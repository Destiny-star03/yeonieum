"""Opaque immutable files outside web assets. Content checks are not malware scanning."""

import hashlib
import re
import zipfile
from pathlib import Path

from fastapi import HTTPException

EXTENSIONS = {".pdf", ".txt", ".csv", ".png", ".jpg", ".jpeg", ".docx", ".xlsx", ".pptx", ".hwpx", ".hwp"}


def valid_filename(value):
    if (
        Path(value).suffix.lower() not in EXTENSIONS
        or any(c in value for c in "/\\\r\n\x00:")
        or any(ord(c) < 32 for c in value)
        or value in {".", ".."}
    ):
        raise HTTPException(422, "지원하는 파일 이름·형식을 확인해 주세요.")
    return value


def checksum(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def validate_content(path, filename, *, max_unpacked=100 * 1024 * 1024):
    suffix = Path(filename).suffix.lower()
    with path.open("rb") as source:
        head = source.read(16)
    signatures = {
        ".pdf": b"%PDF-",
        ".png": b"\x89PNG\r\n\x1a\n",
        ".jpg": b"\xff\xd8\xff",
        ".jpeg": b"\xff\xd8\xff",
        ".hwp": b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
    }
    try:
        if suffix in signatures:
            if not head.startswith(signatures[suffix]):
                raise ValueError()
        elif suffix in {".txt", ".csv"}:
            with path.open("r", encoding="utf-8-sig") as source:
                while chunk := source.read(65536):
                    if "\x00" in chunk:
                        raise ValueError()
        else:
            required = {
                ".docx": "word/document.xml",
                ".xlsx": "xl/workbook.xml",
                ".pptx": "ppt/presentation.xml",
                ".hwpx": "Contents/content.hpf",
            }[suffix]
            with zipfile.ZipFile(path) as archive:
                entries = archive.infolist()
                if (
                    len(entries) > 10000
                    or sum(i.file_size for i in entries) > max_unpacked
                    or any(i.flag_bits & 1 for i in entries)
                    or required not in archive.namelist()
                    or any("vbaproject" in i.filename.lower() for i in entries)
                ):
                    raise ValueError()
    except (ValueError, UnicodeError, zipfile.BadZipFile, KeyError):
        raise HTTPException(422, "파일 내용과 형식이 맞지 않거나 지원하지 않는 파일입니다.") from None


class FileStore:
    def __init__(self, root):
        self.root = Path(root)

    def path(self, key):
        if not re.fullmatch(r"[a-f0-9]{32}", key):
            raise HTTPException(409, "파일 저장 정보가 올바르지 않습니다.")
        return self.root / key

    def verified(self, version):
        path = self.path(version["storage_key"])
        if (
            not path.is_file()
            or path.stat().st_size != version["size"]
            or checksum(path) != version["checksum"]
        ):
            raise HTTPException(409, "파일이 없거나 무결성 확인에 실패했습니다. 백업을 확인해 주세요.")
        return path
