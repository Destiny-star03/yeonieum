from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from yeonieum.core.database import connect
from yeonieum.main import create_app

ORIGIN = {"origin": "http://localhost:5173"}


@pytest.fixture
def calendar(tmp_path):
    path = tmp_path / "calendar.sqlite3"
    clock = [datetime(datetime.now(timezone.utc).year, 6, 1, tzinfo=timezone.utc)]
    app = create_app(path, lambda: clock[0])
    with TestClient(app, headers=ORIGIN) as client:
        login(client)
        yield client, path, clock, app


def login(client, account="student-chair"):
    r = client.post("/api/auth/login", json={"identifier": account, "password": "Yeonieum-demo-2026!"})
    assert r.status_code == 200


def payload(**extra):
    year = datetime.now(timezone.utc).year
    return {
        "unit_id": "software",
        "title": "가상 회의",
        "starts_at": f"{year}-06-10T09:00:00+09:00",
        "ends_at": f"{year}-06-10T10:00:00+09:00",
        **extra,
    }


def listing(client, year=None):
    year = year or datetime.now(timezone.utc).year
    return client.get(
        "/api/calendar/events",
        params={"start": f"{year}-06-01T00:00:00+09:00", "end": f"{year}-07-01T00:00:00+09:00"},
    )


def test_calendar_create_update_remove_persists_and_keeps_audit(calendar):
    c, path, clock, app = calendar
    new = c.post("/api/calendar/events", json=payload())
    assert new.status_code == 201
    row = new.json()
    ident = row["id"]
    assert row["can_edit"] and row["revision"] == 1
    assert len(listing(c).json()["events"]) == 1
    changed = c.post(
        f"/api/calendar/events/{ident}/update",
        json=payload(title="회의 변경", location="가상 회의실", expected_revision=1),
    )
    assert changed.status_code == 200 and changed.json()["revision"] == 2
    assert (
        c.post(f"/api/calendar/events/{ident}/update", json=payload(expected_revision=1)).status_code == 409
    )
    with TestClient(app, headers=ORIGIN) as restarted:
        login(restarted)
        assert restarted.get(f"/api/calendar/events/{ident}").json()["title"] == "회의 변경"
        assert (
            restarted.post(
                f"/api/calendar/events/{ident}/remove", json={"confirmed": True, "expected_revision": 1}
            ).status_code
            == 409
        )
        assert (
            restarted.post(
                f"/api/calendar/events/{ident}/remove", json={"confirmed": True, "expected_revision": 2}
            ).status_code
            == 200
        )
        assert restarted.get(f"/api/calendar/events/{ident}").status_code == 404
        assert listing(restarted).json()["events"] == []
    conn = connect(path)
    assert conn.execute("SELECT deleted_at FROM calendar_events WHERE id=?", (ident,)).fetchone()[0]
    assert [
        r[0] for r in conn.execute("SELECT action FROM audit WHERE target_id=? ORDER BY rowid", (ident,))
    ] == ["calendar.created", "calendar.updated", "calendar.removed"]
    conn.close()


