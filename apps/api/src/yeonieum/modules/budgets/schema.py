"""Additive finance tables; historical records are never cascaded away."""

SCHEMA = """
CREATE TABLE IF NOT EXISTS finance_grants (
 user_id TEXT NOT NULL REFERENCES users(id), org_id TEXT NOT NULL REFERENCES units(id),
 capability TEXT NOT NULL, assignment_id TEXT REFERENCES assignments(id),
 active INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(user_id,org_id,capability)
);
CREATE TABLE IF NOT EXISTS annual_budgets (
 org_id TEXT NOT NULL REFERENCES units(id), year INTEGER NOT NULL, amount INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, settled_at TEXT, settled_by TEXT REFERENCES users(id),
 PRIMARY KEY(org_id,year), CHECK(amount>=0)
);
CREATE TABLE IF NOT EXISTS budget_events (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES units(id), year INTEGER NOT NULL,
 name TEXT NOT NULL, allocation INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
 active INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(org_id,year) REFERENCES annual_budgets(org_id,year), CHECK(allocation>=0)
);
CREATE TABLE IF NOT EXISTS expenses (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES units(id), year INTEGER NOT NULL,
 event_id TEXT REFERENCES budget_events(id), spent_on TEXT NOT NULL,
 purpose TEXT NOT NULL, amount INTEGER NOT NULL, executor_id TEXT NOT NULL REFERENCES users(id),
 executor_was_head INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL REFERENCES users(id),
 request_id TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, review_state TEXT NOT NULL DEFAULT 'pending',
 reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT,
 exception_required INTEGER NOT NULL DEFAULT 0, exception_state TEXT NOT NULL DEFAULT 'none',
 exception_by TEXT REFERENCES users(id), exception_at TEXT, revision INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(org_id,year) REFERENCES annual_budgets(org_id,year), CHECK(amount>=0)
);
CREATE TABLE IF NOT EXISTS expense_changes (
 id TEXT PRIMARY KEY, expense_id TEXT NOT NULL REFERENCES expenses(id), actor_id TEXT NOT NULL REFERENCES users(id),
 changed_at TEXT NOT NULL, reason TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expense_evidence (
 id TEXT PRIMARY KEY, expense_id TEXT NOT NULL REFERENCES expenses(id),
 storage_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, size INTEGER NOT NULL,
 checksum TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settlement_snapshots (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES units(id), year INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS expenses_scope ON expenses(org_id,year,event_id);
"""
