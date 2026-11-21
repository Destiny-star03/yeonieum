"""Private streamed uploads and authenticated downloads with current authorization."""

import asyncio
import hashlib
import json
from datetime import timedelta, timezone
from uuid import uuid4

from fastapi import Depends, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool
from starlette.responses import FileResponse

from yeonieum.core.database import audit, stamp, transaction
from yeonieum.modules.access.policy import unit
from yeonieum.modules.documents.folders import folder_for, install_folder_routes, validate_folder
from yeonieum.modules.documents.policy import (
    can_create,
    can_manage,
    can_read,
    creation_options,
    validate_audience,
)
from yeonieum.modules.documents.schemas import (
    MAX_FILE_SIZE,
    Change,
    Metadata,
    RestoreVersion,
    StaffScope,
    Update,
    Upload,
)
from yeonieum.modules.documents.storage import (
    EXTENSIONS,
    FileStore,
    checksum,
    valid_filename,
    validate_content,
)


def install_document_routes(app, db, actor, now, storage_root):
    store = FileStore(storage_root)
    install_folder_routes(app, db, actor, now)

    def document(conn, ident, user, manage=False, include_trash=False):
        row = conn.execute("SELECT * FROM documents WHERE id=?", (ident,)).fetchone()
        if (
            not row
            or not (can_manage if manage else can_read)(conn, user, row, now())
            or (row["deleted_at"] and not include_trash)
        ):
            raise HTTPException(404, "자료가 없거나 현재 접근할 수 없습니다.")
        return dict(row)

    def version(conn, ident, number):
        row = conn.execute(
            "SELECT * FROM document_versions WHERE document_id=? AND version=?", (ident, number)
        ).fetchone()
        if not row:
            raise HTTPException(404, "자료 버전을 찾을 수 없습니다.")
        return dict(row)

    def check_revision(row, revision):
        if row["revision"] != revision:
            raise HTTPException(
                409, "다른 변경이 먼저 저장되었습니다. 자료를 새로고침한 뒤 다시 시도해 주세요."
            )

    def serialize(conn, row, user):
        latest = version(conn, row["id"], row["current_version"])
        return {
            **dict(row),
            "org_name": unit(conn, row["org_id"])["name"],
            "unit_name": unit(conn, row["unit_id"])["name"],
            "can_manage": can_manage(conn, user, row, now()),
            "filename": latest["filename"],
            "size": latest["size"],
            "folder_name": conn.execute(
                "SELECT name FROM document_folders WHERE id=?", (row["folder_id"],)
            ).fetchone()[0]
            if row["folder_id"]
            else None,
        }

    def validate_metadata(conn, user, metadata):
        target = unit(conn, metadata.unit_id)
        if not can_create(conn, user, target, now()):
            raise HTTPException(403, "현재 담당 범위에만 자료를 등록할 수 있습니다.")
        validate_audience(conn, user, target, metadata.audience, now())
        validate_folder(conn, metadata, user, now())
        return target

    @app.get("/api/documents/options")
    def options(user=Depends(actor), conn=Depends(db)):
        available = creation_options(conn, user, now())
        organizations = {row["org_id"] for row in available}
        years = {now().astimezone(timezone(timedelta(hours=9))).year}
        for row in conn.execute("SELECT * FROM documents WHERE deleted_at IS NULL"):
            if can_read(conn, user, row, now()):
                years.add(row["academic_year"])
                organizations.add(row["org_id"])
        for row in conn.execute("SELECT * FROM document_folders"):
            try:
                folder_for(conn, row["id"], user, now())
            except HTTPException:
                continue
            years.add(row["academic_year"])
        return {
            "units": available,
            "organizations": [
                {"id": ident, "name": unit(conn, ident)["name"]} for ident in sorted(organizations)
            ],
            "extensions": sorted(EXTENSIONS),
            "max_size": MAX_FILE_SIZE,
            "years": sorted(years, reverse=True),
        }

    @app.get("/api/documents/staff-scopes")
    def staff_scopes(user=Depends(actor), conn=Depends(db)):
        if not user["is_admin"]:
            raise HTTPException(403, "담당 선생님만 자료 관리 범위를 설정할 수 있습니다.")
        return [
            {
                "unit_id": r["id"],
                "name": r["name"],
                "enabled": bool(
                    conn.execute(
                        "SELECT 1 FROM document_staff_scopes WHERE user_id=? AND unit_id=? AND active=1",
                        (user["id"], r["id"]),
                    ).fetchone()
                ),
            }
            for r in conn.execute("SELECT * FROM units WHERE kind='organization' AND active=1 ORDER BY name")
        ]

    @app.post("/api/documents/staff-scopes")
    def set_staff_scope(data: StaffScope, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            if not user["is_admin"]:
                raise HTTPException(403, "담당 선생님만 자료 관리 범위를 설정할 수 있습니다.")
            target = unit(conn, data.unit_id)
            if target["kind"] != "organization" or not target["active"]:
                raise HTTPException(422, "운영 중인 단체를 선택해 주세요.")
            conn.execute(
                "INSERT INTO document_staff_scopes VALUES (?,?,?) ON CONFLICT(user_id,unit_id) DO UPDATE SET active=excluded.active",
                (user["id"], data.unit_id, int(data.enabled)),
            )
            audit(
                conn,
                user,
                target["org_id"],
                "document.staff-scope-changed",
                target["id"],
                {"enabled": data.enabled},
            )
        return {"ok": True}

    @app.get("/api/documents")
    def listing(
        q: str = Query(default="", max_length=150),
        org_id: str = Query(default="", max_length=100),
        academic_year: int | None = Query(default=None, ge=1900, le=2200),
        category: str = Query(default="", max_length=120),
        folder: str = Query(default="", max_length=120),
        event: str = Query(default="", max_length=120),
        folder_id: str | None = Query(default=None, max_length=100),
        audience: str = Query(default="all", pattern="^(all|private|organization)$"),
        file_type: str = Query(default="", max_length=12),
        sort: str = Query(default="updated", pattern="^(updated|name|size)$"),
        descending: bool = True,
        trash: bool = False,
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=20, ge=1, le=100),
        user=Depends(actor),
        conn=Depends(db),
    ):
        if folder_id and folder_id != "root":
            folder_for(conn, folder_id, user, now())
        visible = []
        for row in conn.execute("SELECT * FROM documents ORDER BY updated_at DESC,id"):
            # Permission and state filters precede counts, search and pagination.
            if bool(row["deleted_at"]) != trash or not (can_manage if trash else can_read)(
                conn, user, row, now()
            ):
                continue
            if org_id and row["org_id"] != org_id or academic_year and row["academic_year"] != academic_year:
                continue
            if folder_id is not None and (row["folder_id"] or "root") != folder_id:
                continue
            if (
                audience == "private"
                and row["audience"] != "private"
                or audience == "organization"
                and row["audience"] == "private"
            ):
                continue
            if any(
                value and value.casefold() not in row[key].casefold()
                for key, value in [("category", category), ("folder", folder), ("event", event)]
            ):
                continue
            item = serialize(conn, row, user)
            extension = item["filename"].rsplit(".", 1)[-1].lower()
            groups = {
                "pdf": {"pdf"},
                "text": {"txt", "csv"},
                "document": {"docx", "hwp", "hwpx"},
                "slides": {"pptx"},
                "sheet": {"xlsx"},
                "image": {"png", "jpg", "jpeg"},
            }
            if file_type and extension not in groups.get(file_type, set()):
                continue
            haystack = " ".join(str(item[k]) for k in ["title", "description", "filename"]).casefold()
            if q.strip().casefold() not in haystack:
                continue
            visible.append(item)
        visible.sort(
            key=lambda item: item[{"updated": "updated_at", "name": "title", "size": "size"}[sort]],
            reverse=descending,
        )
        return {"items": visible[offset : offset + limit], "total": len(visible)}

    @app.post("/api/documents/uploads", status_code=201)
    def prepare(data: Upload, user=Depends(actor), conn=Depends(db)):
        valid_filename(data.filename)
        with transaction(conn):
            if data.document_id:
                if data.metadata is not None or data.expected_revision is None:
                    raise HTTPException(422, "새 버전은 현재 자료 개정 번호로 등록해 주세요.")
                row = document(conn, data.document_id, user, manage=True)
                check_revision(row, data.expected_revision)
            elif data.metadata is None or data.expected_revision is not None:
                raise HTTPException(422, "새 자료의 분류 정보를 입력해 주세요.")
            else:
                validate_metadata(conn, user, data.metadata)
            ident = uuid4().hex
            conn.execute(
                "INSERT INTO document_uploads (id,user_id,document_id,metadata,filename,expected_size,expected_checksum,expected_revision,state,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    ident,
                    user["id"],
                    data.document_id,
                    json.dumps(
                        {
                            "metadata": data.metadata.model_dump() if data.metadata else None,
                            "note": data.note,
                        },
                        ensure_ascii=False,
                    ),
                    data.filename,
                    data.size,
                    data.checksum,
                    data.expected_revision,
                    "PENDING",
                    stamp(now()),
                    stamp(now() + timedelta(minutes=30)),
                ),
            )
        return {"id": ident, "state": "PENDING"}

    @app.get("/api/documents/uploads/{upload_id}")
    def upload_status(upload_id: str, user=Depends(actor), conn=Depends(db)):
        row = conn.execute(
            "SELECT * FROM document_uploads WHERE id=? AND user_id=?", (upload_id, user["id"])
        ).fetchone()
        if not row:
            raise HTTPException(404, "업로드 요청을 찾을 수 없습니다.")
        if row["document_id"]:
            document(conn, row["document_id"], user, manage=True)
        else:
            validate_metadata(conn, user, Metadata(**json.loads(row["metadata"])["metadata"]))
        return {k: row[k] for k in ["id", "state", "error", "result_id", "expires_at"]}

    @app.put("/api/documents/uploads/{upload_id}/content")
    async def upload_content(upload_id: str, request: Request, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            saved = conn.execute(
                "SELECT * FROM document_uploads WHERE id=? AND user_id=?", (upload_id, user["id"])
            ).fetchone()
            if not saved:
                raise HTTPException(404, "업로드 요청을 찾을 수 없습니다.")
            saved = dict(saved)
            if saved["state"] != "PENDING" or saved["expires_at"] <= stamp(now()):
                raise HTTPException(409, "이미 처리했거나 만료된 업로드입니다. 새로 등록해 주세요.")
            payload = json.loads(saved["metadata"])
            if saved["document_id"]:
                row = document(conn, saved["document_id"], user, manage=True)
                check_revision(row, saved["expected_revision"])
            else:
                validate_metadata(conn, user, Metadata(**payload["metadata"]))
            conn.execute("UPDATE document_uploads SET state='PROCESSING' WHERE id=?", (upload_id,))
        key = uuid4().hex
        path = store.path(key)
        committed = False
        try:
            declared = request.headers.get("content-length")
            if declared is not None and (not declared.isdigit() or int(declared) != saved["expected_size"]):
                raise HTTPException(422, "전송 크기가 등록한 파일 크기와 다릅니다.")
            store.root.mkdir(parents=True, exist_ok=True)
            size = 0
            with path.open("xb") as output:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_FILE_SIZE or size > saved["expected_size"]:
                        raise HTTPException(413, "파일은 최대 50 MiB이며 등록한 크기와 같아야 합니다.")
                    await run_in_threadpool(output.write, chunk)
            if (
                size != saved["expected_size"]
                or await run_in_threadpool(checksum, path) != saved["expected_checksum"]
            ):
                raise HTTPException(422, "파일 크기 또는 체크섬이 일치하지 않습니다. 다시 등록해 주세요.")
            await run_in_threadpool(validate_content, path, saved["filename"])
            with transaction(conn):
                # A role/account/unit/share may have changed while bytes were in flight.
                current_user = conn.execute(
                    "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND u.active=1 AND u.email_verified=1 AND s.token_hash=? AND s.expires_at>?",
                    (
                        user["id"],
                        hashlib.sha256(request.cookies.get("yeonieum_session", "").encode()).hexdigest(),
                        stamp(now()),
                    ),
                ).fetchone()
                if not current_user:
                    raise HTTPException(403, "계정의 현재 권한이 종료되었습니다.")
                if saved["expires_at"] <= stamp(now()):
                    raise HTTPException(409, "업로드 요청이 만료되었습니다.")
                if saved["document_id"]:
                    row = document(conn, saved["document_id"], dict(current_user), manage=True)
                    check_revision(row, saved["expected_revision"])
                    ident, number, org_id = row["id"], row["current_version"] + 1, row["org_id"]
                    conn.execute(
                        "UPDATE documents SET current_version=?,revision=revision+1,updated_at=? WHERE id=?",
                        (number, stamp(now()), ident),
                    )
                else:
                    metadata = Metadata(**payload["metadata"])
                    target = validate_metadata(conn, dict(current_user), metadata)
                    ident, number, org_id = str(uuid4()), 1, target["org_id"]
                    conn.execute(
                        "INSERT INTO documents (id,org_id,unit_id,title,description,academic_year,category,folder,event,audience,created_by,created_at,updated_at,folder_id,current_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
                        (
                            ident,
                            org_id,
                            metadata.unit_id,
                            metadata.title,
                            metadata.description,
                            metadata.academic_year,
                            metadata.category,
                            metadata.folder,
                            metadata.event,
                            metadata.audience,
                            user["id"],
                            stamp(now()),
                            stamp(now()),
                            metadata.folder_id,
                        ),
                    )
                conn.execute(
                    "INSERT INTO document_versions VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        ident,
                        number,
                        key,
                        saved["filename"],
                        size,
                        saved["expected_checksum"],
                        user["id"],
                        stamp(now()),
                        payload["note"],
                    ),
                )
                conn.execute(
                    "UPDATE document_uploads SET state='READY',result_id=? WHERE id=?", (ident, upload_id)
                )
                audit(conn, user, org_id, "document.version-added", ident, {"version": number, "size": size})
            committed = True
            return {"id": ident, "version": number, "state": "READY"}
        except (Exception, asyncio.CancelledError) as exc:
            with transaction(conn):
                conn.execute(
                    "UPDATE document_uploads SET state='REJECTED',error=? WHERE id=?",
                    (
                        exc.detail
                        if isinstance(exc, HTTPException) and isinstance(exc.detail, str)
                        else "파일 저장에 실패했습니다. 다시 등록해 주세요.",
                        upload_id,
                    ),
                )
            raise
        finally:
            if not committed:
                path.unlink(missing_ok=True)

    @app.get("/api/documents/{document_id}")
    def detail(document_id: str, user=Depends(actor), conn=Depends(db)):
        row = document(conn, document_id, user, include_trash=True)
        if row["deleted_at"] and not can_manage(conn, user, row, now()):
            raise HTTPException(404, "자료가 없거나 현재 접근할 수 없습니다.")
        versions = [
            {k: r[k] for k in ["version", "filename", "size", "checksum", "created_at", "note"]}
            for r in conn.execute(
                "SELECT * FROM document_versions WHERE document_id=? ORDER BY version DESC", (document_id,)
            )
        ]
        return {**serialize(conn, row, user), "versions": versions}

    @app.post("/api/documents/{document_id}/metadata")
    def edit(document_id: str, data: Update, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = document(conn, document_id, user, manage=True)
            check_revision(row, data.expected_revision)
            if data.metadata.unit_id != row["unit_id"]:
                raise HTTPException(422, "자료의 소유 범위는 변경할 수 없습니다.")
            if (row["audience"] == "private" or data.metadata.audience == "private") and row[
                "created_by"
            ] != user["id"]:
                raise HTTPException(403, "개인 보관 전환은 작성자만 할 수 있습니다.")
            validate_metadata(conn, user, data.metadata)
            values = data.metadata.model_dump(exclude={"unit_id"})
            conn.execute(
                "UPDATE documents SET title=?,description=?,academic_year=?,category=?,folder=?,event=?,audience=?,folder_id=?,revision=revision+1,updated_at=? WHERE id=?",
                (
                    *[
                        values[k]
                        for k in [
                            "title",
                            "description",
                            "academic_year",
                            "category",
                            "folder",
                            "event",
                            "audience",
                            "folder_id",
                        ]
                    ],
                    stamp(now()),
                    document_id,
                ),
            )
            audit_values = values
            if "private" in {row["audience"], data.metadata.audience}:
                audit_values = {k: values[k] for k in ("audience", "academic_year", "folder_id")}
            audit(
                conn,
                user,
                row["org_id"],
                "document.metadata-updated",
                document_id,
                {"before": {k: row[k] for k in audit_values}, "after": audit_values},
            )
        return {"ok": True}

    @app.post("/api/documents/{document_id}/trash")
    def trash_document(document_id: str, data: Change, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = document(conn, document_id, user, manage=True)
            check_revision(row, data.expected_revision)
            conn.execute(
                "UPDATE documents SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=?",
                (stamp(now()), stamp(now()), document_id),
            )
            audit(conn, user, row["org_id"], "document.trashed", document_id, {})
        return {"ok": True}

    @app.post("/api/documents/{document_id}/restore")
    def restore_document(document_id: str, data: Change, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = document(conn, document_id, user, manage=True, include_trash=True)
            check_revision(row, data.expected_revision)
            if not row["deleted_at"]:
                raise HTTPException(409, "이미 보관 중인 자료입니다.")
            conn.execute(
                "UPDATE documents SET deleted_at=NULL,updated_at=?,revision=revision+1 WHERE id=?",
                (stamp(now()), document_id),
            )
            audit(conn, user, row["org_id"], "document.restored", document_id, {})
        return {"ok": True}

    @app.post("/api/documents/{document_id}/restore-version")
    def restore_version(document_id: str, data: RestoreVersion, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = document(conn, document_id, user, manage=True)
            check_revision(row, data.expected_revision)
            old = version(conn, document_id, data.version)
            store.verified(old)
            number = row["current_version"] + 1
            conn.execute(
                "INSERT INTO document_versions VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    document_id,
                    number,
                    old["storage_key"],
                    old["filename"],
                    old["size"],
                    old["checksum"],
                    user["id"],
                    stamp(now()),
                    f"v{data.version} 파일 복원",
                ),
            )
            conn.execute(
                "UPDATE documents SET current_version=?,revision=revision+1,updated_at=? WHERE id=?",
                (number, stamp(now()), document_id),
            )
            audit(
                conn,
                user,
                row["org_id"],
                "document.version-restored",
                document_id,
                {"source": data.version, "version": number},
            )
        return {"ok": True, "version": number}

    @app.get("/api/documents/{document_id}/versions/{number}/download")
    def download(document_id: str, number: int, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = document(conn, document_id, user)
            saved = version(conn, document_id, number)
            path = store.verified(saved)
            audit(conn, user, row["org_id"], "document.download-authorized", document_id, {"version": number})
        return FileResponse(
            path,
            media_type="application/octet-stream",
            filename=saved["filename"],
            content_disposition_type="attachment",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )
