"""Stage, link, and serve private expense evidence."""

from collections.abc import AsyncIterable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from starlette.responses import FileResponse

from yeonieum.core.database import audit, stamp
from yeonieum.modules.documents.storage import FileStore, checksum, valid_filename, validate_content

MAX_EVIDENCE_SIZE = 50 * 1024 * 1024
PREVIEW_MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


@dataclass(frozen=True)
class StagedEvidence:
    path: Path
    key: str
    filename: str
    size: int
    checksum: str


async def stage_evidence(store: FileStore, filename: str, chunks: AsyncIterable[bytes]) -> StagedEvidence:
    valid_filename(filename)
    key = uuid4().hex
    path = store.path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    output = path.open("xb")
    try:
        with output:
            async for chunk in chunks:
                size += len(chunk)
                if size > MAX_EVIDENCE_SIZE:
                    raise HTTPException(413, "파일은 50 MiB 이하로 등록해 주세요.")
                output.write(chunk)
        if size == 0:
            raise HTTPException(422, "빈 파일은 등록할 수 없습니다.")
        validate_content(path, filename)
        return StagedEvidence(path, key, filename, size, checksum(path))
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def link_evidence(conn, user, row, staged: StagedEvidence, now: datetime) -> dict:
    """Link a staged file inside the caller's expense transaction."""
    record_id = str(uuid4())
    conn.execute(
        "INSERT INTO expense_evidence VALUES (?,?,?,?,?,?,?,?)",
        (
            record_id,
            row["id"],
            staged.key,
            staged.filename,
            staged.size,
            staged.checksum,
            user["id"],
            stamp(now),
        ),
    )
    audit(
        conn,
        user,
        row["org_id"],
        "finance.evidence-added",
        record_id,
        {
            "expense_id": row["id"],
            "filename": staged.filename,
            "size": staged.size,
            "checksum": staged.checksum,
        },
    )
    return {"id": record_id, "size": staged.size, "checksum": staged.checksum}


def is_previewable(filename: str) -> bool:
    return Path(filename).suffix.lower() in PREVIEW_MEDIA_TYPES


def evidence_response(store: FileStore, row, *, inline: bool = False) -> FileResponse:
    filename = row["filename"]
    media_type = "application/octet-stream"
    if inline:
        media_type = PREVIEW_MEDIA_TYPES.get(Path(filename).suffix.lower())
        if media_type is None:
            raise HTTPException(415, "PDF와 PNG·JPEG 이미지만 미리 볼 수 있습니다.")
    return FileResponse(
        store.verified(row),
        media_type=media_type,
        filename=filename,
        content_disposition_type="inline" if inline else "attachment",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )
