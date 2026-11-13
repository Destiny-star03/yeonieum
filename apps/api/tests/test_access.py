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
        "identifier": "20260001",
        "phone": "010-0000-0000",
        "password": DEMO_PASSWORD,
        "unit_ids": ["software"],
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


def account(identifier="20260002", home="council"):
    return {
        "name": "가상 조직 담당자",
        "email": f"{identifier}@demo.invalid",
        "identifier": identifier,
        "phone": "01012345678",
        "password": DEMO_PASSWORD,
        "unit_ids": [home],
    }


def test_five_organizations_and_teacher_routes_org_registration_to_department(setup):
    c, path, _, _ = setup
    login(c)
    work = c.get("/api/workspace").json()
    assert {u["name"] for u in work["units"] if u["kind"] == "organization" and u["active"]} == {
        "총학생회",
        "학과협의회",
        "신문방송국",
        "연합동아리",
        "모니터링단",
    }
    created = c.post("/api/users", json=account())
    assert created.status_code == 201
    ident = created.json()["id"]
    year = datetime.now(timezone.utc).year
    assert (
        c.post(
            "/api/assignments",
            json=payload(
                ident,
                "software",
                "department_head",
                starts_at=f"{year + 1}-01-01T00:00:00+00:00",
                ends_at=f"{year + 2}-01-01T00:00:00+00:00",
            ),
        ).status_code
        == 201
    )
    conn = connect(path)
    assert conn.execute("SELECT phone FROM users WHERE id=?", (ident,)).fetchone()[0] == "010-1234-5678"
    assert {r[0] for r in conn.execute("SELECT unit_id FROM memberships WHERE user_id=?", (ident,))} == {
        "software"
    }
    conn.close()


def test_chair_routes_pending_member_but_lower_head_cannot_guess_pending_id(setup):
    c, _, _, _ = setup
    login(c)
    ident = c.post("/api/users", json=account()).json()["id"]
    login(c, "student-head")
    assert (
        c.post("/api/assignments", json=payload(ident, "mechanical", "vice_department_head")).status_code
        == 422
    )
    login(c, "student-chair")
    assert c.post("/api/assignments", json=payload(ident, "software-2-A", "class_rep")).status_code == 201


def test_remove_person_requires_admin_and_exact_confirmation(setup):
    c, _, _, _ = setup
    login(c, "student-chair")
    assert c.post("/api/users/member/remove", json={"confirmation": "제거하겠습니다"}).status_code == 403
    login(c)
    assert c.post("/api/users/member/remove", json={"confirmation": "제거"}).status_code == 422
    assert c.post("/api/users/teacher/remove", json={"confirmation": "제거하겠습니다"}).status_code == 403
    assert any(p["id"] == "member" for p in c.get("/api/workspace").json()["users"])


def test_remove_person_ends_sessions_roles_preserves_history_and_restart(setup):
    c, path, clock, app = setup
    login(c)
    with TestClient(app, headers=ORIGIN) as student:
        login(student, "student-chair")
        assert c.post("/api/users/chair/remove", json={"confirmation": "제거하겠습니다"}).status_code == 200
        assert student.get("/api/me").status_code == 401
        assert (
            student.post(
                "/api/auth/login", json={"identifier": "student-chair", "password": DEMO_PASSWORD}
            ).status_code
            == 401
        )
    work = c.get("/api/workspace").json()
    assert all(p["id"] != "chair" for p in work["users"])
    assert all(p["id"] != "chair" for p in work["contacts"])
    assert all(a["revoked_at"] and not a["effective"] for a in work["assignments"] if a["user_id"] == "chair")
    assert {a["action"] for a in c.get("/api/audit").json()} >= {"user.removed", "role.revoked"}
    with TestClient(create_app(path, lambda: clock[0]), headers=ORIGIN) as reopened:
        login(reopened)
        assert all(p["id"] != "chair" for p in reopened.get("/api/workspace").json()["users"])


def test_organization_lifecycle_rechecks_permissions_and_preserves_records(setup):
    c, path, clock, app = setup
    login(c, "student-chair")
    assert c.post("/api/organizations", json={"name": "신설단체"}).status_code == 403
    assert (
        c.post("/api/organizations/student/remove", json={"confirmation": "삭제하겠습니다"}).status_code
        == 403
    )
    login(c)
    assert c.post("/api/organizations", json={"name": "   "}).status_code == 422
    created = c.post("/api/organizations", json={"name": "  신설단체  "})
    assert created.status_code == 201
    org = created.json()["id"]
    assert c.post("/api/organizations", json={"name": "신설단체"}).status_code == 409
    person = c.post("/api/users", json=account("20260003", org)).json()["id"]
    assert c.post("/api/assignments", json=payload(person, org, "head")).status_code == 201
    assert c.post(f"/api/organizations/{org}/remove", json={"confirmation": "잘못된 이름"}).status_code == 422
    with TestClient(app, headers=ORIGIN) as student:
        accept_latest(c, person)
        login(student, "20260003")
        assert student.get("/api/me").json()["assignments"]
        assert (
            c.post(f"/api/organizations/{org}/remove", json={"confirmation": "삭제하겠습니다"}).status_code
            == 200
        )
        assert student.get("/api/me").json()["assignments"] == []
    assert c.post("/api/assignments", json=payload(person, org, "head")).status_code == 403
    assert c.post("/api/users", json=account("20260004", org)).status_code == 403
    work = c.get("/api/workspace").json()
    assert any(u["id"] == org and not u["active"] for u in work["units"])
    assert not any(o["unit_id"] == org for o in work["grant_options"])
    assert any(p["id"] == person for p in work["users"])
    assert any(a["unit_id"] == org and a["revoked_at"] and not a["effective"] for a in work["assignments"])
    with TestClient(create_app(path, lambda: clock[0]), headers=ORIGIN) as reopened:
        login(reopened)
        assert any(u["id"] == org and not u["active"] for u in reopened.get("/api/workspace").json()["units"])
        restored = reopened.post("/api/organizations", json={"name": "신설단체"})
        assert restored.status_code == 200
        assert restored.json() == {"id": org, "name": "신설단체", "restored": True}
        work = reopened.get("/api/workspace").json()
        assert len([u for u in work["units"] if u["name"] == "신설단체"]) == 1
        assert any(u["id"] == org and u["active"] for u in work["units"])
        assert all(not a["effective"] and a["revoked_at"] for a in work["assignments"] if a["unit_id"] == org)
        assert reopened.get("/api/audit").json()[0]["action"] == "organization.restored"
        assert reopened.post("/api/organizations", json={"name": "신설단체"}).status_code == 409
        # A fresh appointment is possible, while the old appointment remains revoked.
        assert reopened.post("/api/assignments", json=payload(person, org, "head")).status_code == 201


