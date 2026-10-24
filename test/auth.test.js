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
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(`${baseUrl}${route}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
}

function sessionToken(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "response should set a session cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  return cookie.match(/flyrank_session=([^;]+)/)[1];
}

async function register(email, password = "correct horse battery") {
  const response = await api("/api/auth/register", {
    method: "POST",
    body: { email, password }
  });
  return {
    response,
    data: response.status === 201 ? await response.json() : null,
    token: response.status === 201 ? sessionToken(response) : null
  };
}

test("registracija validira podatke, hashira lozinku i omogućava prijavu", async () => {
  const shortPassword = await api("/api/auth/register", {
    method: "POST",
    body: { email: "short@example.com", password: "short" }
  });
  assert.equal(shortPassword.status, 400);

  const created = await register("Alice@Example.com");
  assert.equal(created.response.status, 201);
  assert.equal(created.data.user.email, "alice@example.com");

  const user = db.prepare(`
    SELECT email, password_hash FROM users WHERE email = ?
  `).get("alice@example.com");
  assert.notEqual(user.password_hash, "correct horse battery");
  assert.match(user.password_hash, /^\$2[aby]\$/);
  assert.equal(
    require("bcryptjs").compareSync("correct horse battery", user.password_hash),
    true
  );

  const storedSession = db.prepare(
    "SELECT token_hash FROM sessions WHERE user_id = ?"
  ).get(created.data.user.id);
  assert.notEqual(storedSession.token_hash, created.token);
  assert.equal((await api("/api/auth/me", { token: created.token })).status, 200);
  assert.equal((await api("/api/auth/me")).status, 401);

  const duplicate = await register("alice@example.com");
  assert.equal(duplicate.response.status, 409);

  const badLogin = await api("/api/auth/login", {
    method: "POST",
    body: { email: "alice@example.com", password: "incorrect password" }
  });
  assert.equal(badLogin.status, 401);

  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email: "ALICE@example.com", password: "correct horse battery" }
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.id, created.data.user.id);
  const loginToken = sessionToken(login);

  assert.equal((await api("/api/auth/logout", {
    method: "POST",
    token: loginToken
  })).status, 204);
  assert.equal((await api("/api/auth/me", { token: loginToken })).status, 401);
});

test("widget CRUD i prijave su ograničeni na vlasnika", async () => {
  const alice = await register("owner@example.com");
  const bob = await register("other@example.com");
  assert.equal(alice.response.status, 201);
  assert.equal(bob.response.status, 201);

  const unauthenticated = await api("/api/owner/widgets");
  assert.equal(unauthenticated.status, 401);

  const created = await api("/api/owner/widgets", {
    method: "POST",
    token: alice.token,
    body: { name: "Alice forma" }
  });
  assert.equal(created.status, 201);
  const aliceWidget = (await created.json()).widget;

  const details = await api(`/api/owner/widgets/${aliceWidget.id}`, {
    token: alice.token
  });
  assert.equal((await details.json()).widget.publicKey, aliceWidget.publicKey);

  const publicWidget = await api(`/api/widgets/${aliceWidget.publicKey}`);
  assert.equal(publicWidget.status, 200);

  const submission = await api(
    `/api/widgets/${aliceWidget.publicKey}/submissions`,
    {
      method: "POST",
      body: {
        name: "Test korisnik",
        email: "lead@example.com",
        message: "Pozdrav"
      }
    }
  );
  assert.equal(submission.status, 201);

  const ownerSubmissions = await api(
    `/api/owner/widgets/${aliceWidget.id}/submissions`,
    { token: alice.token }
  );
  assert.equal((await ownerSubmissions.json()).submissions.length, 1);

  const stats = await api(`/api/owner/widgets/${aliceWidget.id}/stats`, {
    token: alice.token
  });
  assert.equal((await stats.json()).totalSubmissions, 1);

  const bobWidgets = await api("/api/owner/widgets", { token: bob.token });
  assert.deepEqual((await bobWidgets.json()).widgets, []);

  for (const [method, route, body] of [
    ["GET", `/api/owner/widgets/${aliceWidget.id}`, undefined],
    ["PATCH", `/api/owner/widgets/${aliceWidget.id}`, { name: "Tuđa forma" }],
    ["DELETE", `/api/owner/widgets/${aliceWidget.id}`, undefined],
    ["GET", `/api/owner/widgets/${aliceWidget.id}/submissions`, undefined],
    ["GET", `/api/owner/widgets/${aliceWidget.id}/stats`, undefined],
    ["GET", `/api/widgets/${aliceWidget.publicKey}/stats`, undefined]
  ]) {
    const response = await api(route, {
      method,
      token: bob.token,
      body
    });
    assert.equal(response.status, 404, `${method} ${route} must be isolated`);
  }

  const updated = await api(`/api/owner/widgets/${aliceWidget.id}`, {
    method: "PATCH",
    token: alice.token,
    body: { name: "Ažurirana forma" }
  });
  assert.equal((await updated.json()).widget.name, "Ažurirana forma");

  const bobWidgetResponse = await api("/api/owner/widgets", {
    method: "POST",
    token: bob.token,
    body: { name: "Bob forma" }
  });
  const bobWidget = (await bobWidgetResponse.json()).widget;

  const deleted = await api(`/api/owner/widgets/${aliceWidget.id}`, {
    method: "DELETE",
    token: alice.token
  });
  assert.equal(deleted.status, 204);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE widget_id = ?")
      .get(aliceWidget.id).count,
    0
  );
  assert.equal(
    (await api(`/api/owner/widgets/${bobWidget.id}`, { token: bob.token })).status,
    200
  );
});

test("postojeći demo widget i javni obrazac ostaju dostupni", async () => {
  const widget = await api("/api/widgets/demo-widget");
  assert.equal(widget.status, 200);
  assert.equal((await widget.json()).publicKey, "demo-widget");

  const submission = await api("/api/widgets/demo-widget/submissions", {
    method: "POST",
    body: {
      name: "Demo korisnik",
      email: "demo@example.com",
      message: "Demo prijava"
    }
  });
  assert.equal(submission.status, 201);
});
