"""Local-only email invitation rehearsal. No external messages are sent."""

import hashlib
import secrets
from datetime import timedelta
from uuid import uuid4

from fastapi import Depends, HTTPException
from pydantic import Field

from yeonieum.core.database import audit, stamp, transaction
from yeonieum.modules.access.policy import can_register, deny, unit
from yeonieum.modules.access.schemas import StrictModel


class AcceptInvitation(StrictModel):
    token: str = Field(min_length=20, max_length=200)


def issue_invitation(conn, actor, user_id, now):
    conn.execute(
        "UPDATE invitations SET revoked_at=? WHERE user_id=? AND used_at IS NULL AND revoked_at IS NULL",
        (stamp(now), user_id),
    )
    ident, token = str(uuid4()), secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO invitations VALUES (?,?,?,?,?,?,NULL,NULL)",
        (
            ident,
            user_id,
            actor["id"],
            hashlib.sha256(token.encode()).hexdigest(),
            stamp(now + timedelta(hours=24)),
            stamp(now),
        ),
    )
    # A local mail preview necessarily holds the link just as a delivered email would.
    # It is never returned by the public account/workspace APIs or written to logs.
    conn.execute("INSERT INTO local_outbox VALUES (?,?)", (ident, f"http://127.0.0.1:5173/#invite={token}"))
    return ident


def can_invite_user(conn, actor, user_id, now):
    homes = [
        unit(conn, row[0])
        for row in conn.execute("SELECT unit_id FROM memberships WHERE user_id=?", (user_id,))
    ]
    if actor["is_admin"]:
        return bool(homes) and all(home["active"] and unit(conn, home["org_id"])["active"] for home in homes)
    return bool(homes) and all(can_register(conn, actor, home, now) for home in homes)


def install_invitation_routes(app, db, actor, now):
    @app.get("/api/invitations/outbox")
    def outbox(user=Depends(actor), conn=Depends(db)):
        result = []
        for row in conn.execute(
            "SELECT i.*,o.link,u.name,u.email FROM invitations i JOIN local_outbox o ON o.invitation_id=i.id JOIN users u ON u.id=i.user_id WHERE u.active=1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? ORDER BY i.created_at DESC",
            (stamp(now()),),
        ):
            if (user["is_admin"] or row["created_by"] == user["id"]) and can_invite_user(
                conn, user, row["user_id"], now()
            ):
                result.append({k: row[k] for k in ["id", "user_id", "name", "email", "link", "expires_at"]})
        return {"mode": "local-preview", "messages": result}

    @app.post("/api/users/{user_id}/invite")
    def resend(user_id: str, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            target = conn.execute("SELECT * FROM users WHERE id=? AND active=1", (user_id,)).fetchone()
            if not target or target["is_admin"] or not can_invite_user(conn, user, user_id, now()):
                deny()
            if target["email_verified"]:
                raise HTTPException(409, "이미 초대 인증을 완료한 계정입니다.")
            latest = conn.execute(
                "SELECT created_at FROM invitations WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
                (user_id,),
            ).fetchone()
            if latest and latest[0] > stamp(now() - timedelta(seconds=60)):
                raise HTTPException(429, "초대 재발급은 1분 후 다시 시도해 주세요.")
            issue_invitation(conn, user, user_id, now())
            for org in {
                unit(conn, row[0])["org_id"]
                for row in conn.execute("SELECT unit_id FROM memberships WHERE user_id=?", (user_id,))
            }:
                audit(conn, user, org, "invitation.reissued", user_id, {})
        return {"ok": True, "delivery": "local-preview"}

    @app.post("/api/invitations/accept")
    def accept(data: AcceptInvitation, conn=Depends(db)):
        with transaction(conn):
            invite = conn.execute(
                "SELECT i.*,u.active,u.email_verified FROM invitations i JOIN users u ON u.id=i.user_id WHERE i.token_hash=?",
                (hashlib.sha256(data.token.encode()).hexdigest(),),
            ).fetchone()
            if (
                not invite
                or not invite["active"]
                or invite["email_verified"]
                or invite["used_at"]
                or invite["revoked_at"]
                or invite["expires_at"] <= stamp(now())
            ):
                raise HTTPException(
                    400, "유효하지 않거나 만료된 초대 링크입니다. 담당자에게 재발급을 요청해 주세요."
                )
            conn.execute("UPDATE invitations SET used_at=? WHERE id=?", (stamp(now()), invite["id"]))
            conn.execute("UPDATE users SET email_verified=1 WHERE id=?", (invite["user_id"],))
            for org in {
                unit(conn, row[0])["org_id"]
                for row in conn.execute(
                    "SELECT unit_id FROM memberships WHERE user_id=?", (invite["user_id"],)
                )
            }:
                audit(
                    conn,
                    {"id": invite["user_id"]},
                    org,
                    "invitation.accepted",
                    invite["user_id"],
                    {"mode": "local-preview"},
                )
        return {"ok": True, "mode": "local-preview"}
