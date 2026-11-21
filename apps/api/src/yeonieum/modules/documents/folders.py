"""Year/organization folders; personal containers never grant access to managers."""

from uuid import uuid4

from fastapi import Depends, HTTPException, Query

from yeonieum.core.database import audit, stamp, transaction
from yeonieum.modules.documents.policy import organization_access
from yeonieum.modules.documents.schemas import Folder


def folder_for(conn, ident, user, now):
    row = conn.execute("SELECT * FROM document_folders WHERE id=?", (ident,)).fetchone()
    if (
        not row
        or not organization_access(conn, user, row["org_id"], now)
        or row["audience"] == "private"
        and row["created_by"] != user["id"]
    ):
        raise HTTPException(404, "폴더가 없거나 현재 접근할 수 없습니다.")
    return row


def validate_folder(conn, metadata, user, now):
    if not metadata.folder_id:
        return
    folder = folder_for(conn, metadata.folder_id, user, now)
    if (
        any(folder[key] != getattr(metadata, key) for key in ("academic_year", "audience"))
        or folder["org_id"]
        != conn.execute("SELECT org_id FROM units WHERE id=?", (metadata.unit_id,)).fetchone()[0]
    ):
        raise HTTPException(422, "폴더의 연도·단체·공유 방식과 파일 설정이 같아야 합니다.")


def install_folder_routes(app, db, actor, now):
    @app.get("/api/documents/folders")
    def listing(
        org_id: str = Query(max_length=100),
        academic_year: int = Query(ge=1900, le=2200),
        audience: str = Query(pattern="^(private|organization)$"),
        user=Depends(actor),
        conn=Depends(db),
    ):
        if not organization_access(conn, user, org_id, now()):
            return []
        return [
            dict(row)
            for row in conn.execute(
                "SELECT * FROM document_folders WHERE org_id=? AND academic_year=? AND audience=? ORDER BY name,id",
                (org_id, academic_year, audience),
            )
            if audience != "private" or row["created_by"] == user["id"]
        ]

    @app.post("/api/documents/folders", status_code=201)
    def create(data: Folder, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            if not organization_access(conn, user, data.org_id, now()):
                raise HTTPException(403, "현재 담당하는 단체에만 폴더를 만들 수 있습니다.")
            if data.parent_id:
                parent = folder_for(conn, data.parent_id, user, now())
                if any(parent[k] != getattr(data, k) for k in ("org_id", "academic_year", "audience")):
                    raise HTTPException(422, "상위 폴더의 연도·단체·공유 방식을 유지해 주세요.")
            duplicate = conn.execute(
                "SELECT * FROM document_folders WHERE org_id=? AND academic_year=? AND parent_id IS ? AND audience=? AND name=? COLLATE NOCASE",
                (data.org_id, data.academic_year, data.parent_id, data.audience, data.name),
            ).fetchall()
            if any(data.audience != "private" or row["created_by"] == user["id"] for row in duplicate):
                raise HTTPException(409, "같은 위치에 같은 이름의 폴더가 있습니다.")
            ident = uuid4().hex
            conn.execute(
                "INSERT INTO document_folders VALUES (?,?,?,?,?,?,?,?)",
                (
                    ident,
                    data.org_id,
                    data.academic_year,
                    data.parent_id,
                    data.name,
                    data.audience,
                    user["id"],
                    stamp(now()),
                ),
            )
            detail = data.model_dump(exclude={"name"} if data.audience == "private" else set())
            audit(conn, user, data.org_id, "document.folder-created", ident, detail)
        return {"id": ident}
