"""Teacher-managed organizations; removal preserves historical references."""

import re
import unicodedata
from typing import Literal
from uuid import uuid4

from fastapi import Depends, HTTPException, Response
from pydantic import Field, field_validator

from yeonieum.core.database import audit, transaction
from yeonieum.modules.access.catalog import seed_roles
from yeonieum.modules.access.policy import can_create_child_unit, can_remove_child_unit, deny, unit
from yeonieum.modules.access.schemas import StrictModel
from yeonieum.modules.organizations.lifecycle import deactivate_subtree, restore_subtree


class NewOrganization(StrictModel):
    name: str = Field(min_length=1, max_length=60)


class NewUnit(StrictModel):
    parent_id: str
    kind: Literal["office", "department", "year", "class", "club"]
    name: str = Field(min_length=1, max_length=60)


class ConvertClass(StrictModel):
    parent_id: str
    name: str = Field(min_length=1, max_length=60)


class RemoveUnit(StrictModel):
    confirmed: bool = Field(strict=True)

    @field_validator("confirmed")
    @classmethod
    def must_confirm(cls, value):
        if not value:
            raise ValueError("삭제 유의사항을 확인하고 체크해 주세요.")
        return value


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
                restore_subtree(conn, existing["id"])
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
    def create_unit(data: NewUnit, response: Response, user=Depends(actor), conn=Depends(db)):
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
            if data.kind == "year" and re.fullmatch(r"[0-9]+\s*[A-Za-z]+(?:반)?", name):
                raise HTTPException(
                    422,
                    "1A·3SAP 같은 반 이름은 학년으로 등록할 수 없습니다. 먼저 1학년·3학년을 등록한 뒤 해당 학년 아래에 반을 등록해 주세요.",
                )
            existing = next(
                (
                    row
                    for row in conn.execute(
                        "SELECT * FROM units WHERE parent_id=? AND kind=?", (parent["id"], data.kind)
                    )
                    if row["name"].casefold() == name.casefold()
                ),
                None,
            )
            if existing:
                if existing["active"]:
                    raise HTTPException(409, "같은 상위 조직에 이미 등록된 이름입니다.")
                restore_subtree(conn, existing["id"])
                audit(
                    conn,
                    user,
                    org["id"],
                    "unit.restored",
                    existing["id"],
                    {"name": existing["name"], "parent_id": parent["id"]},
                )
                response.status_code = 200
                return {"id": existing["id"], "name": existing["name"], "restored": True}
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
        return {"id": ident, "name": name, "restored": False}

    @app.post("/api/units/{unit_id}/convert-to-class")
    def convert_to_class(unit_id: str, data: ConvertClass, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            target = unit(conn, unit_id)
            parent = unit(conn, data.parent_id)
            if not can_remove_child_unit(conn, user, target, now()) or not can_create_child_unit(
                conn, user, parent, now()
            ):
                deny("현재 담당 범위에서만 반으로 변경할 수 있습니다.")
            if (
                target["org_id"] != "council"
                or target["kind"] != "year"
                or parent["kind"] != "year"
                or target["parent_id"] != parent["parent_id"]
                or target["id"] == parent["id"]
                or not target["active"]
            ):
                raise HTTPException(422, "같은 학과의 운영 중인 학년 아래로만 반을 변경할 수 있습니다.")
            if (
                conn.execute("SELECT 1 FROM units WHERE parent_id=?", (unit_id,)).fetchone()
                or conn.execute("SELECT 1 FROM assignments WHERE unit_id=?", (unit_id,)).fetchone()
            ):
                raise HTTPException(
                    409,
                    "하위 조직이나 역할 이력이 있는 항목은 반으로 변경할 수 없습니다. 기존 기록을 유지하고 올바른 반을 새로 등록해 주세요.",
                )
            name = " ".join(unicodedata.normalize("NFKC", data.name).split())
            if not name:
                raise HTTPException(422, "반 이름을 입력해 주세요.")
            if any(
                r["name"].casefold() == name.casefold()
                for r in conn.execute(
                    "SELECT name FROM units WHERE parent_id=? AND kind='class'", (parent["id"],)
                )
            ):
                raise HTTPException(
                    409, "같은 학년에 같은 이름의 반이 있습니다. 삭제된 반이면 기존 반을 복원해 주세요."
                )
            conn.execute(
                "UPDATE units SET kind='class',parent_id=?,name=? WHERE id=?", (parent["id"], name, unit_id)
            )
            audit(
                conn,
                user,
                target["org_id"],
                "unit.converted-to-class",
                unit_id,
                {
                    "before": {
                        "parent_id": target["parent_id"],
                        "kind": target["kind"],
                        "name": target["name"],
                    },
                    "after": {"parent_id": parent["id"], "kind": "class", "name": name},
                },
            )
        return {"id": unit_id, "org_id": target["org_id"], "name": name}

    @app.post("/api/units/{unit_id}/remove")
    def remove_unit(unit_id: str, data: RemoveUnit, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            target = unit(conn, unit_id)
            if target["kind"] == "organization":
                raise HTTPException(422, "단체 자체는 단체 관리에서 삭제해 주세요.")
            if not target["active"]:
                raise HTTPException(404, "운영 중인 하위 조직을 찾을 수 없습니다.")
            if not can_remove_child_unit(conn, user, target, now()):
                deny("현재 담당 범위의 하위 조직만 삭제할 수 있습니다.")
            result = deactivate_subtree(conn, user, unit_id, now())
            audit(conn, user, target["org_id"], "unit.removed", unit_id, {"name": target["name"], **result})
        return {"ok": True, **result}

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
            deactivate_subtree(conn, user, organization_id, now())
            audit(
                conn, user, organization_id, "organization.removed", organization_id, {"name": target["name"]}
            )
        return {"ok": True}
