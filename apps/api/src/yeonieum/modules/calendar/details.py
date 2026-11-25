import json

from fastapi import HTTPException
from pydantic import ValidationError

from yeonieum.modules.access.policy import scope
from yeonieum.modules.calendar.policy import event_unit_ids, visible_units
from yeonieum.modules.calendar.schemas import EventInput
from yeonieum.modules.documents.policy import can_read as can_read_document

DEFAULTS = {
    "time_zone": "Asia/Seoul",
    "recurrence": None,
    "participant_ids": [],
    "links": [],
    "attachment_ids": [],
    "reminder_minutes": [],
    "availability": "busy",
    "visibility": "details",
    "color": "default",
}


def stored_details(row):
    return {**DEFAULTS, **json.loads(row["details"] or "{}")}


def document_options(conn, user, now):
    return [
        {"id": r["id"], "title": r["title"], "version": r["current_version"]}
        for r in conn.execute(
            "SELECT * FROM documents WHERE deleted_at IS NULL AND current_version>0 ORDER BY title"
        )
        if can_read_document(conn, user, r, now)
    ]


def participant_options(conn, user, target_ids, now):
    targets = set(target_ids)
    if not targets <= scope(conn, user, now):
        raise HTTPException(403, "현재 일정 등록 범위의 참여자만 선택할 수 있습니다.")
    return [
        {"id": r["id"], "name": r["name"]}
        for r in conn.execute("SELECT * FROM users WHERE active=1 AND email_verified=1 ORDER BY name")
        if not targets.isdisjoint(visible_units(conn, dict(r), now))
    ]


def validate_details(conn, user, data, target_ids, now, old=None):
    result = stored_details(old) if old else {**DEFAULTS}
    dumped = data.model_dump(mode="json")
    for key in DEFAULTS:
        if key in data.model_fields_set:
            result[key] = dumped[key]
    # Validate newly selected recipients/attachments; unchanged historical entries
    # remain recorded but are re-authorized and filtered on every read.
    if "participant_ids" in data.model_fields_set:
        permitted = {r["id"] for r in participant_options(conn, user, target_ids, now)}
        historical = set(stored_details(old)["participant_ids"]) if old else set()
        if not (set(result["participant_ids"]) - historical) <= permitted:
            raise HTTPException(422, "일정을 볼 수 있는 현재 담당자만 참여자로 선택해 주세요.")
        result["participant_ids"] = list(
            dict.fromkeys([*result["participant_ids"], *sorted(historical - permitted)])
        )
    if "attachment_ids" in data.model_fields_set:
        permitted = {r["id"] for r in document_options(conn, user, now)}
        historical = set(stored_details(old)["attachment_ids"]) if old else set()
        if not (set(result["attachment_ids"]) - historical) <= permitted:
            raise HTTPException(403, "첨부 자료의 현재 열람 권한을 확인해 주세요.")
        result["attachment_ids"] = list(
            dict.fromkeys([*result["attachment_ids"], *sorted(historical - permitted)])
        )
    result["reminder_minutes"] = sorted(set(result["reminder_minutes"]))
    try:
        EventInput.model_validate(
            {
                **{key: value for key, value in dumped.items() if key in EventInput.model_fields},
                **{key: result[key] for key in DEFAULTS},
            }
        )
    except ValidationError as error:
        raise HTTPException(422, "반복 종료일·시간대·기간 설정을 확인해 주세요.") from error
    return result


def public_details(conn, user, row, visible_targets, editable, now):
    details = stored_details(row)
    targets = set(event_unit_ids(row)) if editable else visible_targets
    participants = [
        {"id": person["id"], "name": person["name"]}
        for ident in details["participant_ids"]
        for person in conn.execute(
            "SELECT * FROM users WHERE id=? AND active=1 AND email_verified=1", (ident,)
        )
        if not targets.isdisjoint(visible_units(conn, dict(person), now))
    ]
    current_participant_ids = [person["id"] for person in participants]
    masked = details["visibility"] == "busy" and not (
        row["created_by"] == user["id"] or user["id"] in current_participant_ids or editable
    )
    if masked:
        return {
            **DEFAULTS,
            "visibility": "busy",
            "availability": details["availability"],
            "color": details["color"],
            "recurrence": details["recurrence"],
            "participants": [],
            "attachments": [],
            "is_masked": True,
        }
    attachments = []
    for ident in details["attachment_ids"]:
        doc = conn.execute(
            "SELECT * FROM documents WHERE id=? AND deleted_at IS NULL AND current_version>0", (ident,)
        ).fetchone()
        if doc and can_read_document(conn, user, doc, now):
            attachments.append({"id": ident, "title": doc["title"], "version": doc["current_version"]})
    return {
        **{key: details[key] for key in DEFAULTS},
        "participant_ids": current_participant_ids,
        "attachment_ids": [d["id"] for d in attachments],
        "participants": participants,
        "attachments": attachments,
        "is_masked": False,
    }