def test_old_database_migrates_without_losing_data(tmp_path):
    import sqlite3

    from yeonieum.core.database import SCHEMA

    path = tmp_path / "legacy.sqlite3"
    old = sqlite3.connect(path)
    old.executescript(SCHEMA)
    old.execute("INSERT INTO units VALUES ('legacy','legacy',NULL,'organization','기존 단체')")
    old.commit()
    old.close()
    migrated = connect(path)
    assert dict(migrated.execute("SELECT * FROM units WHERE id='legacy'").fetchone())["active"] == 1
    migrated.close()


def test_restoring_council_keeps_child_units_and_revoked_roles_separate(setup):
    c, _, _, app = setup
    login(c)
    assert (
        c.post("/api/organizations/council/remove", json={"confirmation": "삭제하겠습니다"}).status_code
        == 200
    )
    login(c, "student-other")
    assert c.post("/api/organizations", json={"name": "학과협의회"}).status_code == 403
    login(c)
    restored = c.post("/api/organizations", json={"name": "  학과협의회  "})
    assert restored.status_code == 200 and restored.json()["id"] == "council"
    work = c.get("/api/workspace").json()
    assert all(u["active"] for u in work["units"] if u["org_id"] == "council")
    assert all(
        a["revoked_at"] and not a["effective"] for a in work["assignments"] if a["unit_id"] != "student"
    )
    assert any(a["id"] == "other-role" and a["effective"] for a in work["assignments"])
    with TestClient(app, headers=ORIGIN) as student:
        login(student, "student-chair")
        assert student.get("/api/me").json()["assignments"] == []


# Only the local development outbox exposes test invitation links to its managers.
def accept_latest(client, user_id):
    from urllib.parse import parse_qs, urlparse

    messages = client.get("/api/invitations/outbox").json()["messages"]
    link = next(m["link"] for m in messages if m["user_id"] == user_id)
    token = parse_qs(urlparse(link).fragment)["invite"][0]
    response = client.post("/api/invitations/accept", json={"token": token})
    assert response.status_code == 200, response.text
    return token


@pytest.mark.parametrize(
    "field,value",
    [
        ("identifier", "1234567"),
        ("identifier", "123456789"),
        ("identifier", "1234567a"),
        ("password", "abc123!"),
        ("password", "abcdefgh!"),
        ("password", "abcd1234"),
        ("email", "not-an-email"),
        ("email", "a..b@example.com"),
        ("email", "person@bad_domain.com"),
        ("email", "person@bad#domain.com"),
        ("email", "bad[box]@example.com"),
        ("unit_ids", []),
    ],
)
def test_registration_rejects_invalid_fields(setup, field, value):
    c, path, _, _ = setup
    login(c)
    data = account()
    data[field] = value
    assert c.post("/api/users", json=data).status_code == 422
    conn = connect(path)
    assert conn.execute("SELECT count(*) FROM invitations").fetchone()[0] == 0
    conn.close()


def test_multi_membership_and_invitation_required_before_login_and_roles(setup):
    c, _, _, app = setup
    login(c)
    data = {**account("00123456"), "password": "1234567!", "unit_ids": ["council", "student", "council"]}
    created = c.post("/api/users", json=data)
    assert created.status_code == 201
    person = created.json()["id"]
    assert "link" not in created.json()
    work = c.get("/api/workspace").json()
    row = next(p for p in work["users"] if p["id"] == person)
    assert set(row["unit_ids"]) == {"council", "student"} and row["email_verified"] == 0
    assert c.post("/api/assignments", json=payload(person, "monitoring", "head")).status_code == 422
    assert (
        c.post(
            "/api/assignments",
            json=payload(person, "council", "chair", prerequisite_id="chair-dept", election_note="가상 결과"),
        ).status_code
        == 422
    )
    with TestClient(app, headers=ORIGIN) as student:
        assert (
            student.post(
                "/api/auth/login", json={"identifier": data["identifier"], "password": data["password"]}
            ).status_code
            == 401
        )
        token = accept_latest(c, person)
        assert (
            student.post(
                "/api/auth/login", json={"identifier": data["identifier"], "password": data["password"]}
            ).status_code
            == 200
        )
        assert student.get("/api/me").json()["assignments"] == []
        assert student.get("/api/invitations/outbox").json()["messages"] == []
        assert student.post("/api/invitations/accept", json={"token": token}).status_code == 400


