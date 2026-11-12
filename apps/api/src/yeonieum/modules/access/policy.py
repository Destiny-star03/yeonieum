"""Current server-side role checks; academic-year labels never grant permission."""

from datetime import datetime

from fastapi import HTTPException

from yeonieum.modules.access.catalog import definition, label_for


def deny(message="담당 범위 또는 역할 권한이 없습니다."):
    raise HTTPException(403, message)


def unit(conn, unit_id):
    result = conn.execute("SELECT * FROM units WHERE id=?", (unit_id,)).fetchone()
    if not result:
        raise HTTPException(404, "소속 단위를 찾을 수 없습니다.")
    return dict(result)


def descendants(conn, root_id):
    return {
        row["id"]
        for row in conn.execute(
            """WITH RECURSIVE tree(id) AS (
      SELECT id FROM units WHERE id=? UNION ALL
      SELECT u.id FROM units u JOIN tree t ON u.parent_id=t.id) SELECT id FROM tree""",
            (root_id,),
        )
    }


def effective(conn, row, now, seen=None):
    row = dict(row)
    seen = set() if seen is None else seen
    if row["id"] in seen:
        return False
    seen.add(row["id"])
    target = unit(conn, row["unit_id"])
    role_type = definition(conn, target["org_id"], row["role"])
    if (
        not target["active"]
        or not unit(conn, target["org_id"])["active"]
        or not role_type
        or not role_type["active"]
    ):
        return False
    if row["revoked_at"] or not (
        datetime.fromisoformat(row["starts_at"]) <= now < datetime.fromisoformat(row["ends_at"])
    ):
        return False
    if datetime.fromisoformat(row["activated_at"]) > now:
        return False
    owner = conn.execute("SELECT active,email_verified FROM users WHERE id=?", (row["user_id"],)).fetchone()
    if not owner or not owner["active"] or not owner["email_verified"]:
        return False
    if row["role"] == "chair":
        parent = conn.execute("SELECT * FROM assignments WHERE id=?", (row["prerequisite_id"],)).fetchone()
        return bool(
            parent
            and parent["user_id"] == row["user_id"]
            and parent["role"] == "department_head"
            and parent["starts_at"] == row["starts_at"]
            and parent["ends_at"] == row["ends_at"]
            and unit(conn, parent["unit_id"])["org_id"] == unit(conn, row["unit_id"])["org_id"]
            and effective(conn, parent, now, seen)
        )
    return True


def active_roles(conn, actor, now):
    return [
        dict(row)
        for row in conn.execute("SELECT * FROM assignments WHERE user_id=?", (actor["id"],))
        if effective(conn, row, now)
    ]


def scope(conn, actor, now):
    if actor["is_admin"]:
        return {
            r["id"]
            for r in conn.execute(
                "SELECT u.id FROM units u JOIN units o ON o.id=u.org_id WHERE u.active=1 AND o.active=1"
            )
        }
    result = set()
    for row in active_roles(conn, actor, now):
        result.update(descendants(conn, row["unit_id"]))
    return result


def can_grant(conn, actor, target_unit, role, now):
    role_type = definition(conn, target_unit["org_id"], role)
    if (
        not target_unit["active"]
        or not unit(conn, target_unit["org_id"])["active"]
        or not role_type
        or not role_type["active"]
        or target_unit["kind"] != role_type["scope_kind"]
    ):
        return False
    if actor["is_admin"]:
        return True
    for row in active_roles(conn, actor, now):
        owned = unit(conn, row["unit_id"])
        if owned["org_id"] != target_unit["org_id"]:
            continue
        if not role_type["builtin"]:
            if row["role"] in {"head", "chair"}:
                return True
            if row["role"] == "department_head" and target_unit["id"] in descendants(conn, row["unit_id"]):
                return True
        if row["role"] == "chair" and role in {"department_head", "vice_department_head", "class_rep"}:
            return True
        if row["role"] == "head" and role in {
            "manager",
            "deputy",
            "club_head",
            "club_vice",
            "club_treasurer",
        }:
            return True
        if (
            row["role"] == "department_head"
            and role in {"vice_department_head", "class_rep"}
            and target_unit["id"] in descendants(conn, row["unit_id"])
        ):
            return True
    return False


def validate_role_unit(conn, target, role):
    row = definition(conn, target["org_id"], role)
    if not row or not row["active"]:
        raise HTTPException(422, "선택한 단체에서 사용할 수 없는 역할입니다.")
    if target["kind"] != row["scope_kind"]:
        raise HTTPException(422, "직책과 소속 단위 종류가 일치하지 않습니다.")


def can_register(conn, actor, target, now):
    if actor["is_admin"] and target["kind"] == "organization" and target["active"]:
        return True
    return any(
        can_grant(conn, actor, target, row[0], now)
        for row in conn.execute(
            "SELECT code FROM role_definitions WHERE org_id=? AND active=1", (target["org_id"],)
        )
    )


def can_create_child_unit(conn, actor, parent, now):
    if not parent["active"] or not unit(conn, parent["org_id"])["active"]:
        return False
    if parent["kind"] not in {"organization", "department", "year"}:
        return False
    if actor["is_admin"]:
        return True
    if parent["org_id"] != "council" or parent["kind"] not in {"department", "year"}:
        return False
    for row in active_roles(conn, actor, now):
        if row["role"] == "chair" and unit(conn, row["unit_id"])["org_id"] == "council":
            return True
        if row["role"] == "department_head" and parent["id"] in descendants(conn, row["unit_id"]):
            return True
    return False


def role_label_for_unit(conn, target, role):
    label = label_for(conn, target["org_id"], role)
    if role == "class_rep" and target["kind"] == "class" and target["parent_id"]:
        return f"{unit(conn, target['parent_id'])['name']} {target['name']} {label}"
    return label
