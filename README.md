# FlyRank Capstone Widget Platform

An embeddable form and lead-capture platform. The backend uses Node.js,
Express, SQLite, Zod, and `bcryptjs`; tests use the built-in Node.js test
runner.

## Getting started

Node.js 20+ and npm are required.

```sh
npm install
```

Optionally, copy `.env.example` to `.env` and adjust `PORT` or
`DATABASE_PATH`. Start the application:

```sh
npm start
```

Development mode with automatic restarts:

```sh
npm run dev
```

## Interface and manual checks

FlyRank uses a shared design system without a frontend framework or additional
runtime dependencies. The home page (`/`) introduces the product and includes
a live demo embed; `/dashboard.html` provides sign-in, registration, widget
and submission management, and background-job status; `/embed-demo.html`
demonstrates the same versioned widget script on a separate test page. Embed
styles are isolated in Shadow DOM so they do not inherit the host page's CSS.

For a quick browser check, run `npm start`, visit `/`, then open
`/dashboard.html` and sign in or register. Create a widget in the dashboard,
copy its embed code, and check the code preview, counts, table/empty state, and
the copy button's confirmation message. Open `/embed-demo.html` to check the
external embed example. To test actual cross-origin CORS, serve `public/` from
a different origin and add its exact origin to `WIDGET_ALLOWED_ORIGINS`; the
local URL in the page is only a development example.

By default, the application uses `widget-platform.db` in the project root.
The existing database is not deleted: on startup, user and session tables are
added, and existing widgets are assigned the system owner
`demo-owner@system.invalid`. This system account has no login password. Always
make your own copy of the SQLite database before manually experimenting with
migrations or data changes.

## Authentication

Registration and sign-in use an email address and a password of at least 12
characters (up to 72 UTF-8 bytes). Passwords are stored as bcrypt hashes.
Successful registration or sign-in sets a random, opaque session token in an
`HttpOnly`, `SameSite=Lax` cookie; only the token's SHA-256 hash is stored in
the database. Sessions last seven days. The cookie is marked `Secure` when
`NODE_ENV=production`, so production must use HTTPS.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Register: `{ "email": "...", "password": "..." }` |
| `POST` | `/api/auth/login` | Sign in with the same JSON fields |
| `POST` | `/api/auth/logout` | Revoke the current session |
| `GET` | `/api/auth/me` | Get the currently signed-in user |

Registration signs the user in immediately. Sign-in and registration requests
are limited to 10 requests per IP address every 15 minutes.

## Widgets and submissions

All `/api/owner` endpoints require a valid session and return only data for
widgets whose `owner_id` belongs to the signed-in user.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/owner/dashboard` | Widget count, total submissions belonging to the user, widgets, and up to 100 latest submissions; optional `?widgetId=...` filters submissions |
| `GET` | `/api/owner/widgets` | List the user's widgets |
| `POST` | `/api/owner/widgets` | Create a widget and its settings; the server generates its key |
| `GET` | `/api/owner/widgets/:id` | View the user's widget and its settings |
| `PUT` / `PATCH` | `/api/owner/widgets/:id` | Update a widget's name and/or settings |
| `DELETE` | `/api/owner/widgets/:id` | Delete a widget and its submissions |
| `GET` | `/api/owner/widgets/:id/submissions` | Get up to 100 latest submissions belonging to the user; supports `?limit=1..100` |
| `GET` | `/api/owner/widgets/:id/stats` | Get the submission count for the user's widget |

Another user receives the same `404` response for a widget they do not own as
for a nonexistent widget. Submissions cannot be read using a public key. The
legacy `GET /api/widgets/:publicKey/stats` endpoint remains available, but now
requires sign-in and returns data only to the owner.

Owner dashboard responses include each submission's location in the
`geolocation` field (country, region, city, coordinates, provider, and status),
as well as aggregate counts for all background-job types associated with the
current user's widgets.

The public demo form remains available:

- `GET /api/widgets/:publicKey` returns the form's public configuration.
- `POST /api/widgets/:publicKey/submissions` accepts a validated submission
  without requiring the widget owner to sign in; this is intentional because
  public visitors fill out the form.
- The `website` honeypot field, Zod validation, and a 10 KB JSON body limit
  protect the public submission endpoint.

A submission sent through a public form belongs to the owner of the target
widget. The public route does not allow stored submissions to be viewed,
updated, or deleted.

## Owner dashboard

Open `http://localhost:3000/dashboard.html` and register or sign in. The
dashboard displays the number of the user's widgets, the total number of
submissions across all their widgets, the submission count for the currently
selected widget, and the number of rows shown in the table. The table shows up
to the 100 latest submissions and can be filtered by widget. It includes the
country/city when available or the location-processing status. Background-job
cards show all job types—not only geolocation—with `pending`, `processing`,
`completed`, and `failed` states. The dashboard also displays each owned
widget's public key, creation date, and embed code.