def test_invite_expiry_reissue_and_old_link_invalidation(setup):
    from datetime import timedelta
    from urllib.parse import parse_qs, urlparse

    c, _, clock, _ = setup
    login(c)
    person = c.post("/api/users", json=account()).json()["id"]
    old_link = c.get("/api/invitations/outbox").json()["messages"][0]["link"]
    old_token = parse_qs(urlparse(old_link).fragment)["invite"][0]
    assert c.post(f"/api/users/{person}/invite", json={}).status_code == 429
    clock[0] += timedelta(hours=25)
    assert c.post("/api/invitations/accept", json={"token": old_token}).status_code == 400
    login(c)
    assert c.post(f"/api/users/{person}/invite", json={}).status_code == 200
    assert c.post("/api/invitations/accept", json={"token": old_token}).status_code == 400
    accept_latest(c, person)
    assert c.post(f"/api/users/{person}/invite", json={}).status_code == 409


def test_account_restore_keeps_identity_history_but_requires_new_invitation(setup):
    c, _, _, app = setup
    login(c)
    data = account()
    person = c.post("/api/users", json=data).json()["id"]
    old_token = accept_latest(c, person)
    assert c.post("/api/assignments", json=payload(person, "monitoring", "head")).status_code == 422
    assert (
        c.post(
            "/api/assignments",
            json=payload(
                person,
                "software",
                "department_head",
                starts_at=f"{datetime.now(timezone.utc).year + 1}-01-01T00:00:00+00:00",
                ends_at=f"{datetime.now(timezone.utc).year + 2}-01-01T00:00:00+00:00",
            ),
        ).status_code
        == 201
    )
    with TestClient(app, headers=ORIGIN) as student:
        login(student, data["identifier"])
        assert (
            c.post(f"/api/users/{person}/remove", json={"confirmation": "제거하겠습니다"}).status_code == 200
        )
        assert student.get("/api/me").status_code == 401
        assert c.post("/api/users", json={**data, "email": "different@demo.invalid"}).status_code == 409
        assert c.post("/api/users", json={**data, "identifier": "20269999"}).status_code == 409
        restored = c.post("/api/users", json={**data, "unit_ids": ["student", "press"]})
        assert restored.status_code == 200 and restored.json()["restored"] and restored.json()["id"] == person
        assert c.post("/api/invitations/accept", json={"token": old_token}).status_code == 400
        assert (
            student.post(
                "/api/auth/login", json={"identifier": data["identifier"], "password": data["password"]}
            ).status_code
            == 401
        )
        accept_latest(c, person)
        login(student, data["identifier"])
        assert student.get("/api/me").json()["assignments"] == []
    work = c.get("/api/workspace").json()
    assert set(next(p for p in work["users"] if p["id"] == person)["unit_ids"]) == {"student", "press"}
    assert all(a["revoked_at"] and not a["effective"] for a in work["assignments"] if a["user_id"] == person)
    assert "user.restored" in {a["action"] for a in c.get("/api/audit").json()}


def test_partial_scope_cannot_register_multiple_organizations_or_restore_accounts(setup):
    c, path, _, _ = setup
    login(c, "student-chair")
    assert c.post("/api/users", json={**account(), "unit_ids": ["software", "student"]}).status_code == 403
    conn = connect(path)
    assert conn.execute("SELECT count(*) FROM users WHERE identifier='20260002'").fetchone()[0] == 0
    conn.close()
    login(c)
    person = c.post("/api/users", json=account()).json()["id"]
    c.post(f"/api/users/{person}/remove", json={"confirmation": "제거하겠습니다"})
    login(c, "student-chair")
    assert c.post("/api/users", json={**account(), "unit_ids": ["software"]}).status_code == 403
    assert c.post(f"/api/users/{person}/invite", json={}).status_code == 403
    assert c.get("/api/invitations/outbox").json()["messages"] == []


def test_multiple_affiliations_keep_role_scopes_and_other_org_metadata_private(setup):
    c, _, _, app = setup
    login(c)
    person = c.post("/api/users", json={**account(), "unit_ids": ["council", "student"]}).json()["id"]
    year = datetime.now(timezone.utc).year
    assert (
        c.post(
            "/api/assignments",
            json=payload(
                person,
                "software",
                "department_head",
                starts_at=f"{year + 1}-01-01T00:00:00+00:00",
                ends_at=f"{year + 2}-01-01T00:00:00+00:00",
            ),
        ).status_code
        == 201
    )
    work = c.get("/api/workspace").json()
    assert set(next(p for p in work["users"] if p["id"] == person)["unit_ids"]) == {"software", "student"}
    # Narrowing one affiliation must neither remove the other nor expand its permissions.
    accept_latest(c, person)
    with TestClient(app, headers=ORIGIN) as leader:
        login(leader, "student-other")
        row = next(p for p in leader.get("/api/workspace").json()["users"] if p["id"] == person)
        assert row["unit_ids"] == ["student"]
        registration = next(a for a in leader.get("/api/audit").json() if a["action"] == "user.registered")
        assert registration["detail"]["unit_ids"] == ["student"]


def new_unit(client, parent, kind, name):
    result = client.post("/api/units", json={"parent_id": parent, "kind": kind, "name": name})
    assert result.status_code == 201, result.text
    return result.json()["id"]


def test_teacher_can_grant_all_default_roles_at_correct_scope(setup):
    c, _, _, _ = setup
    login(c)
    press_office = new_unit(c, "press", "office", "방송기획부")
    club = new_unit(c, "clubs", "club", "사진동아리")
    work = c.get("/api/workspace").json()
    options = {(o["unit_id"], o["role"]): o["label"] for o in work["grant_options"]}
    assert options[("student", "head")] == "학생회장"
    assert options[("press", "head")] == "국장"
    assert options[("clubs", "head")] == "연합회장"
    assert options[("student-office", "manager")] == "부장"
    assert options[("student-office", "deputy")] == "차장"
    assert options[(press_office, "manager")] == "부장"
    assert options[("software", "vice_department_head")] == "부학회장"
    assert options[("software-2-A", "class_rep")] == "2학년 A반 반대표"
    assert {role for (unit_id, role) in options if unit_id == club} == {
        "club_head",
        "club_vice",
        "club_treasurer",
    }
    assert (club, "head") not in options and ("student", "manager") not in options


