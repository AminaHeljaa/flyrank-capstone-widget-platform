const { createHmac } = require("node:crypto");

function positiveInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("SUBMISSION_WEBHOOK_TIMEOUT_MS must be a positive integer.");
  }
  return parsed;
}

function parseWebhookUrl(value) {
  if (value === undefined || value.trim() === "") return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SUBMISSION_WEBHOOK_URL must be a valid HTTPS URL.");
  }

  const localHttpHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && localHttpHosts.has(url.hostname)))
    || url.username
    || url.password
    || url.hash
  ) {
    throw new Error(
      "SUBMISSION_WEBHOOK_URL must use HTTPS, except for local development."
    );
  }

  return url.href;
}

function createSubmissionWebhookService(options = {}) {
  const endpoint = parseWebhookUrl(options.url ?? process.env.SUBMISSION_WEBHOOK_URL ?? "");
  const secret = options.secret ?? process.env.SUBMISSION_WEBHOOK_SECRET ?? "";
  const timeoutMs = positiveInteger(
    options.timeoutMs ?? process.env.SUBMISSION_WEBHOOK_TIMEOUT_MS,
    5000
  );
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (endpoint && !secret) {
    throw new Error(
      "SUBMISSION_WEBHOOK_SECRET is required when a webhook URL is configured."
    );
  }
  if (secret && Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SUBMISSION_WEBHOOK_SECRET must be at least 32 bytes.");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }

  return {
    enabled: endpoint !== null,
    async deliver(event, submissionId) {
      if (!endpoint) {
        throw new Error("WEBHOOK_NOT_CONFIGURED");
      }
      if (!Number.isSafeInteger(submissionId) || submissionId < 1) {
        throw new TypeError("A valid submission ID is required.");
      }

      const body = JSON.stringify(event);
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": `flyrank-submission-${submissionId}`
      };
      if (secret) {
        const signature = createHmac("sha256", secret)
          .update(body)
          .digest("hex");
        headers["X-FlyRank-Signature"] = `sha256=${signature}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body,
          redirect: "error",
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error("WEBHOOK_DELIVERY_FAILED");
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

module.exports = {
  createSubmissionWebhookService,
  parseWebhookUrl
};
