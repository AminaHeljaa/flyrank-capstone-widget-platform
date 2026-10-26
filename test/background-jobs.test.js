const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { createTestDatabase } = require("../test-support/database");
const { JobQueue } = require("../src/services/job-queue");
const { JobWorker } = require("../src/services/job-worker");
const {
  createSubmissionWebhookService
} = require("../src/services/submission-webhook");

const testDatabase = createTestDatabase();
const db = require("../src/db");

test.after(() => {
  testDatabase.cleanup();
});

function createSubmission(name = "Worker Lead") {
  const ownerId = db.prepare(
    "SELECT id FROM users WHERE email = 'demo-owner@system.invalid'"
  ).get().id;
  const widget = db.prepare(`
    INSERT INTO widgets (name, public_key, owner_id)
    VALUES (?, ?, ?)
  `).run(name, `worker-${Date.now()}-${Math.random()}`, ownerId);
  const submission = db.prepare(`
    INSERT INTO submissions (widget_id, name, email, message)
    VALUES (?, ?, ?, ?)
  `).run(Number(widget.lastInsertRowid), name, "worker@example.com", "Sensitive body");
  return Number(submission.lastInsertRowid);
}

function jobFor(submissionId, queue, ip = "8.8.8.8") {
  const id = queue.enqueueGeolocation({ submissionId, ip });
  return db.prepare("SELECT * FROM background_jobs WHERE id = ?").get(id);
}

function successfulLocation() {
  return {
    country: "United States",
    region: "California",
    city: "Mountain View",
    latitude: 37.386,
    longitude: -122.0838,
    provider: "ipwho.is",
    status: "success"
  };
}

test("worker completes a geolocation job and removes its IP payload", async () => {
  let now = 100000;
  const queue = new JobQueue(db, { now: () => now });
  const submissionId = createSubmission();
  const createdJob = jobFor(submissionId, queue);
  const worker = new JobWorker({
    queue,
    geolocate: async (ip) => {
      assert.equal(ip, "8.8.8.8");
      return successfulLocation();
    }
  });

  assert.equal(await worker.runOnce(), true);
  const job = db.prepare("SELECT * FROM background_jobs WHERE id = ?")
    .get(createdJob.id);
  assert.equal(job.status, "completed");
  assert.equal(job.attempts, 1);
  assert.equal(job.payload_json, "{}");
  assert.ok(job.completed_at);
  const submission = db.prepare(`
    SELECT geo_country, geo_region, geo_city, geo_latitude, geo_longitude,
           geo_provider, geo_status
    FROM submissions WHERE id = ?
  `).get(submissionId);
  assert.deepEqual(submission, {
    geo_country: "United States",
    geo_region: "California",
    geo_city: "Mountain View",
    geo_latitude: 37.386,
    geo_longitude: -122.0838,
    geo_provider: "ipwho.is",
    geo_status: "success"
  });
});

test("transient geolocation failures use exponential retry delays", async () => {
  let now = 200000;
  let calls = 0;
  const queue = new JobQueue(db, {
    now: () => now,
    maxAttempts: 3,
    baseDelayMs: 100
  });
  const submissionId = createSubmission("Retry Lead");
  const createdJob = jobFor(submissionId, queue);
  const worker = new JobWorker({
    queue,
    geolocate: async () => {
      calls += 1;
      if (calls < 3) return { status: "unavailable" };
      return successfulLocation();
    }
  });

  assert.equal(await worker.runOnce(), true);
  let job = db.prepare("SELECT * FROM background_jobs WHERE id = ?")
    .get(createdJob.id);
  assert.equal(job.status, "pending");
  assert.equal(job.attempts, 1);
  assert.equal(job.next_attempt_at, 200100);
  assert.equal(job.last_error, "GEOLOCATION_UNAVAILABLE");
  assert.equal(await worker.runOnce(), false);

  now = 200100;
  assert.equal(await worker.runOnce(), true);
  job = db.prepare("SELECT * FROM background_jobs WHERE id = ?")
    .get(createdJob.id);
  assert.equal(job.status, "pending");
  assert.equal(job.attempts, 2);
  assert.equal(job.next_attempt_at, 200300);
  assert.equal(await worker.runOnce(), false);

  now = 200300;
  assert.equal(await worker.runOnce(), true);
  job = db.prepare("SELECT * FROM background_jobs WHERE id = ?")
    .get(createdJob.id);
  assert.equal(job.status, "completed");
  assert.equal(job.attempts, 3);
  assert.equal(calls, 3);
});