def test_subunit_creation_checks_parent_and_scope_and_duplicates(setup):
    c, _, _, _ = setup
    login(c, "student-chair")
    assert (
        c.post(
            "/api/units", json={"parent_id": "council", "kind": "department", "name": "새 학과"}
        ).status_code
        == 403
    )
    login(c)
    dept = new_unit(c, "council", "department", "새 학과")
    year = new_unit(c, dept, "year", "1학년")
    group = new_unit(c, year, "class", "A반")
    assert c.post("/api/units", json={"parent_id": year, "kind": "class", "name": " A반 "}).status_code == 409
    assert (
        c.post("/api/units", json={"parent_id": "press", "kind": "department", "name": "학과"}).status_code
        == 422
    )
    assert (
        c.post("/api/units", json={"parent_id": group, "kind": "class", "name": "하위반"}).status_code == 422
    )
    assert any(
        o["unit_id"] == group and o["role"] == "class_rep"
        for o in c.get("/api/workspace").json()["grant_options"]
    )


def test_custom_role_lifecycle_revokes_and_restores_type_only(setup):
    c, path, clock, app = setup
    login(c)
    data = {"org_id": "council", "label": "행사 담당", "scope_kind": "class"}
    created = c.post("/api/role-types", json=data)
    assert created.status_code == 201
    role = created.json()
    assert c.post("/api/role-types", json=data).status_code == 409
    assert c.post("/api/assignments", json=payload("member", "software-2-A", role["code"])).status_code == 201
    with TestClient(app, headers=ORIGIN) as member:
        login(member, "student-new")
        assert len(member.get("/api/me").json()["assignments"]) == 1
        assert member.post("/api/role-types", json=data).status_code == 403
        assert (
            member.post("/api/assignments", json=payload("rep", "software-2-A", role["code"])).status_code
            == 403
        )
        assert (
            c.post(f"/api/role-types/{role['id']}/remove", json={"confirmation": "삭제"}).status_code == 422
        )
        assert (
            c.post(
                f"/api/role-types/{role['id']}/remove", json={"confirmation": "삭제하겠습니다"}
            ).status_code
            == 200
        )
        assert member.get("/api/me").json()["assignments"] == []
    assert c.post("/api/assignments", json=payload("member", "software-2-A", role["code"])).status_code == 422
    with TestClient(create_app(path, lambda: clock[0]), headers=ORIGIN) as reopened:
        login(reopened)
        assert any(
            t["id"] == role["id"] and not t["active"]
            for t in reopened.get("/api/workspace").json()["role_definitions"]
        )
        restored = reopened.post("/api/role-types", json=data)
        assert restored.status_code == 200 and restored.json()["code"] == role["code"]
        assert all(
            a["revoked_at"] and not a["effective"]
            for a in reopened.get("/api/workspace").json()["assignments"]
            if a["role"] == role["code"]
        )


def test_deleting_department_head_type_ends_linked_chair_and_preserves_other_roles(setup):
    c, path, clock, app = setup
    login(c)
    assert (
        c.post(
            "/api/role-types/council:department_head/remove", json={"confirmation": "삭제하겠습니다"}
        ).status_code
        == 200
    )
    work = c.get("/api/workspace").json()
    assert all(
        not a["effective"] and a["revoked_at"]
        for a in work["assignments"]
        if a["id"] in {"chair-role", "chair-dept", "head-role"}
    )
    assert any(a["id"] == "vice-role" and a["effective"] for a in work["assignments"])
    assert any(a["id"] == "other-role" and a["effective"] for a in work["assignments"])
    with TestClient(create_app(path, lambda: clock[0]), headers=ORIGIN) as reopened:
        login(reopened)
        work = reopened.get("/api/workspace").json()
        assert not any(o["role"] == "department_head" for o in work["grant_options"])
        restored = reopened.post(
            "/api/role-types", json={"org_id": "council", "label": "학회장", "scope_kind": "department"}
        )
        assert restored.status_code == 200 and restored.json()["code"] == "department_head"
        assert all(
            not a["effective"]
            for a in reopened.get("/api/workspace").json()["assignments"]
            if a["id"] in {"chair-role", "chair-dept", "head-role"}
        )


def test_role_types_do_not_cross_organization_and_unrecognized_codes_are_rejected(setup):
    c, _, _, _ = setup
    login(c)
    assert (
        c.post(
            "/api/role-types", json={"org_id": "press", "label": "학회장", "scope_kind": "department"}
        ).status_code
        == 422
    )
    assert (
        c.post(
            "/api/role-types",
            json={"org_id": "press", "label": "새 역할", "scope_kind": "office", "code": "head"},
        ).status_code
        == 422
    )
    assert (
        c.post("/api/assignments", json=payload("member", "software-2-A", "nonexistent-code")).status_code
        == 422
    )
    login(c, "student-head")
    assert (
        c.post(
            "/api/role-types", json={"org_id": "council", "label": "새 역할", "scope_kind": "department"}
        ).status_code
        == 403
    )
    assert (
        c.post("/api/role-types/student:manager/remove", json={"confirmation": "삭제하겠습니다"}).status_code
        == 403
    )


