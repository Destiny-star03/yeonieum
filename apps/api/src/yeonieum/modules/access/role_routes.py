"""Teacher-managed role definitions; deleting a type ends its appointments."""

import unicodedata
from typing import Literal
from uuid import uuid4

from fastapi import Depends, HTTPException, Response
from pydantic import Field

from yeonieum.core.database import audit, stamp, transaction
from yeonieum.modules.access.catalog import allowed_scope_kinds
from yeonieum.modules.access.policy import deny, unit
from yeonieum.modules.access.schemas import StrictModel


class NewRoleType(StrictModel):
    org_id: str
    label: str = Field(min_length=1, max_length=60)
    scope_kind: Literal["organization", "office", "department", "year", "class", "club"]


class RemoveRoleType(StrictModel):
    confirmation: Literal["삭제하겠습니다"]


def install_role_routes(app, db, actor, now):
    @app.post("/api/role-types", status_code=201)
    def add_role(data: NewRoleType, response: Response, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            if not user["is_admin"]:
                deny("담당 선생님만 역할 종류를 관리할 수 있습니다.")
            org = unit(conn, data.org_id)
            if org["kind"] != "organization" or not org["active"]:
                raise HTTPException(422, "운영 중인 단체를 선택해 주세요.")
            if data.scope_kind not in allowed_scope_kinds(org["id"]):
                raise HTTPException(422, "이 단체에서 지원하지 않는 담당 범위 종류입니다.")
            label = " ".join(unicodedata.normalize("NFKC", data.label).split())
            if not label:
                raise HTTPException(422, "역할 이름을 입력해 주세요.")
            old = next(
                (
                    r
                    for r in conn.execute("SELECT * FROM role_definitions WHERE org_id=?", (org["id"],))
                    if r["label"].casefold() == label.casefold()
                ),
                None,
            )
            if old:
                if old["active"] or old["scope_kind"] != data.scope_kind:
                    raise HTTPException(409, "이미 등록된 역할 이름이거나 이전 담당 범위 종류와 다릅니다.")
                conn.execute("UPDATE role_definitions SET active=1 WHERE id=?", (old["id"],))
                ident, code = old["id"], old["code"]
                action = "role_type.restored"
                response.status_code = 200
            else:
                ident = str(uuid4())
                code = f"custom-{ident}"
                conn.execute(
                    "INSERT INTO role_definitions (id,org_id,code,label,scope_kind) VALUES (?,?,?,?,?)",
                    (ident, org["id"], code, label, data.scope_kind),
                )
                action = "role_type.created"
            audit(conn, user, org["id"], action, ident, {"label": label, "scope_kind": data.scope_kind})
        return {"id": ident, "code": code, "label": label, "restored": bool(old)}

    @app.post("/api/role-types/{role_type_id}/remove")
    def remove_role(role_type_id: str, data: RemoveRoleType, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            if not user["is_admin"]:
                deny("담당 선생님만 역할 종류를 관리할 수 있습니다.")
            role = conn.execute(
                "SELECT * FROM role_definitions WHERE id=? AND active=1", (role_type_id,)
            ).fetchone()
            if not role:
                raise HTTPException(404, "사용 중인 역할 종류를 찾을 수 없습니다.")
            conn.execute("UPDATE role_definitions SET active=0 WHERE id=?", (role_type_id,))
            rows = conn.execute(
                "SELECT a.id FROM assignments a JOIN units u ON u.id=a.unit_id WHERE u.org_id=? AND a.role=? AND a.revoked_at IS NULL",
                (role["org_id"], role["code"]),
            ).fetchall()
            for row in rows:
                conn.execute("UPDATE assignments SET revoked_at=? WHERE id=?", (stamp(now()), row["id"]))
                audit(conn, user, role["org_id"], "role.revoked", row["id"], {"reason": "역할 종류 삭제"})
                for dependent in conn.execute(
                    "SELECT id FROM assignments WHERE prerequisite_id=? AND revoked_at IS NULL", (row["id"],)
                ).fetchall():
                    conn.execute(
                        "UPDATE assignments SET revoked_at=? WHERE id=?", (stamp(now()), dependent["id"])
                    )
                    audit(
                        conn,
                        user,
                        role["org_id"],
                        "role.dependency-ended",
                        dependent["id"],
                        {"prerequisite_id": row["id"]},
                    )
            audit(conn, user, role["org_id"], "role_type.removed", role_type_id, {"label": role["label"]})
        return {"ok": True, "revoked_count": len(rows)}
