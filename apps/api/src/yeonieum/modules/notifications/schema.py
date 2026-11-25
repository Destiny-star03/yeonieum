SCHEMA = """
CREATE TABLE IF NOT EXISTS notifications (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('document','calendar')), target_id TEXT NOT NULL,
 source_key TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT,
 UNIQUE(user_id,kind,target_id,source_key)
);
CREATE INDEX IF NOT EXISTS notifications_user_recent ON notifications(user_id,created_at DESC,id DESC);
"""