test("permanent failure is sanitized and emits a safe warning", async () => {
  let now = 300000;
  const warnings = [];
  const queue = new JobQueue(db, {
    now: () => now,
    maxAttempts: 2,
    baseDelayMs: 50
  });
  const submissionId = createSubmission("Final Failure Lead");
  const createdJob = jobFor(submissionId, queue, "203.0.113.19");
  const worker = new JobWorker({
    queue,
    logger: { warn: (message) => warnings.push(message) },
    geolocate: async () => {
      throw new Error(
        "password-token@example.com 203.0.113.19 private provider response"
      );
    }
  });

  await worker.runOnce();
  now += 50;
  await worker.runOnce();

  const job = db.prepare("SELECT * FROM background_jobs WHERE id = ?")
    .get(createdJob.id);
  assert.equal(job.status, "failed");
  assert.equal(job.attempts, 2);
  assert.equal(job.last_error, "JOB_PROCESSING_FAILED");
  assert.equal(job.payload_json, "{}");
  assert.ok(job.completed_at);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /type=geolocate_submission/);
  assert.match(warnings[0], /attempts=2/);
  assert.equal(warnings[0].includes("password-token"), false);
  assert.equal(warnings[0].includes("203.0.113.19"), false);
  assert.equal(warnings[0].includes("private provider response"), false);
  assert.equal(db.prepare("SELECT geo_status FROM submissions WHERE id = ?")
    .get(submissionId).geo_status, "not_processed");
});

test("expired processing jobs recover after a worker restart", async () => {
  let now = 400000;
  const queue = new JobQueue(db, {
    now: () => now,
    leaseMs: 1000,
    baseDelayMs: 20
  });
  const submissionId = createSubmission("Restart Lead");
  const createdJob = jobFor(submissionId, queue);
  db.prepare(`
    UPDATE background_jobs
    SET status = 'processing', attempts = 1, locked_at = ?, processing_token = ?
    WHERE id = ?
  `).run(now - 1001, "previous-worker-token", createdJob.id);

  let recovered = false;
  const workerAfterRestart = new JobWorker({
    queue,
    geolocate: async () => {
      recovered = true;
      return successfulLocation();
    }
  });
  assert.equal(await workerAfterRestart.runOnce(), true);
  assert.equal(recovered, true);
  const job = db.prepare("SELECT status, attempts FROM background_jobs WHERE id = ?")
    .get(createdJob.id);
  assert.deepEqual(job, { status: "completed", attempts: 2 });
});

test("competing workers cannot process the same job at once", async () => {
  const queue = new JobQueue(db);
  const submissionId = createSubmission("Contended Lead");
  const createdJob = jobFor(submissionId, queue);
  let calls = 0;
  let release;
  let started;
  const startedPromise = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const geolocate = async () => {
    calls += 1;
    started();
    await gate;
    return successfulLocation();
  };
  const workerA = new JobWorker({ queue, geolocate });
  const workerB = new JobWorker({ queue, geolocate });

  const first = workerA.runOnce();
  await startedPromise;
  assert.equal(await workerB.runOnce(), false);
  release();
  assert.equal(await first, true);
  assert.equal(calls, 1);
  assert.equal(db.prepare("SELECT status FROM background_jobs WHERE id = ?")
    .get(createdJob.id).status, "completed");
});