The **Create Widget** button opens an editor for the internal name, form title
and description, button text, accent color, selected fields, and success
message; the preview updates as settings change. Create and update operations
send validated data to owner-only API routes and persist it in SQLite. The
widget list provides details/editing, deletion with confirmation, an
**Embed / Preview** button that opens the selected widget and its copyable
code, a separate **Preview** in a new tab, and a quick way to copy the embed
code. Ownership is checked on the server using the session; another user
receives `404` for the widget. Job counts include only submissions for the
currently signed-in user's widgets. Older clients can still create a widget by
sending only `{ "name": "My form" }`; the server applies compatible defaults.

The public key is used to display the form and submit leads, not to view owner
data. The demo form remains on `/` and uses the existing `demo-widget`. Its
submissions belong to the passwordless system owner and are not shown in user
dashboards.

Manual check: run `npm start`, open `/dashboard.html`, register with a password
of at least 12 characters, create a widget, copy its embed code, and check that
the widget displays a form. To submit a test lead to your widget, embed its
code on a page or send a `POST /api/widgets/<publicKey>/submissions` request,
then refresh the dashboard. Sign out and confirm that owner data is available
only after signing in.

## Embeddable widget

The dashboard displays the exact, standalone script tag for each of your
widgets:

```html
<script src="https://widgets.example.com/widget/v1.js" data-widget-key="WIDGET_PUBLIC_KEY"></script>
```

Local example:

```html
<script src="http://localhost:3000/widget/v1.js" data-widget-key="demo-widget"></script>
```

