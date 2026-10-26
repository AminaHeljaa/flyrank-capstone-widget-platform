const Database = require("better-sqlite3");
const path = require("node:path");

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, "..", "widget-platform.db");

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    button_text TEXT NOT NULL DEFAULT 'Pošalji prijavu',
    color TEXT NOT NULL DEFAULT '#4568f5',
    fields_json TEXT NOT NULL DEFAULT '["name","email","message"]',
    success_message TEXT NOT NULL DEFAULT 'Prijava je uspješno zaprimljena.'
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    widget_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    geo_country TEXT,
    geo_region TEXT,
    geo_city TEXT,
    geo_latitude REAL,
    geo_longitude REAL,
    geo_provider TEXT,
    geo_status TEXT NOT NULL DEFAULT 'not_processed',
    FOREIGN KEY (widget_id) REFERENCES widgets(id)
  );

  CREATE TABLE IF NOT EXISTS background_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    locked_at INTEGER,
    processing_token TEXT,
    last_error TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const submissionColumns = new Set(
  db.pragma("table_info(submissions)").map((column) => column.name)
);
const geolocationColumns = [
  ["geo_country", "TEXT"],
  ["geo_region", "TEXT"],
  ["geo_city", "TEXT"],
  ["geo_latitude", "REAL"],
  ["geo_longitude", "REAL"],
  ["geo_provider", "TEXT"],
  ["geo_status", "TEXT NOT NULL DEFAULT 'not_processed'"]
];

for (const [name, definition] of geolocationColumns) {
  if (!submissionColumns.has(name)) {
    db.exec(`ALTER TABLE submissions ADD COLUMN ${name} ${definition}`);
  }
}

const widgetColumns = db.pragma("table_info(widgets)");
if (!widgetColumns.some((column) => column.name === "owner_id")) {
  db.exec(`
    ALTER TABLE widgets
    ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE
  `);
}
const widgetSettingsColumns = new Set(
  db.pragma("table_info(widgets)").map((column) => column.name)
);
const widgetSettings = [
  ["title", "TEXT NOT NULL DEFAULT ''"],
  ["description", "TEXT NOT NULL DEFAULT ''"],
  ["button_text", "TEXT NOT NULL DEFAULT 'Pošalji prijavu'"],
  ["color", "TEXT NOT NULL DEFAULT '#4568f5'"],
  ["fields_json", `TEXT NOT NULL DEFAULT '["name","email","message"]'`],
  ["success_message", "TEXT NOT NULL DEFAULT 'Prijava je uspješno zaprimljena.'"]
];

for (const [name, definition] of widgetSettings) {
  if (!widgetSettingsColumns.has(name)) {
    db.exec(`ALTER TABLE widgets ADD COLUMN ${name} ${definition}`);
  }
}

const systemOwner = db.prepare(`
  INSERT OR IGNORE INTO users (email, password_hash)
  VALUES ('demo-owner@system.invalid', NULL)
`).run();
const systemOwnerId = systemOwner.changes
  ? Number(systemOwner.lastInsertRowid)
  : db.prepare(`
    SELECT id FROM users WHERE email = 'demo-owner@system.invalid'
  `).get().id;

db.prepare(`
  UPDATE widgets SET owner_id = ? WHERE owner_id IS NULL
`).run(systemOwnerId);

db.exec(`
  CREATE TRIGGER IF NOT EXISTS widgets_owner_required_insert
  BEFORE INSERT ON widgets
  WHEN NEW.owner_id IS NULL
  BEGIN
    SELECT RAISE(ABORT, 'Widget owner is required');
  END;

  CREATE TRIGGER IF NOT EXISTS widgets_owner_required_update
  BEFORE UPDATE OF owner_id ON widgets
  WHEN NEW.owner_id IS NULL
  BEGIN
    SELECT RAISE(ABORT, 'Widget owner is required');
  END;

  CREATE INDEX IF NOT EXISTS idx_widgets_owner_id
  ON widgets(owner_id);

  CREATE INDEX IF NOT EXISTS idx_submissions_widget_id
  ON submissions(widget_id);

  CREATE INDEX IF NOT EXISTS idx_background_jobs_ready
  ON background_jobs(status, next_attempt_at, created_at);

  CREATE INDEX IF NOT EXISTS idx_background_jobs_lease
  ON background_jobs(status, locked_at);

  CREATE INDEX IF NOT EXISTS idx_background_jobs_submission
  ON background_jobs(submission_id, status);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_background_jobs_webhook_submission
  ON background_jobs(submission_id)
  WHERE type = 'submission_webhook' AND submission_id IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON sessions(user_id);

  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions(expires_at);
`);

const widgetCount = db.prepare(
  "SELECT COUNT(*) AS count FROM widgets"
).get().count;

if (widgetCount === 0) {
  db.prepare(`
    INSERT INTO widgets (name, public_key, owner_id)
    VALUES (?, ?, ?)
  `).run("Demo kontaktni obrazac", "demo-widget", systemOwnerId);
}

module.exports = db;
