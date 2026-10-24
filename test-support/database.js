const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function createTestDatabase() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "flyrank-widget-test-")
  );
  process.env.DATABASE_PATH = path.join(directory, "test.db");

  return {
    cleanup() {
      const db = require("../src/db");
      if (db.open) db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

module.exports = { createTestDatabase };
