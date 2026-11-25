"""Additive library tables. Organizational records never cascade with accounts."""

SCHEMA = """
CREATE TABLE IF NOT EXISTS document_staff_scopes (
 user_id TEXT NOT NULL REFERENCES users(id), unit_id TEXT NOT NULL REFERENCES units(id),
 active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id,unit_id)
);
CREATE TABLE IF NOT EXISTS document_folders (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES units(id),
 academic_year INTEGER NOT NULL, parent_id TEXT REFERENCES document_folders(id),
 name TEXT NOT NULL, audience TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES units(id),
 unit_id TEXT NOT NULL REFERENCES units(id), title TEXT NOT NULL, description TEXT NOT NULL,
 academic_year INTEGER NOT NULL, category TEXT NOT NULL, folder TEXT NOT NULL,
 event TEXT NOT NULL, audience TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 current_version INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
 folder_id TEXT REFERENCES document_folders(id)
);
CREATE TABLE IF NOT EXISTS document_versions (
 document_id TEXT NOT NULL REFERENCES documents(id), version INTEGER NOT NULL,
 storage_key TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL,
 checksum TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL, note TEXT NOT NULL,
 PRIMARY KEY(document_id,version)
);
CREATE TABLE IF NOT EXISTS document_uploads (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 document_id TEXT REFERENCES documents(id), metadata TEXT NOT NULL,
 filename TEXT NOT NULL, expected_size INTEGER NOT NULL, expected_checksum TEXT NOT NULL,
 expected_revision INTEGER, state TEXT NOT NULL, created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', result_id TEXT
);
CREATE INDEX IF NOT EXISTS document_classification ON documents(org_id,academic_year,deleted_at);
"""
