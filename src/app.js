require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { createHash, randomBytes } = require("node:crypto");
const { z } = require("zod");
const path = require("node:path");
const db = require("./db");
const geolocation = require("./services/geolocation");
const { JobQueue } = require("./services/job-queue");
const { JobWorker } = require("./services/job-worker");
const {
  createSubmissionWebhookService
} = require("./services/submission-webhook");

const app = express();
app.locals.geolocate = geolocation.lookup;
const jobQueue = new JobQueue(db, {
  maxAttempts: process.env.BACKGROUND_JOB_MAX_ATTEMPTS,
  baseDelayMs: process.env.BACKGROUND_JOB_RETRY_BASE_MS,
  maxDelayMs: process.env.BACKGROUND_JOB_RETRY_MAX_MS,
  leaseMs: process.env.BACKGROUND_JOB_LEASE_MS
});
const submissionWebhook = createSubmissionWebhookService();
app.locals.jobQueue = jobQueue;
app.locals.enqueueGeolocation = (job) => jobQueue.enqueueGeolocation(job);
app.locals.submissionWebhookEnabled = submissionWebhook.enabled;
app.locals.enqueueSubmissionWebhook = (job) =>
  jobQueue.enqueueSubmissionWebhook(job);
app.locals.deliverSubmissionWebhook = async (job) => {
  const submission = db.prepare(`
    SELECT submissions.id, submissions.name, submissions.email,
           submissions.message, submissions.created_at,
           widgets.id AS widget_id, widgets.name AS widget_name
    FROM submissions
    JOIN widgets ON widgets.id = submissions.widget_id
    WHERE submissions.id = ?
  `).get(job.submission_id);
  if (!submission) throw new Error("WEBHOOK_DELIVERY_FAILED");

  return submissionWebhook.deliver({
    id: `submission.${submission.id}`,
    type: "submission.created",
    createdAt: submission.created_at,
    data: {
      widget: {
        id: submission.widget_id,
        name: submission.widget_name
      },
      submission: {
        id: submission.id,
        name: submission.name,
        email: submission.email,
        message: submission.message,
        createdAt: submission.created_at
      }
    }
  }, submission.id);
};
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = "flyrank_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

function positiveIntegerSetting(name, defaultValue) {
  const configuredValue = process.env[name];
  if (configuredValue === undefined || configuredValue === "") {
    return defaultValue;
  }

  const value = Number(configuredValue);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

const submissionRateWindowMs = positiveIntegerSetting(
  "WIDGET_SUBMISSION_RATE_WINDOW_MS",
  15 * 60 * 1000
);
const submissionRateLimit = positiveIntegerSetting(
  "WIDGET_SUBMISSION_RATE_LIMIT",
  10
);
const widgetAllowedOrigins = new Set(
  (process.env.WIDGET_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const publicWidgetCors = cors({
  origin(origin, callback) {
    callback(null, !origin || widgetAllowedOrigins.has(origin));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 600,
  optionsSuccessStatus: 204
});

app.use((req, res, next) => {
  const isPublicConfiguration = req.method === "GET"
    && /^\/api\/widgets\/[^/]+\/?$/.test(req.path);
  const isPublicSubmission = req.path.match(/^\/api\/widgets\/[^/]+\/submissions\/?$/)
    && req.method === "POST";
  const isPublicPreflight = req.method === "OPTIONS"
    && /^\/api\/widgets\/[^/]+(?:\/submissions)?\/?$/.test(req.path);

  if (isPublicConfiguration || isPublicSubmission || isPublicPreflight) {
    return publicWidgetCors(req, res, next);
  }
  next();
});

app.use(
  "/api/",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler(req, res) {
      res.status(429).json({
        error: "Too many API requests. Please try again later.",
        code: "API_RATE_LIMIT_EXCEEDED"
      });
    }
  })
);

app.use(express.json({ limit: "10kb" }));

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

const widgetSubmissionRateLimit = rateLimit({
  windowMs: submissionRateWindowMs,
  limit: submissionRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({
      error: "Too many submission attempts. Please try again later.",
      code: "RATE_LIMIT_EXCEEDED"
    });
  }
});

app.use(express.static(path.join(__dirname, "..", "public"), {
  setHeaders(res, filePath) {
    if (filePath.endsWith(path.join("widget", "v1.js"))) {
      res.setHeader(
        "Cache-Control",
        "public, max-age=31536000, immutable"
      );
    }
  }
}));

const registrationSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string()
    .min(12)
    .max(72)
    .refine(
      (password) => Buffer.byteLength(password, "utf8") <= 72,
      "Password must not exceed 72 bytes."
    )
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string()
    .min(1)
    .max(72)
    .refine(
      (password) => Buffer.byteLength(password, "utf8") <= 72,
      "Password must not exceed 72 bytes."
    )
});

