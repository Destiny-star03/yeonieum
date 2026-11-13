"""Entirely synthetic fixtures. No real student or staff identity."""

from datetime import datetime, timezone

from pwdlib import PasswordHash

from yeonieum.core.database import stamp, transaction
from yeonieum.modules.access.catalog import seed_roles

DEMO_PASSWORD = "Yeonieum-demo-2026!"


def seed(conn):
    conn.execute(
        "INSERT OR IGNORE INTO units (id,org_id,parent_id,kind,name) VALUES ('monitoring','monitoring',NULL,'organization','모니터링단')"
    )
    if conn.execute("SELECT count(*) FROM users").fetchone()[0]:
        seed_roles(conn)
        return
    hashed = PasswordHash.recommended().hash(DEMO_PASSWORD)
    year = datetime.now(timezone.utc).year
    start = stamp(datetime(year, 1, 1, tzinfo=timezone.utc))
    stop = stamp(datetime(year + 1, 1, 1, tzinfo=timezone.utc))
    with transaction(conn):
        for ident, name in [
            ("council", "학과협의회"),
            ("student", "총학생회"),
            ("press", "신문방송국"),
            ("clubs", "연합동아리"),
        ]:
            conn.execute(
                "INSERT INTO units (id,org_id,parent_id,kind,name) VALUES (?,?,?,?,?)",
                (ident, ident, None, "organization", name),
            )
        for dept, name in [("software", "스마트소프트웨어학과"), ("mechanical", "기계공학과")]:
            conn.execute(
                "INSERT INTO units (id,org_id,parent_id,kind,name) VALUES (?,?,?,?,?)",
                (dept, "council", "council", "department", name),
            )
            for level in ["1", "2"]:
                group = f"{dept}-{level}"
                conn.execute(
                    "INSERT INTO units (id,org_id,parent_id,kind,name) VALUES (?,?,?,?,?)",
                    (group, "council", dept, "year", f"{level}학년"),
                )
                for section in ["A", "B"]:
                    conn.execute(
                        "INSERT INTO units (id,org_id,parent_id,kind,name) VALUES (?,?,?,?,?)",
                        (f"{group}-{section}", "council", group, "class", f"{section}반"),
                    )
        conn.execute(
            "INSERT INTO units (id,org_id,parent_id,kind,name) VALUES (?,?,?,?,?)",
            ("student-office", "student", "student", "office", "기획부"),
        )
        people = [
            ("teacher", "담당 선생님", "staff-demo", 1, None),
            ("chair", "가상 의장", "student-chair", 0, "software"),
            ("head", "가상 학회장", "student-head", 0, "mechanical"),
            ("vice", "가상 부학회장", "student-vice", 0, "software"),
            ("rep", "가상 반대표", "student-rep", 0, "software-1-A"),
            ("member", "가상 신규 담당자", "student-new", 0, "software-2-A"),
            ("other", "가상 학생회장", "student-other", 0, "student"),
            ("future", "차기 학회장 후보", "student-next", 0, "mechanical"),
        ]
        for ident, name, number, admin, home in people:
            conn.execute(
                "INSERT INTO users (id,name,email,identifier,phone,password_hash,is_admin,active) VALUES (?,?,?,?,?,?,?,1)",
                (ident, name, f"{ident}@demo.invalid", number, "010-0000-0000", hashed, admin),
            )
            if home:
                conn.execute("INSERT INTO memberships VALUES (?,?)", (ident, home))
        roles = [
            ("chair-dept", "chair", "software", "department_head", None),
            ("chair-role", "chair", "council", "chair", "chair-dept"),
            ("head-role", "head", "mechanical", "department_head", None),
            ("vice-role", "vice", "software", "vice_department_head", None),
            ("rep-role", "rep", "software-1-A", "class_rep", None),
            ("other-role", "other", "student", "head", None),
        ]
        for ident, person, home, role, parent in roles:
            conn.execute(
                "INSERT INTO assignments VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    ident,
                    person,
                    home,
                    role,
                    start,
                    stop,
                    start,
                    "teacher",
                    None,
                    parent,
                    "가상 선출 결과" if parent else "",
                ),
            )

    seed_roles(conn)
