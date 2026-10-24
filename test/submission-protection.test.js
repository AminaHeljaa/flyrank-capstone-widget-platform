const test = require("node:test");
const assert = require("node:assert/strict");
const { after, before } = require("node:test");
const { createTestDatabase } = require("../test-support/database");

process.env.WIDGET_ALLOWED_ORIGINS = "https://publisher.example";
process.env.WIDGET_SUBMISSION_RATE_WINDOW_MS = "60000";
process.env.WIDGET_SUBMISSION_RATE_LIMIT = "9";

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

function submissionRequest(body, options = {}, publicKey = "demo-widget") {
  return fetch(`${baseUrl}/api/widgets/${publicKey}/submissions`, {
    method: "POST",
    headers: {
      Origin: options.origin || "https://publisher.example",
      "Content-Type": "application/json"
    },
    body
  });
}

function jsonSubmission(body, options, publicKey) {
  return submissionRequest(JSON.stringify(body), options, publicKey);
}

test("public submissions validate payloads, quietly reject honeypot and rate limit attempts", async () => {
  const submissionsBefore = db.prepare(
    "SELECT COUNT(*) AS count FROM submissions"
  ).get().count;

  const valid = await jsonSubmission({
    name: "Valid Lead",
    email: "valid@example.com",
    message: "Valid message"
  });
  assert.equal(valid.status, 201);
  assert.equal(
    valid.headers.get("access-control-allow-origin"),
    "https://publisher.example"
  );
  const validBody = await valid.json();
  assert.deepEqual(Object.keys(validBody).sort(), ["submissionId", "success"]);
  assert.equal(validBody.success, true);
  assert.ok(validBody.submissionId);

  const missing = await jsonSubmission({});
  assert.equal(missing.status, 400);
  const missingBody = await missing.json();
  assert.equal(missingBody.error, "Podaci nisu ispravni.");
  assert.ok(Array.isArray(missingBody.details));
  assert.equal(missingBody.code, undefined);

  const invalidFields = await jsonSubmission({
    name: "A",
    email: "not-an-email",
    message: "Message"
  });
  assert.equal(invalidFields.status, 400);
  assert.equal((await invalidFields.json()).error, "Podaci nisu ispravni.");

  const invalidEmail = await jsonSubmission({
    name: "Valid Name",
    email: "no-at-sign",
    message: "Message"
  });
  assert.equal(invalidEmail.status, 400);
  assert.ok((await invalidEmail.json()).details.some(
    (detail) => detail.field === "email"
  ));

  const longMessage = await jsonSubmission({
    name: "Valid Name",
    email: "long@example.com",
    message: "m".repeat(2001)
  });
  assert.equal(longMessage.status, 400);
  assert.ok((await longMessage.json()).details.some(
    (detail) => detail.field === "message"
  ));

  const unknownField = await jsonSubmission({
    name: "Valid Name",
    email: "extra@example.com",
    message: "Message",
    owner_id: 1
  });
  assert.equal(unknownField.status, 400);
  assert.ok((await unknownField.json()).details.length > 0);

  const countBeforeHoneypot = db.prepare(
    "SELECT COUNT(*) AS count FROM submissions"
  ).get().count;
  const honeypot = await jsonSubmission(
    { website: "filled" },
    undefined,
    "not-a-real-widget"
  );
  assert.equal(honeypot.status, 200);
  assert.deepEqual(await honeypot.json(), {
    success: true,
    message: "Prijava je zaprimljena."
  });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM submissions").get().count,
    countBeforeHoneypot
  );

  const malformedJson = await submissionRequest("{invalid");
  assert.equal(malformedJson.status, 400);
  assert.equal(
    malformedJson.headers.get("access-control-allow-origin"),
    "https://publisher.example"
  );
  assert.deepEqual(await malformedJson.json(), {
    error: "JSON tijelo zahtjeva nije ispravno.",
    code: "INVALID_JSON"
  });

  const oversized = await submissionRequest(JSON.stringify({
    name: "Large Payload",
    email: "large@example.com",
    message: "x".repeat(11000)
  }));
  assert.equal(oversized.status, 413);
  assert.equal(
    oversized.headers.get("access-control-allow-origin"),
    "https://publisher.example"
  );
  assert.deepEqual(await oversized.json(), {
    error: "Zahtjev je prevelik.",
    code: "PAYLOAD_TOO_LARGE"
  });

  for (let index = 0; index < 2; index += 1) {
    const allowed = await jsonSubmission({
      name: `Allowed Lead ${index}`,
      email: `allowed-${index}@example.com`,
      message: "Within limit"
    });
    assert.equal(allowed.status, 201);
    assert.equal((await allowed.json()).success, true);
  }

  const limited = await jsonSubmission({
    name: "Rate Limited Lead",
    email: "limited@example.com",
    message: "Over limit"
  });
  assert.equal(limited.status, 429);
  assert.equal(
    limited.headers.get("access-control-allow-origin"),
    "https://publisher.example"
  );
  assert.deepEqual(await limited.json(), {
    error: "Previše pokušaja slanja. Pokušajte ponovo kasnije.",
    code: "RATE_LIMIT_EXCEEDED"
  });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM submissions").get().count,
    submissionsBefore + 3
  );

  const disallowedOrigin = await jsonSubmission({
    name: "Other Origin",
    email: "other-origin@example.com",
    message: "Not browser-readable"
  }, { origin: "https://not-allowed.example" });
  assert.equal(disallowedOrigin.status, 429);
  assert.equal(disallowedOrigin.headers.get("access-control-allow-origin"), null);
});

test("CORS preflight is public-only and owner routes still require a session", async () => {
  const publicPreflight = await fetch(
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
  assert.equal(publicPreflight.status, 204);
  assert.equal(
    publicPreflight.headers.get("access-control-allow-origin"),
    "https://publisher.example"
  );

  const privatePreflight = await fetch(`${baseUrl}/api/owner/dashboard`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://publisher.example",
      "Access-Control-Request-Method": "GET"
    }
  });
  assert.equal(privatePreflight.status, 401);
  assert.equal(
    privatePreflight.headers.get("access-control-allow-origin"),
    null
  );

  const publicKeyCannotReadStats = await fetch(
    `${baseUrl}/api/widgets/demo-widget/stats`,
    { headers: { Origin: "https://publisher.example" } }
  );
  assert.equal(publicKeyCannotReadStats.status, 401);
  assert.equal(
    publicKeyCannotReadStats.headers.get("access-control-allow-origin"),
    null
  );
});
