"""Year/organization folders; personal containers never grant access to managers."""

from uuid import uuid4

from fastapi import Depends, HTTPException, Query

from yeonieum.core.database import audit, stamp, transaction
from yeonieum.modules.documents.policy import organization_access, private_folder_access
from yeonieum.modules.documents.schemas import Folder


def can_view_folder(conn, row, user, now):
    if row["audience"] == "private":
        return row["created_by"] == user["id"] and private_folder_access(conn, user, row["org_id"], now)
    return organization_access(conn, user, row["org_id"], now)


def folder_for(conn, ident, user, now):
    row = conn.execute("SELECT * FROM document_folders WHERE id=?", (ident,)).fetchone()
    if not row or not can_view_folder(conn, row, user, now):
        raise HTTPException(404, "폴더가 없거나 현재 접근할 수 없습니다.")
    return row


def validate_folder(conn, folder_id, user, now, *, org_id, academic_year, audience):
    if folder_id is None:
        return
    folder = folder_for(conn, folder_id, user, now)
    if (
        folder["org_id"] != org_id
        or folder["academic_year"] != academic_year
        or folder["audience"] != audience
    ):
        raise HTTPException(422, "폴더의 연도·단체·공유 방식과 파일 설정이 같아야 합니다.")


def install_folder_routes(app, db, actor, now):
    @app.get("/api/documents/folders")
    def listing(
        academic_year: int = Query(ge=1900, le=2200),
        org_id: str = Query(default="", max_length=100),
        audience: str = Query(default="all", pattern="^(all|private|organization)$"),
        user=Depends(actor),
        conn=Depends(db),
    ):
        return [
            dict(row)
            for row in conn.execute(
                """SELECT * FROM document_folders WHERE academic_year=? AND (?='' OR org_id=?)
                   AND (?='all' OR audience=?) ORDER BY name,id""",
                (academic_year, org_id, org_id, audience, audience),
            )
            if can_view_folder(conn, row, user, now())
        ]

    @app.post("/api/documents/folders", status_code=201)
    def create(data: Folder, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            access = private_folder_access if data.audience == "private" else organization_access
            if not access(conn, user, data.org_id, now()):
                raise HTTPException(403, "현재 담당하는 단체에만 폴더를 만들 수 있습니다.")
            if data.parent_id:
                parent = folder_for(conn, data.parent_id, user, now())
                if any(parent[k] != getattr(data, k) for k in ("org_id", "academic_year", "audience")):
                    raise HTTPException(422, "상위 폴더의 연도·단체·공유 방식을 유지해 주세요.")
            duplicate = conn.execute(
                "SELECT * FROM document_folders WHERE org_id=? AND academic_year=? AND parent_id IS NOT DISTINCT FROM ? AND audience=? AND lower(name)=lower(?)",
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