def test_one_event_can_be_shared_with_multiple_authorized_organizations(calendar):
    client, path, _, app = calendar
    login(client, "staff-demo")
    assert (
        client.post("/api/calendar/events", json=payload(additional_unit_ids=["council"])).status_code == 422
    )
    created = client.post(
        "/api/calendar/events",
        json=payload(additional_unit_ids=["student"], participant_ids=["rep", "other"]),
    )
    assert created.status_code == 201
    event = created.json()
    ident = event["id"]
    url = f"/api/calendar/events/{ident}"
    assert [target["unit_id"] for target in event["calendars"]] == ["software", "student"]
    assert [row["id"] for row in listing(client).json()["events"]] == [ident]

    with TestClient(app, headers=ORIGIN) as reader:
        login(reader, "student-other")
        visible = reader.get(url).json()
        assert visible["unit_id"] == "student"
        assert [target["unit_id"] for target in visible["calendars"]] == ["student"]
        assert visible["participant_ids"] == ["other"]
        assert not visible["can_edit"]
        assert (
            reader.post(f"{url}/update", json=payload(unit_id="student", expected_revision=1)).status_code
            == 403
        )
        assert (
            reader.post(f"{url}/remove", json={"confirmed": True, "expected_revision": 1}).status_code == 403
        )
        assert (
            reader.post(
                "/api/calendar/events", json=payload(unit_id="student", additional_unit_ids=["software"])
            ).status_code
            == 403
        )
        assert (
            reader.get(
                "/api/calendar/editor-options", params=[("unit_id", "student"), ("unit_id", "software")]
            ).status_code
            == 403
        )
        assert [row["id"] for row in listing(reader).json()["events"]] == [ident]
        login(reader, "student-head")
        assert reader.get(url).status_code == 404

    updated = client.post(f"{url}/update", json=payload(title="공동 일정", expected_revision=1))
    assert updated.status_code == 200
    assert [target["unit_id"] for target in updated.json()["calendars"]] == ["software", "student"]
    conn = connect(path)
    try:
        audited = conn.execute(
            "SELECT org_id, action FROM audit WHERE target_id=? ORDER BY org_id, action", (ident,)
        ).fetchall()
        assert [tuple(row) for row in audited] == [
            ("council", "calendar.created"),
            ("council", "calendar.updated"),
            ("student", "calendar.created"),
            ("student", "calendar.updated"),
        ]
    finally:
        conn.close()


def test_event_color_palette_persists_and_rejects_unknown_values(calendar):
    c, _, _, app = calendar
    colors = [
        "default",
        "sand",
        "stone",
        "ink",
        "clay",
        "red",
        "orange",
        "yellow",
        "green",
        "mint",
        "sky",
        "blue",
        "violet",
        "pink",
    ]
    row = c.post("/api/calendar/events", json=payload(color="stone")).json()
    for color in colors:
        response = c.post(
            f"/api/calendar/events/{row['id']}/update",
            json=payload(color=color, expected_revision=row["revision"]),
        )
        assert response.status_code == 200, response.text
        row = response.json()
        assert row["color"] == color
    assert c.post("/api/calendar/events", json=payload(color="#123456")).status_code == 422
    with TestClient(app, headers=ORIGIN) as restarted:
        login(restarted)
        assert restarted.get(f"/api/calendar/events/{row['id']}").json()["color"] == "pink"


def test_parent_announcements_visible_but_cross_department_and_writes_are_limited(calendar):
    c, path, clock, app = calendar
    parent = c.post("/api/calendar/events", json=payload()).json()
    other_class = c.post(
        "/api/calendar/events", json=payload(unit_id="software-2-A", title="다른 반 일정")
    ).json()
    login(c, "student-rep")
    options = c.get("/api/calendar/options").json()["units"]
    assert any(u["id"] == "software" and not u["can_create"] for u in options)
    assert any(u["id"] == "software-1-A" and u["can_create"] for u in options)
    assert {r["id"] for r in listing(c).json()["events"]} == {parent["id"]}
    assert not c.get(f"/api/calendar/events/{parent['id']}").json()["can_edit"]
    assert c.get(f"/api/calendar/events/{other_class['id']}").status_code == 404
    assert c.post("/api/calendar/events", json=payload()).status_code == 403
    assert (
        c.post(f"/api/calendar/events/{parent['id']}/update", json=payload(expected_revision=1)).status_code
        == 403
    )
    assert (
        c.post(
            f"/api/calendar/events/{parent['id']}/remove", json={"confirmed": True, "expected_revision": 1}
        ).status_code
        == 403
    )
    own = c.post("/api/calendar/events", json=payload(unit_id="software-1-A")).json()
    assert own["can_edit"]
    login(c, "student-head")
    assert listing(c).json()["events"] == []
    assert c.get(f"/api/calendar/events/{own['id']}").status_code == 404
    login(c, "staff-demo")
    assert c.get(f"/api/calendar/events/{own['id']}").json()["can_edit"]


