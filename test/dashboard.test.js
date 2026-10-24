const test = require("node:test");
const assert = require("node:assert/strict");
const { after, before } = require("node:test");
const { createTestDatabase } = require("../test-support/database");

const testDatabase = createTestDatabase();
const app = require("../src/app");
const db = require("../src/db");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  testDatabase.cleanup();
});

async function api(route, options = {}) {
  const headers = {};
  if (options.token) headers.Cookie = `flyrank_session=${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  return fetch(`${baseUrl}${route}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
}

async function register(email) {
  const response = await api("/api/auth/register", {
    method: "POST",
    body: { email, password: "dashboard test password" }
  });
  assert.equal(response.status, 201);
  const data = await response.json();
  const token = response.headers.get("set-cookie")
    .match(/flyrank_session=([^;]+)/)[1];
  return { user: data.user, token };
}

async function createWidget(token, name, extra = {}) {
  return api("/api/owner/widgets", {
    method: "POST",
    token,
    body: { name, ...extra }
  });
}

async function submit(publicKey, name, email, message) {
  return api(`/api/widgets/${publicKey}/submissions`, {
    method: "POST",
    body: { name, email, message }
  });
}

test("dashboard API zahtijeva autentifikaciju i ne prihvata klijentskog vlasnika", async () => {
  assert.equal((await api("/api/owner/dashboard")).status, 401);

  const alice = await register("dashboard-alice@example.com");
  const bob = await register("dashboard-bob@example.com");

  const forged = await createWidget(alice.token, "Pokušaj lažnog vlasnika", {
    owner_id: bob.user.id
  });
  assert.equal(forged.status, 400);

  const created = await createWidget(alice.token, "Alice dashboard widget");
  assert.equal(created.status, 201);
  const widget = (await created.json()).widget;
  const storedOwner = db.prepare(
    "SELECT owner_id FROM widgets WHERE id = ?"
  ).get(widget.id);
  assert.equal(storedOwner.owner_id, alice.user.id);

  const response = await api(
    `/api/owner/dashboard?ownerId=${bob.user.id}`,
    { token: alice.token }
  );
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  assert.equal(dashboard.widgetCount, 1);
  assert.equal(dashboard.totalSubmissions, 0);
  assert.equal(dashboard.widgets[0].id, widget.id);
  assert.deepEqual(dashboard.submissions, []);
});

test("dashboard prikazuje samo vlastite widgete i prijave, uključujući filtriranje", async () => {
  const alice = await register("dashboard-owner@example.com");
  const bob = await register("dashboard-other@example.com");

  const aliceWidgetResponse = await createWidget(alice.token, "Alice widget");
  const bobWidgetResponse = await createWidget(bob.token, "Bob widget");
  const aliceWidget = (await aliceWidgetResponse.json()).widget;
  const bobWidget = (await bobWidgetResponse.json()).widget;

  assert.equal(
    (await submit(aliceWidget.publicKey, "Alice Lead", "alice-lead@example.com", "Alice message")).status,
    201
  );
  assert.equal(
    (await submit(bobWidget.publicKey, "Bob Lead", "bob-lead@example.com", "Bob message")).status,
    201
  );
  assert.equal(
    (await submit("demo-widget", "Demo Lead", "demo-lead@example.com", "Private demo submission")).status,
    201
  );

  const aliceResponse = await api("/api/owner/dashboard", {
    token: alice.token
  });
  const aliceDashboard = await aliceResponse.json();
  assert.equal(aliceDashboard.widgetCount, 1);
  assert.equal(aliceDashboard.totalSubmissions, 1);
  assert.equal(aliceDashboard.submissionCount, 1);
  assert.equal(aliceDashboard.hasMore, false);
  assert.deepEqual(aliceDashboard.backgroundJobs, {
    pending: 1,
    processing: 0,
    completed: 0,
    failed: 0
  });
  assert.deepEqual(
    aliceDashboard.widgets.map((widget) => widget.id),
    [aliceWidget.id]
  );
  assert.deepEqual(
    aliceDashboard.submissions.map((submission) => ({
      name: submission.name,
      email: submission.email,
      message: submission.message,
      widgetName: submission.widgetName
    })),
    [{
      name: "Alice Lead",
      email: "alice-lead@example.com",
      message: "Alice message",
      widgetName: "Alice widget"
    }]
  );

  const bobDashboard = await api("/api/owner/dashboard", {
    token: bob.token
  });
  const bobData = await bobDashboard.json();
  assert.equal(bobData.widgetCount, 1);
  assert.equal(bobData.totalSubmissions, 1);
  assert.equal(bobData.submissions[0].email, "bob-lead@example.com");
  assert.deepEqual(bobData.backgroundJobs, {
    pending: 1,
    processing: 0,
    completed: 0,
    failed: 0
  });

  const aliceFilter = await api(
    `/api/owner/dashboard?widgetId=${aliceWidget.id}`,
    { token: alice.token }
  );
  const filteredData = await aliceFilter.json();
  assert.equal(filteredData.submissionCount, 1);
  assert.equal(filteredData.submissions[0].name, "Alice Lead");
  assert.deepEqual(filteredData.backgroundJobs, {
    pending: 1,
    processing: 0,
    completed: 0,
    failed: 0
  });

  assert.equal(
    (await api(`/api/owner/dashboard?widgetId=${bobWidget.id}`, {
      token: alice.token
    })).status,
    404
  );
  assert.equal(
    (await api("/api/owner/dashboard?widgetId=invalid", {
      token: alice.token
    })).status,
    400
  );
});
