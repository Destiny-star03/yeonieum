"""Handover records are independent from role grants and organizational ownership."""

SCHEMA = """
CREATE TABLE IF NOT EXISTS handovers (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES units(id), year INTEGER NOT NULL,
 from_user_id TEXT NOT NULL REFERENCES users(id), to_user_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 completed_by TEXT REFERENCES users(id), completed_at TEXT, revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS handover_items (
 id TEXT PRIMARY KEY, handover_id TEXT NOT NULL REFERENCES handovers(id),
 kind TEXT NOT NULL, reference_id TEXT, title TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS handover_checks (
 item_id TEXT PRIMARY KEY REFERENCES handover_items(id), checked_by TEXT NOT NULL REFERENCES users(id),
 checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS handover_scope ON handovers(org_id,year,created_at);
"""
