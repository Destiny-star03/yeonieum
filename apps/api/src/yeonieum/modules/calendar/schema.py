SCHEMA = """
CREATE TABLE IF NOT EXISTS calendar_events (
 id TEXT PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES units(id),
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
 starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 0,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, deleted_by TEXT REFERENCES users(id),
 details TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS calendar_reminder_reads (
 event_id TEXT NOT NULL REFERENCES calendar_events(id), user_id TEXT NOT NULL REFERENCES users(id),
 occurrence_start TEXT NOT NULL, minutes INTEGER NOT NULL, seen_at TEXT NOT NULL,
 PRIMARY KEY(event_id,user_id,occurrence_start,minutes)
);
CREATE INDEX IF NOT EXISTS calendar_event_range ON calendar_events(starts_at,ends_at) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS calendar_external_events (
 source TEXT NOT NULL, bucket TEXT NOT NULL, external_key TEXT NOT NULL,
 title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
 source_url TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
 PRIMARY KEY(source,bucket,external_key)
);
CREATE TABLE IF NOT EXISTS calendar_external_sync (
 source TEXT NOT NULL, bucket TEXT NOT NULL, last_attempt TEXT NOT NULL,
 last_success TEXT, last_error TEXT NOT NULL DEFAULT '', item_count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(source,bucket)
);
"""