def test_creator_loses_access_after_revocation_and_schedules_are_retained(calendar):
    c, path, clock, app = calendar
    login(c, "student-rep")
    row = c.post("/api/calendar/events", json=payload(unit_id="software-1-A")).json()
    ident = row["id"]
    conn = connect(path)
    conn.execute("UPDATE assignments SET revoked_at=? WHERE user_id='rep'", (clock[0].isoformat(),))
    conn.close()
    assert listing(c).json()["events"] == []
    assert c.get(f"/api/calendar/events/{ident}").status_code == 404
    assert c.post("/api/calendar/events", json=payload(unit_id="software-1-A")).status_code == 403
    login(c, "staff-demo")
    assert c.get(f"/api/calendar/events/{ident}").status_code == 200
    assert c.post("/api/units/software-1-A/remove", json={"confirmed": True}).status_code == 200
    assert c.get(f"/api/calendar/events/{ident}").status_code == 404
    conn = connect(path)
    assert conn.execute("SELECT deleted_at FROM calendar_events WHERE id=?", (ident,)).fetchone()[0] is None
    conn.close()


def test_all_day_and_overlap_use_korean_midnight_and_exclusive_end(calendar):
    c, path, clock, app = calendar
    year = clock[0].year
    row = c.post(
        "/api/calendar/events",
        json=payload(
            all_day=True, starts_at=f"{year}-06-10T00:00:00+09:00", ends_at=f"{year}-06-12T00:00:00+09:00"
        ),
    )
    assert row.status_code == 201
    for day, count in [(9, 0), (10, 1), (11, 1), (12, 0)]:
        r = c.get(
            "/api/calendar/events",
            params={
                "start": f"{year}-06-{day:02}T00:00:00+09:00",
                "end": f"{year}-06-{day + 1:02}T00:00:00+09:00",
            },
        )
        assert len(r.json()["events"]) == count
    assert c.post("/api/calendar/events", json=payload(all_day=True)).status_code == 422


@pytest.mark.parametrize(
    "extra",
    [
        {"title": "   "},
        {"starts_at": "2026-06-01T09:00:00"},
        {"ends_at": "2020-01-01T00:00:00+00:00"},
        {"all_day": 1},
        {"title": "x" * 121},
    ],
)
def test_invalid_calendar_input_never_creates_an_event(calendar, extra):
    c, path, clock, app = calendar
    assert c.post("/api/calendar/events", json=payload(**extra)).status_code == 422
    assert listing(c).json()["events"] == []


@pytest.mark.parametrize("confirmed", [False, "true", 1, None])
def test_delete_requires_explicit_boolean_confirmation(calendar, confirmed):
    c, path, clock, app = calendar
    row = c.post("/api/calendar/events", json=payload()).json()
    assert (
        c.post(
            f"/api/calendar/events/{row['id']}/remove", json={"confirmed": confirmed, "expected_revision": 1}
        ).status_code
        == 422
    )
    assert c.get(f"/api/calendar/events/{row['id']}").status_code == 200


def test_calendar_rollback_and_scope_immutability(calendar):
    c, path, clock, app = calendar
    row = c.post("/api/calendar/events", json=payload()).json()
    assert (
        c.post(
            f"/api/calendar/events/{row['id']}/update",
            json=payload(unit_id="software-1-A", expected_revision=1),
        ).status_code
        == 422
    )
    conn = connect(path)
    conn.execute(
        "CREATE TRIGGER fail_calendar_audit BEFORE INSERT ON audit WHEN NEW.action='calendar.removed' BEGIN SELECT RAISE(ABORT,'test failure'); END"
    )
    conn.close()
    with pytest.raises(Exception):
        c.post(f"/api/calendar/events/{row['id']}/remove", json={"confirmed": True, "expected_revision": 1})
    assert c.get(f"/api/calendar/events/{row['id']}").json()["revision"] == 1


