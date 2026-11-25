"""Local HWP print rendering with a bounded, in-memory PDF cache."""

import os
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock

from olefile import DEFECT_INCORRECT, OleFileIO

HANGUL_SUFFIXES = {".hwp", ".hwpx"}
MAX_PREVIEW_PDF = 64 * 1024 * 1024


class PrintPreview:
    def __init__(self, storage_root):
        executable = "hwp.exe" if os.name == "nt" else "hwp"
        builtin = Path(storage_root).parent / "tooling" / "hwp-cli-1.3.1" / executable
        self.renderer = Path(os.environ.get("YEONIEUM_HWP_RENDERER", str(builtin))).resolve()
        system_fonts = (
            Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
            if os.name == "nt"
            else Path("/usr/share/fonts")
        )
        self.fonts = Path(os.environ.get("YEONIEUM_PREVIEW_FONT_DIR", str(system_fonts))).resolve()
        self._cached_pdf = lru_cache(maxsize=2)(self._render)
        self._lock = Lock()

    def pdf(self, path, filename, checksum):
        suffix = Path(filename).suffix.lower()
        if suffix == ".pdf":
            return path
        if suffix in HANGUL_SUFFIXES and self.renderer.is_file():
            with self._lock:
                return self._cached_pdf(path, suffix, checksum)
        return None

    def _render(self, path, suffix, _checksum):
        if suffix == ".hwp":
            with OleFileIO(str(path), raise_defects=DEFECT_INCORRECT) as document:
                if not 40 <= document.get_size("FileHeader") <= 4096:
                    return None
                with document.openstream("FileHeader") as stream:
                    header = stream.read(40)
            if not header.startswith(b"HWP Document File") or int.from_bytes(header[36:40], "little") & 0x516:
                return None

        with TemporaryDirectory(prefix="yeonieum-document-render-") as directory:
            work = Path(directory)
            source, output = work / f"source{suffix}", work / "preview.pdf"
            shutil.copyfile(path, source)
            command = [str(self.renderer), "render", str(source), "-o", str(output)]
            if self.fonts.is_dir():
                command.extend(["--font-dir", str(self.fonts)])
            subprocess.run(
                command,
                cwd=work,
                env={
                    key: os.environ[key]
                    for key in ("SYSTEMROOT", "WINDIR", "LANG", "LC_ALL")
                    if key in os.environ
                },
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=25,
                check=True,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            if output.is_file() and 0 < output.stat().st_size <= MAX_PREVIEW_PDF:
                return output.read_bytes()
        return None
