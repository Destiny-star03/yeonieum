from fastapi import Depends, HTTPException

from yeonieum.core.database import stamp, transaction
from yeonieum.modules.calendar.policy import visible_units
from yeonieum.modules.notifications.service import notification_view, role_organizations


def install_notification_routes(app, db, actor, now):
    @app.get("/api/notifications")
    def notifications(user=Depends(actor), conn=Depends(db)):
        at = now()
        organizations = role_organizations(conn, user, at)
        visible = visible_units(conn, user, at)
        items = []
        for notice in conn.execute(
            "SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC,id DESC", (user["id"],)
        ):
            item = notification_view(conn, user, notice, at, organizations=organizations, visible=visible)
            if item:
                items.append(item)
                if len(items) == 50:
                    break
        return {"items": items}

    @app.post("/api/notifications/{ident}/read")
    def mark_read(ident: str, user=Depends(actor), conn=Depends(db)):
        with transaction(conn):
            notice = conn.execute(
                "SELECT * FROM notifications WHERE id=? AND user_id=?", (ident, user["id"])
            ).fetchone()
            at = now()
            if not notice or not notification_view(conn, user, notice, at):
                raise HTTPException(404, "알림을 찾을 수 없습니다.")
            conn.execute(
                "UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL",
                (stamp(at), ident, user["id"]),
            )
        return {"ok": True}
