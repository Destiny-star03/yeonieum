"""SQLite persistence for synthetic local demo data only."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4

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
CREATE UNIQUE INDEX IF NOT EXISTS unit_identity ON units(org_id, ifnull(parent_id, ''), kind, name);
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


def connect(path):
    conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    if "active" not in {r[1] for r in conn.execute("PRAGMA table_info(units)")}:
        conn.execute("ALTER TABLE units ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
    if "email_verified" not in {r[1] for r in conn.execute("PRAGMA table_info(users)")}:
        conn.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1")
    return conn


@contextmanager
def transaction(conn):
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
