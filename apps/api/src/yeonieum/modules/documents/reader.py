"""Page views and plain-text previews for the authenticated file reader."""

import subprocess
from pathlib import Path

from PIL import Image
from pypdfium2 import PdfiumError

from yeonieum.modules.documents.preview import image_thumbnail, pdf_page_count, pdf_thumbnail

IMAGE_TYPES = {".jpg", ".jpeg", ".png"}
PAGE_SIZE = 1600
MAX_TEXT = 120_000
READER_ERRORS = (
    OSError,
    ValueError,
    RuntimeError,
    IndexError,
    Image.DecompressionBombError,
    PdfiumError,
    subprocess.SubprocessError,
)


def read_content(path, filename, pdf):
    suffix = Path(filename).suffix.lower()
    if pdf is not None:
        pages = pdf_page_count(pdf)
        return {"kind": "pages", "page_count": pages} if pages else {"kind": "unavailable"}
    if suffix in IMAGE_TYPES:
        return {"kind": "pages", "page_count": 1}
    if suffix in {".txt", ".csv"}:
        with path.open(encoding="utf-8-sig") as source:
            content = source.read(MAX_TEXT + 1)
        return {"kind": "text", "text": content[:MAX_TEXT], "truncated": len(content) > MAX_TEXT}
    return {"kind": "unavailable"}


def read_page(path, filename, page, pdf):
    if pdf is not None:
        return pdf_thumbnail(pdf, page - 1, PAGE_SIZE)
    if Path(filename).suffix.lower() in IMAGE_TYPES and page == 1:
        return image_thumbnail(path, PAGE_SIZE)
    return None
