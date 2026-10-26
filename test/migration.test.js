const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "flyrank-widget-migration-")
);
const databasePath = path.join(directory, "legacy.db");
const legacyDb = new Database(databasePath);

legacyDb.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    widget_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (widget_id) REFERENCES widgets(id)
  );

  CREATE INDEX idx_submissions_widget_id ON submissions(widget_id);

  INSERT INTO widgets (id, name, public_key)
  VALUES (41, 'Demo kontaktni obrazac', 'demo-widget'),
         (42, 'Postojeći widget', 'existing-widget');

  INSERT INTO submissions (id, widget_id, name, email, message)
  VALUES (51, 42, 'Sačuvana prijava', 'lead@example.com', 'Sačuvana poruka');
`);
legacyDb.close();

process.env.DATABASE_PATH = databasePath;
const app = require("../src/app");
const db = require("../src/db");

test("migracija sačuva postojeće widgete i prijave i dodijeli vlasnika", async () => {
  const widgets = db.prepare(`
    SELECT id, name, public_key, owner_id FROM widgets ORDER BY id
  `).all();
  assert.equal(widgets.length, 2);
  assert.equal(widgets[0].public_key, "demo-widget");
  assert.equal(widgets[1].public_key, "existing-widget");
  assert.equal(widgets[0].owner_id, widgets[1].owner_id);
  assert.deepEqual(
    db.prepare(`
      SELECT title, description, button_text, color, fields_json,
             success_message
      FROM widgets WHERE id = 42
    `).get(),
    {
      title: "",
      description: "",
      button_text: "Pošalji prijavu",
      color: "#4568f5",
      fields_json: '["name","email","message"]',
      success_message: "Prijava je uspješno zaprimljena."
    }
  );

  const systemOwner = db.prepare(`
    SELECT email, password_hash FROM users WHERE id = ?
  `).get(widgets[0].owner_id);
  assert.equal(systemOwner.email, "demo-owner@system.invalid");
  assert.equal(systemOwner.password_hash, null);

  assert.deepEqual(
    db.prepare(`
      SELECT id, widget_id, name, email, message FROM submissions
    `).all(),
    [{
      id: 51,
      widget_id: 42,
      name: "Sačuvana prijava",
      email: "lead@example.com",
      message: "Sačuvana poruka"
    }]
  );
  const migratedSubmission = db.prepare(`
    SELECT geo_country, geo_region, geo_city, geo_latitude, geo_longitude,
           geo_provider, geo_status
    FROM submissions WHERE id = 51
  `).get();
  assert.deepEqual(migratedSubmission, {
    geo_country: null,
    geo_region: null,
    geo_city: null,
    geo_latitude: null,
    geo_longitude: null,
    geo_provider: null,
    geo_status: "not_processed"
  });
  assert.equal(db.prepare(
    "SELECT COUNT(*) AS count FROM background_jobs"
  ).get().count, 0);
  assert.ok(db.pragma("index_list(background_jobs)").some(
    (index) => index.name === "idx_background_jobs_ready"
  ));
  assert.ok(db.pragma("index_list(background_jobs)").some(
    (index) => index.name === "idx_background_jobs_lease"
  ));
  assert.ok(db.pragma("index_list(background_jobs)").some(
    (index) => index.name === "idx_background_jobs_webhook_submission"
  ));

  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/widgets/demo-widget`
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).publicKey, "demo-widget");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

test.after(() => {
  if (db.open) db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
