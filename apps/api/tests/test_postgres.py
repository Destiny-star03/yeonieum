import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg.conninfo import make_conninfo
from test_documents import metadata, sign_in, upload

from yeonieum.main import create_app
from yeonieum.modules.budgets import evidence as receipt_storage

ORIGIN = {"origin": "http://localhost:5173"}


@pytest.fixture
def postgres_app(monkeypatch, tmp_path):
    conninfo = os.environ.get("YEONIEUM_TEST_POSTGRES_URL")
    if not conninfo:
        pytest.skip("Requires YEONIEUM_TEST_POSTGRES_URL for a disposable PostgreSQL database.")
    schema = "test_" + uuid4().hex
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        try:
            monkeypatch.setenv(
                "YEONIEUM_DATABASE_URL", make_conninfo(conninfo, options=f"-csearch_path={schema}")
            )
            monkeypatch.setenv("YEONIEUM_STORAGE_ROOT", str(tmp_path / "uploads"))
            monkeypatch.delenv("YEONIEUM_POSTGRES_PASSWORD_FILE", raising=False)
            monkeypatch.setenv("YEONIEUM_MODE", "local-demo")
            now = datetime(datetime.now(timezone.utc).year, 6, 1, tzinfo=timezone.utc)
            yield create_app(clock=lambda: now, external_sync=False), now.year
        finally:
            conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def test_postgres_upload_permissions_restart_and_concurrent_folder_uniqueness(postgres_app):
    app, year = postgres_app
    with TestClient(app, headers=ORIGIN) as client:
        assert client.get("/api/health").json()["database"] == "postgresql"
        sign_in(client)
        folder = {
            "org_id": "council",
            "academic_year": year,
            "name": "Meeting",
            "audience": "private",
        }

        def create(name):
            return client.post("/api/documents/folders", json={**folder, "name": name})

        with ThreadPoolExecutor(max_workers=2) as threads:
            results = list(threads.map(create, ["Meeting", "meeting"]))
        assert sorted(response.status_code for response in results) == [201, 409]
        folder_id = next(response.json()["id"] for response in results if response.status_code == 201)
        ident = upload(client, metadata=metadata(academic_year=year, audience="private", folder_id=folder_id))
        starts_at = f"{year}-06-10T09:00:00+09:00"
        event = client.post(
            "/api/calendar/events",
            json={
                "unit_id": "software",
                "title": "가상 회의",
                "starts_at": starts_at,
                "ends_at": f"{year}-06-10T10:00:00+09:00",
            },
        )
        assert event.status_code == 201, event.text

    with TestClient(app, headers=ORIGIN) as client:
        sign_in(client)
        url = f"/api/documents/{ident}/versions/1/download"
        assert client.get(url).content == b"synthetic v1"
        assert client.get(f"/api/calendar/events/{event.json()['id']}").json()["title"] == "가상 회의"
        sign_in(client, "student-other")
        assert client.get(url).status_code == 404


def test_postgres_budget_uses_bigint_and_preserves_same_time_posting_order(postgres_app):
    app, year = postgres_app
    with TestClient(app, headers=ORIGIN) as client:
        sign_in(client, "staff-demo")
        planned = client.post(
            "/api/budgets/annual",
            json={"org_id": "council", "year": year, "amount": 5_000_000_000, "authorize_heads": True},
        )
        assert planned.status_code == 200, planned.text
        sign_in(client)

        def create(amount):
            response = client.post(
                "/api/budgets/expenses",
                json={
                    "request_id": str(uuid4()),
                    "org_id": "council",
                    "year": year,
                    "spent_on": f"{year}-05-20",
                    "purpose": "가상 집행",
                    "amount": amount,
                    "executor_id": "chair",
                },
            )
            assert response.status_code == 200, response.text
            return response.json()["id"]

        first, second = create(4_000_000_000), create(2_000_000_000)
        expenses = client.get(f"/api/budgets/council/{year}").json()["expenses"]
        assert [row["id"] for row in expenses] == [second, first]
        assert [row["exception_required"] for row in expenses] == [1, 0]
        assert all("posting_order" not in row for row in expenses)


def test_postgres_receipt_submission_commits_file_and_expense_once(postgres_app, monkeypatch, tmp_path):
    app, year = postgres_app
    with TestClient(app, headers=ORIGIN) as client:
        sign_in(client, "staff-demo")
        budget = client.post(
            "/api/budgets/annual",
            json={"org_id": "council", "year": year, "amount": 100000, "authorize_heads": True},
        )
        assert budget.status_code == 200, budget.text
        sign_in(client)
        expense = json.dumps(
            {
                "request_id": str(uuid4()),
                "org_id": "council",
                "year": year,
                "spent_on": f"{year}-05-20",
                "purpose": "가상 집행",
                "amount": 12000,
                "executor_id": "chair",
            }
        )

        def submit(receipt):
            return client.post(
                "/api/budgets/expenses/submit",
                data={"expense": expense},
                files={"receipt": ("receipt.pdf", receipt, "application/pdf")},
            )

        assert submit(b"incorrect PDF").status_code == 422
        assert client.get(f"/api/budgets/council/{year}").json()["totals"]["remaining"] == 100000
        receipt = b"%PDF-1.7\n% synthetic receipt\n%%EOF\n"

        def fail_link(*args):
            raise OSError("synthetic link failure")

        with monkeypatch.context() as patch:
            patch.setattr(receipt_storage, "link_evidence", fail_link)
            failed = submit(receipt)
        assert failed.status_code == 500
        assert failed.json()["detail"]["field"] == "receipt"
        assert client.get(f"/api/budgets/council/{year}").json()["totals"]["remaining"] == 100000
        evidence_dir = tmp_path / "uploads" / "evidence"
        assert list(evidence_dir.iterdir()) == []

        created = submit(receipt)
        assert created.status_code == 200, created.text
        assert submit(receipt).json() == created.json()

        detail = client.get(f"/api/budgets/council/{year}").json()
        assert detail["totals"]["remaining"] == 88000
        assert len(detail["expenses"]) == 1
        assert detail["expenses"][0]["evidence_count"] == 1
        ident = created.json()["id"]
        [evidence] = client.get(f"/api/budgets/expenses/{ident}/evidence").json()
        assert client.get(f"/api/budgets/evidence/{evidence['id']}/preview").content == receipt
