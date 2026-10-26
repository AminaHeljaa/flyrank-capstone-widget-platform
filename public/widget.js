const currentScript = document.currentScript;
const publicKey = currentScript?.dataset.widgetKey || "demo-widget";
const embeddedRoots = Array.from(
  document.querySelectorAll("[data-flyrank-widget]")
);
const root = embeddedRoots.find(
  (element) => element.dataset.flyrankWidget === publicKey
) || (publicKey === "demo-widget"
  ? document.getElementById("widget-root")
  : null);
const apiOrigin = currentScript?.src
  ? new URL(currentScript.src).origin
  : window.location.origin;

if (root && !root.dataset.flyrankMounted) {
  root.dataset.flyrankMounted = "true";

  const shadowRoot = root.shadowRoot || root.attachShadow({ mode: "open" });
  const form = document.createElement("form");
  form.className = "legacy-widget-form";

  const style = document.createElement("style");
  style.textContent = `
    :host {
      display: block;
      color: #17223b;
      font: 15px/1.55 "DM Sans", "Segoe UI", Arial, sans-serif;
    }
    .legacy-widget-form {
      box-sizing: border-box;
      display: grid;
      gap: 13px;
      width: 100%;
      max-width: 460px;
      padding: 23px;
      border: 1px solid #e4e8f1;
      border-radius: 18px;
      background: #fff;
      box-shadow: 0 14px 40px rgb(23 34 59 / 9%);
    }
    label {
      display: grid;
      gap: 6px;
      color: #44516b;
      font-size: .85rem;
      font-weight: 650;
    }
    .widget-input {
      box-sizing: border-box;
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid #dce1ec;
      border-radius: 10px;
      color: #17223b;
      background: #fff;
      font: inherit;
    }
    textarea.widget-input { min-height: 106px; resize: vertical; }
    .widget-input:focus {
      border-color: #8d91f5;
      outline: 0;
      box-shadow: 0 0 0 4px rgb(103 100 235 / 12%);
    }
    .widget-button {
      min-height: 45px;
      padding: 10px 16px;
      border: 0;
      border-radius: 10px;
      color: #fff;
      background: #3158d4;
      box-shadow: 0 7px 17px rgb(69 104 245 / 20%);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .widget-button:disabled {
      opacity: .6;
      cursor: wait;
    }
    .widget-honeypot {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      clip-path: inset(50%) !important;
    }
    .widget-status { min-height: 1.3em; margin: 0; color: #68748d; font-size: .86rem; }
    .widget-status.error { color: #b43b4e; }
    .widget-status.success { color: #187650; }
    @media (max-width: 480px) {
      .legacy-widget-form { padding: 18px; border-radius: 15px; }
    }
  `;
  shadowRoot.appendChild(style);

  function addField(labelText, name, type = "text") {
    const label = document.createElement("label");
    label.textContent = labelText;

    const input = document.createElement("input");
    input.className = "widget-input";
    input.name = name;
    input.type = type;
    input.required = true;
    input.maxLength = name === "email" ? 254 : 100;

    label.appendChild(input);
    form.appendChild(label);
  }

  addField("Name", "name");
  addField("Email address", "email", "email");

  const messageLabel = document.createElement("label");
  messageLabel.textContent = "Message";

  const message = document.createElement("textarea");
  message.className = "widget-input";
  message.name = "message";
  message.rows = 4;
  message.maxLength = 2000;
  message.required = true;
  messageLabel.appendChild(message);
  form.appendChild(messageLabel);

  const honeypot = document.createElement("input");
  honeypot.name = "website";
  honeypot.tabIndex = -1;
  honeypot.autocomplete = "off";
  honeypot.className = "widget-honeypot";
  honeypot.setAttribute("aria-hidden", "true");
  form.appendChild(honeypot);

  const button = document.createElement("button");
  button.className = "widget-button";
  button.type = "submit";
  button.textContent = "Send";
  form.appendChild(button);

  const status = document.createElement("p");
  status.className = "widget-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  let submitting = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;

    submitting = true;
    button.disabled = true;
    status.className = "widget-status";
    status.textContent = "Sending...";

    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const response = await fetch(
        `${apiOrigin}/api/widgets/${encodeURIComponent(publicKey)}/submissions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        }
      );
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Too many attempts. Please try again later.");
        }
        if (response.status === 413) {
          throw new Error("The form is too large. Shorten your message and try again.");
        }
        if (response.status === 400) {
          throw new Error(
            "Check your name, email address, and message length, then try again."
          );
        }
        if (response.status >= 500) {
          throw new Error("A server error occurred. Please try again later.");
        }
        throw new Error(result.error || "Your message could not be sent.");
      }

      if (result.success !== true) {
        throw new Error("Your submission was not confirmed. Please try again.");
      }

      status.textContent = "Your message has been received!";
      status.className = "widget-status success";
      form.reset();
    } catch (error) {
      status.textContent = error instanceof TypeError
        ? "Could not connect to the server. Check your connection and CORS settings."
        : error.message || "An error occurred while sending your message.";
      status.className = "widget-status error";
    } finally {
      submitting = false;
      button.disabled = false;
    }
  });

  shadowRoot.append(form, status);
}