For a live deployment, replace the local URL with the server's public
**HTTPS** URL and use the correct public key. `data-widget-key` is the unique
public key of the specific saved widget (not the demo widget's ID). The script
fetches only public settings using `GET /api/widgets/:publicKey`—title,
description, button text, color, fields, and success message—and sends
submissions to `POST /api/widgets/:publicKey/submissions`. The configuration
contains only the name, public key, and public settings; it never exposes the
owner, submissions, or secrets. The form uses only supported text fields
(`name`, `email`, `message`), generated with the DOM API; it does not execute
HTML from the configuration. Embed styles are isolated in Shadow DOM.
Unselected fields are not displayed; their values are stored as empty values
to remain compatible with the existing submission model.

The configuration has a short 30-second cache and `must-revalidate`.
The versioned `/widget/v1.js` file has
`Cache-Control: public, max-age=31536000, immutable`. When the script's public
behavior changes, publish a new versioned path instead of changing the
contents of an existing version.
The earlier `/widget.js` remains available for existing two-part embeds; use
the versioned v1 script tag for new integrations.

CORS is enabled only for public configuration and submission endpoints, not
for authenticated API routes. In `.env`, specify exact origins (scheme + host
+ port, without a path), separated by commas:

```env
WIDGET_ALLOWED_ORIGINS=https://www.example.com,https://shop.example.com
```

The local `.env.example` includes `http://localhost:5500` and
`http://127.0.0.1:5500`. Add production domains explicitly and restart the
server after changing them; wildcard `*` is not supported. CORS preflight
allows only `GET`, `POST`, and `Content-Type` on public routes.

### Testing on a different origin

1. Back up the database and start the application on port 3000 with
   `npm start`.
2. Check that `.env` contains
   `WIDGET_ALLOWED_ORIGINS=http://localhost:5500`. If the test page uses
   `127.0.0.1`, add that origin too, then restart the application.
3. Open the `public/` folder in VS Code and start VS Code Live Server on port
   5500. Visit `http://localhost:5500/embed-demo.html`; do not use `file://`.
4. The page uses a script tag for `demo-widget`. Submit a test lead and check
   for the success message. The demo submission remains assigned to the system
   owner.
5. For your own widget, sign in at
   `http://localhost:3000/dashboard.html`, create a widget, and copy its
   script tag into `embed-demo.html`, replacing the demo tag. Submit a lead and
   check that it appears only in that widget owner's dashboard.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATABASE_PATH` | `widget-platform.db` in the project root | Path to the SQLite database |
| `NODE_ENV` | — | Set to `production` to enable `Secure` cookies |
| `WIDGET_ALLOWED_ORIGINS` | empty (no cross-origin CORS access) | Exact allowlist of origins for public widget API routes |
| `GEOLOCATION_TIMEOUT_MS` | `1200` | Maximum time to wait for each geolocation provider, in milliseconds |
| `BACKGROUND_JOB_POLL_INTERVAL_MS` | `1000` | Worker queue polling interval |
| `BACKGROUND_JOB_MAX_ATTEMPTS` | `5` | Maximum number of job attempts |
| `BACKGROUND_JOB_RETRY_BASE_MS` | `1000` | Initial exponential backoff delay |
| `BACKGROUND_JOB_RETRY_MAX_MS` | `3600000` | Maximum backoff delay |
| `BACKGROUND_JOB_LEASE_MS` | `30000` | Lease duration for recovering abandoned jobs |
| `SUBMISSION_WEBHOOK_URL` | empty (disabled) | HTTPS endpoint for new-submission events; HTTP is allowed only for localhost |
| `SUBMISSION_WEBHOOK_SECRET` | empty | Required with the webhook URL; an HMAC-SHA256 key of at least 32 bytes |
| `SUBMISSION_WEBHOOK_TIMEOUT_MS` | `5000` | Webhook HTTP request timeout |

Neither JWT nor a hard-coded session secret is needed: session tokens are
generated with a cryptographically secure random generator at sign-in.

## Tests and verification

```sh
npm test
```

Tests use a temporary SQLite database and do not modify the project database.
They cover `/health`, registration and sign-in, password hashing, widget CRUD,
submission access, user isolation, the dashboard API, the versioned widget
script, public configuration, CORS/OPTIONS, validation, the honeypot, rate
limiting, geolocation fallback, background-job retries, and the webhook side
effect.

## Validation, spam protection, and request limits

The public submission endpoint validates the name (2–100 characters), email
(up to 254 characters), and message (up to 2,000 characters). Name and email
are required; the message can be empty to preserve existing API behavior.
Unknown fields are rejected. Invalid JSON and Zod validation errors return
structured JSON with status `400`; requests larger than 10 KB return `413`.
Server errors do not include stack traces or database details in the response.

A populated hidden `website` honeypot returns a neutral success response, but
the submission is not stored. Public submission attempts are subject to a
configurable per-IP limit:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WIDGET_SUBMISSION_RATE_WINDOW_MS` | `900000` | Rate-limit window duration in milliseconds |
| `WIDGET_SUBMISSION_RATE_LIMIT` | `10` | Maximum attempts per IP address during the window |

Exceeding the public submission limit returns `429` and the JSON code
`RATE_LIMIT_EXCEEDED`; the general API limit also returns JSON `429`. The
limiter uses the in-memory store of a single Node.js process: counters reset
on restart and are not shared across multiple processes or instances. A shared
rate-limit store is needed for multiple production instances. The application
does not set `trust proxy`; behind a reverse proxy, Express may see the proxy
IP for all clients. Do not enable `trust proxy` blindly: if needed, configure
Express with trusted proxy addresses/CIDRs based on the actual topology before
exposing the application.

The test limit is configured only in a separate test process (9 requests in
the test window); tests use a temporary SQLite database and do not change the
runtime configuration or project database.

## Background jobs and submission geolocation

After a submission is successfully saved, the API adds a
`geolocate_submission` job to SQLite and responds immediately; the HTTP
request does not wait for external services. The job contains a
`submission_id` and IP address in its JSON payload, but no name, email, or
message. The IP payload is removed when the job completes or exhausts its
attempts. If SQLite cannot enqueue the job, the submission remains saved and
the user still receives a success response; the application emits a generic
warning without private values, but that particular job will not be retried
automatically.

A worker starts with the main Node process and polls the queue according to
`BACKGROUND_JOB_POLL_INTERVAL_MS`. Jobs are claimed atomically using a SQLite
`UPDATE ... RETURNING` operation with `processing` status, a unique processing
token, and a lease; concurrent workers cannot claim the same job. A worker
heartbeat renews the lease while waiting for the provider. On restart and
during operation, expired processing jobs are returned to `pending`. If a job
lease expires after all attempts have been used, the job is marked `failed`
and a safe warning is emitted.

Provider errors with `unavailable` status are treated as transient and
retried. Public addresses that are skipped (`skipped`) are final results,
because retrying would not change the fact that private/local addresses are
not sent to providers. Retries use exponential backoff:
`base * 2^(attempts - 1)`, up to `BACKGROUND_JOB_RETRY_MAX_MS`; after at most
`BACKGROUND_JOB_MAX_ATTEMPTS` attempts, the job becomes `failed`. The final
error contains only a fixed code, not text from the provider response.

### Webhook for new submissions

Optionally set `SUBMISSION_WEBHOOK_URL` to enable a real side effect for new
submissions. The URL must use HTTPS; HTTP is allowed only for `localhost`,
`127.0.0.1`, or `::1` during local development. The server owner controls the
endpoint through the environment, never the widget visitor, so the public API
cannot be used to send arbitrary requests. Secrets are not placed in code or
the repository. When a URL is configured, `SUBMISSION_WEBHOOK_SECRET` must be
set and contain at least 32 UTF-8 bytes; FlyRank then adds
`X-FlyRank-Signature: sha256=<hex>`, an HMAC-SHA256 signature of the exact JSON
body. The receiver must verify the signature in constant time and use
`Idempotency-Key` for deduplication. Generate your own key locally and put it
in `.env` (not in the repository):

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

After saving the submission to SQLite, the application only enqueues a
`submission_webhook` job in the same persistent queue and returns HTTP `201`
without waiting for the receiver. The queued job contains only a reference to
the submission—not its name, email, or message; the worker loads those fields
when delivering. The receiver gets `submission.created` with the submission
identifier and timestamp, widget ID/name, and the submission's name, email,
and message. Therefore, the endpoint must be trusted and authorized to receive
this data.

A non-2xx response, network error, or timeout goes through the same bounded
exponential retry process. A final failure marks the job `failed`, clears the
payload, and records only the fixed `WEBHOOK_DELIVERY_FAILED` code along with
a warning that contains no lead data, URL, signature, or response body. An
enqueue error also does not undo the saved submission; a success response is
returned and only a generic warning is logged, but that individual webhook
cannot then be delivered automatically. The queue has a unique partial index
per submission for the webhook job type, and each attempt uses the stable
idempotency key `flyrank-submission-<id>`. This prevents duplicate local jobs
and lets the receiver deduplicate retries; exactly-once delivery cannot be
guaranteed if the receiver ignores the idempotency key.

When no webhook URL is configured, webhook functionality is disabled and no
job is created; the application does not claim that a message was sent.
`.env.example` lists all optional settings. For a local test, use a controlled
HTTP receiver bound only to loopback; automated tests use a mocked `fetch`
and do not contact the internet.

The SQLite queue is intended for a local/persistent disk that supports SQLite
locks; do not share a WAL database over an unreliable network filesystem.
Multiple workers using the same supported SQLite database use atomic claims
and leases, but production throughput remains limited by SQLite writes and
one claim per worker instance.

The primary provider is
[ipwho.is](https://ipwhois.io/documentation); if the request times out, the
provider returns an HTTP/JSON error, or the result is unusable, the fallback
[FreeIPAPI](https://freeipapi.com/docs/api-reference/api-introduction) is
used. Each request has its own timeout (`GEOLOCATION_TIMEOUT_MS`, 1200 ms by
default). If both providers fail, the job is retried and the submission
remains saved. After a final failure, the geolocation status remains without
a location (`not_processed`) and the job is marked `failed`. Addresses that
are not publicly routable receive `skipped` status without calling public
services. Older submissions receive `not_processed`, because their IP
addresses were not stored and their location cannot be reconstructed.

Provider A documents a free plan without registration/API keys, with 1,000
requests per day and commercial use
([pricing](https://ipwhois.io/pricing)); uptime is not guaranteed. Provider B
states that free commercial and non-commercial use is available with a limit
of 60 requests per minute ([FreeIPAPI](https://freeipapi.com/)). Limits,
availability, and terms may change; a provider may reject requests after a
quota is exceeded. Location data is approximate, not proof of physical
location, and this service does not guarantee provider availability.

Geolocation runs on the server: only the IP address is sent to providers,
never the submission's name, email, or message. The IP is stored temporarily
only in the SQLite queue payload while the job is pending, processing, or
being retried; it is deleted when the job completes or reaches final failure.
The IP is not written to application logs. Geolocation APIs may log requests
according to their own privacy policies; before production use, inform
visitors and establish an appropriate legal basis and retention period. A
safety filter skips loopback, private, link-local, multicast, and known
reserved IPv4/IPv6 ranges.

The client IP is taken from `req.ip` while Express `trust proxy` is disabled;
`X-Forwarded-For` is not read directly. The application does not geolocate IPs
in the browser and does not invent an IP when a request comes through a local
or private proxy. If the deployment uses a reverse proxy, restrict direct
access to the application and manually configure Express `trust proxy` only
for that proxy's known address/CIDR; never set it to `true` or `0.0.0.0/0`
without a trusted topology.
