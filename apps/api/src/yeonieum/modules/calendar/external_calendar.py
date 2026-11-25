"""Read-only public sources, independently cached; no changes to user events."""

import asyncio
import os
from datetime import datetime, timedelta
from urllib.parse import unquote
from xml.etree import ElementTree as ET

import httpx
from fastapi import Depends, HTTPException, Request

from yeonieum.core.database import connect, stamp, transaction
from yeonieum.modules.calendar.external_parsers import SCHOOL_URL, SOURCES, holiday_events, school_events
from yeonieum.modules.calendar.policy import visible_units
from yeonieum.modules.calendar.schemas import KST

MAX_BODY = 2 * 1024 * 1024


class ExternalCalendar:
    def __init__(self, database, now, enabled=True, fetcher=None):
        self.database, self.now, self.enabled, self.fetcher = database, now, enabled, fetcher
        self.locks = {}

    def configured(self, source):
        return source == "school" or bool(self.fetcher or os.environ.get("YEONIEUM_HOLIDAY_SERVICE_KEY"))

    @staticmethod
    def buckets(start, end):
        day = start.astimezone(KST).date().replace(day=1)
        last = (end - timedelta(microseconds=1)).astimezone(KST).date()
        result = set()
        while day <= last:
            result.add(("school", str(day.year - (day.month < 3))))
            result.add(("holidays", day.strftime("%Y-%m")))
            day = (day.replace(day=28) + timedelta(days=4)).replace(day=1)
        return sorted(result)

    async def fetch(self, source, bucket):
        if self.fetcher:
            return await self.fetcher(source, bucket)
        if source == "school":
            url, params = SCHOOL_URL, {"schMonth": f"{bucket}-03"}
        else:
            year, month = bucket.split("-")
            url = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo"
            params = {
                "serviceKey": unquote(os.environ["YEONIEUM_HOLIDAY_SERVICE_KEY"]),
                "solYear": year,
                "solMonth": month,
                "numOfRows": "1000",
                "pageNo": "1",
            }
        async with asyncio.timeout(10):
            async with httpx.AsyncClient(
                timeout=8, follow_redirects=False, headers={"User-Agent": "YeonieumCalendar/1.0"}
            ) as client:
                async with client.stream("GET", url, params=params) as response:
                    response.raise_for_status()
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_BODY:
                            raise ValueError("oversized source")
                    return bytes(body)

    async def sync(self, source, bucket, force=False):
        if not self.enabled or not self.configured(source):
            return
        lock = self.locks.setdefault((source, bucket), asyncio.Lock())
        async with lock:
            conn = connect(self.database)
            try:
                previous = conn.execute(
                    "SELECT * FROM calendar_external_sync WHERE source=? AND bucket=?", (source, bucket)
                ).fetchone()
                instant = self.now()
                if previous:
                    interval = 60 if force else 3600 if previous["last_error"] else 86400
                    if instant - datetime.fromisoformat(previous["last_attempt"]) < timedelta(
                        seconds=interval
                    ):
                        return
                error = ""
                try:
                    body = await self.fetch(source, bucket)
                    if not body or len(body) > MAX_BODY:
                        raise ValueError("invalid source size")
                    items = (
                        school_events(body.decode("utf-8-sig"), int(bucket))
                        if source == "school"
                        else holiday_events(body, *map(int, bucket.split("-")))
                    )
                except (httpx.HTTPError, TimeoutError, ValueError, UnicodeError, ET.ParseError):
                    items = None
                    error = "공식 원본을 확인하지 못했습니다. 이전 자료를 유지하며 자동으로 다시 확인합니다."
                with transaction(conn):
                    at = stamp(instant)
                    if items is not None:
                        conn.execute(
                            "UPDATE calendar_external_events SET active=0 WHERE source=? AND bucket=?",
                            (source, bucket),
                        )
                        for item in items:
                            url = (
                                f"{SCHOOL_URL}?schMonth={bucket}-03"
                                if source == "school"
                                else SOURCES[source][1]
                            )
                            conn.execute(
                                "INSERT INTO calendar_external_events VALUES (?,?,?,?,?,?,?,1,?) ON CONFLICT(source,bucket,external_key) DO UPDATE SET active=1,updated_at=excluded.updated_at,source_url=excluded.source_url",
                                (
                                    source,
                                    bucket,
                                    item["key"],
                                    item["title"],
                                    item["starts_at"],
                                    item["ends_at"],
                                    url,
                                    at,
                                ),
                            )
                    conn.execute(
                        "INSERT INTO calendar_external_sync VALUES (?,?,?,?,?,?) ON CONFLICT(source,bucket) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=coalesce(excluded.last_success,calendar_external_sync.last_success),last_error=excluded.last_error,item_count=CASE WHEN excluded.last_success IS NOT NULL THEN excluded.item_count ELSE calendar_external_sync.item_count END",
                        (source, bucket, at, at if items is not None else None, error, len(items or [])),
                    )
            finally:
                conn.close()

    async def ensure(self, start, end, force=False):
        if not self.enabled:
            return
        await asyncio.gather(
            *(self.sync(source, bucket, force) for source, bucket in self.buckets(start, end))
        )

    async def run(self):
        while True:
            instant = self.now().astimezone(KST)
            start = instant.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            await self.ensure(start, start + timedelta(days=62))
            await asyncio.sleep(3600)

    def result(self, conn, start, end):
        events = {}
        for row in conn.execute(
            "SELECT * FROM calendar_external_events WHERE active=1 AND starts_at<? AND ends_at>? ORDER BY updated_at",
            (stamp(end), stamp(start)),
        ):
            source = row["source"]
            name = SOURCES[source][0]
            ident = f"external:{source}:{row['external_key']}"
            events[ident] = {
                "id": ident,
                "instance_key": ident,
                "title": row["title"],
                "starts_at": row["starts_at"],
                "ends_at": row["ends_at"],
                "all_day": True,
                "org_id": f"external:{source}",
                "org_name": name,
                "unit_id": "",
                "unit_name": name,
                "creator_name": name,
                "can_edit": False,
                "revision": 1,
                "description": "공식 원본에서 자동으로 가져온 읽기 전용 일정입니다.",
                "location": "",
                "time_zone": "Asia/Seoul",
                "recurrence": None,
                "availability": "busy",
                "visibility": "details",
                "color": "red" if source == "holidays" else "blue",
                "is_masked": False,
                "participant_ids": [],
                "participants": [],
                "links": [],
                "attachment_ids": [],
                "attachments": [],
                "reminder_minutes": [],
                "external_source": source,
                "source_url": row["source_url"],
            }
        statuses = []
        for source, (name, url) in SOURCES.items():
            buckets = [bucket for s, bucket in self.buckets(start, end) if s == source]
            rows = [
                dict(row)
                for row in conn.execute(
                    "SELECT bucket,last_attempt,last_success,last_error,item_count FROM calendar_external_sync WHERE source=?",
                    (source,),
                )
                if row["bucket"] in buckets
            ]
            statuses.append(
                {
                    "id": source,
                    "name": name,
                    "source_url": url,
                    "enabled": self.enabled,
                    "configured": self.configured(source),
                    "buckets": [
                        {
                            "bucket": bucket,
                            **next(
                                (row for row in rows if row["bucket"] == bucket),
                                {
                                    "last_success": None,
                                    "last_error": "",
                                    "last_attempt": None,
                                    "item_count": 0,
                                },
                            ),
                        }
                        for bucket in buckets
                    ],
                }
            )
        return {
            "events": sorted(events.values(), key=lambda r: (r["starts_at"], r["title"])),
            "sources": statuses,
        }