def test_deleting_same_named_role_type_in_one_organization_does_not_touch_another(setup):
    c, _, _, _ = setup
    login(c)
    press = new_unit(c, "press", "office", "편집부")
    student_person = c.post("/api/users", json=account("20261001", "student")).json()["id"]
    press_person = c.post("/api/users", json=account("20261002", "press")).json()["id"]
    accept_latest(c, student_person)
    accept_latest(c, press_person)
    assert (
        c.post("/api/assignments", json=payload(student_person, "student-office", "manager")).status_code
        == 201
    )
    assert c.post("/api/assignments", json=payload(press_person, press, "manager")).status_code == 201
    assert (
        c.post("/api/role-types/student:manager/remove", json={"confirmation": "삭제하겠습니다"}).status_code
        == 200
    )
    work = c.get("/api/workspace").json()
    assert all(not a["effective"] for a in work["assignments"] if a["user_id"] == student_person)
    assert any(a["effective"] for a in work["assignments"] if a["user_id"] == press_person)


def test_club_roles_allow_federation_head_but_not_club_officer_redelegation(setup):
    c, _, _, app = setup
    login(c)
    club = new_unit(c, "clubs", "club", "사진동아리")
    leader = c.post("/api/users", json=account("20261003", "clubs")).json()["id"]
    president = c.post("/api/users", json=account("20261004", "clubs")).json()["id"]
    vice = c.post("/api/users", json=account("20261005", "clubs")).json()["id"]
    accept_latest(c, leader)
    accept_latest(c, president)
    accept_latest(c, vice)
    assert c.post("/api/assignments", json=payload(leader, "clubs", "head")).status_code == 201
    with TestClient(app, headers=ORIGIN) as federation:
        login(federation, "20261003")
        assert (
            federation.post("/api/assignments", json=payload(president, club, "club_head")).status_code == 201
        )
        assert federation.post("/api/assignments", json=payload(vice, club, "club_vice")).status_code == 201
    with TestClient(app, headers=ORIGIN) as officer:
        login(officer, "20261004")
        assert officer.get("/api/workspace").json()["grant_options"] == []
        assert officer.post("/api/assignments", json=payload(vice, club, "club_treasurer")).status_code == 403


def test_explicit_role_grants_can_add_another_office_without_widening_lower_officers(setup):
    c, _, _, app = setup
    login(c)
    second = new_unit(c, "student", "office", "홍보부")
    person = c.post("/api/users", json=account("20261006", "student")).json()["id"]
    accept_latest(c, person)
    assert c.post("/api/assignments", json=payload(person, "student-office", "manager")).status_code == 201
    with TestClient(app, headers=ORIGIN) as leader:
        login(leader, "student-other")
        assert leader.post("/api/assignments", json=payload(person, second, "deputy")).status_code == 201
    row = next(p for p in c.get("/api/workspace").json()["users"] if p["id"] == person)
    assert set(row["unit_ids"]) == {"student-office", second}
    with TestClient(app, headers=ORIGIN) as officer:
        login(officer, "20261006")
        assert officer.get("/api/workspace").json()["grant_options"] == []
    login(c, "student-head")
    assert (
        c.post("/api/assignments", json=payload("member", "mechanical-1-A", "class_rep")).status_code == 422
    )


def test_korean_final_day_is_included_until_next_midnight(setup):
    from datetime import timedelta

    c, _, clock, app = setup
    login(c)
    year = clock[0].year
    end = datetime(year, 12, 31, 15, tzinfo=timezone.utc)
    assert (
        c.post(
            "/api/assignments",
            json=payload(
                "member",
                "software-2-A",
                "class_rep",
                starts_at=f"{year}-01-01T00:00:00+09:00",
                ends_at=end.isoformat(),
            ),
        ).status_code
        == 201
    )
    with TestClient(app, headers=ORIGIN) as student:
        clock[0] = end - timedelta(milliseconds=1)
        login(student, "student-new")
        assert len(student.get("/api/me").json()["assignments"]) == 1
        clock[0] = end
        assert student.get("/api/me").json()["assignments"] == []


def test_academic_officer_audience_is_separate_from_management_and_contacts(setup):
    c, path, _, _ = setup
    login(c, "student-vice")
    work = c.get("/api/workspace").json()
    groups = {g["key"]: g for g in work["sharing_groups"]}
    assert set(groups) == {"council-officers", "department:software"}
    assert {m["user_id"] for m in groups["council-officers"]["members"]} == {"chair", "head", "vice"}
    assert {m["user_id"] for m in groups["department:software"]["members"]} == {"chair", "vice", "rep"}
    assert all(not {"phone", "email", "identifier"} & set(m) for g in groups.values() for m in g["members"])
    assert not any(p["id"] == "head" for p in work["users"])
    assert work["grant_options"] == [] and work["unit_creation_options"] == []
    conn = connect(path)
    from yeonieum.modules.access.audiences import can_access_sharing_group

    actor = dict(conn.execute("SELECT * FROM users WHERE id='vice'").fetchone())
    assert can_access_sharing_group(
        conn, actor, "council-officers", datetime(datetime.now(timezone.utc).year, 6, 1, tzinfo=timezone.utc)
    )
    assert not can_access_sharing_group(
        conn,
        actor,
        "department:mechanical",
        datetime(datetime.now(timezone.utc).year, 6, 1, tzinfo=timezone.utc),
    )
    conn.close()


def test_class_representative_belongs_to_department_not_council_officers(setup):
    c, _, _, _ = setup
    login(c, "student-rep")
    work = c.get("/api/workspace").json()
    assert [g["key"] for g in work["sharing_groups"]] == ["department:software"]
    assert {m["user_id"] for m in work["sharing_groups"][0]["members"]} == {"chair", "vice", "rep"}
    assert {p["id"] for p in work["users"]} == {"rep"}
    assert work["unit_creation_options"] == []


