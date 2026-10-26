const { randomUUID } = require("node:crypto");

const GEOLOCATION_JOB_TYPE = "geolocate_submission";
const SUBMISSION_WEBHOOK_JOB_TYPE = "submission_webhook";
const JOB_STATUSES = ["pending", "processing", "completed", "failed"];

class JobQueue {
  constructor(db, options = {}) {
    this.db = db;
    this.now = options.now || Date.now;
    this.maxAttempts = positiveInteger(options.maxAttempts, 5);
    this.baseDelayMs = positiveInteger(options.baseDelayMs, 1000);
    this.maxDelayMs = positiveInteger(options.maxDelayMs, 3600000);
    this.leaseMs = positiveInteger(options.leaseMs, 30000);
  }

  enqueueGeolocation({ submissionId, ip }) {
    if (!Number.isSafeInteger(submissionId) || submissionId < 1) {
      throw new TypeError("A valid submission ID is required.");
    }
    if (typeof ip !== "string" || ip.length === 0) {
      throw new TypeError("A request IP is required.");
    }

    const result = this.db.prepare(`
      INSERT INTO background_jobs (type, payload_json, submission_id, next_attempt_at)
      VALUES (?, ?, ?, ?)
    `).run(
      GEOLOCATION_JOB_TYPE,
      JSON.stringify({ ip }),
      submissionId,
      this.now()
    );
    return Number(result.lastInsertRowid);
  }

  enqueueSubmissionWebhook({ submissionId }) {
    if (!Number.isSafeInteger(submissionId) || submissionId < 1) {
      throw new TypeError("A valid submission ID is required.");
    }

    const result = this.db.prepare(`
      INSERT OR IGNORE INTO background_jobs (
        type, payload_json, submission_id, next_attempt_at
      )
      VALUES (?, '{}', ?, ?)
    `).run(SUBMISSION_WEBHOOK_JOB_TYPE, submissionId, this.now());
    if (result.changes === 1) return Number(result.lastInsertRowid);

    const existing = this.db.prepare(`
      SELECT id FROM background_jobs
      WHERE type = ? AND submission_id = ?
    `).get(SUBMISSION_WEBHOOK_JOB_TYPE, submissionId);
    if (!existing) {
      throw new Error("Submission webhook job could not be queued.");
    }
    return existing.id;
  }

  claimNext() {
    const now = this.now();
    const processingToken = randomUUID();
    const job = this.db.prepare(`
      UPDATE background_jobs
      SET status = 'processing',
          attempts = attempts + 1,
          locked_at = ?,
          processing_token = ?
      WHERE id = (
        SELECT id
        FROM background_jobs
        WHERE status = 'pending' AND next_attempt_at <= ?
        ORDER BY next_attempt_at, id
        LIMIT 1
      )
        AND status = 'pending'
      RETURNING id, type, payload_json, submission_id, attempts,
                processing_token
    `).get(now, processingToken, now);

    if (!job) return null;
    return job;
  }

  extendLease(jobId, processingToken) {
    return this.db.prepare(`
      UPDATE background_jobs
      SET locked_at = ?
      WHERE id = ? AND status = 'processing' AND processing_token = ?
    `).run(this.now(), jobId, processingToken).changes === 1;
  }

  completeGeolocation(job, location) {
    if (!location || location.status === "unavailable") {
      throw new TypeError("A successful or skipped geolocation is required.");
    }

    const now = new Date(this.now()).toISOString();
    const complete = this.db.transaction(() => {
      const jobUpdate = this.db.prepare(`
        UPDATE background_jobs
        SET status = 'completed', payload_json = '{}',
            completed_at = ?, locked_at = NULL, processing_token = NULL,
            last_error = NULL
        WHERE id = ? AND status = 'processing' AND processing_token = ?
      `).run(now, job.id, job.processing_token);
      if (jobUpdate.changes !== 1) return false;

      this.db.prepare(`
        UPDATE submissions
        SET geo_country = ?, geo_region = ?, geo_city = ?,
            geo_latitude = ?, geo_longitude = ?, geo_provider = ?,
            geo_status = ?
        WHERE id = ?
      `).run(
        location.country,
        location.region,
        location.city,
        location.latitude,
        location.longitude,
        location.provider,
        location.status,
        job.submission_id
      );
      return true;
    });

    return complete();
  }

