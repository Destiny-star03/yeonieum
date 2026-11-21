"""Public source fixtures only: no live network or user database in tests."""

from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET

import pytest
from fastapi.testclient import TestClient

from yeonieum.core.database import connect
from yeonieum.main import create_app
from yeonieum.modules.calendar.external_calendar import ExternalCalendar
from yeonieum.modules.calendar.external_parsers import holiday_events, school_events

ORIGIN = {"origin": "http://localhost:5173"}
RANGE = {"start": "2026-06-01T00:00:00+09:00", "end": "2026-07-01T00:00:00+09:00"}


def school_html(year=2026, title="가상 학사 일정"):
    months = []
    for month in [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2]:
        heading = (
            f"{year}년<br/>3월" if month == 3 else f"{year + 1}년<br/>1월" if month == 1 else f"{month}월"
        )
        extra = "<div><p>24(Wed) ~ 7.30(Thu)</p><ul><li>가상 기간 일정</li></ul></div>" if month == 6 else ""
        months.append(
            f"<div><p>{heading}</p><div><div><p>15(Mon)</p><ul><li>{title}</li></ul></div>{extra}</div></div>"
        )
    return '<div class="b-cal-list-box">' + "".join(months) + "</div>"


def holiday_xml(bucket, title="가상 공휴일", flag="Y"):
    return f"<response><header><resultCode>00</resultCode></header><body><items><item><locdate>{bucket.replace('-', '')}15</locdate><dateName>{title}</dateName><isHoliday>{flag}</isHoliday></item></items><totalCount>1</totalCount></body></response>".encode()


def login(client, account="staff-demo"):
    assert (
        client.post(
            "/api/auth/login", json={"identifier": account, "password": "Yeonieum-demo-2026!"}
        ).status_code
        == 200
    )


@pytest.fixture
def linked(tmp_path):
    path = tmp_path / "external.sqlite3"
    clock = [datetime(2026, 6, 1, tzinfo=timezone.utc)]
    state = {"bad": False, "title": "가상 학사 일정", "calls": []}

    async def fetch(source, bucket):
        state["calls"].append((source, bucket))
        if state["bad"]:
            return b"invalid source"
        return (
            school_html(int(bucket), state["title"]).encode() if source == "school" else holiday_xml(bucket)
        )

    app = create_app(path, lambda: clock[0], external_sync=True, external_fetcher=fetch)
    with TestClient(app, headers=ORIGIN) as client:
        login(client)
        yield client, path, clock, state


def test_academic_parser_year_rollover_cross_month_and_complete_snapshot():
    rows = school_events(school_html(), 2026)
    assert len(rows) == 13
    period = next(row for row in rows if row["title"] == "가상 기간 일정")
    assert period["starts_at"] == "2026-06-23T15:00:00+00:00"
    assert period["ends_at"] == "2026-07-30T15:00:00+00:00"
    assert any(row["starts_at"].startswith("2027-02-14") for row in rows)
    assert school_events(school_html(), 2026) == rows
    with pytest.raises(ValueError):
        school_events(school_html(), 2027)
    with pytest.raises(ValueError):
        school_events(school_html().replace("2월", "unknown"), 2026)
    with pytest.raises(ValueError):
        school_events("<div>학교 페이지 구조 변경</div>", 2026)


def test_holiday_parser_uses_official_flag_and_allows_verified_empty_month():
    assert len(holiday_events(holiday_xml("2026-06"), 2026, 6)) == 1
    assert holiday_events(holiday_xml("2026-06", flag="N"), 2026, 6) == []
    assert (
        holiday_events(
            b"<response><header><resultCode>00</resultCode></header><body><items/><totalCount>0</totalCount></body></response>",
            2026,
            6,
        )
        == []
    )


@pytest.mark.parametrize(
    "content",
    [
        b"<response><header><resultCode>30</resultCode></header></response>",
        b"<!DOCTYPE response [<!ENTITY a 'x'>]><response/>",
        holiday_xml("2026-07"),
        holiday_xml("2026-06", flag="unknown"),
        holiday_xml("2026-06").replace(b"20260615", b"20260230"),
        holiday_xml("2026-06").replace(b"<totalCount>1", b"<totalCount>2"),
    ],
)
def test_holiday_parser_rejects_incomplete_or_unsafe_source(content):
    with pytest.raises((ValueError, ET.ParseError)):
        holiday_events(content, 2026, 6)


