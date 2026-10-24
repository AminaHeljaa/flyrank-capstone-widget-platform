const test = require("node:test");
const assert = require("node:assert/strict");
const { after, before } = require("node:test");
const { createTestDatabase } = require("../test-support/database");
const {
  createGeolocationService,
  emptyLocation,
  isPublicIp
} = require("../src/services/geolocation");

process.env.WIDGET_SUBMISSION_RATE_WINDOW_MS = "60000";
process.env.WIDGET_SUBMISSION_RATE_LIMIT = "20";

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

function providerResponse(data, options = {}) {
  return {
    ok: options.ok !== false,
    json: options.json || (async () => data)
  };
}

function primaryResult(overrides = {}) {
  return {
    success: true,
    country: "United States",
    region: "California",
    city: "Mountain View",
    latitude: 37.386,
    longitude: -122.0838,
    ...overrides
  };
}

function fallbackResult(overrides = {}) {
  return {
    countryName: "United States",
    regionName: "California",
    cityName: "Mountain View",
    latitude: 37.386,
    longitude: -122.0838,
    ...overrides
  };
}

test("primary provider success skips the fallback", async () => {
  const requests = [];
  const service = createGeolocationService({
    timeoutMs: 100,
    fetchImpl: async (url) => {
      requests.push(url);
      return providerResponse(primaryResult());
    }
  });

  assert.deepEqual(await service.lookup("8.8.8.8"), {
    country: "United States",
    region: "California",
    city: "Mountain View",
    latitude: 37.386,
    longitude: -122.0838,
    provider: "ipwho.is",
    status: "success"
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0], /^https:\/\/ipwho\.is\/8\.8\.8\.8$/);
});

test("primary provider failure falls back and normalizes the response", async () => {
  const requests = [];
  const service = createGeolocationService({
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.startsWith("https://ipwho.is/")) {
        return providerResponse({}, { ok: false });
      }
      return providerResponse(fallbackResult());
    }
  });

  const location = await service.lookup("8.8.8.8");
  assert.equal(requests.length, 2);
  assert.match(requests[1], /^https:\/\/free\.freeipapi\.com\/api\/v1\/json\//);
  assert.deepEqual(location, {
    country: "United States",
    region: "California",
    city: "Mountain View",
    latitude: 37.386,
    longitude: -122.0838,
    provider: "FreeIPAPI",
    status: "success"
  });
});

test("primary timeout triggers the fallback", async () => {
  const requests = [];
  const service = createGeolocationService({
    timeoutMs: 10,
    fetchImpl: async (url, options) => {
      requests.push(url);
      if (url.startsWith("https://ipwho.is/")) {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      }
      return providerResponse(fallbackResult());
    }
  });

  const location = await service.lookup("8.8.8.8");
  assert.equal(requests.length, 2);
  assert.equal(location.provider, "FreeIPAPI");
  assert.equal(location.status, "success");
});

test("malformed JSON and invalid coordinates trigger the fallback", async () => {
  for (const invalidPrimary of [
    providerResponse(null, {
      json: async () => {
        throw new SyntaxError("invalid json");
      }
    }),
    providerResponse(primaryResult({ latitude: 91 }))
  ]) {
    const requests = [];
    const service = createGeolocationService({
      fetchImpl: async (url) => {
        requests.push(url);
        return url.startsWith("https://ipwho.is/")
          ? invalidPrimary
          : providerResponse(fallbackResult());
      }
    });

    const location = await service.lookup("8.8.8.8");
    assert.equal(requests.length, 2);
    assert.equal(location.provider, "FreeIPAPI");
    assert.equal(location.status, "success");
  }
});

test("private, localhost and reserved IPs never reach public providers", async () => {
  const addresses = [
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.2",
    "169.254.1.1",
    "192.0.2.10",
    "240.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2001:4:112::1",
    "192.31.196.1",
    "192.52.193.1",
    "192.175.48.1"
  ];
  let calls = 0;
  const service = createGeolocationService({
    fetchImpl: async () => {
      calls += 1;
      return providerResponse(primaryResult());
    }
  });

  for (const address of addresses) {
    assert.equal(isPublicIp(address), false, address);
    assert.deepEqual(await service.lookup(address), emptyLocation("skipped"));
  }
  assert.equal(isPublicIp("8.8.8.8"), true);
  assert.equal(isPublicIp("2001:4860:4860::8888"), true);
  assert.equal(calls, 0);
});