const widgetFields = ["name", "email", "message"];
const widgetSchema = z.object({
  name: z.string().trim().min(2).max(100),
  title: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  buttonText: z.string().trim().min(2).max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fields: z.array(z.enum(widgetFields)).min(1).max(widgetFields.length)
    .refine((fields) => new Set(fields).size === fields.length).optional(),
  successMessage: z.string().trim().min(2).max(200).optional()
}).strict();

const widgetUpdateSchema = widgetSchema.partial()
  .refine((widget) => Object.keys(widget).length > 0);

function widgetSettings(data, current = {}) {
  return {
    name: data.name ?? current.name,
    title: data.title ?? current.title ?? data.name ?? current.name,
    description: data.description ?? current.description ?? "",
    buttonText: data.buttonText ?? current.button_text ?? "Send",
    color: data.color ?? current.color ?? "#3158d4",
    fields: data.fields ?? current.fields ?? widgetFields,
    successMessage: data.successMessage
      ?? current.success_message
      ?? "Your message has been received."
  };
}

const submissionSchema = z.object({
  name: z.string().max(100).trim().min(2),
  email: z.string().max(254).trim().email(),
  message: z.string().max(2000).trim().default(""),
  website: z.string().max(200).optional().default("")
}).strict();

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function requestSessionToken(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const cookie = cookieHeader
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`));

  return cookie ? cookie.slice(SESSION_COOKIE.length + 1) : null;
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}

function revokeRequestSession(req) {
  const token = requestSessionToken(req);
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(tokenHash(token));
  }
}

function createSession(userId, res) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_DURATION_MS;

  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(tokenHash(token), userId, expiresAt);

  db.prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .run(Date.now());

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_MS
  });
  res.set("Cache-Control", "no-store");
}

function requireAuth(req, res, next) {
  const token = requestSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: "Authentication is required." });
  }

  const hash = tokenHash(token);
  const session = db.prepare(`
    SELECT users.id, users.email, sessions.expires_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
  `).get(hash);

  if (!session || session.expires_at <= Date.now()) {
    if (session) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
    }
    clearSessionCookie(res);
    return res.status(401).json({ error: "Authentication is required." });
  }

  req.user = { id: session.id, email: session.email };
  res.set("Cache-Control", "no-store");
  next();
}

function validationError(res, result) {
  return res.status(400).json({
    error: "The provided data is invalid.",
    details: result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message
    }))
  });
}

function parseWidgetId(value) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function serializeWidget(widget) {
  const fields = JSON.parse(widget.fields_json || '["name","email","message"]');
  return {
    id: widget.id,
    name: widget.name,
    publicKey: widget.public_key,
    createdAt: widget.created_at,
    title: widget.title || widget.name,
    description: widget.description || "",
    buttonText: widget.button_text || "Send",
    color: widget.color || "#3158d4",
    fields,
    successMessage: widget.success_message
      || "Your message has been received."
  };
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "flyrank-capstone-widget-platform"
  });
});

app.post("/api/auth/register", authRateLimit, async (req, res) => {
  const result = registrationSchema.safeParse(req.body);
  if (!result.success) return validationError(res, result);

  const email = result.data.email.toLowerCase();
  const passwordHash = await bcrypt.hash(result.data.password, BCRYPT_ROUNDS);
  const insert = db.prepare(`
    INSERT INTO users (email, password_hash)
    VALUES (?, ?)
    ON CONFLICT(email) DO NOTHING
  `).run(email, passwordHash);

  if (insert.changes === 0) {
    return res.status(409).json({ error: "This email address is already registered." });
  }

  const user = { id: Number(insert.lastInsertRowid), email };
  createSession(user.id, res);
  res.status(201).json({ user });
});

app.post("/api/auth/login", authRateLimit, async (req, res) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) return validationError(res, result);

  const email = result.data.email.toLowerCase();
  const user = db.prepare(`
    SELECT id, email, password_hash FROM users WHERE email = ?
  `).get(email);

  const passwordMatches = user && user.password_hash
    ? await bcrypt.compare(result.data.password, user.password_hash)
    : false;

  if (!passwordMatches) {
    return res.status(401).json({ error: "The email address or password is incorrect." });
  }

  revokeRequestSession(req);
  createSession(user.id, res);
  res.json({ user: { id: user.id, email: user.email } });
});

app.post("/api/auth/logout", (req, res) => {
  revokeRequestSession(req);
  clearSessionCookie(res);
  res.set("Cache-Control", "no-store");
  res.status(204).end();
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.use("/api/owner", requireAuth);

app.get("/api/owner/widgets", (req, res) => {
  const widgets = db.prepare(`
    SELECT id, name, public_key, created_at, title, description, button_text,
           color, fields_json, success_message
    FROM widgets
    WHERE owner_id = ?
    ORDER BY id DESC
  `).all(req.user.id);

  res.json({ widgets: widgets.map(serializeWidget) });
});

app.post("/api/owner/widgets", (req, res) => {
  const result = widgetSchema.safeParse(req.body);
  if (!result.success) return validationError(res, result);

  const publicKey = randomBytes(24).toString("base64url");
  const settings = widgetSettings(result.data);
  const insert = db.prepare(`
    INSERT INTO widgets (
      name, public_key, owner_id, title, description, button_text, color,
      fields_json, success_message
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    settings.name,
    publicKey,
    req.user.id,
    settings.title,
    settings.description,
    settings.buttonText,
    settings.color,
    JSON.stringify(settings.fields),
    settings.successMessage
  );
  const widget = db.prepare(`
    SELECT id, name, public_key, created_at, title, description, button_text,
           color, fields_json, success_message
    FROM widgets WHERE id = ?
  `).get(insert.lastInsertRowid);

  res.status(201).json({ widget: serializeWidget(widget) });
});

