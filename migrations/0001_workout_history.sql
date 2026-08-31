CREATE TABLE IF NOT EXISTS workout_pages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  workout_date TEXT NOT NULL,
  created_time TEXT NOT NULL,
  last_edited_time TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS workout_pages_date_idx
  ON workout_pages(workout_date DESC);

CREATE TABLE IF NOT EXISTS history_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