def test_department_head_creates_own_year_class_registers_invites_and_grants_rep(setup):
    c, _, _, _ = setup
    login(c, "student-head")
    work = c.get("/api/workspace").json()
    assert {o["parent_id"] for o in work["unit_creation_options"]} == {
        "mechanical",
        "mechanical-1",
        "mechanical-2",
    }
    assert (
        c.post("/api/units", json={"parent_id": "software", "kind": "year", "name": "3학년"}).status_code
        == 403
    )
    assert (
        c.post(
            "/api/units", json={"parent_id": "council", "kind": "department", "name": "신설 학과"}
        ).status_code
        == 403
    )
    year = new_unit(c, "mechanical", "year", "3학년")
    group = new_unit(c, year, "class", "B반")
    created = c.post("/api/users", json=account("20262001", group))
    assert created.status_code == 201
    person = created.json()["id"]
    accept_latest(c, person)
    assert c.post("/api/assignments", json=payload(person, group, "class_rep")).status_code == 201
    work = c.get("/api/workspace").json()
    assert any(
        o["unit_id"] == group and o["role"] == "class_rep" and o["label"] == "3학년 B반 반대표"
        for o in work["grant_options"]
    )
    assert any(
        a["user_id"] == person and a["role_label"] == "3학년 B반 반대표" and a["effective"]
        for a in work["assignments"]
    )
    audience = next(g for g in work["sharing_groups"] if g["key"] == "department:mechanical")
    assert any(m["user_id"] == person for m in audience["members"])
    officers = next(g for g in work["sharing_groups"] if g["key"] == "council-officers")
    assert not any(m["user_id"] == person for m in officers["members"])
    assert c.post("/api/users", json=account("20262002", "software-1-A")).status_code == 403


def test_academic_group_and_child_management_end_with_role_revocation(setup):
    c, path, clock, app = setup
    from yeonieum.modules.access.audiences import can_access_sharing_group

    with TestClient(app, headers=ORIGIN) as head:
        login(head, "student-head")
        assert head.get("/api/workspace").json()["unit_creation_options"]
        login(c)
        assert c.post("/api/assignments/head-role/revoke", json={"reason": "임기 중 교체"}).status_code == 200
        work = head.get("/api/workspace").json()
        assert work["sharing_groups"] == [] and work["unit_creation_options"] == []
        assert (
            head.post(
                "/api/units", json={"parent_id": "mechanical", "kind": "year", "name": "3학년"}
            ).status_code
            == 403
        )
        conn = connect(path)
        actor = dict(conn.execute("SELECT * FROM users WHERE id='head'").fetchone())
        assert not can_access_sharing_group(conn, actor, "council-officers", clock[0])
        assert not can_access_sharing_group(conn, actor, "department:mechanical", clock[0])
        conn.close()


def test_vice_and_custom_named_roles_do_not_gain_academic_management_or_audience(setup):
    c, _, _, _ = setup
    login(c, "student-vice")
    assert (
        c.post("/api/units", json={"parent_id": "software", "kind": "year", "name": "3학년"}).status_code
        == 403
    )
    assert c.post("/api/users", json=account("20262003", "software-1-A")).status_code == 403
    login(c)
    role = c.post(
        "/api/role-types",
        json={"org_id": "council", "label": "학과협의회 간부 도우미", "scope_kind": "class"},
    ).json()
    assert c.post("/api/assignments", json=payload("member", "software-2-A", role["code"])).status_code == 201
    login(c, "student-new")
    work = c.get("/api/workspace").json()
    assert work["sharing_groups"] == [] and work["unit_creation_options"] == []


def test_subunit_delete_revokes_current_future_roles_and_restore_keeps_history(setup):
    c, path, clock, app = setup
    login(c)
    sibling = new_unit(c, "student", "office", "홍보부")
    person = c.post("/api/users", json=account("20263001", "student")).json()["id"]
    accept_latest(c, person)
    assert c.post("/api/assignments", json=payload(person, "student-office", "manager")).status_code == 201
    year = clock[0].year
    assert (
        c.post(
            "/api/assignments",
            json=payload(
                person,
                "student-office",
                "deputy",
                starts_at=f"{year + 1}-01-01T00:00:00+00:00",
                ends_at=f"{year + 2}-01-01T00:00:00+00:00",
            ),
        ).status_code
        == 201
    )
    assert c.post("/api/units/student-office/remove", json={"confirmed": False}).status_code == 422
    with TestClient(app, headers=ORIGIN) as officer:
        login(officer, "20263001")
        removed = c.post("/api/units/student-office/remove", json={"confirmed": True})
        assert removed.status_code == 200 and removed.json()["revoked_count"] == 2
        assert officer.get("/api/me").status_code == 200
        assert officer.get("/api/me").json()["assignments"] == []
    work = c.get("/api/workspace").json()
    assert any(p["id"] == person for p in work["users"])
    assert all(a["revoked_at"] and not a["effective"] for a in work["assignments"] if a["user_id"] == person)
    assert any(u["id"] == sibling and u["active"] for u in work["units"])
    assert c.post("/api/assignments", json=payload(person, "student-office", "manager")).status_code == 403
    assert c.post("/api/users", json=account("20263002", "student-office")).status_code == 403
    login(c, "student-other")
    assert not any(u["id"] == "student-office" for u in c.get("/api/workspace").json()["units"])
    login(c)
    restored = c.post("/api/units", json={"parent_id": "student", "kind": "office", "name": " 기획부 "})
    assert (
        restored.status_code == 200
        and restored.json()["id"] == "student-office"
        and restored.json()["restored"]
    )
    assert all(
        a["revoked_at"] for a in c.get("/api/workspace").json()["assignments"] if a["user_id"] == person
    )
    conn = connect(path)
    assert conn.execute("SELECT count(*) FROM memberships WHERE user_id=?", (person,)).fetchone()[0] == 1
    conn.close()