app.get("/api/owner/widgets/:widgetId", (req, res) => {
  const widgetId = parseWidgetId(req.params.widgetId);
  const widget = widgetId && db.prepare(`
    SELECT id, name, public_key, created_at, title, description, button_text,
           color, fields_json, success_message
    FROM widgets
    WHERE id = ? AND owner_id = ?
  `).get(widgetId, req.user.id);

  if (!widget) return res.status(404).json({ error: "Widget not found." });
  res.json({ widget: serializeWidget(widget) });
});

function updateWidget(req, res) {
  const widgetId = parseWidgetId(req.params.widgetId);
  if (!widgetId) {
    return res.status(404).json({ error: "Widget not found." });
  }

  const result = widgetUpdateSchema.safeParse(req.body);
  if (!result.success) return validationError(res, result);

  const current = db.prepare(`
    SELECT id, name, title, description, button_text, color, fields_json,
           success_message
    FROM widgets WHERE id = ? AND owner_id = ?
  `).get(widgetId, req.user.id);
  if (!current) {
    return res.status(404).json({ error: "Widget not found." });
  }
  const settings = widgetSettings({
    ...result.data,
    fields: result.data.fields
  }, {
    ...current,
    fields: JSON.parse(current.fields_json)
  });

  const update = db.prepare(`
    UPDATE widgets
    SET name = ?, title = ?, description = ?, button_text = ?, color = ?,
        fields_json = ?, success_message = ?
    WHERE id = ? AND owner_id = ?
  `).run(
    settings.name,
    settings.title,
    settings.description,
    settings.buttonText,
    settings.color,
    JSON.stringify(settings.fields),
    settings.successMessage,
    widgetId,
    req.user.id
  );

  if (update.changes === 0) {
    return res.status(404).json({ error: "Widget not found." });
  }

  const widget = db.prepare(`
    SELECT id, name, public_key, created_at, title, description, button_text,
           color, fields_json, success_message
    FROM widgets WHERE id = ?
  `).get(widgetId);
  res.json({ widget: serializeWidget(widget) });
}

app.route("/api/owner/widgets/:widgetId")
  .put(updateWidget)
  .patch(updateWidget);

app.delete("/api/owner/widgets/:widgetId", (req, res) => {
  const widgetId = parseWidgetId(req.params.widgetId);
  if (!widgetId) {
    return res.status(404).json({ error: "Widget not found." });
  }

  const deleteWidget = db.transaction(() => {
    const widget = db.prepare(`
      SELECT id FROM widgets WHERE id = ? AND owner_id = ?
    `).get(widgetId, req.user.id);
    if (!widget) return false;

    db.prepare("DELETE FROM submissions WHERE widget_id = ?").run(widgetId);
    db.prepare("DELETE FROM widgets WHERE id = ? AND owner_id = ?")
      .run(widgetId, req.user.id);
    return true;
  });

  if (!deleteWidget()) {
    return res.status(404).json({ error: "Widget not found." });
  }
  res.status(204).end();
});

