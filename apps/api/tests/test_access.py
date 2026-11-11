from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from yeonieum.core.database import connect
from yeonieum.main import create_app
from yeonieum.modules.organizations.seed import DEMO_PASSWORD

ORIGIN = {"origin": "http://localhost:5173"}


@pytest.fixture
def setup(tmp_path):
    path = tmp_path / "test.sqlite3"
    time = [datetime(datetime.now(timezone.utc).year, 6, 1, tzinfo=timezone.utc)]
    app = create_app(path, lambda: time[0])
    with TestClient(app, headers=ORIGIN) as client:
        yield client, path, time, app


def login(client, number="staff-demo"):
    result = client.post("/api/auth/login", json={"identifier": number, "password": DEMO_PASSWORD})
    assert result.status_code == 200, result.text
    return result


def payload(person="member", home="software-2-A", role="class_rep", **extra):
    year = datetime.now(timezone.utc).year
    return {
        "user_id": person,
        "unit_id": home,
        "role": role,
        "starts_at": f"{year}-01-01T00:00:00+00:00",
        "ends_at": f"{year + 1}-01-01T00:00:00+00:00",
        **extra,
    }


def test_login_cookie_and_logout(setup):
    c, _, _, _ = setup
    assert c.get("/api/me").status_code == 401
    response = login(c)
    assert (
        "HttpOnly" in response.headers["set-cookie"] and "SameSite=strict" in response.headers["set-cookie"]
    )
    assert c.get("/api/me").json()["id"] == "teacher"
    c.post("/api/auth/logout", json={})
    assert c.get("/api/me").status_code == 401


def test_bad_password_and_origin_rejected(setup):
    c, _, _, _ = setup
    assert (
        c.post("/api/auth/login", json={"identifier": "staff-demo", "password": "wrong"}).status_code == 401
    )
    assert (
        c.post(
            "/api/auth/login",
            headers={"origin": "https://attacker.invalid"},
            json={"identifier": "staff-demo", "password": DEMO_PASSWORD},
        ).status_code
        == 403
    )


def test_teacher_bootstraps_head_with_required_identity(setup):
    c, _, _, _ = setup
    login(c)
    account = {
        "name": "가상 신규 학회장",
        "email": "new@demo.invalid",
        "identifier": "student-extra",
        "phone": "010-0000-0000",
        "password": DEMO_PASSWORD,
        "unit_id": "software",
    }
    assert c.post("/api/users", json={k: v for k, v in account.items() if k != "phone"}).status_code == 422
    created = c.post("/api/users", json=account)
    assert created.status_code == 201, created.text
    assert c.post("/api/users", json=account).status_code == 409
    # Existing synthetic leader cannot overlap a new leader; future appointment can be recorded.
    year = datetime.now(timezone.utc).year
    data = payload(
        created.json()["id"],
        "software",
        "department_head",
        starts_at=f"{year + 1}-01-01T00:00:00+00:00",
        ends_at=f"{year + 2}-01-01T00:00:00+00:00",
    )
    assert c.post("/api/assignments", json=data).status_code == 201
    assert c.get("/api/audit").json()[0]["action"] == "role.granted"


def test_head_can_assign_own_class_but_not_other_department(setup):
    c, _, _, _ = setup
    login(c, "student-head")
    assert c.post("/api/assignments", json=payload()).status_code == 403
    assert (
        c.post("/api/assignments", json=payload("future", "mechanical", "vice_department_head")).status_code
        == 201
    )
    assert (
        c.post("/api/assignments", json=payload("future", "mechanical", "department_head")).status_code == 403
    )


def test_chair_dual_scope_and_self_escalation(setup):
    c, _, _, _ = setup
    login(c, "student-chair")
    work = c.get("/api/workspace").json()
    assert {"chair", "department_head"} <= {
        r["role"] for r in work["assignments"] if r["user_id"] == "chair" and r["effective"]
    }
    assert any(p["id"] == "head" for p in work["users"])
    assert c.post("/api/assignments", json=payload("chair", "software", "department_head")).status_code == 403
    assert c.post("/api/assignments", json=payload()).status_code == 201
    assert c.post("/api/assignments", json=payload()).status_code == 409


