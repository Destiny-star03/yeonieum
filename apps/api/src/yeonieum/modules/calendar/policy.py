import json

from yeonieum.modules.access.policy import active_roles, descendants, scope, unit


def visible_units(conn, actor, now):
    allowed = scope(conn, actor, now)
    result = set(allowed)
    # Parent-level schedules are announcements for current descendants.
    # This does not grant any document, accounting or role-management permission.
    for ident in allowed:
        parent = unit(conn, ident)["parent_id"]
        while parent:
            target = unit(conn, parent)
            if target["active"]:
                result.add(parent)
            parent = target["parent_id"]
    return result


def event_unit_ids(event):
    return (event["unit_id"], *json.loads(event["details"] or "{}").get("additional_unit_ids", []))


def can_manage(conn, actor, event, now):
    targets = set(event_unit_ids(event))
    if not targets <= scope(conn, actor, now):
        return False
    if actor["is_admin"] or actor["id"] == event["created_by"]:
        return True
    managed = set()
    for role in active_roles(conn, actor, now):
        if role["role"] in {"head", "chair", "department_head"}:
            managed.update(descendants(conn, role["unit_id"]))
    return targets <= managed
