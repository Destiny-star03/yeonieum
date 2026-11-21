import json
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import Depends, HTTPException

from yeonieum.core.database import audit, stamp, transaction
from yeonieum.modules.access.policy import scope, unit
from yeonieum.modules.calendar.details import (
    document_options,
    participant_options,
    public_details,
    stored_details,
    validate_details,
)
from yeonieum.modules.calendar.policy import can_manage, visible_units
from yeonieum.modules.calendar.recurrence import occurrences
from yeonieum.modules.calendar.schemas import EventInput, EventRemove, EventUpdate, ReminderRead


def install_calendar_routes(app, db, actor, now):
    def path(conn, ident):
        target = unit(conn, ident)
        return (
            f"{path(conn, target['parent_id'])} / {target['name']}" if target["parent_id"] else target["name"]
        )

    def serialized(conn, user, row):
        target = unit(conn, row["unit_id"])
        creator = conn.execute("SELECT name FROM users WHERE id=?", (row["created_by"],)).fetchone()
        data = dict(row)
        data.pop("details", None)
        extra = public_details(conn, user, row, now())
        if extra["is_masked"]:
            data.update(title="바쁨", description="", location="", creator_name="비공개 일정")
        return {
            **data,
            **extra,
            "instance_key": row.get("instance_key", row["id"] + "@" + row["starts_at"])
            if isinstance(row, dict)
            else row["id"] + "@" + row["starts_at"],
            "all_day": bool(row["all_day"]),
            "unit_name": path(conn, row["unit_id"]),
            "org_id": target["org_id"],
            "org_name": unit(conn, target["org_id"])["name"],
            "creator_name": "비공개 일정" if extra["is_masked"] else creator["name"],
            "can_edit": can_manage(conn, user, row, now()),
        }

    def event(conn, user, ident):
        row = conn.execute(
            "SELECT * FROM calendar_events WHERE id=? AND deleted_at IS NULL", (ident,)
        ).fetchone()
        if not row or row["unit_id"] not in visible_units(conn, user, now()):
            raise HTTPException(404, "일정을 찾을 수 없습니다.")
        return row

    def check_revision(row, expected):
        if row["revision"] != expected:
            raise HTTPException(409, "다른 담당자가 일정을 변경했습니다. 일정을 다시 열고 확인해 주세요.")

    @app.get("/api/calendar/options")
    def options(user=Depends(actor), conn=Depends(db)):
        visible = visible_units(conn, user, now())
        editable = scope(conn, user, now())
        return {
            "units": [
                {
                    "id": r["id"],
                    "name": path(conn, r["id"]),
                    "org_id": r["org_id"],
                    "org_name": unit(conn, r["org_id"])["name"],
                    "can_create": r["id"] in editable,
                }
                for r in conn.execute("SELECT * FROM units WHERE active=1 ORDER BY org_id,kind,name")
                if r["id"] in visible
            ]
        }

    @app.get("/api/calendar/events")
    def events(start: datetime, end: datetime, user=Depends(actor), conn=Depends(db)):
        if start.tzinfo is None or end.tzinfo is None or not timedelta(0) < end - start <= timedelta(days=93):
            raise HTTPException(422, "시간대를 포함해 최대 93일의 조회 기간을 지정해 주세요.")
        visible = visible_units(conn, user, now())
        result = []
        for row in conn.execute(
            "SELECT * FROM calendar_events WHERE deleted_at IS NULL ORDER BY starts_at,id"
        ):
            if row["unit_id"] not in visible:
                continue
            for occurrence in occurrences(row, stored_details(row), start, end):
                result.append(serialized(conn, user, occurrence))
                if len(result) > 5000:
                    raise HTTPException(422, "일정이 너무 많습니다. 조회 기간을 좁혀 주세요.")
        return {"events": sorted(result, key=lambda r: (r["starts_at"], r["ends_at"], r["id"]))}

    @app.get("/api/calendar/search")
    def search(q: str, user=Depends(actor), conn=Depends(db)):
        query = q.strip().casefold()
        if not 1 <= len(query) <= 150:
            raise HTTPException(422, "검색어는 1~150자로 입력해 주세요.")
        visible = visible_units(conn, user, now())
        result = []
        for row in conn.execute(
            "SELECT * FROM calendar_events WHERE deleted_at IS NULL ORDER BY starts_at DESC,id"
        ):
            if row["unit_id"] not in visible:
                continue
            public = serialized(conn, user, row)
            if query in " ".join([public["title"], public["location"], public["description"]]).casefold():
                result.append(public)
                if len(result) > 50:
                    return {"events": result[:50], "has_more": True}
        return {"events": result, "has_more": False}

    @app.get("/api/calendar/editor-options")
    def editor_options(unit_id: str, user=Depends(actor), conn=Depends(db)):
        return {
            "participants": participant_options(conn, user, unit_id, now()),
            "documents": document_options(conn, user, now()),
        }

    def due_reminders(conn, user):
        result = []
        visible = visible_units(conn, user, now())
        for row in conn.execute("SELECT * FROM calendar_events WHERE deleted_at IS NULL"):
            extra = stored_details(row)
            if row["unit_id"] not in visible or user["id"] not in [
                row["created_by"],
                *extra["participant_ids"],
            ]:
                continue
            for occurrence in occurrences(row, extra, now() - timedelta(days=1), now() + timedelta(days=8)):
                begin = datetime.fromisoformat(occurrence["starts_at"])
                finish = datetime.fromisoformat(occurrence["ends_at"])
                for minutes in extra["reminder_minutes"]:
                    if (
                        begin - timedelta(minutes=minutes) <= now() < finish
                        and not conn.execute(
                            "SELECT 1 FROM calendar_reminder_reads WHERE event_id=? AND user_id=? AND occurrence_start=? AND minutes=?",
                            (row["id"], user["id"], occurrence["starts_at"], minutes),
                        ).fetchone()
                    ):
                        result.append(
                            {
                                "event": serialized(conn, user, occurrence),
                                "minutes": minutes,
                                "occurrence_start": occurrence["starts_at"],
                            }
                        )
        return result[:100]

    @app.get("/api/calendar/reminders")
    def reminders(user=Depends(actor), conn=Depends(db)):
        return {"reminders": due_reminders(conn, user)}

    @app.post("/api/calendar/events/{ident}/reminder-read")
    def reminder_read(ident: str, data: ReminderRead, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            event(conn, user, ident)
            key = stamp(data.occurrence_start)
            if not any(
                r["event"]["id"] == ident and r["occurrence_start"] == key and r["minutes"] == data.minutes
                for r in due_reminders(conn, user)
            ):
                raise HTTPException(404, "확인할 리마인더가 없습니다.")
            conn.execute(
                "INSERT OR IGNORE INTO calendar_reminder_reads VALUES (?,?,?,?,?)",
                (ident, user["id"], key, data.minutes, stamp(now())),
            )
        return {"ok": True}

    @app.get("/api/calendar/events/{ident}")
    def detail(ident: str, user=Depends(actor), conn=Depends(db)):
        return serialized(conn, user, event(conn, user, ident))

    @app.post("/api/calendar/events", status_code=201)
    def create(data: EventInput, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            if data.unit_id not in scope(conn, user, now()):
                raise HTTPException(403, "현재 담당 범위에만 일정을 등록할 수 있습니다.")
            ident = str(uuid4())
            at = stamp(now())
            conn.execute(
                "INSERT INTO calendar_events (id,unit_id,title,description,location,starts_at,ends_at,all_day,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    ident,
                    data.unit_id,
                    data.title,
                    data.description.strip(),
                    data.location.strip(),
                    stamp(data.starts_at),
                    stamp(data.ends_at),
                    int(data.all_day),
                    user["id"],
                    at,
                    at,
                ),
            )
            details = validate_details(conn, user, data, now())
            conn.execute(
                "UPDATE calendar_events SET details=? WHERE id=?",
                (json.dumps(details, ensure_ascii=False), ident),
            )
            audit(
                conn,
                user,
                unit(conn, data.unit_id)["org_id"],
                "calendar.created",
                ident,
                {"unit_id": data.unit_id, "starts_at": stamp(data.starts_at), "ends_at": stamp(data.ends_at)},
            )
            return serialized(conn, user, event(conn, user, ident))

    @app.post("/api/calendar/events/{ident}/update")
    def update(ident: str, data: EventUpdate, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = event(conn, user, ident)
            if not can_manage(conn, user, row, now()):
                raise HTTPException(403, "이 일정을 수정할 권한이 없습니다.")
            check_revision(row, data.expected_revision)
            if data.unit_id != row["unit_id"]:
                raise HTTPException(422, "기존 일정의 캘린더 범위는 변경할 수 없습니다.")
            conn.execute(
                "UPDATE calendar_events SET title=?,description=?,location=?,starts_at=?,ends_at=?,all_day=?,updated_at=?,revision=revision+1 WHERE id=?",
                (
                    data.title,
                    data.description.strip(),
                    data.location.strip(),
                    stamp(data.starts_at),
                    stamp(data.ends_at),
                    int(data.all_day),
                    stamp(now()),
                    ident,
                ),
            )
            details = validate_details(conn, user, data, now(), row)
            conn.execute(
                "UPDATE calendar_events SET details=? WHERE id=?",
                (json.dumps(details, ensure_ascii=False), ident),
            )
            audit(
                conn,
                user,
                unit(conn, row["unit_id"])["org_id"],
                "calendar.updated",
                ident,
                {"before_revision": row["revision"], "after_revision": row["revision"] + 1},
            )
            return serialized(conn, user, event(conn, user, ident))

    @app.post("/api/calendar/events/{ident}/remove")
    def remove(ident: str, data: EventRemove, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            row = event(conn, user, ident)
            if not can_manage(conn, user, row, now()):
                raise HTTPException(403, "이 일정을 삭제할 권한이 없습니다.")
            check_revision(row, data.expected_revision)
            conn.execute(
                "UPDATE calendar_events SET deleted_at=?,deleted_by=?,updated_at=?,revision=revision+1 WHERE id=?",
                (stamp(now()), user["id"], stamp(now()), ident),
            )
            audit(
                conn,
                user,
                unit(conn, row["unit_id"])["org_id"],
                "calendar.removed",
                ident,
                {"unit_id": row["unit_id"], "revision": row["revision"]},
            )
        return {"ok": True}