def test_lower_officer_no_redelegation_and_contact_privacy(setup):
    c, _, _, _ = setup
    login(c, "student-vice")
    work = c.get("/api/workspace").json()
    assert work["grant_options"] == []
    assert c.post("/api/assignments", json=payload()).status_code == 403
    others = [p for p in work["users"] if p["id"] != "vice"]
    assert others and all("phone" not in p and "identifier" not in p and "email" not in p for p in others)
    assert all("identifier" not in p for p in work["contacts"])
    assert c.get("/api/audit").status_code == 403


def test_class_scope_keeps_year_and_department_separate(setup):
    c, _, _, _ = setup
    login(c, "student-rep")
    work = c.get("/api/workspace").json()
    assert {p["id"] for p in work["users"]} == {"rep"}
    assert not any(u["id"] == "software-2-A" for u in work["units"])
    assert not any(p["id"] == "head" for p in work["users"])


def test_chair_requires_same_person_same_tenure_and_election(setup):
    c, _, _, _ = setup
    login(c)
    bad = payload(
        "head", "council", "chair", prerequisite_id="head-role", election_note="가상 투표 선출 결과 확인"
    )
    year = datetime.now(timezone.utc).year
    bad["ends_at"] = f"{year}-12-01T00:00:00+00:00"
    assert c.post("/api/assignments", json=bad).status_code == 422
    bad = payload("head", "council", "chair", prerequisite_id="chair-dept", election_note="가상 결과")
    assert c.post("/api/assignments", json=bad).status_code == 422
    bad = payload("head", "council", "chair", prerequisite_id="head-role")
    assert c.post("/api/assignments", json=bad).status_code == 422
    # Revoke only the outgoing chair service role, then register an elected eligible head.
    assert c.post("/api/assignments/chair-role/revoke", json={"reason": "가상 교체 시연"}).status_code == 200
    good = payload(
        "head", "council", "chair", prerequisite_id="head-role", election_note="가상 학회장 투표 결과 확인"
    )
    assert c.post("/api/assignments", json=good).status_code == 201


def test_revoking_prerequisite_ends_chair_for_existing_session(setup):
    c, _, _, app = setup
    with TestClient(app, headers=ORIGIN) as student:
        login(student, "student-chair")
        login(c)
        assert (
            c.post(
                "/api/assignments/chair-dept/revoke", json={"reason": "학회장 자격 중도 종료 시연"}
            ).status_code
            == 200
        )
        roles = student.get("/api/me").json()["assignments"]
        assert roles == []
        assert student.post("/api/assignments", json=payload()).status_code == 403
        rows = c.get("/api/audit").json()
        assert {r["action"] for r in rows} >= {"role.revoked", "role.dependency-ended"}
        assert c.post("/api/assignments/chair-dept/revoke", json={"reason": "재요청"}).status_code == 409


def test_expiry_and_future_activation_use_server_time(setup):
    c, _, clock, _ = setup
    login(c, "student-head")
    year = clock[0].year
    clock[0] = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    # Session renewal keeps identity but not expired permission.
    login(c, "student-head")
    assert c.get("/api/me").json()["assignments"] == []
    assert c.post("/api/assignments", json=payload()).status_code == 403


def test_scope_forgery_and_atomic_audit(setup):
    c, path, _, _ = setup
    login(c, "student-chair")
    assert c.post("/api/assignments", json=payload("other", "software-2-A", "class_rep")).status_code == 422
    conn = connect(path)
    assert conn.execute("SELECT count(*) FROM audit").fetchone()[0] == 0
    conn.close()
    assert c.post("/api/assignments", json=payload("member", "student", "head")).status_code == 403


def test_unauthorized_audit_other_org_and_revocation(setup):
    c, _, _, _ = setup
    login(c)
    c.post("/api/assignments/chair-dept/revoke", json={"reason": "가상 자격 종료"})
    login(c, "student-other")
    assert c.get("/api/audit").json() == []
    assert (
        c.post("/api/assignments/head-role/revoke", json={"reason": "권한 범위 밖 요청"}).status_code == 403
    )


def test_persistence_reopen_preserves_records(setup):
    c, path, _, _ = setup
    login(c, "student-chair")
    created = c.post("/api/assignments", json=payload())
    assert created.status_code == 201
    conn = connect(path)
    assert (
        conn.execute("SELECT role FROM assignments WHERE id=?", (created.json()["id"],)).fetchone()[0]
        == "class_rep"
    )
    assert conn.execute("SELECT count(*) FROM audit").fetchone()[0] == 1
    conn.close()
