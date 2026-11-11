"""Loopback-only local prototype; no production mode is implemented."""

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Response
from starlette.middleware.trustedhost import TrustedHostMiddleware

from yeonieum.core.database import connect
from yeonieum.modules.access.router import install_routes
from yeonieum.modules.organizations.seed import seed

ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000", "http://127.0.0.1:8000"}


def create_app(db_path=None, clock=None):
    if os.environ.get("YEONIEUM_MODE", "local-demo") != "local-demo":
        raise RuntimeError("Only local-demo mode is implemented. Do not deploy with real data.")
    database = Path(
        db_path
        or os.environ.get("YEONIEUM_DB_PATH")
        or Path(__file__).resolve().parents[4] / "local-data" / "prototype.sqlite3"
    )
    database.parent.mkdir(parents=True, exist_ok=True)
    now = clock or (lambda: datetime.now(timezone.utc))

    @asynccontextmanager
    async def lifespan(app):
        conn = connect(database)
        try:
            seed(conn)
        finally:
            conn.close()
        yield

    app = FastAPI(title="연이음 · 로컬 조직/권한 프로토타입", lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"])

    @app.middleware("http")
    async def boundary(request, call_next):
        if request.method not in {"GET", "HEAD", "OPTIONS"} and request.headers.get("origin") not in ORIGINS:
            return Response("허용되지 않은 요청 출처입니다.", status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    install_routes(app, database, now)
    return app
