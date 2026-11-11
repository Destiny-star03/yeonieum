"""Current server-side role checks; academic-year labels never grant permission."""

from datetime import datetime

from fastapi import HTTPException

ROLE_LABELS = {
    "head": "최고 책임자",
    "chair": "의장",
    "department_head": "학회장",
    "vice_department_head": "부학회장",
    "class_rep": "반대표",
    "manager": "부장",
    "deputy": "차장",
    "club_head": "일반동아리장",
}


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
    if row["revoked_at"] or not (
        datetime.fromisoformat(row["starts_at"]) <= now < datetime.fromisoformat(row["ends_at"])
    ):
        return False
    if datetime.fromisoformat(row["activated_at"]) > now:
        return False
    owner = conn.execute("SELECT active FROM users WHERE id=?", (row["user_id"],)).fetchone()
    if not owner or not owner["active"]:
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
        return {r["id"] for r in conn.execute("SELECT id FROM units")}
    result = set()
    for row in active_roles(conn, actor, now):
        result.update(descendants(conn, row["unit_id"]))
    return result


def can_grant(conn, actor, target_unit, role, now):
    if actor["is_admin"]:
        return role in {"head", "chair", "department_head"}
    for row in active_roles(conn, actor, now):
        owned = unit(conn, row["unit_id"])
        if owned["org_id"] != target_unit["org_id"]:
            continue
        if row["role"] == "chair" and role in {"department_head", "vice_department_head", "class_rep"}:
            return True
        if row["role"] == "head" and role in {"manager", "deputy", "club_head"}:
            return True
        if row["role"] == "department_head" and role in {"vice_department_head", "class_rep"}:
            if target_unit["id"] in descendants(conn, row["unit_id"]):
                return True
    return False


def validate_role_unit(target, role):
    expected = {
        "head": "organization",
        "chair": "organization",
        "department_head": "department",
        "vice_department_head": "department",
        "class_rep": "class",
        "manager": "office",
        "deputy": "office",
        "club_head": "club",
    }
    if target["kind"] != expected[role]:
        raise HTTPException(422, "직책과 소속 단위 종류가 일치하지 않습니다.")
    if (
        role in {"chair", "department_head", "vice_department_head", "class_rep"}
        and target["org_id"] != "council"
    ):
        raise HTTPException(422, "학과협의회에만 적용되는 역할입니다.")
    if role == "head" and target["org_id"] == "council":
        raise HTTPException(422, "학과협의회 최고 책임자는 의장입니다.")
    if role == "club_head" and target["org_id"] != "clubs":
        raise HTTPException(422, "연합동아리 역할입니다.")
    if role in {"manager", "deputy"} and target["org_id"] not in {"student", "press"}:
        raise HTTPException(422, "총학생회·신문방송국 부서 역할입니다.")