def test_sync_deduplicates_and_preserves_user_events_and_failed_snapshot(linked):
    client, path, clock, state = linked
    user = client.post(
        "/api/calendar/events",
        json={
            "unit_id": "council",
            "title": "가상 자체 일정",
            "starts_at": "2026-06-15T09:00:00+09:00",
            "ends_at": "2026-06-15T10:00:00+09:00",
        },
    ).json()
    first = client.get("/api/calendar/external", params=RANGE).json()
    assert len(first["events"]) == 3
    assert all(not item["can_edit"] and item["source_url"].startswith("https://") for item in first["events"])
    calls = len(state["calls"])
    second = client.get("/api/calendar/external", params=RANGE).json()
    assert [row["id"] for row in second["events"]] == [row["id"] for row in first["events"]]
    assert len(state["calls"]) == calls
    state["bad"] = True
    clock[0] += timedelta(days=2)
    login(client)
    failed = client.get("/api/calendar/external", params=RANGE).json()
    assert failed["events"] == first["events"]
    assert all(source["buckets"][0]["last_error"] for source in failed["sources"])
    with connect(path) as conn:
        assert conn.execute("SELECT count(*) FROM calendar_events").fetchone()[0] == 1
    assert client.get(f"/api/calendar/events/{user['id']}").json()["title"] == "가상 자체 일정"
    ident = first["events"][0]["id"]
    assert client.get(f"/api/calendar/events/{ident}").status_code == 404
    assert (
        client.post(
            f"/api/calendar/events/{ident}/remove", json={"expected_revision": 1, "confirmed": True}
        ).status_code
        == 404
    )


def test_changed_source_replaces_only_its_snapshot_and_keeps_removed_history(linked):
    client, path, clock, state = linked
    first = client.get("/api/calendar/external", params=RANGE).json()
    old = next(row["id"] for row in first["events"] if row["title"] == "가상 학사 일정")
    state["title"] = "가상 수정 학사 일정"
    clock[0] += timedelta(days=2)
    login(client)
    changed = client.get("/api/calendar/external", params=RANGE).json()
    assert old not in {row["id"] for row in changed["events"]}
    assert any(row["title"] == "가상 수정 학사 일정" for row in changed["events"])
    with connect(path) as conn:
        assert (
            conn.execute(
                "SELECT count(*) FROM calendar_external_events WHERE source='school' AND active=0"
            ).fetchone()[0]
            == 12
        )


def test_manual_refresh_admin_only_and_current_role_required(linked):
    client, path, clock, state = linked
    login(client, "student-rep")
    assert client.get("/api/calendar/external", params=RANGE).json()["events"]
    assert client.post("/api/calendar/external/refresh", params=RANGE).status_code == 403
    with connect(path) as conn:
        conn.execute("UPDATE assignments SET revoked_at=? WHERE user_id='rep'", (clock[0].isoformat(),))
    assert client.get("/api/calendar/external", params=RANGE).json()["events"] == []
    login(client)
    clock[0] += timedelta(minutes=2)
    assert client.post("/api/calendar/external/refresh", params=RANGE).status_code == 200
    calls = len(state["calls"])
    assert client.post("/api/calendar/external/refresh", params=RANGE).status_code == 200
    assert len(state["calls"]) == calls


def test_missing_key_is_explicit_and_never_uses_unofficial_holiday_fallback(tmp_path, monkeypatch):
    monkeypatch.delenv("YEONIEUM_HOLIDAY_SERVICE_KEY", raising=False)
    calls = []

    async def fetch(self, source, bucket):
        calls.append(source)
        return school_html(int(bucket)).encode()

    monkeypatch.setattr(ExternalCalendar, "fetch", fetch)
    app = create_app(
        tmp_path / "missing-key.sqlite3",
        lambda: datetime(2026, 6, 1, tzinfo=timezone.utc),
        external_sync=True,
    )
    with TestClient(app, headers=ORIGIN) as client:
        login(client)
        data = client.get("/api/calendar/external", params=RANGE).json()
        assert next(s for s in data["sources"] if s["id"] == "holidays")["configured"] is False
        assert set(calls) == {"school"}
        assert not any(e["external_source"] == "holidays" for e in data["events"])


@pytest.mark.parametrize(
    "start,end",
    [
        ("2026-06-01", "2026-07-01"),
        ("2026-06-01T00:00:00Z", "2027-07-01T00:00:00Z"),
        ("1999-06-01T00:00:00Z", "1999-07-01T00:00:00Z"),
    ],
)
def test_external_window_validation(linked, start, end):
    client, _, _, _ = linked
    assert client.get("/api/calendar/external", params={"start": start, "end": end}).status_code == 422