test("submission webhook delivery is signed and idempotent across retries", async () => {
  let now = 500000;
  let deliveryAttempts = 0;
  const requests = [];
  const warnings = [];
  const secret = "test-webhook-secret-that-is-at-least-32-bytes";
  const service = createSubmissionWebhookService({
    url: "https://hooks.example.test/flyrank",
    secret,
    timeoutMs: 1000,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      deliveryAttempts += 1;
      return { ok: deliveryAttempts > 1 };
    }
  });
  const queue = new JobQueue(db, {
    now: () => now,
    maxAttempts: 2,
    baseDelayMs: 25
  });
  const submissionId = createSubmission("Webhook Lead");
  const firstJobId = queue.enqueueSubmissionWebhook({ submissionId });
  const duplicateJobId = queue.enqueueSubmissionWebhook({ submissionId });
  assert.equal(duplicateJobId, firstJobId);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM background_jobs
    WHERE type = 'submission_webhook' AND submission_id = ?
  `).get(submissionId).count, 1);

  const worker = new JobWorker({
    queue,
    logger: { warn: (message) => warnings.push(message) },
    deliverWebhook: (job) => service.deliver({
      id: `submission.${job.submission_id}`,
      type: "submission.created",
      data: { submissionId: job.submission_id }
    }, job.submission_id)
  });

  await worker.runOnce();
  let job = db.prepare("SELECT * FROM background_jobs WHERE id = ?")
    .get(firstJobId);
  assert.equal(job.status, "pending");
  assert.equal(job.last_error, "WEBHOOK_DELIVERY_FAILED");
  assert.equal(job.next_attempt_at, 500025);
  assert.equal(job.payload_json, "{}");

  now += 25;
  await worker.runOnce();
  job = db.prepare("SELECT * FROM background_jobs WHERE id = ?")
    .get(firstJobId);
  assert.equal(job.status, "completed");
  assert.equal(job.attempts, 2);
  assert.equal(job.payload_json, "{}");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://hooks.example.test/flyrank");
  assert.equal(
    requests[0].options.headers["Idempotency-Key"],
    `flyrank-submission-${submissionId}`
  );
  assert.equal(
    requests[1].options.headers["Idempotency-Key"],
    requests[0].options.headers["Idempotency-Key"]
  );
  assert.match(
    requests[0].options.headers["X-FlyRank-Signature"],
    /^sha256=[a-f0-9]{64}$/
  );
  assert.equal(
    requests[0].options.headers["X-FlyRank-Signature"],
    `sha256=${createHmac("sha256", secret)
      .update(requests[0].options.body)
      .digest("hex")}`
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE id = ?")
      .get(submissionId).count,
    1
  );
  assert.deepEqual(warnings, []);
});

test("permanent webhook failure keeps the lead and logs no personal data", async () => {
  const warnings = [];
  const queue = new JobQueue(db, {
    maxAttempts: 1
  });
  const submissionId = createSubmission("Webhook failure private lead");
  const jobId = queue.enqueueSubmissionWebhook({ submissionId });
  const worker = new JobWorker({
    queue,
    logger: { warn: (message) => warnings.push(message) },
    deliverWebhook: async () => {
      throw new Error(
        "webhook response contains private@example.com and secret token"
      );
    }
  });

  await worker.runOnce();
  const job = db.prepare("SELECT * FROM background_jobs WHERE id = ?")
    .get(jobId);
  assert.equal(job.status, "failed");
  assert.equal(job.last_error, "WEBHOOK_DELIVERY_FAILED");
  assert.equal(job.payload_json, "{}");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /type=submission_webhook/);
  assert.equal(warnings[0].includes("private@example.com"), false);
  assert.equal(warnings[0].includes("secret token"), false);
  assert.equal(db.prepare(`
    SELECT email, message FROM submissions WHERE id = ?
  `).get(submissionId).email, "worker@example.com");
});

test("webhook configuration rejects unsafe destinations and weak secrets", () => {
  assert.throws(
    () => createSubmissionWebhookService({ url: "http://example.test/hook" }),
    /must use HTTPS/
  );
  assert.throws(
    () => createSubmissionWebhookService({
      url: "https://hooks.example.test",
      secret: "too-short"
    }),
    /at least 32 bytes/
  );
  assert.throws(
    () => createSubmissionWebhookService({
      url: "https://hooks.example.test"
    }),
    /is required/
  );
  assert.throws(
    () => createSubmissionWebhookService({
      url: "https://user:password@hooks.example.test"
    }),
    /must use HTTPS/
  );
  assert.equal(
    createSubmissionWebhookService({ url: "" }).enabled,
    false
  );
});

test("webhook requests are aborted after their configured timeout", async () => {
  const service = createSubmissionWebhookService({
    url: "https://hooks.example.test",
    secret: "test-webhook-secret-that-is-at-least-32-bytes",
    timeoutMs: 5,
    fetchImpl: async (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });

  await assert.rejects(
    service.deliver({ type: "submission.created" }, 1),
    { name: "AbortError" }
  );
});