test("submission queues geolocation without waiting for providers", async () => {
  const originalGeolocate = app.locals.geolocate;
  let providerCalls = 0;
  app.locals.geolocate = async () => {
    providerCalls += 1;
    throw new Error("A request handler must not run the provider.");
  };

  try {
    const registered = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "geo-owner@example.com",
        password: "geolocation test password"
      })
    });
    assert.equal(registered.status, 201);
    const token = registered.headers.get("set-cookie")
      .match(/flyrank_session=([^;]+)/)[1];

    const createdWidget = await fetch(`${baseUrl}/api/owner/widgets`, {
      method: "POST",
      headers: {
        Cookie: `flyrank_session=${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: "Geolocation widget" })
    });
    assert.equal(createdWidget.status, 201);
    const widget = (await createdWidget.json()).widget;

    const response = await fetch(
      `${baseUrl}/api/widgets/${widget.publicKey}/submissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Saved Lead",
          email: "saved@example.com",
          message: "This must survive provider outages"
        })
      }
    );
    assert.equal(response.status, 201);
    const responseData = await response.json();
    assert.equal(responseData.success, true);
    assert.equal(providerCalls, 0);

    const stored = db.prepare(`
      SELECT id, name, email, message, geo_status
      FROM submissions
      WHERE widget_id = ?
    `).get(widget.id);
    assert.deepEqual(stored, {
      id: responseData.submissionId,
      name: "Saved Lead",
      email: "saved@example.com",
      message: "This must survive provider outages",
      geo_status: "not_processed"
    });
    const queuedJob = db.prepare(`
      SELECT status, type, submission_id, payload_json
      FROM background_jobs WHERE submission_id = ?
    `).get(stored.id);
    assert.equal(queuedJob.status, "pending");
    assert.equal(queuedJob.type, "geolocate_submission");
    assert.equal(queuedJob.submission_id, stored.id);
    assert.deepEqual(Object.keys(JSON.parse(queuedJob.payload_json)), ["ip"]);
    assert.equal(JSON.stringify(queuedJob).includes("saved@example.com"), false);

    const dashboardResponse = await fetch(
      `${baseUrl}/api/owner/dashboard`,
      { headers: { Cookie: `flyrank_session=${token}` } }
    );
    assert.equal(dashboardResponse.status, 200);
    const dashboard = await dashboardResponse.json();
    assert.equal(dashboard.totalSubmissions, 1);
    assert.equal(dashboard.submissions[0].email, "saved@example.com");
    assert.deepEqual(dashboard.backgroundJobs, {
      pending: 1,
      processing: 0,
      completed: 0,
      failed: 0
    });
    assert.deepEqual(dashboard.submissions[0].geolocation, {
      country: null,
      region: null,
      city: null,
      latitude: null,
      longitude: null,
      provider: null,
      status: "not_processed"
    });
  } finally {
    app.locals.geolocate = originalGeolocate;
  }
});

test("queue failure does not discard a saved submission", async () => {
  const originalEnqueue = app.locals.enqueueGeolocation;
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));
  app.locals.enqueueGeolocation = () => {
    throw new Error("sensitive queue internals");
  };

  try {
    const response = await fetch(
      `${baseUrl}/api/widgets/demo-widget/submissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Queue Failure Lead",
          email: "queue-failure@example.com",
          message: "Still saved"
        })
      }
    );
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE id = ?")
        .get(body.submissionId).count,
      1
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].includes("queue-failure@example.com"), false);
    assert.equal(warnings[0].includes("sensitive queue internals"), false);
  } finally {
    app.locals.enqueueGeolocation = originalEnqueue;
    console.warn = originalWarn;
  }
});
