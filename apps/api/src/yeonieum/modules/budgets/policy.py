"""Separate finance capabilities from role titles and ordinary document access."""

from yeonieum.modules.access.policy import active_roles, effective, unit

CAPABILITIES = {"view", "plan", "record", "review", "evidence"}


def live_organization(conn, org_id):
    target = unit(conn, org_id)
    return target["kind"] == "organization" and bool(target["active"])


def org_roles(conn, user, org_id, now):
    return [r for r in active_roles(conn, user, now) if unit(conn, r["unit_id"])["org_id"] == org_id]


def can_view(conn, user, org_id, now):
    return live_organization(conn, org_id) and (
        bool(user["is_admin"]) or has_capability(conn, user, org_id, "view", now)
    )


def has_capability(conn, user, org_id, capability, now):
    if capability not in CAPABILITIES or not live_organization(conn, org_id):
        return False
    if user["is_admin"] and capability == "plan":
        return True
    if not user["is_admin"] and not org_roles(conn, user, org_id, now):
        return False
    grant = conn.execute(
        "SELECT * FROM finance_grants WHERE user_id=? AND org_id=? AND capability=? AND active=1",
        (user["id"], org_id, capability),
    ).fetchone()
    if not grant:
        return False
    if user["is_admin"]:
        return grant["assignment_id"] is None
    assignment = conn.execute(
        "SELECT * FROM assignments WHERE id=? AND user_id=?", (grant["assignment_id"], user["id"])
    ).fetchone()
    return bool(
        assignment
        and effective(conn, assignment, now)
        and unit(conn, assignment["unit_id"])["org_id"] == org_id
    )


def is_head(conn, user, org_id, now):
    return any(r["role"] in {"head", "chair"} for r in org_roles(conn, user, org_id, now))
