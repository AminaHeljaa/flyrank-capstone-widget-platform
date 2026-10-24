
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDatabase } = require("../test-support/database");

const testDatabase = createTestDatabase();
const app = require("../src/app");

test.after(() => {
  testDatabase.cleanup();
});

test("GET /health vraća status ok", async () => {
  const server = app.listen(0);

  try {
    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/health`
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "flyrank-capstone-widget-platform"
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
