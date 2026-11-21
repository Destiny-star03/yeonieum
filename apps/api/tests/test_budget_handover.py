"""Critical local finance and handover boundaries with synthetic data."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from yeonieum.core.database import connect
from yeonieum.main import create_app
from yeonieum.modules.documents.backup import copy_snapshot

ORIGIN = {"origin": "http://localhost:5173"}
YEAR = 2026


def login(client, identifier):
    response = client.post(
        "/api/auth/login", json={"identifier": identifier, "password": "Yeonieum-demo-2026!"}
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def portal(tmp_path):
    db_path = tmp_path / "finance.sqlite3"
    app = create_app(db_path, lambda: datetime(2026, 6, 1, tzinfo=timezone.utc))
    with TestClient(app, headers=ORIGIN) as client:
        yield client, db_path


def grant(client, user_id, org="council", capabilities=("view", "plan", "record", "review", "evidence")):
    login(client, "staff-demo")
    for capability in capabilities:
        response = client.post(
            "/api/budgets/grants",
            json={"user_id": user_id, "org_id": org, "capability": capability, "enabled": True},
        )
        assert response.status_code == 200, response.text


def setup_budget(client, chair):
    grant(client, chair["id"])
    login(client, "student-chair")
    response = client.post(
        "/api/budgets/annual", json={"org_id": "council", "year": YEAR, "amount": 1_000_000}
    )
    assert response.status_code == 200, response.text
    response = client.post(
        "/api/budgets/events",
        json={"org_id": "council", "year": YEAR, "name": "시연 행사", "allocation": 300_000},
    )
    assert response.status_code == 200, response.text
    return response.json()["events"][0]["id"]


def record(client, executor_id, amount, event_id=None, request_id=None):
    response = client.post(
        "/api/budgets/expenses",
        json={
            "org_id": "council",
            "year": YEAR,
            "event_id": event_id,
            "spent_on": "2026-05-20",
            "purpose": "가상 집행",
            "amount": amount,
            "executor_id": executor_id,
            "request_id": request_id or str(uuid4()),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def detail(client):
    response = client.get(f"/api/budgets/council/{YEAR}")
    assert response.status_code == 200, response.text
    return response.json()


def expense(client, ident):
    return next(r for r in detail(client)["expenses"] if r["id"] == ident)


def test_teacher_sets_annual_without_self_grant_and_explicitly_authorizes_current_head(portal):
    client, path = portal
    login(client, "staff-demo")
    result = client.post(
        "/api/budgets/annual",
        json={"org_id": "council", "year": YEAR, "amount": 500000, "authorize_heads": True},
    )
    assert result.status_code == 200
    assert result.json()["capabilities"]["plan"] is True
    assert result.json()["capabilities"]["evidence"] is False
    login(client, "student-chair")
    capabilities = detail(client)["capabilities"]
    assert capabilities["view"] and capabilities["record"] and capabilities["evidence"]
    assert not capabilities["review"] and not capabilities["plan"]
    with connect(path) as conn:
        grants = conn.execute("SELECT * FROM finance_grants WHERE user_id='chair'").fetchall()
        assert len(grants) == 3 and all(r["assignment_id"] for r in grants)
        role_id = grants[0]["assignment_id"]
        conn.execute(
            "UPDATE assignments SET revoked_at=? WHERE id=?",
            (datetime(2026, 6, 1, tzinfo=timezone.utc).isoformat(), role_id),
        )
    assert client.get(f"/api/budgets/council/{YEAR}").status_code == 404
    login(client, "student-vice")
    assert client.get(f"/api/budgets/council/{YEAR}").status_code == 404


def test_annual_does_not_authorize_head_unless_selected_and_student_cannot_delegate(portal):
    client, _ = portal
    chair = login(client, "student-chair")
    login(client, "staff-demo")
    assert (
        client.post(
            "/api/budgets/annual", json={"org_id": "council", "year": YEAR, "amount": 1234}
        ).status_code
        == 200
    )
    login(client, "student-chair")
    assert client.get(f"/api/budgets/council/{YEAR}").status_code == 404
    grant(client, chair["id"], capabilities=("view", "plan"))
    login(client, "student-chair")
    assert (
        client.post(
            "/api/budgets/annual",
            json={
                "org_id": "council",
                "year": YEAR,
                "amount": 5000,
                "expected_revision": 1,
                "authorize_heads": True,
            },
        ).status_code
        == 403
    )
    assert detail(client)["budget"]["amount"] == 1234


def test_overview_and_deduction_ledger_are_scoped_and_count_actual_only_once(portal):
    client, _ = portal
    chair = login(client, "student-chair")
    setup_budget(client, chair)
    first = record(client, chair["id"], 100000)
    second = record(client, chair["id"], 200000)
    rows = {r["id"]: r for r in detail(client)["expenses"]}
    assert (rows[first]["balance_before"], rows[first]["balance_after"]) == (1000000, 900000)
    assert (rows[second]["balance_before"], rows[second]["balance_after"]) == (900000, 700000)
    client.post(
        f"/api/budgets/expenses/{first}/review",
        json={"decision": "rejected", "reason": "가상 반려", "expected_revision": rows[first]["revision"]},
    )
    overview = client.get(f"/api/budgets/overview?year={YEAR}").json()["items"]
    assert [r["org_id"] for r in overview] == ["council"]
    assert overview[0]["totals"]["remaining"] == 700000
    assert overview[0]["totals"]["actual"] == 300000 and overview[0]["expense_count"] == 2
    login(client, "student-other")
    assert client.get(f"/api/budgets/overview?year={YEAR}").json()["items"] == []
    login(client, "staff-demo")
    assert len(client.get(f"/api/budgets/overview?year={YEAR}").json()["items"]) >= 5


def preview(client, data, filename="spending.csv", org="council"):
    return client.post(
        f"/api/budgets/import-preview?org_id={org}&year={YEAR}&filename={filename}", content=data
    )


def workbook(rows, formula=False, entity=False):
    import io
    import zipfile
    from xml.sax.saxutils import escape

    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr(
            "xl/workbook.xml",
            '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="가상 지출" r:id="r1" /></sheets></workbook>',
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml" /></Relationships>',
        )
        cells = []
        for number, row in enumerate(rows, 1):
            values = "".join(
                f'<c r="{chr(65 + i)}{number}" t="inlineStr">'
                + ("<f>1+2</f>" if formula and number == 2 and i == 1 else "")
                + f"<is><t>{escape(str(value))}</t></is></c>"
                for i, value in enumerate(row)
            )
            cells.append(f'<row r="{number}">{values}</row>')
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            ('<!DOCTYPE worksheet [<!ENTITY x "value">]>' if entity else "")
            + "<worksheet><sheetData>"
            + "".join(cells)
            + "</sheetData></worksheet>",
        )
    return data.getvalue()


def test_csv_xlsx_preview_skips_totals_does_not_mutate_ledger_and_requires_evidence(portal):
    client, path = portal
    chair = login(client, "student-chair")
    setup_budget(client, chair)
    data = '용도,금액\n가상 물품,"12,000"\n가상 인쇄,3000\n합계,15000\n'.encode()
    result = preview(client, data)
    assert result.status_code == 200, result.text
    assert result.json()["total"] == 15000 and len(result.json()["items"]) == 2
    xlsx = preview(
        client,
        workbook([["용도", "금액"], ["가상 물품", 12000], ["가상 인쇄", 3000], ["합계", 15000]]),
        "spending.xlsx",
    )
    assert xlsx.status_code == 200 and xlsx.json()["total"] == 15000
    assert detail(client)["totals"]["actual"] == 0
    with connect(path) as conn:
        assert conn.execute("SELECT count(*) FROM expense_evidence").fetchone()[0] == 0
    login(client, "student-vice")
    assert preview(client, data).status_code == 404
    grant(client, "vice", capabilities=("view", "record"))
    login(client, "student-vice")
    assert preview(client, data).status_code == 403


@pytest.mark.parametrize(
    "data,filename",
    [
        (b"", "x.csv"),
        (b"a,b\n1,2", "x.csv"),
        ("용도,금액\na,-1".encode(), "x.csv"),
        ("용도,금액\na,1.5".encode(), "x.csv"),
        ("용도,금액\na,NaN".encode(), "x.csv"),
        ("용도,금액\na,=1+2".encode(), "x.csv"),
        (b"bad zip", "x.xlsx"),
        (b"synthetic", "x.pdf"),
        (workbook([["용도", "금액"], ["a", "3"]], formula=True), "x.xlsx"),
        (workbook([["용도", "금액"], ["a", "3"]], entity=True), "x.xlsx"),
        (("용도,금액\n" + "a,1\n" * 501).encode(), "x.csv"),
        (("용도,금액\n" + "a" * 140000 + ",1\n").encode(), "x.csv"),
    ],
)
def test_preview_rejects_ambiguous_or_unsafe_tables_without_charging(portal, data, filename):
    client, _ = portal
    chair = login(client, "student-chair")
    setup_budget(client, chair)
    assert preview(client, data, filename).status_code == 422
    assert detail(client)["totals"]["actual"] == 0


@pytest.mark.parametrize("change", ["session", "grant", "settled"])
def test_preview_rechecks_current_access_after_stream(portal, change):
    client, path = portal
    chair = login(client, "student-chair")
    setup_budget(client, chair)

    def chunks():
        yield "용도,금액\n".encode()
        with connect(path) as conn:
            if change == "session":
                conn.execute("DELETE FROM sessions WHERE user_id='chair'")
            elif change == "grant":
                conn.execute(
                    "UPDATE finance_grants SET active=0 WHERE user_id='chair' AND capability='evidence'"
                )
            else:
                conn.execute("UPDATE annual_budgets SET settled_at='2026-06-01' WHERE org_id='council'")
        yield "가상 물품,1000\n".encode()

    result = preview(client, chunks())
    assert result.status_code == {"session": 401, "grant": 403, "settled": 409}[change]
    with connect(path) as conn:
        assert conn.execute("SELECT count(*) FROM expenses").fetchone()[0] == 0


def test_actual_spending_review_exception_and_settlement(portal, tmp_path):
    client, db_path = portal
    chair = login(client, "student-chair")
    assert client.get(f"/api/budgets/council/{YEAR}").status_code == 404
    event_id = setup_budget(client, chair)
    rep = login(client, "student-rep")
    assert (
        client.post(
            "/api/budgets/expenses",
            json={
                "org_id": "council",
                "year": YEAR,
                "spent_on": "2026-05-20",
                "purpose": "권한 없음",
                "amount": 1,
                "executor_id": rep["id"],
                "request_id": str(uuid4()),
            },
        ).status_code
        == 404
    )
    login(client, "student-chair")
    request_id = str(uuid4())
    normal = record(client, rep["id"], 100_000, event_id, request_id)
    assert record(client, rep["id"], 100_000, event_id, request_id) == normal
    assert detail(client)["totals"]["actual"] == 100_000
    assert detail(client)["events"][0]["totals"]["actual"] == 100_000
    assert detail(client)["totals"]["pending"] == 100_000
    row = expense(client, normal)
    assert (
        client.post(
            f"/api/budgets/expenses/{normal}/review",
            json={"decision": "rejected", "reason": "가상 반려", "expected_revision": row["revision"]},
        ).status_code
        == 200
    )
    assert detail(client)["totals"]["actual"] == 100_000
    assert detail(client)["totals"]["rejected"] == 100_000
    oversized = record(client, rep["id"], 250_000, event_id)
    row = expense(client, oversized)
    assert row["exception_state"] == "pending"
    assert detail(client)["events"][0]["totals"]["excess"] == 50_000
    assert (
        client.post(
            f"/api/budgets/expenses/{oversized}/exception",
            json={"decision": "approved", "reason": "가상 예외", "expected_revision": row["revision"]},
        ).status_code
        == 200
    )
    row = expense(client, oversized)
    assert (
        client.post(
            f"/api/budgets/expenses/{oversized}/review",
            json={"decision": "approved", "reason": "증빙 확인", "expected_revision": row["revision"]},
        ).status_code
        == 200
    )
    row = expense(client, oversized)
    assert (
        client.post(
            f"/api/budgets/expenses/{oversized}/correct",
            json={
                "amount": 240_000,
                "purpose": "가상 정정",
                "reason": "금액 확인",
                "expected_revision": row["revision"],
            },
        ).status_code
        == 200
    )
    row = expense(client, oversized)
    assert row["review_state"] == "pending" and row["changes"]
    assert detail(client)["events"][0]["totals"]["actual"] == 340_000
    assert detail(client)["totals"]["actual"] == 340_000
    assert detail(client)["totals"]["pending"] == 240_000
    assert (
        client.put(
            f"/api/budgets/expenses/{oversized}/evidence?filename=receipt.txt", content=b"synthetic receipt"
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/budgets/expenses/{normal}/evidence?filename=receipt.txt", content=b"synthetic receipt 2"
        ).status_code
        == 200
    )
    evidence_id = client.get(f"/api/budgets/expenses/{normal}/evidence").json()[0]["id"]
    login(client, "student-rep")
    assert client.get(f"/api/budgets/evidence/{evidence_id}/download").status_code == 404
    login(client, "student-other")
    assert client.get(f"/api/budgets/council/{YEAR}").status_code == 404
    login(client, "staff-demo")
    assert (
        client.post(
            "/api/budgets/settle",
            json={
                "org_id": "council",
                "year": YEAR,
                "expected_revision": detail(client)["budget"]["revision"],
            },
        ).status_code
        == 409
    )
    login(client, "student-chair")
    row = expense(client, oversized)
    assert (
        client.post(
            f"/api/budgets/expenses/{oversized}/exception",
            json={"decision": "approved", "reason": "정정 후 확인", "expected_revision": row["revision"]},
        ).status_code
        == 200
    )
    row = expense(client, oversized)
    assert (
        client.post(
            f"/api/budgets/expenses/{oversized}/review",
            json={"decision": "approved", "reason": "재검토 완료", "expected_revision": row["revision"]},
        ).status_code
        == 200
    )
    login(client, "staff-demo")
    settled = client.post(
        "/api/budgets/settle",
        json={"org_id": "council", "year": YEAR, "expected_revision": detail(client)["budget"]["revision"]},
    )
    assert settled.status_code == 200
    historical = client.get(f"/api/budgets/history/settlements/{settled.json()['id']}")
    assert historical.status_code == 200
    assert historical.json()["snapshot"]["totals"]["actual"] == 340_000
    login(client, "student-chair")
    row = expense(client, normal)
    assert (
        client.post(
            f"/api/budgets/expenses/{normal}/correct",
            json={"amount": 1, "purpose": "변경", "reason": "확정 후", "expected_revision": row["revision"]},
        ).status_code
        == 409
    )
    target = tmp_path / "backup"
    copy_snapshot(db_path, target)
    assert (target / "prototype-evidence").exists()
    assert len(list((target / "prototype-evidence").iterdir())) == 2
    assert (target / "backup.json").exists()


def test_head_own_excess_requires_teacher_and_grant_does_not_revive(portal):
    client, db_path = portal
    chair = login(client, "student-chair")
    setup_budget(client, chair)
    own = record(client, chair["id"], 1_200_000)
    row = expense(client, own)
    assert (
        client.post(
            f"/api/budgets/expenses/{own}/exception",
            json={"decision": "approved", "reason": "본인 예외", "expected_revision": row["revision"]},
        ).status_code
        == 403
    )
    login(client, "staff-demo")
    assert (
        client.post(
            f"/api/budgets/expenses/{own}/exception",
            json={"decision": "approved", "reason": "선생님 확인", "expected_revision": row["revision"]},
        ).status_code
        == 200
    )
    with connect(db_path) as conn:
        linked = conn.execute(
            "SELECT assignment_id FROM finance_grants WHERE user_id=? AND org_id='council' AND capability='record'",
            (chair["id"],),
        ).fetchone()[0]
        original = conn.execute("SELECT * FROM assignments WHERE id=?", (linked,)).fetchone()
        conn.execute(
            "UPDATE assignments SET revoked_at=? WHERE id=?",
            (datetime(2026, 6, 1, tzinfo=timezone.utc).isoformat(), linked),
        )
        conn.execute(
            "INSERT INTO assignments(id,user_id,unit_id,role,starts_at,ends_at,activated_at,granted_by,prerequisite_id,election_note) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                "new-finance-role",
                original["user_id"],
                original["unit_id"],
                original["role"],
                original["starts_at"],
                original["ends_at"],
                original["activated_at"],
                original["granted_by"],
                original["prerequisite_id"],
                original["election_note"],
            ),
        )
    grant(client, chair["id"], capabilities=("view",))
    login(client, "student-chair")
    assert detail(client)["capabilities"]["record"] is False


def test_handover_recipient_only_checks_and_history_survives_role_change(portal):
    client, db_path = portal
    chair = login(client, "student-chair")
    vice = login(client, "student-vice")
    login(client, "student-chair")
    created = client.post(
        "/api/handovers",
        json={
            "org_id": "council",
            "year": YEAR,
            "from_user_id": chair["id"],
            "to_user_id": vice["id"],
            "title": "가상 중도 교체",
        },
    )
    assert created.status_code == 200, created.text
    ident = created.json()["id"]
    assert (
        client.post(
            f"/api/handovers/{ident}/items",
            json={"kind": "task", "title": "예산 현황 확인", "required": True, "expected_revision": 1},
        ).status_code
        == 200
    )
    row = client.get(f"/api/handovers/{ident}").json()
    item_id = row["items"][0]["id"]
    assert (
        client.post(
            f"/api/handovers/{ident}/items/{item_id}/check", json={"expected_revision": row["revision"]}
        ).status_code
        == 403
    )
    login(client, "student-vice")
    assert (
        client.post(
            f"/api/handovers/{ident}/complete", json={"expected_revision": row["revision"]}
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/handovers/{ident}/items/{item_id}/check", json={"expected_revision": row["revision"]}
        ).status_code
        == 200
    )
    row = client.get(f"/api/handovers/{ident}").json()
    assert (
        client.post(
            f"/api/handovers/{ident}/complete", json={"expected_revision": row["revision"]}
        ).status_code
        == 200
    )
    with connect(db_path) as conn:
        assert (
            conn.execute("SELECT count(*) FROM handover_checks WHERE item_id=?", (item_id,)).fetchone()[0]
            == 1
        )
        assert (
            conn.execute(
                "SELECT count(*) FROM audit WHERE action='handover.completed' AND target_id=?", (ident,)
            ).fetchone()[0]
            == 1
        )
    login(client, "student-other")
    assert client.get(f"/api/handovers/{ident}").status_code == 404
