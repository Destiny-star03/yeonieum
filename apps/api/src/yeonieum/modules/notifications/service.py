"""Deliver pointers to shared records. Titles and scopes are resolved at read time."""

from uuid import uuid4

from yeonieum.modules.access.policy import active_roles, unit
from yeonieum.modules.calendar.details import public_details
from yeonieum.modules.calendar.policy import can_manage, event_unit_ids, visible_units
from yeonieum.modules.documents.policy import can_read


def _candidates(conn, org_ids, actor_id, *, include_staff=False):
    placeholders = ",".join("?" for _ in org_ids)
    staff = f"""OR EXISTS (SELECT 1 FROM document_staff_scopes s JOIN units u ON u.id=s.unit_id
                           WHERE s.user_id=p.id AND s.active=1 AND u.org_id IN ({placeholders}))"""
    return conn.execute(
        f"""SELECT p.* FROM users p WHERE p.id<>? AND p.active=1 AND p.email_verified=1 AND (
             EXISTS (SELECT 1 FROM assignments a JOIN units u ON u.id=a.unit_id
                     WHERE a.user_id=p.id AND a.revoked_at IS NULL AND u.org_id IN ({placeholders}))
             {staff if include_staff else ""})""",
        (actor_id, *org_ids, *(org_ids if include_staff else ())),
    ).fetchall()


def _insert(conn, user_id, kind, target_id, source_key, created_at):
    conn.execute(
        """INSERT INTO notifications(id,user_id,kind,target_id,source_key,created_at) VALUES (?,?,?,?,?,?)
           ON CONFLICT(user_id,kind,target_id,source_key) DO NOTHING""",
        (str(uuid4()), user_id, kind, target_id, source_key, created_at.isoformat()),
    )


def notify_document(conn, actor_id, target_id, source_key, now, previous=None):
    row = conn.execute("SELECT * FROM documents WHERE id=?", (target_id,)).fetchone()
    if row["audience"] == "private":
        return
    for user in _candidates(conn, (row["org_id"],), actor_id, include_staff=True):
        if can_read(conn, user, row, now) and (previous is None or not can_read(conn, user, previous, now)):
            _insert(conn, user["id"], "document", target_id, source_key, now)


def _visible_targets(conn, row, organizations, visible):
    return [
        target
        for target in event_unit_ids(row)
        if target in visible and unit(conn, target)["org_id"] in organizations
    ]


def role_organizations(conn, user, now):
    return {unit(conn, role["unit_id"])["org_id"] for role in active_roles(conn, user, now)}


def notify_calendar(conn, actor_id, row, source_key, now, participants=None):
    org_ids = sorted({unit(conn, target)["org_id"] for target in event_unit_ids(row)})
    for user in _candidates(conn, org_ids, actor_id):
        if participants is not None and user["id"] not in participants:
            continue
        if _visible_targets(conn, row, role_organizations(conn, user, now), visible_units(conn, user, now)):
            _insert(conn, user["id"], "calendar", row["id"], source_key, now)


def notification_view(conn, user, notice, now, *, organizations=None, visible=None):
    if notice["kind"] == "document":
        row = conn.execute(
            "SELECT * FROM documents WHERE id=? AND deleted_at IS NULL AND audience<>'private'",
            (notice["target_id"],),
        ).fetchone()
        if not row or not can_read(conn, user, row, now):
            return None
        title = row["title"]
        org_id = row["org_id"]
        target = {"id": row["id"]}
    else:
        row = conn.execute(
            "SELECT * FROM calendar_events WHERE id=? AND deleted_at IS NULL", (notice["target_id"],)
        ).fetchone()
        if not row:
            return None
        if organizations is None:
            organizations = role_organizations(conn, user, now)
        if visible is None:
            visible = visible_units(conn, user, now)
        targets = _visible_targets(conn, row, organizations, visible)
        if not targets:
            return None
        details = public_details(
            conn, user, row, set(event_unit_ids(row)) & visible, can_manage(conn, user, row, now), now
        )
        title = "바쁨" if details["is_masked"] else row["title"]
        org_id = unit(conn, targets[0])["org_id"]
        target = {"id": row["id"]}
    return {
        "id": notice["id"],
        "kind": notice["kind"],
        "title": title,
        "org_name": unit(conn, org_id)["name"],
        "created_at": notice["created_at"],
        "read": notice["read_at"] is not None,
        "target": target,
    }