def install_external_routes(app, db, actor, now, service):
    def validate(start, end):
        if (
            start.tzinfo is None
            or end.tzinfo is None
            or not timedelta(0) < end - start <= timedelta(days=93)
            or not (2000 <= start.year <= end.year <= 2200)
        ):
            raise HTTPException(422, "2000~2200년 안에서 시간대를 포함한 최대 93일을 선택해 주세요.")

    @app.get("/api/calendar/external")
    async def external(
        request: Request, start: datetime, end: datetime, user=Depends(actor), conn=Depends(db)
    ):
        validate(start, end)
        if not visible_units(conn, user, now()):
            return {"events": [], "sources": [], "can_refresh": False}
        await service.ensure(start, end)
        user = actor(request, conn)
        # Recheck current scope after waiting on the public upstream.
        if not visible_units(conn, user, now()):
            return {"events": [], "sources": [], "can_refresh": False}
        return {**service.result(conn, start, end), "can_refresh": bool(user["is_admin"])}

    @app.post("/api/calendar/external/refresh")
    async def refresh(
        request: Request, start: datetime, end: datetime, user=Depends(actor), conn=Depends(db)
    ):
        validate(start, end)
        if not user["is_admin"]:
            raise HTTPException(403, "선생님만 공식 일정 갱신을 요청할 수 있습니다.")
        await service.ensure(start, end, True)
        user = actor(request, conn)
        if not user["is_admin"]:
            raise HTTPException(403, "현재 관리자 권한을 확인해 주세요.")
        return {**service.result(conn, start, end), "can_refresh": True}
