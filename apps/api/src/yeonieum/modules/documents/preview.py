"""Bounded previews of library files, without executing document content."""

from contextlib import closing
from io import BytesIO
from math import isfinite
from pathlib import Path
from struct import error as StructError
from threading import Lock
from zipfile import BadZipFile, ZipFile
from zlib import error as ZlibError

from olefile import DEFECT_INCORRECT, OleFileIO
from PIL import Image, ImageOps
from pypdfium2 import PdfDocument, PdfiumError

PREVIEW_SIZE = 480
MAX_IMAGE_PIXELS = 32_000_000
MAX_EMBEDDED_SIZE = 8 * 1024 * 1024
HWPX_IMAGES = ("Preview/PrvImage.png", "Preview/PrvImage.jpg", "Preview/PrvImage.bmp")
OFFICE_IMAGES = ("docProps/thumbnail.jpeg", "docProps/thumbnail.png", "docProps/thumbnail.jpg")
PDF_LOCK = Lock()


def encode_thumbnail(image, size=PREVIEW_SIZE):
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    pixels = image.convert("RGBA")
    output = Image.new("RGB", pixels.size, "white")
    output.paste(pixels, mask=pixels.getchannel("A"))
    buffer = BytesIO()
    output.save(buffer, "JPEG", quality=87)
    return buffer.getvalue()


def image_thumbnail(source, size=PREVIEW_SIZE):
    with Image.open(source, formats=("PNG", "JPEG", "BMP", "GIF")) as image:
        if image.width * image.height > MAX_IMAGE_PIXELS:
            return None
        image.draft("RGB", (size, size))
        return encode_thumbnail(ImageOps.exif_transpose(image), size)


def archive_thumbnail(path, names):
    with ZipFile(path) as archive:
        for name in names:
            try:
                entry = archive.getinfo(name)
            except KeyError:
                continue
            if 0 < entry.file_size <= MAX_EMBEDDED_SIZE:
                return image_thumbnail(BytesIO(archive.read(entry)))
    return None


def hwp_thumbnail(path):
    with path.open("rb") as source, OleFileIO(source, raise_defects=DEFECT_INCORRECT) as document:
        if document.exists("PrvImage") and 0 < document.get_size("PrvImage") <= MAX_EMBEDDED_SIZE:
            with document.openstream("PrvImage") as preview:
                return image_thumbnail(preview)
    return None


def pdf_page_count(path):
    with PDF_LOCK, PdfDocument(path) as document:
        return len(document)


def pdf_thumbnail(path, index=0, size=PREVIEW_SIZE):
    # PDFium requires all calls to be serialized, even for separate files.
    with PDF_LOCK, PdfDocument(path) as document, closing(document[index]) as page:
        width, height = page.get_size()
        if not (isfinite(width) and isfinite(height) and min(width, height) > 0):
            return None
        with closing(page.render(scale=min(4, size / max(width, height)))) as bitmap:
            return encode_thumbnail(bitmap.to_pil(), size)


def file_preview(path, filename):
    suffix = Path(filename).suffix.lower()
    try:
        if suffix in {".txt", ".csv"}:
            with path.open(encoding="utf-8-sig") as source:
                excerpt = "\n".join(source.read(1200).splitlines()[:12])
            return (excerpt, "text/plain") if excerpt.strip() else None
        if suffix in {".png", ".jpg", ".jpeg"}:
            thumbnail = image_thumbnail(path)
        elif suffix == ".pdf":
            thumbnail = pdf_thumbnail(path)
        elif suffix == ".hwp":
            thumbnail = hwp_thumbnail(path)
        else:
            thumbnail = archive_thumbnail(path, HWPX_IMAGES if suffix == ".hwpx" else OFFICE_IMAGES)
    except (
        OSError,
        ValueError,
        RuntimeError,
        IndexError,
        BadZipFile,
        StructError,
        ZlibError,
        Image.DecompressionBombError,
        PdfiumError,
    ):
        return None
    return (thumbnail, "image/jpeg") if thumbnail else None