  complete(job) {
    return this.db.prepare(`
      UPDATE background_jobs
      SET status = 'completed', payload_json = '{}',
          completed_at = ?, locked_at = NULL, processing_token = NULL,
          last_error = NULL
      WHERE id = ? AND status = 'processing' AND processing_token = ?
    `).run(
      new Date(this.now()).toISOString(),
      job.id,
      job.processing_token
    ).changes === 1;
  }

  failAttempt(job, errorCode) {
    const failedPermanently = job.attempts >= this.maxAttempts;
    const nextAttemptAt = failedPermanently
      ? null
      : this.now() + Math.min(
        this.maxDelayMs,
        this.baseDelayMs * (2 ** Math.min(job.attempts - 1, 30))
      );
    const completedAt = failedPermanently
      ? new Date(this.now()).toISOString()
      : null;

    const result = this.db.prepare(`
      UPDATE background_jobs
      SET status = ?,
          payload_json = CASE WHEN ? THEN '{}' ELSE payload_json END,
          next_attempt_at = COALESCE(?, next_attempt_at),
          completed_at = ?,
          locked_at = NULL,
          processing_token = NULL,
          last_error = ?
      WHERE id = ? AND status = 'processing' AND processing_token = ?
    `).run(
      failedPermanently ? "failed" : "pending",
      failedPermanently ? 1 : 0,
      nextAttemptAt,
      completedAt,
      safeErrorCode(errorCode),
      job.id,
      job.processing_token
    );

    return {
      updated: result.changes === 1,
      failedPermanently,
      nextAttemptAt
    };
  }

  recoverExpiredProcessing() {
    const now = this.now();
    const recover = this.db.prepare(`
      UPDATE background_jobs
      SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END,
          payload_json = CASE WHEN attempts >= ? THEN '{}' ELSE payload_json END,
          next_attempt_at = CASE WHEN attempts >= ? THEN next_attempt_at ELSE ? END,
          completed_at = CASE WHEN attempts >= ? THEN ? ELSE NULL END,
          locked_at = NULL,
          processing_token = NULL,
          last_error = 'WORKER_LEASE_EXPIRED'
      WHERE status = 'processing' AND locked_at <= ?
      RETURNING status
    `).all(
      this.maxAttempts,
      this.maxAttempts,
      this.maxAttempts,
      now,
      this.maxAttempts,
      new Date(now).toISOString(),
      now - this.leaseMs
    );
    return {
      recovered: recover.length,
      permanentlyFailed: recover.filter((job) => job.status === "failed").length
    };
  }

  statusCountsForOwner(ownerId, widgetId = null) {
    const rows = this.db.prepare(`
      SELECT jobs.status, COUNT(*) AS count
      FROM background_jobs AS jobs
      JOIN submissions ON submissions.id = jobs.submission_id
      JOIN widgets ON widgets.id = submissions.widget_id
      WHERE widgets.owner_id = ?
        AND (? IS NULL OR widgets.id = ?)
      GROUP BY jobs.status
    `).all(ownerId, widgetId, widgetId);

    const counts = Object.fromEntries(
      JOB_STATUSES.map((status) => [status, 0])
    );
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

}

function positiveInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("Background job settings must be positive integers.");
  }
  return parsed;
}

function safeErrorCode(value) {
  return [
    "GEOLOCATION_UNAVAILABLE",
    "WEBHOOK_DELIVERY_FAILED"
  ].includes(value)
    ? value
    : "JOB_PROCESSING_FAILED";
}

module.exports = {
  GEOLOCATION_JOB_TYPE,
  SUBMISSION_WEBHOOK_JOB_TYPE,
  JobQueue
};
