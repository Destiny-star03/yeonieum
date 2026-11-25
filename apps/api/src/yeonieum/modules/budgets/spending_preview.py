"""Bounded XLSX/UTF-8 CSV preview. Values are suggestions, never ledger mutations."""

import csv
import io
import posixpath
import re
import zipfile
import zlib
from decimal import Decimal, InvalidOperation
from xml.etree import ElementTree as ET

from fastapi import HTTPException

MAX_PREVIEW_SIZE = 5 * 1024 * 1024


def fail(message):
    raise HTTPException(422, message)


def xml(data):
    if (
        len(data) > 2 * 1024 * 1024
        or b"\0" in data
        or b"<!DOCTYPE" in data.upper()
        or b"<!ENTITY" in data.upper()
    ):
        fail("복잡하거나 지원하지 않는 엑셀 XML입니다. 값을 CSV로 저장해 주세요.")
    return ET.fromstring(data)


def excel_rows(content):
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        entries = archive.infolist()
        if (
            len(entries) > 1000
            or sum(e.file_size for e in entries) > 10 * 1024 * 1024
            or any(e.flag_bits & 1 or "vbaproject" in e.filename.lower() for e in entries)
        ):
            fail("엑셀 읽기는 암호·매크로 없이 압축 해제 크기 10 MiB 이하만 지원합니다.")
        book = xml(archive.read("xl/workbook.xml"))
        sheet = next(
            (s for s in book.findall("{*}sheets/{*}sheet") if s.get("state", "visible") == "visible"), None
        )
        if sheet is None:
            fail("읽을 수 있는 시트가 없습니다.")
        rid = sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        relations = xml(archive.read("xl/_rels/workbook.xml.rels"))
        relation = next(
            (r for r in relations if r.get("Id") == rid and r.get("TargetMode") != "External"), None
        )
        if relation is None:
            fail("시트 연결을 읽을 수 없습니다.")
        target = relation.get("Target", "")
        target = posixpath.normpath(target.lstrip("/") if target.startswith("/") else "xl/" + target)
        if not target.startswith("xl/worksheets/") or not target.endswith(".xml"):
            fail("지원하지 않는 시트 위치입니다.")
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ["".join(s.itertext()) for s in xml(archive.read("xl/sharedStrings.xml"))]
        result = []
        for row in xml(archive.read(target)).findall("{*}sheetData/{*}row"):
            if len(result) >= 520:
                fail("엑셀 읽기는 최대 500개 지출 행을 지원합니다.")
            values, formulas = [""] * 64, set()
            for cell in row:
                reference = re.match(r"^([A-Z]{1,3})[0-9]+$", cell.get("r", ""))
                if not reference:
                    fail("셀 위치를 읽을 수 없습니다.")
                column = 0
                for char in reference[1]:
                    column = column * 26 + ord(char) - 64
                if column > 64:
                    fail("엑셀 읽기는 64열 이하의 표를 지원합니다.")
                value = cell.findtext("{*}v", "")
                if cell.get("t") == "s":
                    value = shared[int(value)]
                elif cell.get("t") == "inlineStr":
                    value = "".join(cell.find("{*}is").itertext())
                values[column - 1] = value.strip()
                if cell.find("{*}f") is not None:
                    formulas.add(column - 1)
            result.append((values, formulas))
        return result, sheet.get("name", "첫 시트")


def preview_spending(content, filename):
    if not content or len(content) > MAX_PREVIEW_SIZE:
        fail("내역 미리 읽기는 1바이트~5 MiB의 XLSX·UTF-8 CSV를 지원합니다.")
    try:
        if filename.lower().endswith(".xlsx"):
            table, sheet = excel_rows(content)
        elif filename.lower().endswith(".csv"):
            text = content.decode("utf-8-sig")
            if "\0" in text:
                fail("UTF-8 CSV 파일을 선택해 주세요.")
            table = []
            for row in csv.reader(io.StringIO(text)):
                if len(table) >= 520 or len(row) > 64:
                    fail("최대 500개 지출 행·64열까지 읽을 수 있습니다.")
                table.append(([cell.strip() for cell in row], set()))
            sheet = "CSV"
        else:
            fail("자동 읽기는 XLSX·CSV만 지원합니다. 다른 증빙은 금액을 직접 입력해 주세요.")
        header = None
        for i, (row, _) in enumerate(table[:20]):
            labels = [re.sub(r"\s|\(원\)|원화", "", c) for c in row]
            amount_col = next(
                (j for j, c in enumerate(labels) if c in {"금액", "지출금액", "사용금액", "집행금액"}), None
            )
            purpose_col = next(
                (j for j, c in enumerate(labels) if c in {"용도", "내역", "지출내역", "적요"}), None
            )
            if amount_col is not None and purpose_col is not None:
                header = i, amount_col, purpose_col
                break
        if header is None:
            fail("첫 20행 안에 ‘용도’와 ‘금액’ 열이 필요합니다. CSV 양식을 참고해 주세요.")
        start, amount_col, purpose_col = header
        items = []
        for number, (row, formulas) in enumerate(table[start + 1 :], start + 2):
            if not any(row):
                continue
            if max(amount_col, purpose_col) >= len(row):
                fail(f"{number}행의 용도·금액을 확인해 주세요.")
            purpose, raw = row[purpose_col], row[amount_col]
            if re.sub(r"\s", "", purpose) in {"합계", "총계", "총합계", "소계"}:
                continue
            if amount_col in formulas or purpose_col in formulas:
                fail(f"{number}행에 계산식이 있습니다. 계산 결과를 값으로 저장해 주세요.")
            if not purpose or len(purpose) > 300:
                fail(f"{number}행의 용도를 1~300자로 입력해 주세요.")
            amount = Decimal(raw.replace(",", "").replace("원", "").replace("₩", "").strip())
            if not amount.is_finite() or amount != amount.to_integral_value() or not 0 < amount <= 10**15:
                fail(f"{number}행의 금액은 양의 정수 원화여야 합니다.")
            items.append({"row": number, "purpose": purpose, "amount": int(amount)})
            if len(items) > 500:
                fail("한 파일에서 최대 500개 지출 행을 읽을 수 있습니다.")
        total = sum(r["amount"] for r in items)
        if not items or total > 10**15:
            fail("읽을 지출이 없거나 합계가 허용 범위를 넘습니다.")
        return {
            "items": items,
            "total": total,
            "sheet": sheet,
            "notice": (
                ("첫 표시 시트의 값만 읽었습니다. " if filename.lower().endswith(".xlsx") else "")
                + "합계·소계 행은 합산에서 제외했습니다. 집행일·집행자·용도를 확인한 뒤 기록하면 "
                "지출 1건과 원본 증빙을 저장합니다."
            ),
        }
    except (
        ValueError,
        KeyError,
        IndexError,
        AttributeError,
        InvalidOperation,
        UnicodeError,
        zipfile.BadZipFile,
        zlib.error,
        csv.Error,
        ET.ParseError,
        OSError,
        NotImplementedError,
    ):
        fail("표를 읽을 수 없습니다. 용도·금액 열의 값과 XLSX·UTF-8 CSV 형식을 확인해 주세요.")
