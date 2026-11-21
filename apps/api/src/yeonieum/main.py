"""Loopback-only local prototype; no production mode is implemented."""

import asyncio
import os
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Response
from starlette.middleware.trustedhost import TrustedHostMiddleware

from yeonieum.core.database import connect
from yeonieum.core.local import web_port
from yeonieum.modules.access.router import install_routes
from yeonieum.modules.budgets.router import install_budget_routes
from yeonieum.modules.calendar.external_calendar import ExternalCalendar, install_external_routes
from yeonieum.modules.calendar.router import install_calendar_routes
from yeonieum.modules.documents.router import install_document_routes
from yeonieum.modules.handovers.router import install_handover_routes
from yeonieum.modules.organizations.seed import seed

ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000", "http://127.0.0.1:8000"}


def create_app(db_path=None, clock=None, external_sync=None, external_fetcher=None):
    origins = ORIGINS | {f"http://localhost:{web_port()}", f"http://127.0.0.1:{web_port()}"}
    if os.environ.get("YEONIEUM_MODE", "local-demo") != "local-demo":
        raise RuntimeError("Only local-demo mode is implemented. Do not deploy with real data.")
    database = Path(
        db_path
        or os.environ.get("YEONIEUM_DB_PATH")
        or Path(__file__).resolve().parents[4] / "local-data" / "prototype.sqlite3"
    )
    database.parent.mkdir(parents=True, exist_ok=True)
    now = clock or (lambda: datetime.now(timezone.utc))
    external = ExternalCalendar(
        database,
        now,
        enabled=(os.environ.get("YEONIEUM_EXTERNAL_SYNC", "1") != "0" and db_path is None)
        if external_sync is None
        else external_sync,
        fetcher=external_fetcher,
    )

    @asynccontextmanager
    async def lifespan(app):
        conn = connect(database)
        try:
            seed(conn)
        finally:
            conn.close()
        task = asyncio.create_task(external.run()) if external.enabled else None
        try:
            yield
        finally:
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    app = FastAPI(title="연이음 · 로컬 조직/권한 프로토타입", lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"])

    @app.middleware("http")
    async def boundary(request, call_next):
        if request.method not in {"GET", "HEAD", "OPTIONS"} and request.headers.get("origin") not in origins:
            return Response("허용되지 않은 요청 출처입니다.", status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    db, actor = install_routes(app, database, now)
    install_document_routes(app, db, actor, now, database.parent / f"{database.stem}-files")
    install_budget_routes(app, db, actor, now, database.parent / f"{database.stem}-evidence")
    install_handover_routes(app, db, actor, now)
    install_calendar_routes(app, db, actor, now)
    install_external_routes(app, db, actor, now, external)
    return app