def test_calendar_query_bounds_and_authentication(calendar):
    c, path, clock, app = calendar
    year = clock[0].year
    assert (
        c.get(
            "/api/calendar/events",
            params={"start": f"{year}-01-01T00:00:00Z", "end": f"{year}-12-31T00:00:00Z"},
        ).status_code
        == 422
    )
    assert (
        c.get(
            "/api/calendar/events",
            params={"start": f"{year}-06-01T00:00:00", "end": f"{year}-06-02T00:00:00"},
        ).status_code
        == 422
    )
    assert c.post("/api/auth/logout").status_code == 200
    assert c.get("/api/calendar/options").status_code == 401
    assert listing(c).status_code == 401


def test_weekly_series_expands_only_in_window_and_delete_removes_all(calendar):
    c, path, clock, app = calendar
    year = clock[0].year
    row = c.post(
        "/api/calendar/events",
        json=payload(
            starts_at=f"{year}-06-01T09:00:00+09:00",
            ends_at=f"{year}-06-01T10:00:00+09:00",
            recurrence={"frequency": "weekly", "interval": 1, "until": f"{year}-06-30"},
        ),
    ).json()
    events = listing(c).json()["events"]
    assert len(events) == 5
    assert len({r["instance_key"] for r in events}) == 5
    assert {r["id"] for r in events} == {row["id"]}
    assert [
        datetime.fromisoformat(r["starts_at"]).astimezone(timezone(timedelta(hours=9))).day for r in events
    ] == [1, 8, 15, 22, 29]
    assert (
        c.post(
            f"/api/calendar/events/{row['id']}/remove", json={"confirmed": True, "expected_revision": 1}
        ).status_code
        == 200
    )
    assert listing(c).json()["events"] == []


def test_scoped_occurrence_moves_keep_original_order_and_count(calendar):
    client, path, clock, app = calendar
    row = client.post(
        "/api/calendar/events", json=payload(recurrence={"frequency": "daily", "count": 4})
    ).json()
    url = f"/api/calendar/events/{row['id']}/occurrence"
    original = listing(client).json()["events"]
    year = clock[0].year

    def at(day, hour):
        return f"{year}-06-{day:02d}T{hour:02d}:00:00+00:00"

    single = {
        "expected_revision": 1,
        "scope": "single",
        "occurrence_start": original[1]["occurrence_start"],
        "starts_at": at(18, 0),
        "ends_at": at(18, 1),
    }
    assert client.post(url, json=single).status_code == 200
    assert client.post(url, json=single).status_code == 409
    following = {
        **single,
        "expected_revision": 2,
        "scope": "following",
        "occurrence_start": original[2]["occurrence_start"],
        "starts_at": at(13, 2),
        "ends_at": at(13, 3),
    }
    assert client.post(url, json={**following, "occurrence_start": at(20, 0)}).status_code == 404
    assert client.post(url, json=following).status_code == 200
    assert client.get(f"/api/calendar/events/{row['id']}").json()["starts_at"] == row["starts_at"]
    assert (
        client.post(
            f"/api/calendar/events/{row['id']}/update",
            json=payload(title="변경된 제목", expected_revision=3),
        ).status_code
        == 200
    )

    with TestClient(app, headers=ORIGIN) as restarted:
        login(restarted)
        result = listing(restarted).json()["events"]
        assert [event["starts_at"] for event in result] == [at(10, 0), at(13, 2), at(14, 2), at(18, 0)]
        assert [event["instance_key"] for event in result] == [
            original[index]["instance_key"] for index in (0, 2, 3, 1)
        ]
        assert all(event["recurrence"]["count"] == 4 for event in result)
        assert all(event["title"] == "변경된 제목" and "occurrence_changes" not in event for event in result)

    with connect(path) as conn:
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM audit WHERE target_id=? AND action='calendar.occurrence_updated'",
                (row["id"],),
            ).fetchone()[0]
            == 2
        )


