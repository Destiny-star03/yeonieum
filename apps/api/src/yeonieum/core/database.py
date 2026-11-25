"""Database initialization and transaction boundaries for the application."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4

from yeonieum.core.postgres import PostgresConnection, PostgresDatabase
from yeonieum.modules.budgets.schema import SCHEMA as BUDGET_SCHEMA
from yeonieum.modules.calendar.schema import SCHEMA as CALENDAR_SCHEMA
from yeonieum.modules.documents.schema import SCHEMA as DOCUMENT_SCHEMA
from yeonieum.modules.handovers.schema import SCHEMA as HANDOVER_SCHEMA
from yeonieum.modules.notifications.schema import SCHEMA as NOTIFICATION_SCHEMA

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 identifier TEXT NOT NULL UNIQUE, phone TEXT NOT NULL, password_hash TEXT NOT NULL,
 is_admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS units (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES units(id),
 parent_id TEXT REFERENCES units(id), kind TEXT NOT NULL, name TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS unit_identity ON units(org_id, coalesce(parent_id, ''), kind, name);
CREATE TABLE IF NOT EXISTS role_definitions (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES units(id), code TEXT NOT NULL,
 label TEXT NOT NULL, scope_kind TEXT NOT NULL, builtin INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1, UNIQUE(org_id,code)
);
CREATE TABLE IF NOT EXISTS memberships (
 user_id TEXT REFERENCES users(id), unit_id TEXT REFERENCES units(id), PRIMARY KEY(user_id,unit_id)
);
CREATE TABLE IF NOT EXISTS assignments (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 unit_id TEXT NOT NULL REFERENCES units(id), role TEXT NOT NULL,
 starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, activated_at TEXT NOT NULL,
 granted_by TEXT NOT NULL REFERENCES users(id), revoked_at TEXT,
 prerequisite_id TEXT REFERENCES assignments(id), election_note TEXT NOT NULL DEFAULT '',
 CHECK(starts_at < ends_at)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_by TEXT NOT NULL REFERENCES users(id),
 token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS local_outbox (
 invitation_id TEXT PRIMARY KEY REFERENCES invitations(id), link TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), org_id TEXT NOT NULL,
 action TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL
);
"""

APP_SCHEMA = (
    SCHEMA + DOCUMENT_SCHEMA + BUDGET_SCHEMA + HANDOVER_SCHEMA + CALENDAR_SCHEMA + NOTIFICATION_SCHEMA
)
EXPENSE_REQUEST_INDEX = (
    "CREATE UNIQUE INDEX IF NOT EXISTS expense_request_once "
    "ON expenses(created_by,request_id) WHERE request_id IS NOT NULL"
)


def connect(database):
    if isinstance(database, PostgresDatabase):
        return database.connect()
    conn = sqlite3.connect(database, isolation_level=None, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(APP_SCHEMA)
    if "folder_id" not in {r[1] for r in conn.execute("PRAGMA table_info(documents)")}:
        conn.execute("ALTER TABLE documents ADD COLUMN folder_id TEXT REFERENCES document_folders(id)")
    if "details" not in {r[1] for r in conn.execute("PRAGMA table_info(calendar_events)")}:
        conn.execute("ALTER TABLE calendar_events ADD COLUMN details TEXT NOT NULL DEFAULT '{}' ")
    if "active" not in {r[1] for r in conn.execute("PRAGMA table_info(units)")}:
        conn.execute("ALTER TABLE units ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
    if "deletion_root_id" not in {r[1] for r in conn.execute("PRAGMA table_info(units)")}:
        conn.execute("ALTER TABLE units ADD COLUMN deletion_root_id TEXT REFERENCES units(id)")
        # Existing inactive units came from whole-organization deletion.
        conn.execute("UPDATE units SET deletion_root_id=org_id WHERE active=0")
    if "email_verified" not in {r[1] for r in conn.execute("PRAGMA table_info(users)")}:
        conn.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1")
    if "request_id" not in {r[1] for r in conn.execute("PRAGMA table_info(expenses)")}:
        conn.execute("ALTER TABLE expenses ADD COLUMN request_id TEXT")
    conn.execute(EXPENSE_REQUEST_INDEX)
    return conn


def initialize(conn):
    if not isinstance(conn, PostgresConnection):
        return
    with transaction(conn):
        for statement in APP_SCHEMA.split(";"):
            if statement.strip():
                conn.execute(statement)
        conn.execute("ALTER TABLE units ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1")
        conn.execute("ALTER TABLE units ADD COLUMN IF NOT EXISTS deletion_root_id TEXT REFERENCES units(id)")
        conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER NOT NULL DEFAULT 1")
        conn.execute(
            "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS posting_order BIGINT GENERATED ALWAYS AS IDENTITY"
        )
        conn.execute(EXPENSE_REQUEST_INDEX)


@contextmanager
def transaction(conn):
    if isinstance(conn, PostgresConnection):
        with conn.transaction():
            # The application reads before writing under SQLite's BEGIN IMMEDIATE.
            # Retain that serialization for PostgreSQL-backed mutations.
            conn.execute("SELECT pg_advisory_xact_lock(409971501667)")
            yield
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def stamp(value=None):
    return (value or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()


def audit(conn, actor, org, action, target, detail):
    conn.execute(
        "INSERT INTO audit VALUES (?,?,?,?,?,?,?)",
        (str(uuid4()), actor["id"], org, action, target, json.dumps(detail, ensure_ascii=False), stamp()),
    )
