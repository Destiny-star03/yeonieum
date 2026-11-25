from datetime import datetime, timezone

from fastapi.testclient import TestClient
from test_calendar import payload
from test_documents import ORIGIN, metadata, sign_in, upload

from yeonieum.main import create_app


def inbox(client):
    response = client.get("/api/notifications")
    assert response.status_code == 200, response.text
    return response.json()["items"]


def test_document_notifications_follow_membership_and_private_storage(tmp_path):
    clock = datetime(datetime.now(timezone.utc).year, 6, 1, tzinfo=timezone.utc)
    app = create_app(tmp_path / "documents.sqlite3", lambda: clock)
    with TestClient(app, headers=ORIGIN) as client:
        sign_in(client)
        ident = upload(client, metadata=metadata(title="단체 새 자료", audience="organization"))
        private = upload(client, metadata=metadata(title="개인 자료", audience="private"))
        assert inbox(client) == []
        sign_in(client, "student-rep")
        [notice] = inbox(client)
        assert notice["target"]["id"] == ident and notice["title"] == "단체 새 자료" and not notice["read"]
        path = f"/api/notifications/{notice['id']}/read"
        assert client.post(path, json={}).status_code == 200
        assert client.post(path, json={}).status_code == 200
        assert inbox(client)[0]["read"]
        sign_in(client, "student-other")
        assert inbox(client) == [] and client.post(path, json={}).status_code == 404
        sign_in(client)
        assert (
            client.post(
                f"/api/documents/{private}/metadata",
                json={
                    "metadata": metadata(title="공유한 자료", audience="organization"),
                    "expected_revision": 1,
                },
            ).status_code
            == 200
        )
        sign_in(client, "student-rep")
        assert {item["title"] for item in inbox(client)} == {"단체 새 자료", "공유한 자료"}
        sign_in(client)
        assert client.post(f"/api/documents/{ident}/trash", json={"expected_revision": 1}).status_code == 200
        sign_in(client, "student-rep")
        assert [item["target"]["id"] for item in inbox(client)] == [private]
        sign_in(client)
        assert (
            client.post("/api/assignments/rep-role/revoke", json={"reason": "임기 종료 확인"}).status_code
            == 200
        )
    with TestClient(app, headers=ORIGIN) as reopened:
        sign_in(reopened, "student-rep")
        assert inbox(reopened) == []
        assert reopened.post(path, json={}).status_code == 404


def test_shared_calendar_alerts_use_current_visibility_and_do_not_leak_masked_titles(tmp_path):
    clock = datetime(datetime.now(timezone.utc).year, 6, 1, tzinfo=timezone.utc)
    with TestClient(create_app(tmp_path / "calendar.sqlite3", lambda: clock), headers=ORIGIN) as client:
        sign_in(client, "staff-demo")
        data = payload(title="비공개 안건", visibility="busy", additional_unit_ids=["student"])
        response = client.post("/api/calendar/events", json=data)
        assert response.status_code == 201, response.text
        ident = response.json()["id"]
        assert inbox(client) == []
        sign_in(client, "student-rep")
        [notice] = inbox(client)
        assert notice["kind"] == "calendar" and notice["target"]["id"] == ident
        assert notice["title"] == "바쁨"
        sign_in(client, "student-other")
        assert [item["target"]["id"] for item in inbox(client)] == [ident]
        sign_in(client, "student-head")
        assert inbox(client) == []
        sign_in(client, "staff-demo")
        # A participant addition is delivered once, and the participant may see the full title.
        update = {key: value for key, value in data.items() if key != "additional_unit_ids"}
        response = client.post(
            f"/api/calendar/events/{ident}/update",
            json={**update, "participant_ids": ["rep"], "expected_revision": 1},
        )
        assert response.status_code == 200, response.text
        sign_in(client, "student-rep")
        notices = inbox(client)
        assert len(notices) == 2 and {item["title"] for item in notices} == {"비공개 안건"}
        sign_in(client, "staff-demo")
        assert (
            client.post(
                f"/api/calendar/events/{ident}/remove", json={"expected_revision": 2, "confirmed": True}
            ).status_code
            == 200
        )
        sign_in(client, "student-rep")
        assert inbox(client) == []