def test_scoped_weekly_move_shifts_future_selected_weekdays_across_query_windows(calendar):
    client, _, clock, _ = calendar
    row = client.post(
        "/api/calendar/events",
        json=payload(recurrence={"frequency": "weekly", "weekdays": [1, 3, 5], "count": 5}),
    ).json()
    original = listing(client).json()["events"]
    assert len(original) == 5
    before = datetime.fromisoformat(original[1]["starts_at"])
    after = before + timedelta(days=40)
    move = {
        "expected_revision": 1,
        "scope": "following",
        "occurrence_start": before.isoformat(),
        "starts_at": after.isoformat(),
        "ends_at": (after + timedelta(hours=1)).isoformat(),
    }
    assert client.post(f"/api/calendar/events/{row['id']}/occurrence", json=move).status_code == 200
    assert [event["starts_at"] for event in listing(client).json()["events"]] == [original[0]["starts_at"]]
    result = client.get(
        "/api/calendar/events",
        params={"start": after.isoformat(), "end": (after + timedelta(days=30)).isoformat()},
    ).json()["events"]
    assert [event["starts_at"] for event in result] == [
        (datetime.fromisoformat(event["starts_at"]) + timedelta(days=40)).isoformat()
        for event in original[1:]
    ]


def test_weekday_interval_count_and_window_do_not_reset_occurrence_count(calendar):
    c, _, _, _ = calendar
    row = c.post(
        "/api/calendar/events",
        json=payload(
            starts_at="2026-06-01T09:00:00+09:00",
            ends_at="2026-06-01T10:00:00+09:00",
            recurrence={"frequency": "weekly", "interval": 2, "weekdays": [1, 3], "count": 4},
        ),
    ).json()

    def days(start, end):
        response = c.get(
            "/api/calendar/events",
            params={"start": f"2026-{start}T00:00:00+09:00", "end": f"2026-{end}T00:00:00+09:00"},
        )
        assert response.status_code == 200
        return [
            datetime.fromisoformat(e["starts_at"]).astimezone(timezone(timedelta(hours=9))).strftime("%m-%d")
            for e in response.json()["events"]
            if e["id"] == row["id"]
        ]

    assert days("06-01", "07-01") == ["06-01", "06-03", "06-15", "06-17"]
    assert days("06-16", "07-01") == ["06-17"]
    assert days("07-01", "08-01") == []
    assert c.get(f"/api/calendar/events/{row['id']}").json()["recurrence"]["weekdays"] == [1, 3]


def test_fifth_weekday_monthly_skips_missing_dates_and_counts_actual_occurrences(calendar):
    c, _, _, _ = calendar
    row = c.post(
        "/api/calendar/events",
        json=payload(
            starts_at="2026-06-29T23:30:00+09:00",
            ends_at="2026-06-30T00:30:00+09:00",
            recurrence={"frequency": "monthly", "monthly_mode": "weekday", "count": 2},
        ),
    ).json()
    result = c.get(
        "/api/calendar/events",
        params={"start": "2026-08-01T00:00:00+09:00", "end": "2026-09-02T00:00:00+09:00"},
    ).json()["events"]
    assert len(result) == 1 and result[0]["id"] == row["id"]
    assert result[0]["starts_at"] == "2026-08-31T14:30:00+00:00"
    assert result[0]["ends_at"] == "2026-08-31T15:30:00+00:00"
    assert (
        c.get(
            "/api/calendar/events",
            params={"start": "2026-11-01T00:00:00+09:00", "end": "2026-12-01T00:00:00+09:00"},
        ).json()["events"]
        == []
    )


@pytest.mark.parametrize(
    "rule",
    [
        {"frequency": "weekly", "weekdays": []},
        {"frequency": "weekly", "weekdays": [1, 1]},
        {"frequency": "weekly", "weekdays": [True]},
        {"frequency": "weekly", "weekdays": [7]},
        {"frequency": "daily", "weekdays": [1]},
        {"frequency": "weekly", "monthly_mode": "weekday"},
        {"frequency": "weekly", "count": 0},
        {"frequency": "weekly", "count": True},
        {"frequency": "weekly", "count": 1001},
        {"frequency": "weekly", "count": 4, "until": "2026-12-31"},
    ],
)
def test_custom_repeat_rejects_invalid_rules_without_saving(calendar, rule):
    c, _, _, _ = calendar
    assert c.post("/api/calendar/events", json=payload(recurrence=rule)).status_code == 422
    assert listing(c).json()["events"] == []


