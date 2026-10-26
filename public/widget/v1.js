(function mountFlyRankWidget() {
  const script = document.currentScript;
  if (!script) return;

  const publicKey = script.getAttribute("data-widget-key");
  const apiOrigin = new URL(script.src, document.baseURI).origin;
  const existingRoot = script.parentElement?.id === "widget-root"
    ? script.parentElement
    : null;
  const root = existingRoot || document.createElement("div");
  root.classList.add("flyrank-widget");
  root.setAttribute("data-flyrank-widget-root", "");

  if (!existingRoot) {
    if (script.parentElement) {
      script.parentElement.insertBefore(root, script.nextSibling);
    } else {
      document.body.append(root);
    }
  }

  const shadowRoot = root.shadowRoot || root.attachShadow({ mode: "open" });
  const widget = document.createElement("div");
  widget.className = "flyrank-widget-card";
  shadowRoot.append(widget);

  const style = document.createElement("style");
  style.textContent = `
    :host {
      display: block;
      width: 100%;
      color: #17223b;
      font: 15px/1.55 "DM Sans", "Segoe UI", Arial, sans-serif;
    }
    .flyrank-widget-card {
      box-sizing: border-box;
      display: grid;
      gap: 16px;
      width: 100%;
      max-width: 460px;
      padding: 23px;
      border: 1px solid #e4e8f1;
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 8px 24px rgb(18 31 55 / 7%);
      --flyrank-accent: #3158d4;
    }
    h3 {
      margin: 0;
      color: #17223b;
      font: 800 1.2rem/1.25 "Manrope", "Segoe UI", Arial, sans-serif;
      letter-spacing: -.035em;
    }
    [data-flyrank-description] {
      margin: -8px 0 0;
      color: #74809a;
      font-size: .9rem;
    }
    form { display: grid; gap: 13px; }
    label {
      display: grid;
      gap: 6px;
      color: #44516b;
      font-size: .85rem;
      font-weight: 650;
    }
    input, textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid #dce1ec;
      border-radius: 9px;
      color: #17223b;
      background: #fff;
      font: inherit;
      transition: border-color .18s ease, box-shadow .18s ease;
    }
    textarea { min-height: 106px; resize: vertical; }
    input:focus, textarea:focus {
      border-color: #6d88de;
      outline: 0;
      box-shadow: 0 0 0 3px rgb(49 88 212 / 12%);
    }
    button {
      display: inline-flex;
      min-height: 45px;
      align-items: center;
      justify-content: center;
      padding: 10px 16px;
      border: 0;
      border-radius: 10px;
      color: #fff;
      background: var(--flyrank-accent);
      box-shadow: none;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      transition: transform .18s ease, box-shadow .18s ease;
    }
    button:hover:not(:disabled) { filter: brightness(.94); }
    button:focus-visible { outline: 3px solid #9e8bff; outline-offset: 3px; }
    button:disabled { cursor: wait; opacity: .65; }
    [data-flyrank-status] { min-height: 1.3em; margin: -4px 0 0; color: #68748d; font-size: .86rem; }
    [data-flyrank-error] { color: #b43b4e; }
    [data-flyrank-success] { color: #187650; }
    [data-flyrank-honeypot] {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      clip-path: inset(50%) !important;
    }
    @media (max-width: 480px) {
      .flyrank-widget-card { padding: 18px; border-radius: 15px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition-duration: .01ms !important; }
    }
  `;
  shadowRoot.append(style);

  const status = document.createElement("p");
  status.setAttribute("data-flyrank-status", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  function showError(message) {
    widget.replaceChildren(status);
    status.textContent = message;
    status.setAttribute("data-flyrank-error", "");
  }

  if (!publicKey) {
    showError("This widget is not configured: its public key is missing.");
    return;
  }

  function addField(form, labelText, name, type) {
    const label = document.createElement("label");
    label.append(document.createTextNode(labelText));

    const input = document.createElement(type === "textarea" ? "textarea" : "input");
    input.name = name;
    input.required = true;
    if (type === "text") input.maxLength = 100;
    if (type === "email") {
      input.type = "email";
      input.maxLength = 254;
    }
    if (type === "textarea") {
      input.rows = 4;
      input.maxLength = 2000;
    }

    label.append(input);
    form.append(label);
  }

  async function loadConfiguration() {
    status.textContent = "Loading form...";
    widget.replaceChildren(status);

    let response;
    try {
      response = await fetch(
        `${apiOrigin}/api/widgets/${encodeURIComponent(publicKey)}`,
        { headers: { Accept: "application/json" } }
      );
    } catch {
      showError("The form could not be loaded. Check your connection and CORS settings.");
      return;
    }

    if (!response.ok) {
      showError(response.status === 404
        ? "This form is unavailable."
        : "The form could not be loaded right now.");
      return;
    }

    let configuration;
    try {
      configuration = await response.json();
    } catch {
      showError("The server returned an invalid form configuration.");
      return;
    }

    if (
      !configuration
      || configuration.publicKey !== publicKey
      || !Array.isArray(configuration.fields)
      || configuration.fields.length === 0
      || configuration.fields.some(
        (field) => !["name", "email", "message"].includes(field)
      )
      || typeof configuration.color !== "string"
      || !/^#[0-9a-fA-F]{6}$/.test(configuration.color)
    ) {
      showError("The form configuration is invalid.");
      return;
    }

    const heading = document.createElement("h3");
    heading.textContent = typeof configuration.title === "string"
      ? configuration.title
      : "Contact form";

    widget.style.setProperty("--flyrank-accent", configuration.color);
    const form = document.createElement("form");
    for (const field of configuration.fields) {
      if (field === "name") addField(form, "Name", "name", "text");
      if (field === "email") addField(form, "Email address", "email", "email");
      if (field === "message") addField(form, "Message", "message", "textarea");
    }

    const description = document.createElement("p");
    description.setAttribute("data-flyrank-description", "");
    description.textContent = typeof configuration.description === "string"
      ? configuration.description
      : "";

    const honeypotLabel = document.createElement("label");
    honeypotLabel.setAttribute("data-flyrank-honeypot", "");
    honeypotLabel.setAttribute("aria-hidden", "true");
    honeypotLabel.append(document.createTextNode("Website"));
    const honeypot = document.createElement("input");
    honeypot.name = "website";
    honeypot.tabIndex = -1;
    honeypot.autocomplete = "off";
    honeypotLabel.append(honeypot);
    form.append(honeypotLabel);

    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = typeof configuration.buttonText === "string"
      ? configuration.buttonText
      : "Send";
    form.append(button);

    let submitting = false;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submitting) return;

      submitting = true;
      button.disabled = true;
      status.removeAttribute("data-flyrank-error");
      status.removeAttribute("data-flyrank-success");
      status.textContent = "Sending...";

      const data = Object.fromEntries(new FormData(form).entries());
      try {
        const submissionResponse = await fetch(
          `${apiOrigin}/api/widgets/${encodeURIComponent(publicKey)}/submissions`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
          }
        );
        const result = await submissionResponse.json().catch(() => ({}));

        if (!submissionResponse.ok) {
          if (submissionResponse.status === 429) {
            throw new Error("Too many attempts. Please try again later.");
          }
          if (submissionResponse.status === 413) {
            throw new Error("The form is too large. Shorten your message and try again.");
          }
          if (submissionResponse.status === 400) {
            throw new Error(
              "Check your name, email address, and message length, then try again."
            );
          }
          if (submissionResponse.status >= 500) {
            throw new Error("A server error occurred. Please try again later.");
          }
          throw new Error(
            result.error || "Your message could not be sent. Check your details and try again."
          );
        }

        if (result.success !== true) {
          throw new Error("Your submission was not confirmed. Please try again.");
        }

        status.textContent = typeof configuration.successMessage === "string"
          ? configuration.successMessage
          : "Your message has been received.";
        status.setAttribute("data-flyrank-success", "");
        form.reset();
      } catch (error) {
        status.textContent = error instanceof TypeError
          ? "Could not connect to the server. Check your connection and CORS settings."
          : error.message || "An error occurred while sending your message.";
        status.setAttribute("data-flyrank-error", "");
      } finally {
        submitting = false;
        button.disabled = false;
      }
    });

    status.textContent = "";
    widget.replaceChildren(heading);
    if (description.textContent) widget.append(description);
    widget.append(form, status);
  }

  loadConfiguration();
})();
