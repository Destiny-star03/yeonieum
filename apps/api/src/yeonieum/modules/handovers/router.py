"""Yearly and midterm handovers with recipient-only mandatory acknowledgements."""

from datetime import datetime
from uuid import uuid4

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from yeonieum.core.database import audit, stamp, transaction
from yeonieum.modules.access.policy import unit
from yeonieum.modules.budgets.policy import is_head, live_organization, org_roles
from yeonieum.modules.documents.policy import can_read


class NewHandover(BaseModel):
    org_id: str
    year: int = Field(ge=2000, le=2200)
    from_user_id: str
    to_user_id: str
    title: str = Field(min_length=2, max_length=180)


class NewItem(BaseModel):
    kind: str
    reference_id: str | None = None
    title: str = Field(min_length=2, max_length=250)
    required: bool = True
    expected_revision: int = Field(ge=1)


class Change(BaseModel):
    expected_revision: int = Field(ge=1)


def install_handover_routes(app, db, actor, now):
    def handover_access(conn, user, org_id):
        return live_organization(conn, org_id) and (
            bool(user["is_admin"]) or bool(org_roles(conn, user, org_id, now()))
        )

    def eligible(conn, user_id, org_id, future=False):
        person = conn.execute(
            "SELECT * FROM users WHERE id=? AND active=1 AND email_verified=1", (user_id,)
        ).fetchone()
        if not person:
            return False
        if future:
            return any(
                row["revoked_at"] is None
                and datetime.fromisoformat(row["ends_at"]) > now()
                and unit(conn, row["unit_id"])["org_id"] == org_id
                for row in conn.execute("SELECT * FROM assignments WHERE user_id=?", (user_id,))
            )
        return bool(org_roles(conn, dict(person), org_id, now()))

    def handover(conn, ident, user):
        row = conn.execute("SELECT * FROM handovers WHERE id=?", (ident,)).fetchone()
        if not row or not handover_access(conn, user, row["org_id"]):
            raise HTTPException(404, "인수인계를 찾을 수 없습니다.")
        return dict(row)

    def can_prepare(conn, user, row):
        return bool(
            user["is_admin"]
            or is_head(conn, user, row["org_id"], now())
            or (row["from_user_id"] == user["id"] and org_roles(conn, user, row["org_id"], now()))
        )

    def visible(conn, user, row):
        return bool(
            user["is_admin"]
            or is_head(conn, user, row["org_id"], now())
            or user["id"] in {row["from_user_id"], row["to_user_id"]}
        )

    def serialize(conn, row):
        items = [
            {
                **dict(item),
                "checked_by": check["checked_by"] if check else None,
                "checked_at": check["checked_at"] if check else None,
            }
            for item in conn.execute(
                "SELECT * FROM handover_items WHERE handover_id=? ORDER BY created_at,id", (row["id"],)
            )
            for check in [
                conn.execute("SELECT * FROM handover_checks WHERE item_id=?", (item["id"],)).fetchone()
            ]
        ]
        return {
            **dict(row),
            "from_name": conn.execute("SELECT name FROM users WHERE id=?", (row["from_user_id"],)).fetchone()[
                0
            ],
            "to_name": conn.execute("SELECT name FROM users WHERE id=?", (row["to_user_id"],)).fetchone()[0],
            "items": items,
        }

    @app.get("/api/handovers/options")
    def options(user=Depends(actor), conn=Depends(db)):
        orgs = [
            {"id": r["id"], "name": r["name"]}
            for r in conn.execute("SELECT * FROM units WHERE kind='organization' AND active=1 ORDER BY name")
            if handover_access(conn, user, r["id"])
        ]
        people = {
            org["id"]: [
                {"id": r["id"], "name": r["name"]}
                for r in conn.execute(
                    "SELECT id,name FROM users WHERE active=1 AND email_verified=1 ORDER BY name"
                )
                if eligible(conn, r["id"], org["id"], True)
            ]
            for org in orgs
        }
        return {"organizations": orgs, "people": people}

    @app.get("/api/handovers")
    def listing(org_id: str = "", year: int | None = None, user=Depends(actor), conn=Depends(db)):
        result = []
        for row in conn.execute("SELECT * FROM handovers ORDER BY created_at DESC,id"):
            if org_id and row["org_id"] != org_id or year and row["year"] != year:
                continue
            if handover_access(conn, user, row["org_id"]) and visible(conn, user, row):
                result.append(serialize(conn, row))
        return result

    @app.get("/api/handovers/reference-options")
    def reference_options(org_id: str, user=Depends(actor), conn=Depends(db)):
        if not handover_access(conn, user, org_id):
            raise HTTPException(404, "단체를 찾을 수 없습니다.")
        documents = [
            {"id": r["id"], "title": r["title"]}
            for r in conn.execute(
                "SELECT * FROM documents WHERE org_id=? AND deleted_at IS NULL ORDER BY updated_at DESC",
                (org_id,),
            )
            if can_read(conn, user, r, now())
        ]
        settlements = [
            {"id": r["id"], "title": f"{r['year']}년 확정 정산"}
            for r in conn.execute(
                "SELECT id,year FROM settlement_snapshots WHERE org_id=? ORDER BY year DESC", (org_id,)
            )
        ]
        return {"documents": documents, "settlements": settlements}

    @app.post("/api/handovers")
    def create(data: NewHandover, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            if not handover_access(conn, user, data.org_id):
                raise HTTPException(404, "단체를 찾을 수 없습니다.")
            if not (
                user["is_admin"] or is_head(conn, user, data.org_id, now()) or user["id"] == data.from_user_id
            ):
                raise HTTPException(403, "이 단체의 인계 담당자가 아닙니다.")
            if (
                data.from_user_id == data.to_user_id
                or not eligible(conn, data.from_user_id, data.org_id)
                or not eligible(conn, data.to_user_id, data.org_id, True)
            ):
                raise HTTPException(422, "현재 인계자와 후임 담당자를 확인해 주세요.")
            ident = str(uuid4())
            conn.execute(
                "INSERT INTO handovers(id,org_id,year,from_user_id,to_user_id,title,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)",
                (
                    ident,
                    data.org_id,
                    data.year,
                    data.from_user_id,
                    data.to_user_id,
                    data.title.strip(),
                    user["id"],
                    stamp(now()),
                ),
            )
            audit(conn, user, data.org_id, "handover.created", ident, data.model_dump())
        return {"id": ident}

    @app.get("/api/handovers/{ident}")
    def detail(ident: str, user=Depends(actor), conn=Depends(db)):
        row = handover(conn, ident, user)
        if not visible(conn, user, row):
            raise HTTPException(404, "인수인계를 찾을 수 없습니다.")
        return serialize(conn, row)

    @app.post("/api/handovers/{ident}/items")
    def add_item(ident: str, data: NewItem, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = handover(conn, ident, user)
            if not can_prepare(conn, user, row) or row["completed_at"]:
                raise HTTPException(403, "인계 항목을 추가할 수 없습니다.")
            if row["revision"] != data.expected_revision:
                raise HTTPException(409, "인수인계를 새로고침해 주세요.")
            if data.kind not in {"task", "document", "settlement"}:
                raise HTTPException(422, "업무·자료·정산 항목 중에서 선택해 주세요.")
            if data.kind == "task" and data.reference_id:
                raise HTTPException(422, "업무 메모에는 참조 ID를 넣지 않습니다.")
            if data.kind != "task" and not data.reference_id:
                raise HTTPException(422, "자료 또는 정산 ID가 필요합니다.")
            if data.kind == "document":
                document = conn.execute(
                    "SELECT * FROM documents WHERE id=? AND org_id=? AND deleted_at IS NULL",
                    (data.reference_id, row["org_id"]),
                ).fetchone()
                if not document or not can_read(conn, user, document, now()):
                    raise HTTPException(404, "연결할 자료를 찾을 수 없습니다.")
            if (
                data.kind == "settlement"
                and not conn.execute(
                    "SELECT 1 FROM settlement_snapshots WHERE id=? AND org_id=?",
                    (data.reference_id, row["org_id"]),
                ).fetchone()
            ):
                raise HTTPException(404, "연결할 정산을 찾을 수 없습니다.")
            item_id = str(uuid4())
            conn.execute(
                "INSERT INTO handover_items VALUES (?,?,?,?,?,?,?,?)",
                (
                    item_id,
                    ident,
                    data.kind,
                    data.reference_id,
                    data.title.strip(),
                    int(data.required),
                    user["id"],
                    stamp(now()),
                ),
            )
            conn.execute("UPDATE handovers SET revision=revision+1 WHERE id=?", (ident,))
            audit(
                conn,
                user,
                row["org_id"],
                "handover.item-added",
                item_id,
                {"handover_id": ident, **data.model_dump()},
            )
        return {"id": item_id}

    @app.post("/api/handovers/{ident}/items/{item_id}/check")
    def check_item(ident: str, item_id: str, data: Change, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = handover(conn, ident, user)
            if row["to_user_id"] != user["id"] or row["completed_at"]:
                raise HTTPException(403, "인수자만 항목을 확인할 수 있습니다.")
            if row["revision"] != data.expected_revision:
                raise HTTPException(409, "인수인계를 새로고침해 주세요.")
            if not conn.execute(
                "SELECT 1 FROM handover_items WHERE id=? AND handover_id=?", (item_id, ident)
            ).fetchone():
                raise HTTPException(404, "인수 항목을 찾을 수 없습니다.")
            if conn.execute("SELECT 1 FROM handover_checks WHERE item_id=?", (item_id,)).fetchone():
                raise HTTPException(409, "이미 확인한 항목입니다.")
            conn.execute("INSERT INTO handover_checks VALUES (?,?,?)", (item_id, user["id"], stamp(now())))
            conn.execute("UPDATE handovers SET revision=revision+1 WHERE id=?", (ident,))
            audit(conn, user, row["org_id"], "handover.item-checked", item_id, {"handover_id": ident})
        return {"ok": True}

    @app.post("/api/handovers/{ident}/complete")
    def complete(ident: str, data: Change, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = handover(conn, ident, user)
            if row["to_user_id"] != user["id"] or row["completed_at"]:
                raise HTTPException(403, "인수자만 완료할 수 있습니다.")
            if row["revision"] != data.expected_revision:
                raise HTTPException(409, "인수인계를 새로고침해 주세요.")
            if not conn.execute("SELECT 1 FROM handover_items WHERE handover_id=?", (ident,)).fetchone():
                raise HTTPException(409, "인계 항목을 먼저 등록해 주세요.")
            if conn.execute(
                "SELECT 1 FROM handover_items i LEFT JOIN handover_checks c ON c.item_id=i.id WHERE i.handover_id=? AND i.required=1 AND c.item_id IS NULL LIMIT 1",
                (ident,),
            ).fetchone():
                raise HTTPException(409, "필수 인수 확인이 남아 있습니다.")
            conn.execute(
                "UPDATE handovers SET completed_by=?,completed_at=?,revision=revision+1 WHERE id=?",
                (user["id"], stamp(now()), ident),
            )
            audit(conn, user, row["org_id"], "handover.completed", ident, {"year": row["year"]})
        return {"ok": True}