app.get("/api/owner/widgets/:widgetId/submissions", (req, res) => {
  const widgetId = parseWidgetId(req.params.widgetId);
  const widget = widgetId && db.prepare(`
    SELECT id FROM widgets WHERE id = ? AND owner_id = ?
  `).get(widgetId, req.user.id);

  if (!widget) return res.status(404).json({ error: "Widget not found." });

  const limitResult = z.coerce.number().int().min(1).max(100)
    .safeParse(req.query.limit ?? 100);
  if (!limitResult.success) {
    return res.status(400).json({ error: "Limit must be between 1 and 100." });
  }

  const submissions = db.prepare(`
    SELECT id, name, email, message, created_at,
           geo_country, geo_region, geo_city, geo_latitude, geo_longitude,
           geo_provider, geo_status
    FROM submissions
    WHERE widget_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(widgetId, limitResult.data);

  res.json({ submissions });
});

app.get("/api/owner/widgets/:widgetId/stats", (req, res) => {
  const widgetId = parseWidgetId(req.params.widgetId);
  const widget = widgetId && db.prepare(`
    SELECT id FROM widgets WHERE id = ? AND owner_id = ?
  `).get(widgetId, req.user.id);

  if (!widget) return res.status(404).json({ error: "Widget not found." });

  const stats = db.prepare(`
    SELECT COUNT(*) AS total FROM submissions WHERE widget_id = ?
  `).get(widgetId);

  res.json({
    widgetId,
    totalSubmissions: stats.total
  });
});

app.get("/api/owner/dashboard", (req, res) => {
  const requestedWidgetId = req.query.widgetId === undefined
    ? null
    : parseWidgetId(String(req.query.widgetId));

  if (req.query.widgetId !== undefined && !requestedWidgetId) {
    return res.status(400).json({ error: "The widget ID is invalid." });
  }

  if (requestedWidgetId) {
    const ownedWidget = db.prepare(`
      SELECT id FROM widgets WHERE id = ? AND owner_id = ?
    `).get(requestedWidgetId, req.user.id);

    if (!ownedWidget) {
      return res.status(404).json({ error: "Widget not found." });
    }
  }

  const widgets = db.prepare(`
    SELECT widgets.id, widgets.name, widgets.public_key, widgets.created_at,
           widgets.title, widgets.description, widgets.button_text,
           widgets.color, widgets.fields_json, widgets.success_message,
           COUNT(submissions.id) AS submission_count
    FROM widgets
    LEFT JOIN submissions ON submissions.widget_id = widgets.id
    WHERE widgets.owner_id = ?
    GROUP BY widgets.id
    ORDER BY widgets.id DESC
  `).all(req.user.id);

  const totalSubmissions = db.prepare(`
    SELECT COUNT(*) AS total
    FROM submissions
    JOIN widgets ON widgets.id = submissions.widget_id
    WHERE widgets.owner_id = ?
  `).get(req.user.id).total;

  const submissionCount = requestedWidgetId
    ? db.prepare(`
      SELECT COUNT(*) AS total
      FROM submissions
      JOIN widgets ON widgets.id = submissions.widget_id
      WHERE widgets.owner_id = ? AND widgets.id = ?
    `).get(req.user.id, requestedWidgetId).total
    : totalSubmissions;

  const submissions = db.prepare(`
    SELECT submissions.id, submissions.name, submissions.email,
           submissions.message, submissions.created_at,
           submissions.geo_country, submissions.geo_region,
           submissions.geo_city, submissions.geo_latitude,
           submissions.geo_longitude, submissions.geo_provider,
           submissions.geo_status,
           widgets.id AS widget_id, widgets.name AS widget_name,
           widgets.public_key
    FROM submissions
    JOIN widgets ON widgets.id = submissions.widget_id
    WHERE widgets.owner_id = ?
      AND (? IS NULL OR widgets.id = ?)
    ORDER BY submissions.id DESC
    LIMIT 100
  `).all(req.user.id, requestedWidgetId, requestedWidgetId);
  const backgroundJobs = jobQueue.statusCountsForOwner(
    req.user.id,
    requestedWidgetId
  );

  res.json({
    widgetCount: widgets.length,
    totalSubmissions,
    submissionCount,
    hasMore: submissionCount > submissions.length,
    backgroundJobs,
    widgets: widgets.map((widget) => ({
      ...serializeWidget(widget),
      submissionCount: widget.submission_count
    })),
    submissions: submissions.map((submission) => ({
      id: submission.id,
      name: submission.name,
      email: submission.email,
      message: submission.message,
      createdAt: submission.created_at,
      geolocation: {
        country: submission.geo_country,
        region: submission.geo_region,
        city: submission.geo_city,
        latitude: submission.geo_latitude,
        longitude: submission.geo_longitude,
        provider: submission.geo_provider,
        status: submission.geo_status
      },
      widgetId: submission.widget_id,
      widgetName: submission.widget_name,
      publicKey: submission.public_key
    }))
  });
});

app.get("/api/widgets/:publicKey", (req, res) => {
  const widget = db.prepare(`
    SELECT id, name, public_key, title, description, button_text, color,
           fields_json, success_message
    FROM widgets
    WHERE public_key = ?
  `).get(req.params.publicKey);

  if (!widget) {
    res.set("Cache-Control", "no-store");
    return res.status(404).json({
      error: "Widget not found."
    });
  }

  res.set("Cache-Control", "public, max-age=30, must-revalidate");
  res.json({
    name: widget.name,
    publicKey: widget.public_key,
    title: widget.title || widget.name,
    description: widget.description || "",
    buttonText: widget.button_text || "Send",
    color: widget.color || "#3158d4",
    fields: JSON.parse(widget.fields_json || '["name","email","message"]'),
    successMessage: widget.success_message
      || "Your message has been received."
  });
});

app.post(
  "/api/widgets/:publicKey/submissions",
  widgetSubmissionRateLimit,
  (req, res) => {
    const website = req.body?.website;
    const honeypotFilled = typeof website === "string"
      ? website.length > 0
      : website !== undefined && website !== null;

    if (honeypotFilled) {
      return res.status(200).json({
        success: true,
        message: "Your message has been received."
      });
    }

    const widget = db.prepare(`
      SELECT id, fields_json FROM widgets WHERE public_key = ?
    `).get(req.params.publicKey);

    if (!widget) {
      res.set("Cache-Control", "no-store");
      return res.status(404).json({
        error: "Widget not found."
      });
    }

    const configuredFields = JSON.parse(
      widget.fields_json || '["name","email","message"]'
    );
    const configuredFieldSet = new Set(configuredFields);
    const result = z.object({
      name: configuredFieldSet.has("name")
        ? submissionSchema.shape.name
        : z.string().optional().default(""),
      email: configuredFieldSet.has("email")
        ? submissionSchema.shape.email
        : z.string().optional().default(""),
      message: configuredFieldSet.has("message")
        ? submissionSchema.shape.message
        : z.string().optional().default(""),
      website: submissionSchema.shape.website
    }).strict().safeParse(req.body);
    if (!result.success) return validationError(res, result);

    const { name, email, message } = result.data;

    const submission = db.prepare(`
      INSERT INTO submissions (widget_id, name, email, message)
      VALUES (?, ?, ?, ?)
    `).run(widget.id, name, email, message);

    try {
      app.locals.enqueueGeolocation({
        submissionId: Number(submission.lastInsertRowid),
        ip: req.ip
      });
    } catch {
      console.warn(
        "Geolocation job could not be queued; submission was saved."
      );
    }

    if (app.locals.submissionWebhookEnabled) {
      try {
        app.locals.enqueueSubmissionWebhook({
          submissionId: Number(submission.lastInsertRowid)
        });
      } catch {
        console.warn(
          "Submission webhook job could not be queued; submission was saved."
        );
      }
    }

    res.status(201).json({
      success: true,
      submissionId: submission.lastInsertRowid
    });
  }
);

app.get("/api/widgets/:publicKey/stats", requireAuth, (req, res) => {
  const widget = db.prepare(`
    SELECT id FROM widgets
    WHERE public_key = ? AND owner_id = ?
  `).get(req.params.publicKey, req.user.id);

  if (!widget) {
    return res.status(404).json({ error: "Widget not found." });
  }

  const stats = db.prepare(`
    SELECT COUNT(*) AS total FROM submissions WHERE widget_id = ?
  `).get(widget.id);

  res.json({
    widgetId: widget.id,
    totalSubmissions: stats.total
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      error: "The request is too large.",
      code: "PAYLOAD_TOO_LARGE"
    });
  }

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "The request body contains invalid JSON.",
      code: "INVALID_JSON"
    });
  }

  console.error("Unhandled request error:", error);
  res.status(500).json({
    error: "An unexpected server error occurred.",
    code: "INTERNAL_SERVER_ERROR"
  });
});

if (require.main === module) {
  const worker = new JobWorker({
    queue: jobQueue,
    geolocate: (ip) => app.locals.geolocate(ip),
    deliverWebhook: (job) => app.locals.deliverSubmissionWebhook(job),
    pollIntervalMs: process.env.BACKGROUND_JOB_POLL_INTERVAL_MS
  });
  worker.start();
  app.listen(PORT, () => {
    console.log(`Server radi na http://localhost:${PORT}`);
  });
}

module.exports = app;
