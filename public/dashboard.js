const authPanel = document.getElementById("auth-panel");
const dashboardPanel = document.getElementById("dashboard-panel");
const accountBar = document.getElementById("account-bar");
const authForm = document.getElementById("auth-form");
const authStatus = document.getElementById("auth-status");
const authSubmit = document.getElementById("auth-submit");
const authPassword = document.getElementById("auth-password");
const loginTab = document.getElementById("login-tab");
const registerTab = document.getElementById("register-tab");
const dashboardStatus = document.getElementById("dashboard-status");
const widgetList = document.getElementById("widget-list");
const widgetFilter = document.getElementById("widget-filter");
const submissionRows = document.getElementById("submission-rows");

let authMode = "login";
let latestDashboard = null;

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin"
  });

  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Zahtjev nije uspio. Pokušajte ponovo.");
  }
  return data;
}

function setStatus(element, message, kind = "") {
  element.textContent = message;
  element.className = `status${kind ? ` ${kind}` : ""}`;
}

function showAuth(message = "", kind = "") {
  authPanel.hidden = false;
  dashboardPanel.hidden = true;
  accountBar.hidden = true;
  setStatus(authStatus, message, kind);
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  loginTab.className = `button${isLogin ? "" : " secondary"}`;
  loginTab.setAttribute("aria-selected", String(isLogin));
  registerTab.className = `button${isLogin ? " secondary" : ""}`;
  registerTab.setAttribute("aria-selected", String(!isLogin));
  authSubmit.textContent = isLogin ? "Prijavi se" : "Registruj se";
  authPassword.autocomplete = isLogin ? "current-password" : "new-password";
  authPassword.minLength = isLogin ? 1 : 12;
  setStatus(authStatus, "");
}

function formatDate(value) {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("bs-BA", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function embedCode(publicKey) {
  const widgetHost = new URL("/", window.location.href).origin;
  return `<script src="${widgetHost}/widget/v1.js" data-widget-key="${publicKey}"></script>`;
}

function renderWidgets(widgets) {
  widgetList.replaceChildren();
  document.getElementById("widget-loading").hidden = true;
  document.getElementById("widget-empty").hidden = widgets.length > 0;

  for (const widget of widgets) {
    const item = createElement("article", "widget-item");
    const heading = createElement("h3", "", widget.name);
    const meta = createElement(
      "p",
      "widget-meta",
      `Kreiran ${formatDate(widget.createdAt)} · ${widget.submissionCount} prijava`
    );
    const keyLabel = createElement("p", "widget-meta");
    keyLabel.append(
      document.createTextNode("Javni ključ: "),
      createElement("code", "widget-key", widget.publicKey)
    );

    const codeLabel = createElement("label", "widget-meta", "Kod za ugradnju");
    const code = createElement("textarea", "embed-code");
    code.readOnly = true;
    code.setAttribute("aria-label", `Kod za ugradnju: ${widget.name}`);
    code.value = embedCode(widget.publicKey);

    const actions = createElement("div", "widget-actions");
    const copyButton = createElement("button", "button secondary small", "Kopiraj kod");
    copyButton.type = "button";
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.value);
        setStatus(dashboardStatus, `Kod za „${widget.name}” je kopiran.`, "success");
      } catch {
        code.focus();
        code.select();
        setStatus(dashboardStatus, "Označite i kopirajte prikazani kod.", "error");
      }
    });

    const viewButton = createElement("button", "button small", "Prikaži prijave");
    viewButton.type = "button";
    viewButton.addEventListener("click", () => {
      widgetFilter.value = String(widget.id);
      loadDashboard(widget.id);
      document.getElementById("submission-table-wrap")
        .scrollIntoView({ behavior: "smooth", block: "start" });
    });

    actions.append(copyButton, viewButton);
    item.append(heading, meta, keyLabel, codeLabel, code, actions);
    widgetList.append(item);
  }
}