def test_department_head_can_delete_own_year_subtree_but_not_department_or_other_scope(setup):
    c, _, _, _ = setup
    login(c, "student-head")
    year = new_unit(c, "mechanical", "year", "3학년")
    group = new_unit(c, year, "class", "A반")
    person = c.post("/api/users", json=account("20263003", group)).json()["id"]
    accept_latest(c, person)
    assert c.post("/api/assignments", json=payload(person, group, "class_rep")).status_code == 201
    options = c.get("/api/workspace").json()["unit_deletion_options"]
    assert (
        year in options and group in options and "mechanical" not in options and "software-1-A" not in options
    )
    assert c.post("/api/units/mechanical/remove", json={"confirmed": True}).status_code == 403
    assert c.post("/api/units/software-1-A/remove", json={"confirmed": True}).status_code == 403
    response = c.post(f"/api/units/{year}/remove", json={"confirmed": True})
    assert response.status_code == 200 and response.json()["unit_count"] == 2
    work = c.get("/api/workspace").json()
    assert not any(u["id"] in {year, group} for u in work["units"])
    assert not any(m["user_id"] == person for g in work["sharing_groups"] for m in g["members"])
    assert any(a["id"] == "head-role" and a["effective"] for a in work["assignments"])
    login(c, "student-vice")
    assert c.get("/api/workspace").json()["unit_deletion_options"] == []
    assert c.post("/api/units/software-1-A/remove", json={"confirmed": True}).status_code == 403


def test_deleting_department_ends_chair_dependency_without_deleting_accounts(setup):
    c, _, _, _ = setup
    login(c)
    assert c.post("/api/units/council/remove", json={"confirmed": True}).status_code == 422
    removed = c.post("/api/units/software/remove", json={"confirmed": True})
    assert removed.status_code == 200 and removed.json()["revoked_count"] == 4
    work = c.get("/api/workspace").json()
    assert all(
        a["revoked_at"] and not a["effective"]
        for a in work["assignments"]
        if a["id"] in {"chair-dept", "chair-role", "vice-role", "rep-role"}
    )
    assert any(a["id"] == "head-role" and a["effective"] for a in work["assignments"])
    assert {"chair", "vice", "rep"} <= {p["id"] for p in work["users"]}
    assert not any(g["key"] == "department:software" for g in work["sharing_groups"])
    assert "role.dependency-ended" in {a["action"] for a in c.get("/api/audit").json()}
    restored = c.post(
        "/api/units", json={"parent_id": "council", "kind": "department", "name": "스마트소프트웨어학과"}
    )
    assert restored.status_code == 200 and restored.json()["id"] == "software"
    assert all(
        not a["effective"]
        for a in c.get("/api/workspace").json()["assignments"]
        if a["id"] in {"chair-dept", "chair-role", "vice-role", "rep-role"}
    )


def test_parent_and_organization_restores_do_not_revive_independently_deleted_branch(setup):
    c, path, clock, _ = setup
    login(c)
    year = new_unit(c, "mechanical", "year", "3학년")
    a = new_unit(c, year, "class", "A반")
    b = new_unit(c, year, "class", "B반")
    assert c.post(f"/api/units/{a}/remove", json={"confirmed": True}).status_code == 200
    assert c.post(f"/api/units/{year}/remove", json={"confirmed": True}).status_code == 200
    restored = c.post("/api/units", json={"parent_id": "mechanical", "kind": "year", "name": "3학년"})
    assert restored.status_code == 200 and restored.json()["id"] == year
    units = {u["id"]: u for u in c.get("/api/workspace").json()["units"]}
    assert units[year]["active"] and units[b]["active"] and not units[a]["active"]
    assert (
        c.post("/api/organizations/council/remove", json={"confirmation": "삭제하겠습니다"}).status_code
        == 200
    )
    assert c.post("/api/organizations", json={"name": "학과협의회"}).status_code == 200
    with TestClient(create_app(path, lambda: clock[0]), headers=ORIGIN) as reopened:
        login(reopened)
        units = {u["id"]: u for u in reopened.get("/api/workspace").json()["units"]}
        assert units[year]["active"] and units[b]["active"] and not units[a]["active"]
        revived = reopened.post("/api/units", json={"parent_id": year, "kind": "class", "name": "A반"})
        assert revived.status_code == 200 and revived.json()["id"] == a


