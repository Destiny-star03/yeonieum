"""Role vocabulary is configurable; capabilities stay tied to explicit policies."""

SCOPE_LABELS = {
    "organization": "단체 전체",
    "office": "부서",
    "department": "학과",
    "year": "학년",
    "class": "반",
    "club": "동아리",
}
ROLE_LABELS = {
    "head": "최고 책임자",
    "chair": "의장",
    "department_head": "학회장",
    "vice_department_head": "부학회장",
    "class_rep": "반대표",
    "manager": "부장",
    "deputy": "차장",
    "club_head": "동아리 회장",
    "club_vice": "동아리 부회장",
    "club_treasurer": "동아리 총무",
}


def allowed_scope_kinds(org_id):
    if org_id == "council":
        return {"organization", "department", "year", "class"}
    if org_id == "clubs":
        return {"organization", "club"}
    return {"organization", "office"}


def seed_roles(conn, org_id=None):
    orgs = conn.execute(
        "SELECT id FROM units WHERE kind='organization'" + (" AND id=?" if org_id else ""),
        (org_id,) if org_id else (),
    ).fetchall()
    for org in orgs:
        ident = org["id"]
        defaults = [
            (
                "head",
                {"student": "학생회장", "press": "국장", "clubs": "연합회장"}.get(ident, "최고 책임자"),
                "organization",
            )
        ]
        if ident == "council":
            defaults = [
                ("chair", "의장", "organization"),
                ("department_head", "학회장", "department"),
                ("vice_department_head", "부학회장", "department"),
                ("class_rep", "반대표", "class"),
            ]
        elif ident in {"student", "press"}:
            defaults += [("manager", "부장", "office"), ("deputy", "차장", "office")]
        elif ident == "clubs":
            defaults += [
                ("club_head", "동아리 회장", "club"),
                ("club_vice", "동아리 부회장", "club"),
                ("club_treasurer", "동아리 총무", "club"),
            ]
        for code, label, kind in defaults:
            conn.execute(
                "INSERT OR IGNORE INTO role_definitions (id,org_id,code,label,scope_kind,builtin) VALUES (?,?,?,?,?,1)",
                (f"{ident}:{code}", ident, code, label, kind),
            )


def definition(conn, org_id, code):
    row = conn.execute("SELECT * FROM role_definitions WHERE org_id=? AND code=?", (org_id, code)).fetchone()
    return dict(row) if row else None


def label_for(conn, org_id, code):
    row = definition(conn, org_id, code)
    return row["label"] if row else ROLE_LABELS.get(code, code)
