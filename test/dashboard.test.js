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
  const aliceSecondWidgetResponse = await createWidget(
    alice.token,
    "Alice second widget"
  );
  const bobWidgetResponse = await createWidget(bob.token, "Bob widget");
  const aliceWidget = (await aliceWidgetResponse.json()).widget;
  const aliceSecondWidget = (await aliceSecondWidgetResponse.json()).widget;
  const bobWidget = (await bobWidgetResponse.json()).widget;

  assert.equal(
    (await submit(aliceWidget.publicKey, "Alice Lead", "alice-lead@example.com", "Alice message")).status,
    201
  );
  assert.equal(
    (await submit(
      aliceSecondWidget.publicKey,
      "Alice Second Lead",
      "alice-second-lead@example.com",
      "Second Alice message"
    )).status,
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
  db.prepare(`
    UPDATE submissions
    SET geo_country = ?, geo_region = ?, geo_city = ?,
        geo_latitude = ?, geo_longitude = ?, geo_provider = ?,
        geo_status = 'success'
    WHERE email = ?
  `).run(
    "Bosnia and Herzegovina",
    "Sarajevo Canton",
    "Sarajevo",
    43.8563,
    18.4131,
    "ipwho.is",
    "alice-lead@example.com"
  );

  const aliceResponse = await api("/api/owner/dashboard", {
    token: alice.token
  });
  const aliceDashboard = await aliceResponse.json();
  assert.equal(aliceDashboard.widgetCount, 2);
  assert.equal(aliceDashboard.totalSubmissions, 2);
  assert.equal(aliceDashboard.submissionCount, 2);
  assert.equal(aliceDashboard.submissions.length, 2);
  assert.equal(aliceDashboard.hasMore, false);
  assert.deepEqual(aliceDashboard.backgroundJobs, {
    pending: 2,
    processing: 0,
    completed: 0,
    failed: 0
  });
  assert.deepEqual(
    aliceDashboard.widgets.map((widget) => widget.id),
    [aliceSecondWidget.id, aliceWidget.id]
  );
  assert.deepEqual(
    aliceDashboard.submissions.map((submission) => ({
      name: submission.name,
      email: submission.email,
      message: submission.message,
      widgetName: submission.widgetName,
      geolocation: submission.geolocation
    })),
    [
      {
        name: "Alice Second Lead",
        email: "alice-second-lead@example.com",
        message: "Second Alice message",
        widgetName: "Alice second widget",
        geolocation: {
          country: null,
          region: null,
          city: null,
          latitude: null,
          longitude: null,
          provider: null,
          status: "not_processed"
        }
      },
      {
        name: "Alice Lead",
        email: "alice-lead@example.com",
        message: "Alice message",
        widgetName: "Alice widget",
        geolocation: {
          country: "Bosnia and Herzegovina",
          region: "Sarajevo Canton",
          city: "Sarajevo",
          latitude: 43.8563,
          longitude: 18.4131,
          provider: "ipwho.is",
          status: "success"
        }
      }
    ]
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
  assert.equal(filteredData.totalSubmissions, 2);
  assert.equal(filteredData.submissionCount, 1);
  assert.equal(filteredData.submissions.length, 1);
  assert.equal(filteredData.submissions[0].name, "Alice Lead");
  assert.equal(filteredData.submissions[0].geolocation.country, "Bosnia and Herzegovina");
  assert.equal(filteredData.submissions[0].geolocation.city, "Sarajevo");
  assert.deepEqual(filteredData.backgroundJobs, {
    pending: 1,
    processing: 0,
    completed: 0,
    failed: 0
  });

  const secondWidgetFilter = await api(
    `/api/owner/dashboard?widgetId=${aliceSecondWidget.id}`,
    { token: alice.token }
  );
  const secondFilteredData = await secondWidgetFilter.json();
  assert.equal(secondFilteredData.submissionCount, 1);
  assert.equal(secondFilteredData.submissions[0].name, "Alice Second Lead");
  assert.equal(secondFilteredData.submissions[0].email, "alice-second-lead@example.com");
  assert.equal(secondFilteredData.submissions[0].message, "Second Alice message");
  assert.equal(secondFilteredData.submissions[0].widgetName, "Alice second widget");
  assert.equal(secondFilteredData.submissions[0].geolocation.status, "not_processed");
  assert.equal(typeof secondFilteredData.submissions[0].createdAt, "string");

  const ownWidgetSubmissions = await api(
    `/api/owner/widgets/${aliceSecondWidget.id}/submissions`,
    { token: alice.token }
  );
  assert.equal(ownWidgetSubmissions.status, 200);
  const ownWidgetSubmissionData = await ownWidgetSubmissions.json();
  assert.equal(ownWidgetSubmissionData.submissions.length, 1);
  assert.equal(ownWidgetSubmissionData.submissions[0].name, "Alice Second Lead");
  assert.equal(ownWidgetSubmissionData.submissions[0].email, "alice-second-lead@example.com");
  assert.equal(ownWidgetSubmissionData.submissions[0].message, "Second Alice message");
  assert.equal(typeof ownWidgetSubmissionData.submissions[0].created_at, "string");
  assert.equal(
    (await api(`/api/owner/widgets/${aliceSecondWidget.id}/submissions`)).status,
    401
  );
  assert.equal(
    (await api(`/api/owner/widgets/${aliceSecondWidget.id}/submissions`, {
      token: bob.token
    })).status,
    404
  );

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

test("widget settings persist through owner CRUD and stay isolated between accounts", async () => {
  const alice = await register("widget-crud-alice@example.com");
  const bob = await register("widget-crud-bob@example.com");

  const invalid = await createWidget(alice.token, "Invalid config", {
    color: "red",
    fields: ["script"]
  });
  assert.equal(invalid.status, 400);

  const create = await createWidget(alice.token, "Lead form", {
    title: "Let's talk",
    description: "Tell us about your project.",
    buttonText: "Send details",
    color: "#315be8",
    fields: ["name", "email"],
    successMessage: "Message received."
  });
  assert.equal(create.status, 201);
  const { widget } = await create.json();
  const stored = db.prepare(`
    SELECT name, title, description, button_text, color, fields_json,
           success_message, owner_id
    FROM widgets WHERE id = ?
  `).get(widget.id);
  assert.deepEqual(stored, {
    name: "Lead form",
    title: "Let's talk",
    description: "Tell us about your project.",
    button_text: "Send details",
    color: "#315be8",
    fields_json: '["name","email"]',
    success_message: "Message received.",
    owner_id: alice.user.id
  });

  const dashboard = await api("/api/owner/dashboard", { token: alice.token });
  const dashboardData = await dashboard.json();
  assert.equal(dashboardData.widgets[0].id, widget.id);
  assert.equal(dashboardData.widgets[0].title, "Let's talk");
  assert.deepEqual(dashboardData.widgets[0].fields, ["name", "email"]);

  const forbiddenUpdate = await api(`/api/owner/widgets/${widget.id}`, {
    method: "PUT",
    token: bob.token,
    body: { name: "Hijacked widget" }
  });
  const forbiddenDelete = await api(`/api/owner/widgets/${widget.id}`, {
    method: "DELETE",
    token: bob.token
  });
  assert.equal(forbiddenUpdate.status, 404);
  assert.equal(forbiddenDelete.status, 404);

  const update = await api(`/api/owner/widgets/${widget.id}`, {
    method: "PUT",
    token: alice.token,
    body: {
      name: "Updated form",
      title: "A new title",
      description: "Updated description",
      buttonText: "Get in touch",
      color: "#7355dd",
      fields: ["email", "message"],
      successMessage: "We will be in touch."
    }
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).widget.title, "A new title");

  const stillOwned = db.prepare(
    "SELECT owner_id, name FROM widgets WHERE id = ?"
  ).get(widget.id);
  assert.equal(stillOwned.owner_id, alice.user.id);
  assert.equal(stillOwned.name, "Updated form");

  const deleteResponse = await api(`/api/owner/widgets/${widget.id}`, {
    method: "DELETE",
    token: alice.token
  });
  assert.equal(deleteResponse.status, 204);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM widgets WHERE id = ?").get(widget.id).count,
    0
  );
});
