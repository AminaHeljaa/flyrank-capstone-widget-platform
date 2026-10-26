const test = require("node:test");
const assert = require("node:assert/strict");
const { after, before } = require("node:test");
const { createTestDatabase } = require("../test-support/database");

const testDatabase = createTestDatabase();
process.env.WIDGET_ALLOWED_ORIGINS = "https://publisher.example";

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

async function register(email) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "widget embed test password" })
  });
  assert.equal(response.status, 201);
  const data = await response.json();
  return {
    user: data.user,
    token: response.headers.get("set-cookie")
      .match(/flyrank_session=([^;]+)/)[1]
  };
}

test("public widget configuration is minimal, cache-limited and CORS allowlisted", async () => {
  const owner = await register("widget-config-owner@example.com");
  const create = await fetch(`${baseUrl}/api/owner/widgets`, {
    method: "POST",
    headers: {
      Cookie: `flyrank_session=${owner.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Public widget" })
  });
  assert.equal(create.status, 201);
  const { widget } = await create.json();

  const response = await fetch(`${baseUrl}/api/widgets/${widget.publicKey}`, {
    headers: { Origin: "https://publisher.example" }
  });
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://publisher.example"
  );
  assert.match(response.headers.get("vary"), /Origin/i);
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=30, must-revalidate"
  );
  assert.deepEqual(await response.json(), {
    name: "Public widget",
    publicKey: widget.publicKey,
    title: "Public widget",
    description: "",
    buttonText: "Send",
    color: "#3158d4",
    fields: ["name", "email", "message"],
    successMessage: "Your message has been received."
  });

  const missing = await fetch(`${baseUrl}/api/widgets/does-not-exist`, {
    headers: { Origin: "https://publisher.example" }
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");
});

test("script tag receives versioned JavaScript with immutable cache headers", async () => {
  const response = await fetch(`${baseUrl}/widget/v1.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=31536000, immutable"
  );

  const source = await response.text();
  assert.match(source, /data-widget-key/);
  assert.match(source, /Loading form/);
  assert.match(source, /Email address/);
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /\.innerHTML\b/);

  const demoPage = await fetch(`${baseUrl}/embed-demo.html`);
  assert.equal(demoPage.status, 200);
  const html = await demoPage.text();
  assert.match(html, /\.get\("widgetKey"\) \|\| "demo-widget"/);
  assert.match(html, /\.get\("widgetServer"\)/);
  assert.match(html, /new URL\("\/widget\/v1\.js", widgetServer\)\.href/);
  assert.match(html, /widget-key-hint"\)\.textContent = widgetKey/);

  const homePage = await fetch(`${baseUrl}/`);
  assert.equal(homePage.status, 200);
  const homeHtml = await homePage.text();
  assert.match(
    homeHtml,
    /<div id="widget-root">\s*<script src="\/widget\/v1\.js" data-widget-key="demo-widget" defer><\/script>/
  );
});

test("dashboard offers the selected widget preview and its matching embed code", async () => {
  const dashboardResponse = await fetch(`${baseUrl}/dashboard.html`);
  assert.equal(dashboardResponse.status, 200);
  const dashboardHtml = await dashboardResponse.text();
  assert.match(dashboardHtml, /<html lang="en">/);
  assert.match(dashboardHtml, /Your lead workspace/);
  assert.match(dashboardHtml, /id="embed-dialog"/);
  assert.match(dashboardHtml, /id="embed-preview-frame"/);
  assert.match(dashboardHtml, /id="copy-embed-dialog-code"/);

  const dashboardScriptResponse = await fetch(`${baseUrl}/dashboard.js`);
  assert.equal(dashboardScriptResponse.status, 200);
  const dashboardScript = await dashboardScriptResponse.text();
  assert.match(dashboardScript, /createElement\("button", "button small", "Embed"\)/);
  assert.match(dashboardScript, /Latest submissions for your widgets/);
  assert.match(dashboardScript, /embedPreviewUrl\(widget\.publicKey\)/);
  assert.match(dashboardScript, /embedCode\(widget\.publicKey\)/);
  assert.match(dashboardScript, /data-widget-key="\$\{publicKey\}"/);
});

test("saved widget settings are returned publicly and submissions use its configured fields", async () => {
  const owner = await register("widget-settings-owner@example.com");
  const create = await fetch(`${baseUrl}/api/owner/widgets`, {
    method: "POST",
    headers: {
      Cookie: `flyrank_session=${owner.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: "Campaign widget",
      title: "Talk to our team",
      description: "We will reply soon.",
      buttonText: "Contact us",
      color: "#7355dd",
      fields: ["name", "email"],
      successMessage: "Thanks, we got your note!"
    })
  });
  assert.equal(create.status, 201);
  const { widget } = await create.json();
  assert.equal(
    db.prepare("SELECT owner_id FROM widgets WHERE id = ?").get(widget.id).owner_id,
    owner.user.id
  );
  assert.deepEqual(
    {
      title: widget.title,
      description: widget.description,
      buttonText: widget.buttonText,
      color: widget.color,
      fields: widget.fields,
      successMessage: widget.successMessage
    },
    {
      title: "Talk to our team",
      description: "We will reply soon.",
      buttonText: "Contact us",
      color: "#7355dd",
      fields: ["name", "email"],
      successMessage: "Thanks, we got your note!"
    }
  );

  const config = await fetch(`${baseUrl}/api/widgets/${widget.publicKey}`);
  const publicConfig = await config.json();
  assert.equal(config.status, 200);
  assert.equal(publicConfig.title, "Talk to our team");
  assert.equal(publicConfig.buttonText, "Contact us");
  assert.equal(publicConfig.color, "#7355dd");
  assert.equal(publicConfig.ownerId, undefined);

  const submission = await fetch(
    `${baseUrl}/api/widgets/${widget.publicKey}/submissions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Widget lead",
        email: "widget-lead@example.com"
      })
    }
  );
  assert.equal(submission.status, 201);
  const saved = db.prepare(`
    SELECT widget_id, name, email, message
    FROM submissions WHERE id = ?
  `).get((await submission.json()).submissionId);
  assert.deepEqual(saved, {
    widget_id: widget.id,
    name: "Widget lead",
    email: "widget-lead@example.com",
    message: ""
  });
});

test("OPTIONS preflight is allowed for configured public endpoints only", async () => {
  const configPreflight = await fetch(
    `${baseUrl}/api/widgets/demo-widget`,
    {
      method: "OPTIONS",
      headers: {
        Origin: "https://publisher.example",
        "Access-Control-Request-Method": "GET"
      }
    }
  );
  assert.equal(configPreflight.status, 204);
  assert.equal(
    configPreflight.headers.get("access-control-allow-origin"),
    "https://publisher.example"
  );
  assert.match(
    configPreflight.headers.get("access-control-allow-methods"),
    /GET/
  );

  const submissionPreflight = await fetch(
    `${baseUrl}/api/widgets/demo-widget/submissions`,
    {
      method: "OPTIONS",
      headers: {
        Origin: "https://publisher.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"
      }
    }
  );
  assert.equal(submissionPreflight.status, 204);
  assert.equal(
    submissionPreflight.headers.get("access-control-allow-origin"),
    "https://publisher.example"
  );
  assert.match(
    submissionPreflight.headers.get("access-control-allow-headers"),
    /content-type/i
  );

  const disallowed = await fetch(
    `${baseUrl}/api/widgets/demo-widget`,
    {
      method: "OPTIONS",
      headers: {
        Origin: "https://unlisted.example",
        "Access-Control-Request-Method": "GET"
      }
    }
  );
  assert.equal(disallowed.headers.get("access-control-allow-origin"), null);

  const privatePreflight = await fetch(
    `${baseUrl}/api/owner/dashboard`,
    {
      method: "OPTIONS",
      headers: {
        Origin: "https://publisher.example",
        "Access-Control-Request-Method": "GET"
      }
    }
  );
  assert.equal(privatePreflight.status, 401);
  assert.equal(
    privatePreflight.headers.get("access-control-allow-origin"),
    null
  );
});

test("public key permits config and submission only, never private widget data", async () => {
  const owner = await register("widget-private-owner@example.com");
  const create = await fetch(`${baseUrl}/api/owner/widgets`, {
    method: "POST",
    headers: {
      Cookie: `flyrank_session=${owner.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Private data widget" })
  });
  const { widget } = await create.json();

  const submission = await fetch(
    `${baseUrl}/api/widgets/${widget.publicKey}/submissions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Embed Lead",
        email: "embed-lead@example.com",
        message: "Can be submitted"
      })
    }
  );
  assert.equal(submission.status, 201);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE widget_id = ?")
      .get(widget.id).count,
    1
  );

  const invalidSubmission = await fetch(
    `${baseUrl}/api/widgets/${widget.publicKey}/submissions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "X",
        email: "not-an-email",
        message: "invalid"
      })
    }
  );
  assert.equal(invalidSubmission.status, 400);

  const honeypot = await fetch(
    `${baseUrl}/api/widgets/${widget.publicKey}/submissions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bot lead",
        email: "bot@example.com",
        website: "https://spam.example"
      })
    }
  );
  assert.equal(honeypot.status, 200);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE widget_id = ?")
      .get(widget.id).count,
    1
  );

  assert.equal(
    (await fetch(`${baseUrl}/api/widgets/${widget.publicKey}/stats`)).status,
    401
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/owner/widgets/${widget.id}/submissions`)).status,
    401
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/owner/widgets/${widget.id}/stats`)).status,
    401
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/widgets/${widget.publicKey}/submissions`)).status,
    404
  );
});

test("submission queues the webhook after saving and survives enqueue failure", async () => {
  const originalEnabled = app.locals.submissionWebhookEnabled;
  const originalEnqueue = app.locals.enqueueSubmissionWebhook;
  const originalWarn = console.warn;
  const warnings = [];
  app.locals.submissionWebhookEnabled = true;

  try {
    const response = await fetch(
      `${baseUrl}/api/widgets/demo-widget/submissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Webhook route lead",
          email: "webhook-route@example.com",
          message: "Saved before background delivery."
        })
      }
    );
    assert.equal(response.status, 201);
    const { submissionId } = await response.json();
    assert.deepEqual(
      db.prepare(`
        SELECT type, status, payload_json
        FROM background_jobs
        WHERE submission_id = ? AND type = 'submission_webhook'
      `).get(submissionId),
      {
        type: "submission_webhook",
        status: "pending",
        payload_json: "{}"
      }
    );

    app.locals.enqueueSubmissionWebhook = () => {
      throw new Error("private lead details must not be logged");
    };
    console.warn = (message) => warnings.push(message);
    const queueFailure = await fetch(
      `${baseUrl}/api/widgets/demo-widget/submissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Saved despite queue outage",
          email: "queue-outage@example.com"
        })
      }
    );
    assert.equal(queueFailure.status, 201);
    const failedQueueLead = await queueFailure.json();
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count FROM submissions WHERE id = ?
    `).get(failedQueueLead.submissionId).count, 1);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].includes("queue-outage@example.com"), false);
    assert.equal(warnings[0].includes("private lead details"), false);
  } finally {
    app.locals.submissionWebhookEnabled = originalEnabled;
    app.locals.enqueueSubmissionWebhook = originalEnqueue;
    console.warn = originalWarn;
  }
});