def test_legacy_inactive_organization_migrates_deletion_batch(tmp_path):
    import sqlite3

    from yeonieum.core.database import SCHEMA
    from yeonieum.modules.organizations.lifecycle import restore_subtree

    path = tmp_path / "legacy-deleted.sqlite3"
    old = sqlite3.connect(path)
    old.executescript(SCHEMA)
    old.execute("ALTER TABLE units ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
    old.execute(
        "INSERT INTO units (id,org_id,parent_id,kind,name,active) VALUES ('legacy','legacy',NULL,'organization','기존 단체',0)"
    )
    old.execute(
        "INSERT INTO units (id,org_id,parent_id,kind,name,active) VALUES ('office','legacy','legacy','office','기존 부서',0)"
    )
    old.commit()
    old.close()
    migrated = connect(path)
    assert {r[0] for r in migrated.execute("SELECT deletion_root_id FROM units")} == {"legacy"}
    assert restore_subtree(migrated, "legacy") == 2
    assert all(r[0] for r in migrated.execute("SELECT active FROM units"))
    migrated.close()


@pytest.mark.parametrize(
    "body",
    [{}, {"confirmed": False}, {"confirmed": "true"}, {"confirmed": 1}, {"confirmation": "삭제하겠습니다"}],
)
def test_subunit_deletion_requires_explicit_boolean_confirmation(setup, body):
    c, path, _, _ = setup
    login(c)
    assert c.post("/api/units/student-office/remove", json=body).status_code == 422
    conn = connect(path)
    assert conn.execute("SELECT active FROM units WHERE id='student-office'").fetchone()[0] == 1
    assert conn.execute("SELECT count(*) FROM audit").fetchone()[0] == 0
    conn.close()


def legacy_year(path, department="software", name="3SAP"):
    conn = connect(path)
    try:
        conn.execute(
            "INSERT INTO units (id,org_id,parent_id,kind,name) VALUES ('legacy-class','council',?,'year',?)",
            (department, name),
        )
    finally:
        conn.close()
    return "legacy-class"


@pytest.mark.parametrize("actor,department", [("student-chair", "software"), ("student-head", "mechanical")])
def test_convert_legacy_year_to_class_preserves_identity_and_exposes_grant(setup, actor, department):
    c, path, clock, app = setup
    legacy = legacy_year(path, department)
    login(c, actor)
    created = c.post("/api/units", json={"parent_id": department, "kind": "year", "name": "3학년"})
    assert created.status_code == 201
    parent = created.json()["id"]
    assert not any(o["unit_id"] == legacy for o in c.get("/api/workspace").json()["grant_options"])
    conn = connect(path)
    conn.execute("INSERT INTO memberships VALUES ('member',?)", (legacy,))
    assignments = conn.execute("SELECT COUNT(*) FROM assignments").fetchone()[0]
    conn.close()
    changed = c.post(f"/api/units/{legacy}/convert-to-class", json={"parent_id": parent, "name": "SAP반"})
    assert changed.status_code == 200 and changed.json()["id"] == legacy
    work = c.get("/api/workspace").json()
    target = next(u for u in work["units"] if u["id"] == legacy)
    assert (target["kind"], target["parent_id"], target["name"]) == ("class", parent, "SAP반")
    assert any(o["unit_id"] == legacy and o["role"] == "class_rep" for o in work["grant_options"])
    conn = connect(path)
    assert conn.execute(
        "SELECT 1 FROM memberships WHERE user_id='member' AND unit_id=?", (legacy,)
    ).fetchone()
    assert conn.execute("SELECT COUNT(*) FROM assignments").fetchone()[0] == assignments
    assert (
        conn.execute("SELECT COUNT(*) FROM audit WHERE action='unit.converted-to-class'").fetchone()[0] == 1
    )
    conn.close()
    assert c.post("/api/assignments", json=payload(home=legacy)).status_code == 201
    assert any(
        a["unit_id"] == legacy and a["role_label"] == "3학년 SAP반 반대표"
        for a in c.get("/api/workspace").json()["assignments"]
    )


@pytest.mark.parametrize(
    "actor,parent,status",
    [
        ("student-head", "software-1", 403),
        ("student-vice", "software-1", 403),
        ("student-rep", "software-1", 403),
        ("staff-demo", "mechanical-1", 422),
        ("student-chair", "software", 422),
    ],
)
def test_class_conversion_rejects_out_of_scope_or_wrong_parent(setup, actor, parent, status):
    c, path, clock, app = setup
    legacy = legacy_year(path)
    login(c, actor)
    assert (
        c.post(
            f"/api/units/{legacy}/convert-to-class", json={"parent_id": parent, "name": "SAP반"}
        ).status_code
        == status
    )
    conn = connect(path)
    assert tuple(conn.execute("SELECT kind,parent_id FROM units WHERE id=?", (legacy,)).fetchone()) == (
        "year",
        "software",
    )
    assert (
        conn.execute("SELECT COUNT(*) FROM audit WHERE action='unit.converted-to-class'").fetchone()[0] == 0
    )
    conn.close()


@pytest.mark.parametrize("history", ["child", "revoked_role"])
def test_class_conversion_does_not_reinterpret_existing_history(setup, history):
    c, path, clock, app = setup
    legacy = legacy_year(path)
    login(c)
    if history == "child":
        conn = connect(path)
        conn.execute(
            "INSERT INTO units (id,org_id,parent_id,kind,name,active) VALUES ('old-child','council',?,'class','과거 반',0)",
            (legacy,),
        )
        conn.close()
    else:
        role = c.post(
            "/api/role-types", json={"org_id": "council", "label": "학년 담당", "scope_kind": "year"}
        ).json()["code"]
        grant = c.post("/api/assignments", json=payload(home=legacy, role=role))
        assert grant.status_code == 201
        assert (
            c.post(
                f"/api/assignments/{grant.json()['id']}/revoke", json={"reason": "테스트 회수"}
            ).status_code
            == 200
        )
    assert (
        c.post(
            f"/api/units/{legacy}/convert-to-class", json={"parent_id": "software-1", "name": "SAP반"}
        ).status_code
        == 409
    )


@pytest.mark.parametrize("deleted", [False, True])
def test_class_conversion_keeps_existing_or_deleted_class_identity(setup, deleted):
    c, path, clock, app = setup
    legacy = legacy_year(path)
    login(c)
    if deleted:
        assert c.post("/api/units/software-1-A/remove", json={"confirmed": True}).status_code == 200
    assert (
        c.post(
            f"/api/units/{legacy}/convert-to-class", json={"parent_id": "software-1", "name": "A반"}
        ).status_code
        == 409
    )


@pytest.mark.parametrize("name", ["1A", "3SAP", "2B반"])
def test_class_names_cannot_be_registered_as_years(setup, name):
    c, path, clock, app = setup
    login(c, "student-chair")
    response = c.post("/api/units", json={"parent_id": "software", "kind": "year", "name": name})
    assert response.status_code == 422
    assert "학년으로 등록할 수 없습니다" in response.json()["detail"]
