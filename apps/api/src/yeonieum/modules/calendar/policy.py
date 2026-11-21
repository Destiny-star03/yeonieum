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


def can_manage(conn, actor, event, now):
    if event["unit_id"] not in scope(conn, actor, now):
        return False
    if actor["is_admin"] or actor["id"] == event["created_by"]:
        return True
    return any(
        r["role"] in {"head", "chair", "department_head"}
        and event["unit_id"] in descendants(conn, r["unit_id"])
        for r in active_roles(conn, actor, now)
    )
