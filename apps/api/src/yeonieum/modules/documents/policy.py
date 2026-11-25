"""Temporary general-material policy; no receipt/personal-data privileges are implied."""

from fastapi import HTTPException

from yeonieum.modules.access.audiences import can_access_sharing_group, sharing_groups
from yeonieum.modules.access.policy import active_roles, descendants, unit


def live_unit(conn, target):
    return bool(target["active"] and unit(conn, target["org_id"])["active"])


def document_scope(conn, user, now):
    if user["is_admin"]:
        roots = [
            r[0]
            for r in conn.execute(
                "SELECT unit_id FROM document_staff_scopes WHERE user_id=? AND active=1", (user["id"],)
            )
        ]
    else:
        roots = [r["unit_id"] for r in active_roles(conn, user, now)]
    allowed = set()
    for root in roots:
        allowed.update(descendants(conn, root))
    return {ident for ident in allowed if live_unit(conn, unit(conn, ident))}


def can_create(conn, user, target, now):
    return live_unit(conn, target) and target["id"] in document_scope(conn, user, now)


def private_scope(conn, user):
    return {
        row["id"]
        for row in conn.execute(
            """SELECT u.id FROM memberships m JOIN units u ON u.id=m.unit_id
               JOIN units org ON org.id=u.org_id WHERE m.user_id=? AND u.active=1 AND org.active=1""",
            (user["id"],),
        )
    }


def private_folder_access(conn, user, org_id, now):
    return organization_access(conn, user, org_id, now) or any(
        unit(conn, ident)["org_id"] == org_id for ident in private_scope(conn, user)
    )


def organization_access(conn, user, org_id, now):
    target = unit(conn, org_id)
    if target["kind"] != "organization" or not live_unit(conn, target):
        return False
    if user["is_admin"]:
        return org_id in document_scope(conn, user, now)
    return any(unit(conn, role["unit_id"])["org_id"] == org_id for role in active_roles(conn, user, now))


def manager(conn, user, row, now):
    if user["is_admin"]:
        return row["unit_id"] in document_scope(conn, user, now)
    return any(
        role["role"] in {"head", "chair", "department_head"}
        and row["unit_id"] in descendants(conn, role["unit_id"])
        for role in active_roles(conn, user, now)
    )


def can_manage(conn, user, row, now):
    if not live_unit(conn, unit(conn, row["unit_id"])):
        return False
    if row["audience"] == "private":
        return row["created_by"] == user["id"] and (
            organization_access(conn, user, row["org_id"], now) or row["unit_id"] in private_scope(conn, user)
        )
    return manager(conn, user, row, now) or (
        row["created_by"] == user["id"] and row["unit_id"] in document_scope(conn, user, now)
    )


def can_move(conn, user, row, now):
    return (
        not row["deleted_at"]
        and row["audience"] in {"organization", "private"}
        and (row["audience"] != "private" or row["created_by"] == user["id"])
        and live_unit(conn, unit(conn, row["unit_id"]))
        and manager(conn, user, row, now)
    )


def can_read(conn, user, row, now):
    if not live_unit(conn, unit(conn, row["unit_id"])):
        return False
    if row["audience"] == "private":
        return can_manage(conn, user, row, now)
    if row["audience"] == "organization":
        return organization_access(conn, user, row["org_id"], now)
    if can_manage(conn, user, row, now):
        return True
    if row["audience"] == "unit":
        return row["unit_id"] in document_scope(conn, user, now)
    if user["is_admin"]:
        return False
    return can_access_sharing_group(conn, user, row["audience"], now)


def audiences(conn, user, target, now):
    result = [
        {"key": "private", "label": "개인 보관 · 나만 보기"},
        {"key": "organization", "label": "단체 공유 · 단체 담당자"},
        {"key": "unit", "label": "해당 담당 범위"},
    ]
    if target["org_id"] == "council":
        for group in sharing_groups(conn, user, now):
            if group["key"] == "council-officers" or target["id"] in descendants(conn, group["unit_id"]):
                result.append({"key": group["key"], "label": group["label"]})
    return result


def validate_audience(conn, user, target, key, now):
    if key == "private" and target["id"] in private_scope(conn, user):
        return
    if not can_create(conn, user, target, now):
        raise HTTPException(403, "현재 담당 범위나 본인 소속의 개인 보관함에 자료를 등록할 수 있습니다.")
    if key not in {row["key"] for row in audiences(conn, user, target, now)}:
        raise HTTPException(403, "이 자료에 지정할 수 없는 공유 대상입니다.")


def creation_options(conn, user, now):
    def label(target):
        return (
            f"{label(unit(conn, target['parent_id']))} / {target['name']}"
            if target["parent_id"]
            else target["name"]
        )

    shared = document_scope(conn, user, now)
    personal = private_scope(conn, user)
    return [
        {
            "id": row["id"],
            "org_id": row["org_id"],
            "label": label(row),
            "audiences": audiences(conn, user, row, now)
            if row["id"] in shared
            else [{"key": "private", "label": "개인 보관 · 나만 보기"}],
        }
        for row in conn.execute("SELECT * FROM units ORDER BY name,id")
        if row["id"] in shared or row["id"] in personal
    ]
