"""Unit deletion batches preserve records and independently deleted branches."""

from yeonieum.core.database import audit, stamp
from yeonieum.modules.access.policy import descendants, unit


def deactivate_subtree(conn, actor, root_id, now):
    target = unit(conn, root_id)
    subtree = descendants(conn, root_id)
    # Already deleted branches keep their own deletion root so an ancestor
    # restore cannot accidentally bring them back.
    changed = 0
    for ident in subtree:
        changed += conn.execute(
            "UPDATE units SET active=0,deletion_root_id=? WHERE id=? AND active=1", (root_id, ident)
        ).rowcount
    revoked = set()
    rows = conn.execute("SELECT id,unit_id FROM assignments WHERE revoked_at IS NULL").fetchall()
    for row in rows:
        if row["unit_id"] not in subtree or row["id"] in revoked:
            continue
        conn.execute("UPDATE assignments SET revoked_at=? WHERE id=?", (stamp(now), row["id"]))
        revoked.add(row["id"])
        audit(
            conn,
            actor,
            target["org_id"],
            "role.revoked",
            row["id"],
            {"reason": "조직 삭제", "unit_id": root_id},
        )
        for dependent in conn.execute(
            "SELECT id FROM assignments WHERE prerequisite_id=? AND revoked_at IS NULL", (row["id"],)
        ).fetchall():
            conn.execute("UPDATE assignments SET revoked_at=? WHERE id=?", (stamp(now), dependent["id"]))
            revoked.add(dependent["id"])
            audit(
                conn,
                actor,
                target["org_id"],
                "role.dependency-ended",
                dependent["id"],
                {"prerequisite_id": row["id"]},
            )
    return {"unit_count": changed, "revoked_count": len(revoked)}


def restore_subtree(conn, root_id):
    target = unit(conn, root_id)
    return conn.execute(
        "UPDATE units SET active=1,deletion_root_id=NULL WHERE org_id=? AND deletion_root_id=?",
        (target["org_id"], root_id),
    ).rowcount
