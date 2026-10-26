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
let editingWidgetId = null;

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
    const error = new Error(data.error || "The request failed. Please try again.");
    error.status = response.status;
    throw error;
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
  authSubmit.textContent = isLogin ? "Sign in" : "Create account";
  authPassword.autocomplete = isLogin ? "current-password" : "new-password";
  authPassword.minLength = isLogin ? 1 : 12;
  setStatus(authStatus, "");
}

function formatDate(value) {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
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

function formatGeolocation(geolocation) {
  if (!geolocation) return "Location is being processed";

  if (geolocation.status === "success") {
    const parts = [
      geolocation.city,
      geolocation.region,
      geolocation.country
    ].filter((value) => typeof value === "string" && value.trim());
    return parts.length > 0 ? parts.join(", ") : "Location available";
  }
  if (geolocation.status === "not_processed") {
    return "Location is being processed";
  }
  if (geolocation.status === "skipped") {
    return "Location lookup was skipped for this IP address";
  }
  if (geolocation.status === "unavailable") {
    return "Location unavailable";
  }
  return "Location unavailable";
}

function embedCode(publicKey) {
  const widgetHost = new URL("/", window.location.href).origin;
  return `<script src="${widgetHost}/widget/v1.js" data-widget-key="${publicKey}"></script>`;
}

function embedPreviewUrl(publicKey) {
  const url = new URL("/embed-demo.html", window.location.href);
  url.searchParams.set("widgetKey", publicKey);
  url.searchParams.set("widgetServer", window.location.origin);
  return url.href;
}

const embedDialog = document.getElementById("embed-dialog");
let selectedEmbedWidget = null;

function showEmbedDialog(widget) {
  selectedEmbedWidget = widget;
  document.getElementById("embed-dialog-title").textContent =
    `Embed: ${widget.name}`;
  document.getElementById("embed-dialog-description").textContent =
    "Preview your saved widget settings, then copy the code to add it to your website.";
  document.getElementById("embed-preview-frame").src =
    embedPreviewUrl(widget.publicKey);
  document.getElementById("embed-dialog-code").value =
    embedCode(widget.publicKey);
  setStatus(document.getElementById("embed-dialog-status"), "");
  embedDialog.showModal();
  document.getElementById("copy-embed-dialog-code").focus();
}

async function copyEmbedCode() {
  const code = document.getElementById("embed-dialog-code");
  const status = document.getElementById("embed-dialog-status");
  try {
    await navigator.clipboard.writeText(code.value);
    setStatus(status, "Embed code copied. Paste it into your page's HTML.", "success");
  } catch {
    code.focus();
    code.select();
    setStatus(status, "Automatic copying is unavailable. The code is selected for you to copy manually.", "error");
  }
}

const widgetEditor = document.getElementById("widget-editor-dialog");
const widgetEditorForm = document.getElementById("create-widget-form");
const widgetEditorSubmit = document.getElementById("create-widget-button");
const widgetEditorStatus = document.getElementById("widget-status");

function updateWidgetPreview() {
  const title = document.getElementById("widget-title").value.trim();
  const description = document.getElementById("widget-description").value.trim();
  const buttonText = document.getElementById("widget-button-text").value.trim();
  const color = document.getElementById("widget-color").value;
  const successMessage = document.getElementById("widget-success-message").value.trim();
  const selectedFields = new FormData(widgetEditorForm).getAll("fields");
  const previewFields = document.getElementById("preview-widget-fields");

  document.getElementById("preview-widget-title").textContent =
    title || "Your form title";
  document.getElementById("preview-widget-description").textContent =
    description || "Add a short description for visitors.";
  document.getElementById("preview-widget-button").textContent =
    buttonText || "Send";
  document.getElementById("preview-widget-button").style.backgroundColor = color;
  document.getElementById("preview-widget-success").textContent =
    successMessage || "Your success message will appear here.";
  previewFields.replaceChildren();
  for (const field of selectedFields) {
    const placeholder = {
      name: "Name",
      email: "Email address",
      message: "Message"
    }[field];
    if (!placeholder) continue;
    const input = createElement(
      "div",
      `preview-field${field === "message" ? " message" : ""}`,
      placeholder
    );
    previewFields.append(input);
  }
}

function setWidgetEditorMode(widget = null) {
  editingWidgetId = widget?.id ?? null;
  document.getElementById("widget-editor-title").textContent = widget
    ? "Edit widget"
    : "Create a widget";
  widgetEditorSubmit.textContent = widget ? "Save changes" : "Create Widget";
  setStatus(widgetEditorStatus, "");
  document.getElementById("widget-name").value = widget?.name || "";
  document.getElementById("widget-title").value = widget?.title || "";
  document.getElementById("widget-description").value = widget?.description || "";
  document.getElementById("widget-button-text").value =
    widget?.buttonText || "Send";
  document.getElementById("widget-color").value = widget?.color || "#3158d4";
  document.getElementById("widget-success-message").value =
    widget?.successMessage || "Your message has been received.";
  const fields = widget?.fields || ["name", "email", "message"];
  widgetEditorForm.querySelectorAll('input[name="fields"]').forEach((checkbox) => {
    checkbox.checked = fields.includes(checkbox.value);
  });
  updateWidgetPreview();
}

async function showWidgetEditor(widgetId = null) {
  setWidgetEditorMode();
  if (widgetId !== null) {
    setStatus(widgetEditorStatus, "Loading widget settings...");
    try {
      const result = await api(`/api/owner/widgets/${encodeURIComponent(widgetId)}`);
      setWidgetEditorMode(result.widget);
    } catch (error) {
      setStatus(dashboardStatus, error.message, "error");
      return;
    }
  }
  widgetEditor.showModal();
  document.getElementById("widget-name").focus();
}

function renderWidgets(widgets) {
  widgetList.replaceChildren();
  document.getElementById("widget-loading").hidden = true;
  document.getElementById("widget-empty").hidden = widgets.length > 0;

  for (const widget of widgets) {
    const item = createElement("article", "widget-item");
    const header = createElement("div", "widget-item-heading");
    const heading = createElement("h3", "", widget.name);
    header.append(heading);
    const meta = createElement(
      "p",
      "widget-meta",
      `Created ${formatDate(widget.createdAt)} · ${widget.submissionCount} submissions`
    );
    const description = createElement(
      "p",
      "widget-item-description",
      widget.description || widget.title || "No description provided."
    );
    const keyLabel = createElement("p", "widget-meta");
    keyLabel.append(
      document.createTextNode("Public key: "),
      createElement("code", "widget-key", widget.publicKey)
    );

    const codeLabel = createElement("label", "widget-meta", "Embed code");
    const code = createElement("textarea", "embed-code");
    code.readOnly = true;
    code.setAttribute("aria-label", `Embed code: ${widget.name}`);
    code.value = embedCode(widget.publicKey);

    const actions = createElement("div", "widget-actions");
    const copyButton = createElement("button", "button secondary small", "Copy code");
    copyButton.type = "button";
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.value);
        copyButton.textContent = "Copied ✓";
        setStatus(dashboardStatus, `Embed code for "${widget.name}" copied.`, "success");
      } catch {
        code.focus();
        code.select();
        setStatus(dashboardStatus, "Select and copy the displayed code.", "error");
      }
      if (copyButton.textContent === "Copied ✓") {
        window.setTimeout(() => {
          copyButton.textContent = "Copy code";
        }, 1800);
      }
    });

    const viewButton = createElement("button", "button small", "View submissions");
    viewButton.type = "button";
    viewButton.addEventListener("click", () => {
      widgetFilter.value = String(widget.id);
      loadDashboard(widget.id);
      document.getElementById("submission-table-wrap")
        .scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start"
        });
    });

    const editButton = createElement("button", "button secondary small", "Edit settings");
    editButton.type = "button";
    editButton.addEventListener("click", () => showWidgetEditor(widget.id));

    const previewButton = createElement("button", "button secondary small", "Preview");
    previewButton.type = "button";
    previewButton.addEventListener("click", () => {
      window.open(embedPreviewUrl(widget.publicKey), "_blank", "noopener");
    });

    const embedButton = createElement("button", "button small", "Embed");
    embedButton.type = "button";
    embedButton.setAttribute(
      "aria-label",
      `Preview and embed code for ${widget.name}`
    );
    embedButton.addEventListener("click", () => showEmbedDialog(widget));

    const deleteButton = createElement("button", "button danger small", "Delete");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm(`Permanently delete "${widget.name}" and its submissions?`)) {
        return;
      }
      deleteButton.disabled = true;
      try {
        await api(`/api/owner/widgets/${encodeURIComponent(widget.id)}`, {
          method: "DELETE"
        });
        setStatus(dashboardStatus, `Widget "${widget.name}" was deleted.`, "success");
        await loadDashboard("");
      } catch (error) {
        setStatus(dashboardStatus, error.message, "error");
        deleteButton.disabled = false;
      }
    });

    actions.append(
      copyButton,
      embedButton,
      viewButton,
      editButton,
      previewButton,
      deleteButton
    );
    item.append(header, meta, description, keyLabel, codeLabel, code, actions);
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
    ? `Submissions for ${selectedWidget.name}`
    : "Latest submissions for your widgets";

  for (const submission of submissions) {
    const row = document.createElement("tr");
    const cells = [
      { value: submission.name },
      { value: submission.email },
      { value: submission.message || "—", className: "message" },
      { value: submission.widgetName },
      { value: formatGeolocation(submission.geolocation), className: "geolocation" },
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
  setStatus(dashboardStatus, "Loading your dashboard...");

  try {
    const query = widgetId ? `?widgetId=${encodeURIComponent(widgetId)}` : "";
    const data = await api(`/api/owner/dashboard${query}`);
    latestDashboard = data;
    document.getElementById("widget-count").textContent = data.widgetCount;
    document.getElementById("submission-count").textContent = data.totalSubmissions;
    document.getElementById("selected-submission-label").textContent =
      widgetId ? "Selected widget submissions" : "All widget submissions";
    document.getElementById("selected-submission-count").textContent =
      data.submissionCount;
    document.getElementById("table-submission-count").textContent =
      data.submissions.length;
    for (const status of ["pending", "processing", "completed", "failed"]) {
      document.getElementById(`jobs-${status}`).textContent =
        data.backgroundJobs[status];
    }

    widgetFilter.replaceChildren(
      new Option("All widgets", ""),
      ...data.widgets.map((widget) => new Option(widget.name, String(widget.id)))
    );
    widgetFilter.disabled = data.widgets.length === 0;
    widgetFilter.value = widgetId ? String(widgetId) : "";

    renderWidgets(data.widgets);
    renderSubmissions(data.submissions, data.hasMore, widgetId || "");
    setStatus(dashboardStatus, "Your data is up to date.", "success");
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
    if (error.status !== 401) {
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
  setStatus(authStatus, authMode === "login" ? "Signing in..." : "Creating your account...");

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
    showAuth("You have been signed out.", "success");
  } catch (error) {
    setStatus(dashboardStatus, error.message, "error");
  }
});

for (const id of ["close-embed-dialog", "close-embed-dialog-done"]) {
  document.getElementById(id).addEventListener("click", () => embedDialog.close());
}

document.getElementById("copy-embed-dialog-code")
  .addEventListener("click", copyEmbedCode);

document.getElementById("open-embed-preview").addEventListener("click", () => {
  if (!selectedEmbedWidget) return;
  window.open(embedPreviewUrl(selectedEmbedWidget.publicKey), "_blank", "noopener");
});

embedDialog.addEventListener("close", () => {
  document.getElementById("embed-preview-frame").removeAttribute("src");
  selectedEmbedWidget = null;
});

document.getElementById("refresh-button").addEventListener("click", () => {
  loadDashboard(widgetFilter.value);
});

widgetFilter.addEventListener("change", () => {
  loadDashboard(widgetFilter.value);
});

widgetEditorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(widgetEditorForm);
  const fields = formData.getAll("fields");
  if (fields.length === 0) {
    setStatus(widgetEditorStatus, "Select at least one form field.", "error");
    return;
  }
  widgetEditorSubmit.disabled = true;
  setStatus(widgetEditorStatus, editingWidgetId ? "Saving changes..." : "Creating widget...");

  try {
    const payload = {
      name: formData.get("name"),
      title: formData.get("title"),
      description: formData.get("description"),
      buttonText: formData.get("buttonText"),
      color: formData.get("color"),
      fields,
      successMessage: formData.get("successMessage")
    };
    const result = await api(
      editingWidgetId
        ? `/api/owner/widgets/${encodeURIComponent(editingWidgetId)}`
        : "/api/owner/widgets",
      {
        method: editingWidgetId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      }
    );
    const savedWidget = result.widget;
    widgetEditor.close();
    setStatus(
      dashboardStatus,
      editingWidgetId
        ? `Settings for "${savedWidget.name}" were saved.`
        : `Widget "${savedWidget.name}" was created.`,
      "success"
    );
    editingWidgetId = null;
    await loadDashboard("");
  } catch (error) {
    setStatus(widgetEditorStatus, error.message, "error");
  } finally {
    widgetEditorSubmit.disabled = false;
  }
});

for (const id of ["launch-widget-create", "launch-widget-create-secondary"]) {
  document.getElementById(id).addEventListener("click", () => showWidgetEditor());
}

for (const id of ["close-widget-editor", "cancel-widget-editor"]) {
  document.getElementById(id).addEventListener("click", () => widgetEditor.close());
}

widgetEditor.addEventListener("close", () => {
  editingWidgetId = null;
  setStatus(widgetEditorStatus, "");
});

widgetEditorForm.addEventListener("input", updateWidgetPreview);
widgetEditorForm.addEventListener("change", updateWidgetPreview);

setAuthMode("login");
checkSession();
