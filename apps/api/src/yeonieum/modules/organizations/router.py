"""Teacher-managed organizations; removal preserves historical references."""

import unicodedata
from typing import Literal
from uuid import uuid4

from fastapi import Depends, HTTPException, Response
from pydantic import Field

from yeonieum.core.database import audit, stamp, transaction
from yeonieum.modules.access.catalog import seed_roles
from yeonieum.modules.access.policy import can_create_child_unit, deny, unit
from yeonieum.modules.access.schemas import StrictModel


class NewOrganization(StrictModel):
    name: str = Field(min_length=1, max_length=60)


class NewUnit(StrictModel):
    parent_id: str
    kind: Literal["office", "department", "year", "class", "club"]
    name: str = Field(min_length=1, max_length=60)


class RemoveOrganization(StrictModel):
    confirmation: Literal["삭제하겠습니다"]


def install_organization_routes(app, db, actor, now):
    @app.post("/api/organizations", status_code=201)
    def create_organization(data: NewOrganization, response: Response, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            if not user["is_admin"]:
                deny("담당 선생님만 단체를 관리할 수 있습니다.")
            name = " ".join(unicodedata.normalize("NFKC", data.name).split())
            if not name:
                raise HTTPException(422, "단체명을 입력해 주세요.")
            existing = next(
                (
                    r
                    for r in conn.execute("SELECT * FROM units WHERE kind='organization'")
                    if name.casefold() == r["name"].casefold()
                ),
                None,
            )
            if existing:
                if existing["active"]:
                    raise HTTPException(409, "이미 운영 중인 단체명입니다.")
                # Reuse the organization's identity/history, but never revive revoked
                # appointments or inactive user accounts when restoring its units.
                conn.execute("UPDATE units SET active=1 WHERE org_id=?", (existing["id"],))
                audit(
                    conn,
                    user,
                    existing["id"],
                    "organization.restored",
                    existing["id"],
                    {"name": existing["name"]},
                )
                response.status_code = 200
                return {"id": existing["id"], "name": existing["name"], "restored": True}
            ident = str(uuid4())
            conn.execute(
                "INSERT INTO units (id,org_id,parent_id,kind,name) VALUES (?,?,NULL,'organization',?)",
                (ident, ident, name),
            )
            seed_roles(conn, ident)
            audit(conn, user, ident, "organization.created", ident, {"name": name})
        return {"id": ident, "name": name, "restored": False}

    @app.post("/api/units", status_code=201)
    def create_unit(data: NewUnit, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            parent = unit(conn, data.parent_id)
            if not can_create_child_unit(conn, user, parent, now()):
                if user["is_admin"]:
                    raise HTTPException(422, "상위 조직과 하위 조직 종류가 맞지 않습니다.")
                deny("현재 담당 범위에서 하위 조직을 등록할 권한이 없습니다.")
            org = unit(conn, parent["org_id"])
            expected = {
                "organization": "department"
                if org["id"] == "council"
                else "club"
                if org["id"] == "clubs"
                else "office",
                "department": "year",
                "year": "class",
            }.get(parent["kind"])
            if not parent["active"] or not org["active"] or data.kind != expected:
                raise HTTPException(422, "상위 조직과 하위 조직 종류가 맞지 않습니다.")
            name = " ".join(unicodedata.normalize("NFKC", data.name).split())
            if not name:
                raise HTTPException(422, "하위 조직 이름을 입력해 주세요.")
            if any(
                r[0].casefold() == name.casefold()
                for r in conn.execute(
                    "SELECT name FROM units WHERE parent_id=? AND kind=?", (parent["id"], data.kind)
                )
            ):
                raise HTTPException(409, "같은 상위 조직에 이미 등록된 이름입니다.")
            ident = str(uuid4())
            conn.execute(
                "INSERT INTO units (id,org_id,parent_id,kind,name) VALUES (?,?,?,?,?)",
                (ident, org["id"], parent["id"], data.kind, name),
            )
            audit(
                conn,
                user,
                org["id"],
                "unit.created",
                ident,
                {"name": name, "parent_id": parent["id"], "kind": data.kind},
            )
        return {"id": ident, "name": name}

    @app.post("/api/organizations/{organization_id}/remove")
    def remove_organization(
        organization_id: str, data: RemoveOrganization, user=Depends(actor), conn=Depends(db)
    ):
        with transaction(conn):
            if not user["is_admin"]:
                deny("담당 선생님만 단체를 관리할 수 있습니다.")
            target = unit(conn, organization_id)
            if target["kind"] != "organization" or not target["active"]:
                raise HTTPException(404, "운영 중인 단체를 찾을 수 없습니다.")
            conn.execute("UPDATE units SET active=0 WHERE org_id=?", (organization_id,))
            for row in conn.execute(
                "SELECT a.id FROM assignments a JOIN units u ON u.id=a.unit_id WHERE u.org_id=? AND a.revoked_at IS NULL",
                (organization_id,),
            ).fetchall():
                conn.execute("UPDATE assignments SET revoked_at=? WHERE id=?", (stamp(now()), row["id"]))
                audit(conn, user, organization_id, "role.revoked", row["id"], {"reason": "단체 삭제"})
            audit(
                conn, user, organization_id, "organization.removed", organization_id, {"name": target["name"]}
            )
        return {"ok": True}
