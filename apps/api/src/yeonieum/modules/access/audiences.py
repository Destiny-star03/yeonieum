"""Academic sharing audiences are separate from administrative scope."""

from yeonieum.modules.access.policy import active_roles, effective, role_label_for_unit, unit


def academic_department(conn, unit_id):
    current = unit(conn, unit_id)
    seen = set()
    while current["org_id"] == "council" and current["id"] not in seen:
        if current["kind"] == "department":
            return current["id"]
        seen.add(current["id"])
        if not current["parent_id"]:
            break
        current = unit(conn, current["parent_id"])
    return None


def sharing_group_keys(conn, actor, now):
    council = conn.execute("SELECT active FROM units WHERE id='council'").fetchone()
    if not council or not council[0]:
        return set()
    departments = {
        r[0]
        for r in conn.execute(
            "SELECT id FROM units WHERE org_id='council' AND kind='department' AND active=1"
        )
    }
    roles = active_roles(conn, actor, now)
    chair = any(r["role"] == "chair" and r["unit_id"] == "council" for r in roles)
    if actor["is_admin"] or chair:
        return {"council-officers"} | {f"department:{ident}" for ident in departments}
    result = set()
    for role in roles:
        if role["role"] not in {"department_head", "vice_department_head", "class_rep"}:
            continue
        dept = academic_department(conn, role["unit_id"])
        if dept not in departments:
            continue
        result.add(f"department:{dept}")
        if role["role"] in {"department_head", "vice_department_head"}:
            result.add("council-officers")
    return result


def can_access_sharing_group(conn, actor, key, now):
    # The future document service must call this policy as well as its own
    # document state/sensitivity checks. A UI badge is not authorization.
    return key in sharing_group_keys(conn, actor, now)


def sharing_groups(conn, actor, now):
    keys = sharing_group_keys(conn, actor, now)
    if not keys:
        return []
    appointments = [
        dict(r)
        for r in conn.execute(
            "SELECT a.* FROM assignments a JOIN units u ON u.id=a.unit_id WHERE u.org_id='council' AND a.role IN ('department_head','vice_department_head','class_rep')"
        )
        if effective(conn, r, now)
    ]
    chairs = {
        r["user_id"]
        for r in conn.execute("SELECT * FROM assignments WHERE role='chair'")
        if effective(conn, r, now)
    }
    result = []
    for key in sorted(keys):
        council = key == "council-officers"
        dept = None if council else key.split(":", 1)[1]
        members = {}
        for row in appointments:
            row_dept = academic_department(conn, row["unit_id"])
            if (council and row["role"] == "class_rep") or (not council and row_dept != dept):
                continue
            person = conn.execute("SELECT name FROM users WHERE id=?", (row["user_id"],)).fetchone()
            member = members.setdefault(
                row["user_id"],
                {
                    "user_id": row["user_id"],
                    "name": person[0],
                    "roles": set(),
                    "department_names": set(),
                    "is_chair": row["user_id"] in chairs,
                },
            )
            member["roles"].add(role_label_for_unit(conn, unit(conn, row["unit_id"]), row["role"]))
            member["department_names"].add(unit(conn, row_dept)["name"])
        serialized = [
            {**m, "roles": sorted(m["roles"]), "department_names": sorted(m["department_names"])}
            for m in members.values()
        ]
        result.append(
            {
                "key": key,
                "kind": "council_officers" if council else "department",
                "label": "학과협의회 간부진" if council else f"{unit(conn, dept)['name']} 담당자",
                "unit_id": "council" if council else dept,
                "members": serialized,
            }
        )
    return result
