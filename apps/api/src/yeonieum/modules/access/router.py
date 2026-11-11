"""Access feature HTTP handlers; all mutations recheck scope inside a transaction."""

import hashlib
import json
import secrets
from datetime import timedelta
from uuid import uuid4

from fastapi import Depends, HTTPException, Request, Response
from pwdlib import PasswordHash

from yeonieum.core.database import audit, connect, stamp, transaction
from yeonieum.modules.access.policy import (
    ROLE_LABELS,
    active_roles,
    can_grant,
    deny,
    descendants,
    effective,
    scope,
    unit,
    validate_role_unit,
)
from yeonieum.modules.access.schemas import Grant, Login, NewUser, Revoke


def install_routes(app, database, now):
    def db():
        conn = connect(database)
        try:
            yield conn
        finally:
            conn.close()

    def actor(request: Request, conn=Depends(db)):
        token = request.cookies.get("yeonieum_session", "")
        row = conn.execute(
            "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1",
            (hashlib.sha256(token.encode()).hexdigest(), stamp(now())),
        ).fetchone()
        if not row:
            raise HTTPException(401, "로그인이 필요합니다.")
        return dict(row)

    def safe_user(row):
        return {key: row[key] for key in ["id", "name", "email", "identifier", "phone", "is_admin"]}

    @app.get("/api/health")
    def health():
        return {"status": "ok", "mode": "local-demo"}

    @app.post("/api/auth/login")
    def login(data: Login, response: Response, conn=Depends(db)):
        row = conn.execute(
            "SELECT * FROM users WHERE identifier=? AND active=1", (data.identifier,)
        ).fetchone()
        # Always verify a hash even for unknown identifiers.
        fallback = conn.execute("SELECT password_hash FROM users LIMIT 1").fetchone()
        valid = PasswordHash.recommended().verify(data.password, row["password_hash"] if row else fallback[0])
        if not row or not valid:
            raise HTTPException(401, "계정 또는 비밀번호를 확인해 주세요.")
        token = secrets.token_urlsafe(32)
        with transaction(conn):
            conn.execute("DELETE FROM sessions WHERE expires_at<=?", (stamp(now()),))
            conn.execute(
                "INSERT INTO sessions VALUES (?,?,?)",
                (hashlib.sha256(token.encode()).hexdigest(), row["id"], stamp(now() + timedelta(hours=2))),
            )
        response.set_cookie(
            "yeonieum_session",
            token,
            httponly=True,
            samesite="strict",
            secure=False,
            path="/api",
            max_age=7200,
        )
        return safe_user(row)

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response, conn=Depends(db)):
        token = request.cookies.get("yeonieum_session", "")
        with transaction(conn):
            conn.execute(
                "DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),)
            )
        response.delete_cookie("yeonieum_session", path="/api")
        return {"ok": True}

    @app.get("/api/me")
    def me(user=Depends(actor), conn=Depends(db)):
        return {**safe_user(user), "assignments": active_roles(conn, user, now())}

    @app.get("/api/workspace")
    def workspace(user=Depends(actor), conn=Depends(db)):
        allowed = scope(conn, user, now())
        # Include ancestor labels for navigation, without widening the permission scope.
        visible = set(allowed)
        for ident in list(allowed):
            parent = unit(conn, ident)["parent_id"]
            while parent:
                visible.add(parent)
                parent = unit(conn, parent)["parent_id"]
        units = [
            {**dict(r), "in_scope": r["id"] in allowed}
            for r in conn.execute("SELECT * FROM units")
            if r["id"] in visible
        ]
        roles = []
        people = []
        contact_scope = set()
        if user["is_admin"]:
            contact_scope = allowed
        for r in active_roles(conn, user, now()):
            if r["role"] in {"head", "chair", "department_head"}:
                contact_scope.update(descendants(conn, r["unit_id"]))
        for r in conn.execute("SELECT * FROM assignments"):
            if r["unit_id"] in allowed or r["user_id"] == user["id"]:
                roles.append({**dict(r), "effective": effective(conn, r, now())})
        for r in conn.execute("SELECT * FROM users"):
            homes = {
                m[0] for m in conn.execute("SELECT unit_id FROM memberships WHERE user_id=?", (r["id"],))
            }
            if r["id"] == user["id"] or user["is_admin"] or homes & allowed:
                person = {"id": r["id"], "name": r["name"], "unit_ids": sorted(homes)}
                if r["id"] == user["id"] or user["is_admin"] or homes & contact_scope:
                    person.update(safe_user(r))
                people.append(person)
        contacts = []
        for r in conn.execute("SELECT * FROM assignments WHERE role IN ('head','chair')"):
            if effective(conn, r, now()):
                person = conn.execute(
                    "SELECT id,name,email,phone FROM users WHERE id=?", (r["user_id"],)
                ).fetchone()
                contacts.append(
                    {
                        **dict(person),
                        "org_id": unit(conn, r["unit_id"])["org_id"],
                        "org_name": unit(conn, unit(conn, r["unit_id"])["org_id"])["name"],
                    }
                )
        options = [
            {"unit_id": u["id"], "role": r}
            for u in conn.execute("SELECT * FROM units")
            for r in ROLE_LABELS
            if can_grant(conn, user, dict(u), r, now()) and valid_option(dict(u), r)
        ]
        return {
            "units": units,
            "users": people,
            "assignments": roles,
            "contacts": contacts,
            "grant_options": options,
            "roles": ROLE_LABELS,
            "server_time": stamp(now()),
        }

    def valid_option(target, role):
        try:
            validate_role_unit(target, role)
            return True
        except HTTPException:
            return False

    @app.post("/api/users", status_code=201)
    def create_user(data: NewUser, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            target = unit(conn, data.unit_id)
            if not any(
                can_grant(conn, user, target, r, now()) and valid_option(target, r) for r in ROLE_LABELS
            ):
                deny()
            if conn.execute(
                "SELECT id FROM users WHERE identifier=? OR email=?", (data.identifier, data.email)
            ).fetchone():
                raise HTTPException(409, "이미 등록된 계정 또는 이메일입니다.")
            ident = str(uuid4())
            conn.execute(
                "INSERT INTO users VALUES (?,?,?,?,?,?,0,1)",
                (
                    ident,
                    data.name,
                    data.email,
                    data.identifier,
                    data.phone,
                    PasswordHash.recommended().hash(data.password),
                ),
            )
            conn.execute("INSERT INTO memberships VALUES (?,?)", (ident, data.unit_id))
            audit(conn, user, target["org_id"], "user.registered", ident, {"unit_id": data.unit_id})
        return {"id": ident, "name": data.name}

    @app.post("/api/assignments", status_code=201)
    def grant(data: Grant, user=Depends(actor), conn=Depends(db)):
        if data.starts_at.tzinfo is None or data.ends_at.tzinfo is None:
            raise HTTPException(422, "시간대를 포함해 주세요.")
        start, stop = stamp(data.starts_at), stamp(data.ends_at)
        if start >= stop:
            raise HTTPException(422, "종료는 시작 이후여야 합니다.")
        with transaction(conn):
            target = unit(conn, data.unit_id)
            validate_role_unit(target, data.role)
            if data.user_id == user["id"]:
                deny("본인 역할을 스스로 변경할 수 없습니다.")
            if not can_grant(conn, user, target, data.role, now()):
                deny()
            recipient = conn.execute(
                "SELECT * FROM users WHERE id=? AND active=1", (data.user_id,)
            ).fetchone()
            if not recipient or recipient["is_admin"]:
                deny("유효한 학생 계정이 필요합니다.")
            homes = {
                r[0] for r in conn.execute("SELECT unit_id FROM memberships WHERE user_id=?", (data.user_id,))
            }
            if not homes & descendants(conn, target["id"]):
                raise HTTPException(422, "대상 계정의 소속과 역할 범위가 일치하지 않습니다.")
            parent = None
            if data.role == "chair":
                parent = conn.execute(
                    "SELECT * FROM assignments WHERE id=?", (data.prerequisite_id,)
                ).fetchone()
                if (
                    not parent
                    or parent["role"] != "department_head"
                    or parent["user_id"] != data.user_id
                    or not effective(conn, parent, now())
                ):
                    raise HTTPException(422, "현재 유효한 본인의 학회장 자격을 연결해 주세요.")
                if parent["starts_at"] != start or parent["ends_at"] != stop:
                    raise HTTPException(422, "의장·학회장의 공식 임기는 같아야 합니다.")
                if not data.election_note.strip():
                    raise HTTPException(422, "학회장 투표에 따른 선출 확인 내용을 입력해 주세요.")
            elif data.prerequisite_id or data.election_note:
                raise HTTPException(422, "의장에만 선출·전제 자격을 연결합니다.")
            rows = conn.execute(
                "SELECT * FROM assignments WHERE unit_id=? AND role=? AND revoked_at IS NULL",
                (data.unit_id, data.role),
            )
            for row in rows:
                if (
                    row["starts_at"] < stop
                    and start < row["ends_at"]
                    and (
                        row["user_id"] == data.user_id
                        or data.role in {"head", "chair", "department_head", "class_rep"}
                    )
                ):
                    raise HTTPException(409, "같은 범위·기간에 중복된 역할이 있습니다.")
            ident = str(uuid4())
            conn.execute(
                "INSERT INTO assignments VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    ident,
                    data.user_id,
                    data.unit_id,
                    data.role,
                    start,
                    stop,
                    stamp(now()),
                    user["id"],
                    None,
                    data.prerequisite_id,
                    data.election_note,
                ),
            )
            audit(
                conn,
                user,
                target["org_id"],
                "role.granted",
                ident,
                {"user_id": data.user_id, "role": data.role, "unit_id": data.unit_id},
            )
        return {"id": ident}

    @app.post("/api/assignments/{assignment_id}/revoke")
    def revoke(assignment_id: str, data: Revoke, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = conn.execute("SELECT * FROM assignments WHERE id=?", (assignment_id,)).fetchone()
            if not row:
                raise HTTPException(404, "역할을 찾을 수 없습니다.")
            target = unit(conn, row["unit_id"])
            if row["user_id"] == user["id"]:
                deny("본인 역할 변경은 담당 선생님에게 요청해 주세요.")
            if not user["is_admin"] and not can_grant(conn, user, target, row["role"], now()):
                deny()
            if row["revoked_at"]:
                raise HTTPException(409, "이미 회수된 역할입니다.")
            conn.execute("UPDATE assignments SET revoked_at=? WHERE id=?", (stamp(now()), assignment_id))
            audit(conn, user, target["org_id"], "role.revoked", assignment_id, {"reason": data.reason})
            for dependent in conn.execute(
                "SELECT id FROM assignments WHERE prerequisite_id=? AND revoked_at IS NULL", (assignment_id,)
            ).fetchall():
                conn.execute(
                    "UPDATE assignments SET revoked_at=? WHERE id=?", (stamp(now()), dependent["id"])
                )
                audit(
                    conn,
                    user,
                    target["org_id"],
                    "role.dependency-ended",
                    dependent["id"],
                    {"prerequisite_id": assignment_id},
                )
        return {"ok": True}

    @app.get("/api/audit")
    def activity(user=Depends(actor), conn=Depends(db)):
        orgs = set()
        if user["is_admin"]:
            orgs = {r["id"] for r in conn.execute("SELECT id FROM units WHERE kind='organization'")}
        else:
            orgs = {
                unit(conn, r["unit_id"])["org_id"]
                for r in active_roles(conn, user, now())
                if r["role"] in {"head", "chair"}
            }
        if not orgs:
            deny("최고 책임자 또는 선생님만 감사 이력을 조회합니다.")
        return [
            {**dict(r), "detail": json.loads(r["detail"])}
            for r in conn.execute("SELECT * FROM audit ORDER BY at DESC LIMIT 1000")
            if r["org_id"] in orgs
        ][:100]
