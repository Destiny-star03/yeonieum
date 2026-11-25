"""Validate complete public snapshots before replacing cached calendar entries."""

import hashlib
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from xml.etree import ElementTree as ET

from yeonieum.core.database import stamp
from yeonieum.modules.calendar.schemas import KST

SCHOOL_URL = "https://eng.yc.ac.kr/www/scheduleList.do"
HOLIDAY_URL = "https://www.data.go.kr/data/15012690/openapi.do"
SOURCES = {"school": ("학교 학사일정", SCHOOL_URL), "holidays": ("대한민국 공휴일", HOLIDAY_URL)}


def entry(title, begin, finish):
    if not 0 <= (finish - begin).days <= 366 or not 1 <= len(title) <= 300:
        raise ValueError("invalid event")
    return {
        "key": hashlib.sha256(f"{begin}|{finish}|{title}".encode()).hexdigest()[:32],
        "title": title,
        "starts_at": stamp(datetime.combine(begin, datetime.min.time(), KST)),
        "ends_at": stamp(datetime.combine(finish + timedelta(days=1), datetime.min.time(), KST)),
    }


@dataclass
class Node:
    tag: str
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)

    def elements(self, tag=None):
        return [c for c in self.children if isinstance(c, Node) and (tag is None or c.tag == tag)]

    def text(self):
        return " ".join(c.text() if isinstance(c, Node) else c for c in self.children).strip()


class SchoolHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]
        self.boxes = []
        self.nodes = 0

    def handle_starttag(self, tag, attrs):
        self.nodes += 1
        if len(self.stack) > 150 or self.nodes > 50000:
            raise ValueError("complex HTML")
        node = Node(tag, dict(attrs))
        self.stack[-1].children.append(node)
        if "b-cal-list-box" in node.attrs.get("class", "").split():
            self.boxes.append(node)
        if tag not in {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self.stack[-1].tag not in {"script", "style"}:
            self.stack[-1].children.append(data)


def school_events(html, academic_year):
    parser = SchoolHTML()
    parser.feed(html)
    if len(parser.boxes) != 1:
        raise ValueError("school layout changed")
    year, months, result = None, [], {}
    for month_box in parser.boxes[0].elements("div"):
        headings, contents = month_box.elements("p"), month_box.elements("div")
        if len(headings) != 1 or len(contents) != 1:
            raise ValueError("incomplete month")
        header = re.fullmatch(r"(?:(\d{4})년\s*)?(\d{1,2})월", headings[0].text())
        if not header:
            raise ValueError("unknown month")
        if header[1]:
            year = int(header[1])
        month = int(header[2])
        if year != academic_year + (month < 3):
            raise ValueError("unpublished academic year")
        months.append(month)
        for event in contents[0].elements("div"):
            period, titles = event.elements("p"), event.elements("ul")
            if len(period) != 1 or len(titles) != 1:
                raise ValueError("incomplete event")
            match = re.fullmatch(
                r"(?:(\d{1,2})\.)?(\d{1,2})\([^)]*\)\s*(?:~\s*(?:(\d{1,2})\.)?(\d{1,2})\([^)]*\))?",
                period[0].text(),
            )
            if not match:
                raise ValueError("unknown date")
            begin_month = int(match[1] or month)
            if begin_month != month:
                raise ValueError("wrong academic month")
            end_month = int(match[3] or begin_month)
            begin = date(year, begin_month, int(match[2]))
            finish = date(year + (end_month < begin_month), end_month, int(match[4] or match[2]))
            if not titles[0].elements("li"):
                raise ValueError("missing title")
            for title in titles[0].elements("li"):
                value = entry(re.sub(r"\s+", " ", title.text()), begin, finish)
                result[value["key"]] = value
    if months != [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2] or not result:
        raise ValueError("incomplete academic year")
    if len(result) > 2000:
        raise ValueError("too many events")
    return list(result.values())


def holiday_events(content, year, month):
    if b"\0" in content or b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
        raise ValueError("unsafe XML")
    root = ET.fromstring(content)
    if root.findtext("header/resultCode") != "00":
        raise ValueError("holiday API error")
    total = int(root.findtext("body/totalCount", "-1"))
    items = root.findall("body/items/item")
    if not 0 <= total <= 1000 or total != len(items):
        raise ValueError("incomplete holiday response")
    result = {}
    for item in items:
        raw = item.findtext("locdate", "")
        if not re.fullmatch(r"\d{8}", raw):
            raise ValueError("invalid holiday date")
        day = datetime.strptime(raw, "%Y%m%d").date()
        if (day.year, day.month) != (year, month):
            raise ValueError("wrong holiday month")
        holiday = item.findtext("isHoliday")
        if holiday not in {"Y", "N"}:
            raise ValueError("unknown holiday flag")
        if holiday == "Y":
            value = entry(re.sub(r"\s+", " ", item.findtext("dateName", "")).strip(), day, day)
            result[value["key"]] = value
    return list(result.values())