@pytest.mark.parametrize(
    "zone,all_day,start,end,days,until,expected",
    [
        (
            "UTC",
            False,
            "2026-06-06T23:30:00Z",
            "2026-06-07T00:30:00Z",
            [6],
            "2026-06-13",
            ["2026-06-06T23:30:00+00:00", "2026-06-13T23:30:00+00:00"],
        ),
        (
            "Asia/Seoul",
            True,
            "2026-06-07T00:00:00+09:00",
            "2026-06-08T00:00:00+09:00",
            [0],
            "2026-06-14",
            ["2026-06-06T15:00:00+00:00", "2026-06-13T15:00:00+00:00"],
        ),
        (
            "Asia/Seoul",
            False,
            "2026-06-06T09:00:00+09:00",
            "2026-06-06T10:00:00+09:00",
            [1, 2, 3, 4, 5],
            "2026-06-10",
            ["2026-06-08T00:00:00+00:00", "2026-06-09T00:00:00+00:00", "2026-06-10T00:00:00+00:00"],
        ),
    ],
)
def test_weekdays_and_inclusive_until_follow_selected_zone(
    calendar, zone, all_day, start, end, days, until, expected
):
    c, _, _, _ = calendar
    created = c.post(
        "/api/calendar/events",
        json=payload(
            starts_at=start,
            ends_at=end,
            time_zone=zone,
            all_day=all_day,
            recurrence={"frequency": "weekly", "weekdays": days, "until": until},
        ),
    )
    assert created.status_code == 201, created.text
    result = c.get(
        "/api/calendar/events", params={"start": "2026-06-01T00:00:00Z", "end": "2026-06-20T00:00:00Z"}
    ).json()["events"]
    assert [row["starts_at"] for row in result] == expected


@pytest.mark.parametrize(
    "start,end,frequency,window_start,window_end,expected",
    [
        (
            "2026-01-31T09:00:00+09:00",
            "2026-01-31T10:00:00+09:00",
            "monthly",
            "2026-04-01T00:00:00Z",
            "2026-06-01T00:00:00Z",
            ["2026-05-31"],
        ),
        (
            "2024-02-29T09:00:00+09:00",
            "2024-02-29T10:00:00+09:00",
            "yearly",
            "2028-02-01T00:00:00Z",
            "2028-03-01T00:00:00Z",
            ["2028-02-29"],
        ),
    ],
)
def test_monthly_and_leap_year_repeats_skip_missing_dates(
    calendar, start, end, frequency, window_start, window_end, expected
):
    c, path, clock, app = calendar
    assert (
        c.post(
            "/api/calendar/events",
            json=payload(starts_at=start, ends_at=end, recurrence={"frequency": frequency, "interval": 1}),
        ).status_code
        == 201
    )
    data = c.get("/api/calendar/events", params={"start": window_start, "end": window_end}).json()["events"]
    assert [
        datetime.fromisoformat(r["starts_at"]).astimezone(timezone(timedelta(hours=9))).date().isoformat()
        for r in data
    ] == expected