function renderSubmissions(submissions, hasMore, selectedWidgetId) {
  submissionRows.replaceChildren();
  document.getElementById("submission-loading").hidden = true;
  const empty = submissions.length === 0;
  document.getElementById("submission-empty").hidden = !empty;
  document.getElementById("submission-table-wrap").hidden = empty;
  document.getElementById("submission-notice").hidden = !hasMore;

  const selectedWidget = latestDashboard?.widgets.find(
    (widget) => String(widget.id) === String(selectedWidgetId)
  );
  document.getElementById("submission-caption").textContent = selectedWidget
    ? `Prijave za ${selectedWidget.name}`
    : "Najnovije prijave vaših widgeta";

  for (const submission of submissions) {
    const row = document.createElement("tr");
    const cells = [
      { value: submission.name },
      { value: submission.email },
      { value: submission.message || "—", className: "message" },
      { value: submission.widgetName },
      { value: formatDate(submission.createdAt), className: "date" }
    ];
    for (const cellData of cells) {
      const cell = createElement(
        "td",
        cellData.className || "",
        cellData.value
      );
      row.append(cell);
    }
    submissionRows.append(row);
  }
}

async function loadDashboard(widgetId) {
  document.getElementById("submission-loading").hidden = false;
  document.getElementById("submission-empty").hidden = true;
  document.getElementById("submission-table-wrap").hidden = true;
  document.getElementById("submission-notice").hidden = true;
  setStatus(dashboardStatus, "Učitavanje dashboarda...");

  try {
    const query = widgetId ? `?widgetId=${encodeURIComponent(widgetId)}` : "";
    const data = await api(`/api/owner/dashboard${query}`);
    latestDashboard = data;
    document.getElementById("widget-count").textContent = data.widgetCount;
    document.getElementById("submission-count").textContent = data.totalSubmissions;
    for (const status of ["pending", "processing", "completed", "failed"]) {
      document.getElementById(`jobs-${status}`).textContent =
        data.backgroundJobs[status];
    }

    widgetFilter.replaceChildren(
      new Option("Svi widgeti", ""),
      ...data.widgets.map((widget) => new Option(widget.name, String(widget.id)))
    );
    widgetFilter.disabled = data.widgets.length === 0;
    widgetFilter.value = widgetId ? String(widgetId) : "";

    renderWidgets(data.widgets);
    renderSubmissions(data.submissions, data.hasMore, widgetId || "");
    setStatus(dashboardStatus, "Podaci su uspješno učitani.", "success");
  } catch (error) {
    document.getElementById("submission-loading").hidden = true;
    document.getElementById("widget-loading").hidden = true;
    setStatus(dashboardStatus, error.message, "error");
  }
}

async function showDashboard(user) {
  authPanel.hidden = true;
  dashboardPanel.hidden = false;
  accountBar.hidden = false;
  document.getElementById("account-email").textContent = user.email;
  document.getElementById("widget-loading").hidden = false;
  await loadDashboard("");
}

async function checkSession() {
  try {
    const data = await api("/api/auth/me");
    await showDashboard(data.user);
  } catch (error) {
    if (error.message !== "Potrebna je prijava.") {
      showAuth(error.message);
      return;
    }
    showAuth();
  }
}

loginTab.addEventListener("click", () => setAuthMode("login"));
registerTab.addEventListener("click", () => setAuthMode("register"));

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authSubmit.disabled = true;
  setStatus(authStatus, authMode === "login" ? "Prijava..." : "Registracija...");

  const formData = new FormData(authForm);
  try {
    const endpoint = authMode === "login" ? "login" : "register";
    const data = await api(`/api/auth/${endpoint}`, {
      method: "POST",
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password")
      })
    });
    authForm.reset();
    await showDashboard(data.user);
  } catch (error) {
    setStatus(authStatus, error.message, "error");
  } finally {
    authSubmit.disabled = false;
  }
});

document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    latestDashboard = null;
    showAuth("Uspješno ste odjavljeni.", "success");
  } catch (error) {
    setStatus(dashboardStatus, error.message, "error");
  }
});

document.getElementById("refresh-button").addEventListener("click", () => {
  loadDashboard(widgetFilter.value);
});

widgetFilter.addEventListener("change", () => {
  loadDashboard(widgetFilter.value);
});

document.getElementById("create-widget-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.getElementById("create-widget-button");
  const status = document.getElementById("widget-status");
  const name = new FormData(event.currentTarget).get("name");
  button.disabled = true;
  setStatus(status, "Kreiranje widgeta...");

  try {
    const result = await api("/api/owner/widgets", {
      method: "POST",
      body: JSON.stringify({ name })
    });
    event.currentTarget.reset();
    setStatus(status, `Widget „${result.widget.name}” je kreiran.`, "success");
    await loadDashboard("");
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

setAuthMode("login");
checkSession();
