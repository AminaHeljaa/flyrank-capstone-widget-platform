const {
  GEOLOCATION_JOB_TYPE,
  SUBMISSION_WEBHOOK_JOB_TYPE
} = require("./job-queue");

class JobWorker {
  constructor(options) {
    this.queue = options.queue;
    this.geolocate = options.geolocate;
    this.deliverWebhook = options.deliverWebhook;
    this.logger = options.logger || console;
    this.pollIntervalMs = positiveInteger(options.pollIntervalMs, 1000);
    this.leaseHeartbeatMs = Math.max(
      100,
      Math.floor(this.queue.leaseMs / 3)
    );
    this.running = false;
    this.inFlight = false;
    this.timer = null;
  }

  async runOnce() {
    if (this.inFlight) return false;
    this.inFlight = true;
    try {
      this.recoverExpiredJobs();
      const job = this.queue.claimNext();
      if (!job) return false;
      await this.process(job);
      return true;
    } finally {
      this.inFlight = false;
    }
  }

  async process(job) {
    const heartbeat = setInterval(() => {
      this.queue.extendLease(job.id, job.processing_token);
    }, this.leaseHeartbeatMs);
    if (typeof heartbeat.unref === "function") heartbeat.unref();

    try {
      if (job.type === SUBMISSION_WEBHOOK_JOB_TYPE) {
        if (typeof this.deliverWebhook !== "function") {
          throw new Error("WEBHOOK_DELIVERY_FAILED");
        }
        await this.deliverWebhook(job);
        this.queue.complete(job);
        return;
      }

      if (job.type !== GEOLOCATION_JOB_TYPE) {
        throw new Error("UNSUPPORTED_JOB_TYPE");
      }

      const payload = JSON.parse(job.payload_json);
      if (typeof payload.ip !== "string") throw new Error("INVALID_JOB_PAYLOAD");
      const location = await this.geolocate(payload.ip);
      if (!location || location.status === "unavailable") {
        throw new Error("GEOLOCATION_UNAVAILABLE");
      }
      if (location.status !== "success" && location.status !== "skipped") {
        throw new Error("INVALID_GEOLOCATION_RESULT");
      }

      this.queue.completeGeolocation(job, location);
    } catch (error) {
      const errorCode = job.type === SUBMISSION_WEBHOOK_JOB_TYPE
        ? "WEBHOOK_DELIVERY_FAILED"
        : error?.message === "GEOLOCATION_UNAVAILABLE"
          ? "GEOLOCATION_UNAVAILABLE"
          : "JOB_PROCESSING_FAILED";
      const result = this.queue.failAttempt(job, errorCode);
      if (result.updated && result.failedPermanently) {
        this.logger.warn(
          `Background job failed permanently (type=${job.type}, jobId=${job.id}, attempts=${job.attempts}).`
        );
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.recoverExpiredJobs();
    this.schedule(0);
  }

  recoverExpiredJobs() {
    const result = this.queue.recoverExpiredProcessing();
    if (result.permanentlyFailed > 0) {
      this.logger.warn(
        `Background jobs failed after worker lease expiry (count=${result.permanentlyFailed}).`
      );
    }
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(delay = this.pollIntervalMs) {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      try {
        await this.runOnce();
      } catch {
        this.logger.warn("Background worker iteration failed.");
      } finally {
        this.schedule();
      }
    }, delay);
    if (typeof this.timer.unref === "function") this.timer.unref();
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

module.exports = { JobWorker };