def test_busy_event_redacts_private_content_in_detail_list_and_search(calendar):
    c, path, clock, app = calendar
    row = c.post(
        "/api/calendar/events",
        json=payload(
            title="비공개 테스트 제목",
            description="숨겨야할 설명",
            location="숨겨야할 장소",
            visibility="busy",
            participant_ids=["rep"],
            links=[{"title": "비공개 링크", "url": "https://example.com/private"}],
        ),
    ).json()
    login(c, "student-vice")
    detail = c.get(f"/api/calendar/events/{row['id']}").json()
    assert detail["title"] == "바쁨" and detail["is_masked"]
    assert detail["description"] == detail["location"] == ""
    assert detail["links"] == detail["participant_ids"] == detail["attachments"] == []
    assert "details" not in detail
    assert c.get("/api/calendar/search", params={"q": "비공개 테스트"}).json()["events"] == []
    assert listing(c).json()["events"][0]["title"] == "바쁨"
    login(c, "student-rep")
    assert c.get(f"/api/calendar/events/{row['id']}").json()["title"] == "비공개 테스트 제목"
    login(c, "student-head")
    assert c.get(f"/api/calendar/events/{row['id']}").status_code == 404


def test_reminders_are_due_only_for_creator_participants_and_can_be_acknowledged(calendar):
    c, path, clock, app = calendar
    start = clock[0] + timedelta(minutes=30)
    row = c.post(
        "/api/calendar/events",
        json=payload(
            starts_at=start.isoformat(),
            ends_at=(start + timedelta(hours=1)).isoformat(),
            participant_ids=["vice"],
            reminder_minutes=[30, 5],
        ),
    ).json()
    reminders = c.get("/api/calendar/reminders").json()["reminders"]
    assert [r["minutes"] for r in reminders] == [30]
    login(c, "student-vice")
    reminders = c.get("/api/calendar/reminders").json()["reminders"]
    assert len(reminders) == 1
    read = {"occurrence_start": reminders[0]["occurrence_start"], "minutes": 30}
    assert c.post(f"/api/calendar/events/{row['id']}/reminder-read", json=read).status_code == 200
    assert c.get("/api/calendar/reminders").json()["reminders"] == []
    clock[0] += timedelta(minutes=25)
    assert [r["minutes"] for r in c.get("/api/calendar/reminders").json()["reminders"]] == [5]
    login(c, "student-rep")
    assert c.get("/api/calendar/reminders").json()["reminders"] == []
    assert c.post(f"/api/calendar/events/{row['id']}/reminder-read", json=read).status_code == 404


def test_extra_details_survive_basic_time_update_and_invalid_recurrence_rolls_back(calendar):
    c, path, clock, app = calendar
    year = clock[0].year
    row = c.post(
        "/api/calendar/events",
        json=payload(
            recurrence={"frequency": "weekly", "until": f"{year}-06-30"},
            links=[{"title": "회의", "url": "https://example.com"}],
            reminder_minutes=[30],
        ),
    ).json()
    changed = c.post(
        f"/api/calendar/events/{row['id']}/update", json=payload(title="이동", expected_revision=1)
    )
    assert changed.status_code == 200 and changed.json()["recurrence"]["frequency"] == "weekly"
    assert changed.json()["links"][0]["url"] == "https://example.com"
    assert (
        c.post(
            f"/api/calendar/events/{row['id']}/update",
            json=payload(
                starts_at=f"{year}-07-02T09:00:00+09:00",
                ends_at=f"{year}-07-02T10:00:00+09:00",
                expected_revision=2,
            ),
        ).status_code
        == 422
    )
    assert c.get(f"/api/calendar/events/{row['id']}").json()["revision"] == 2


@pytest.mark.parametrize(
    "extra",
    [
        {"links": [{"title": "bad", "url": "javascript:alert(1)"}]},
        {"links": [{"title": "bad", "url": "https://user:secret@example.com"}]},
        {"participant_ids": ["other"]},
        {"reminder_minutes": [-1]},
    ],
)
def test_invalid_links_participants_and_reminders_are_rejected(calendar, extra):
    c, path, clock, app = calendar
    assert c.post("/api/calendar/events", json=payload(**extra)).status_code == 422
    assert listing(c).json()["events"] == []


def test_calendar_linking_does_not_grant_document_access(calendar):
    c, path, clock, app = calendar
    conn = connect(path)
    for ident, target, title in [
        ("calendar-own-doc", "software-1-A", "가상 반 자료"),
        ("calendar-other-doc", "student", "외부 단체 자료"),
    ]:
        org = conn.execute("SELECT org_id FROM units WHERE id=?", (target,)).fetchone()[0]
        conn.execute(
            "INSERT INTO documents (id,org_id,unit_id,title,description,academic_year,category,folder,event,audience,created_by,created_at,updated_at,current_version) VALUES (?,?,?,?,'',?,'','','','unit','teacher',?,?,1)",
            (ident, org, target, title, clock[0].year, clock[0].isoformat(), clock[0].isoformat()),
        )
    conn.close()
    login(c, "student-rep")
    assert (
        c.post(
            "/api/calendar/events",
            json=payload(unit_id="software-1-A", attachment_ids=["calendar-other-doc"]),
        ).status_code
        == 403
    )
    row = c.post(
        "/api/calendar/events", json=payload(unit_id="software-1-A", attachment_ids=["calendar-own-doc"])
    ).json()
    assert row["attachments"][0]["id"] == "calendar-own-doc"
    login(c, "staff-demo")
    assert c.get(f"/api/calendar/events/{row['id']}").json()["attachments"] == []
    assert (
        c.post(
            f"/api/calendar/events/{row['id']}/update",
            json=payload(unit_id="software-1-A", expected_revision=1, attachment_ids=[]),
        ).status_code
        == 200
    )
    login(c, "student-rep")
    assert c.get(f"/api/calendar/events/{row['id']}").json()["attachments"][0]["id"] == "calendar-own-doc"


def test_calendar_details_column_is_added_without_losing_old_events(calendar):
    c, path, clock, app = calendar
    row = c.post("/api/calendar/events", json=payload()).json()
    conn = connect(path)
    conn.execute("ALTER TABLE calendar_events DROP COLUMN details")
    conn.close()
    assert c.get(f"/api/calendar/events/{row['id']}").json()["title"] == row["title"]
    assert c.get(f"/api/calendar/events/{row['id']}").json()["recurrence"] is None


def test_utc_repeat_until_uses_selected_time_zone(calendar):
    c, _, clock, _ = calendar
    year = clock[0].year
    response = c.post(
        "/api/calendar/events",
        json=payload(
            starts_at=f"{year}-06-01T23:30:00Z",
            ends_at=f"{year}-06-02T00:30:00Z",
            time_zone="UTC",
            recurrence={"frequency": "daily", "until": f"{year}-06-01"},
        ),
    )
    assert response.status_code == 201
    assert len(listing(c).json()["events"]) == 1
    response = c.post(
        "/api/calendar/events",
        json=payload(
            starts_at=f"{year}-06-02T00:30:00+09:00",
            ends_at=f"{year}-06-02T01:30:00+09:00",
            recurrence={"frequency": "daily", "until": f"{year}-06-01"},
        ),
    )
    assert response.status_code == 422


def test_readonly_parent_does_not_expose_participant_directory(calendar):
    c, _, _, _ = calendar
    login(c, "student-rep")
    assert c.get("/api/calendar/editor-options", params={"unit_id": "software"}).status_code == 403
    assert c.get("/api/calendar/editor-options", params={"unit_id": "software-1-A"}).status_code == 200


def test_revoked_participants_hidden_on_read_but_historical_link_preserved(calendar):
    c, path, clock, _ = calendar
    row = c.post("/api/calendar/events", json=payload(participant_ids=["rep"])).json()
    with connect(path) as conn:
        conn.execute("UPDATE assignments SET revoked_at=? WHERE user_id='rep'", (clock[0].isoformat(),))
    current = c.get(f"/api/calendar/events/{row['id']}").json()
    assert current["participants"] == current["participant_ids"] == []
    updated = c.post(
        f"/api/calendar/events/{row['id']}/update", json=payload(participant_ids=[], expected_revision=1)
    )
    assert updated.status_code == 200
    with connect(path) as conn:
        import json

        stored = conn.execute("SELECT details FROM calendar_events WHERE id=?", (row["id"],)).fetchone()[0]
        assert json.loads(stored)["participant_ids"] == ["rep"]
