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

  const form = document.createElement("form");
  form.style.display = "grid";
  form.style.gap = "14px";

  const style = document.createElement("style");
  style.textContent = `
    .widget-input {
      width: 100%;
      padding: 12px;
      border: 1px solid #ccd5e2;
      border-radius: 8px;
      font: inherit;
    }

    .widget-button {
      padding: 12px;
      border: 0;
      border-radius: 8px;
      background: #1769aa;
      color: white;
      font-weight: bold;
      cursor: pointer;
    }

    .widget-button:disabled {
      opacity: .6;
      cursor: wait;
    }
  `;
  document.head.appendChild(style);

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

  addField("Ime i prezime", "name");
  addField("Email adresa", "email", "email");

  const messageLabel = document.createElement("label");
  messageLabel.textContent = "Poruka";

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
  honeypot.setAttribute("aria-hidden", "true");
  honeypot.style.cssText =
    "position:absolute;left:-10000px;width:1px;height:1px";
  form.appendChild(honeypot);

  const button = document.createElement("button");
  button.className = "widget-button";
  button.type = "submit";
  button.textContent = "Pošalji prijavu";
  form.appendChild(button);

  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  let submitting = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;

    submitting = true;
    button.disabled = true;
    status.textContent = "Slanje prijave...";

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
          throw new Error("Previše pokušaja slanja. Pokušajte ponovo kasnije.");
        }
        if (response.status === 413) {
          throw new Error("Obrazac je prevelik. Skratite poruku i pokušajte ponovo.");
        }
        if (response.status === 400) {
          throw new Error(
            "Provjerite ime, email adresu i dužinu poruke pa pokušajte ponovo."
          );
        }
        if (response.status >= 500) {
          throw new Error("Greška servera. Pokušajte ponovo kasnije.");
        }
        throw new Error(result.error || "Prijava nije poslana.");
      }

      if (result.success !== true) {
        throw new Error("Prijava nije potvrđena. Pokušajte ponovo.");
      }

      status.textContent = "Prijava je uspješno zaprimljena!";
      form.reset();
    } catch (error) {
      status.textContent = error instanceof TypeError
        ? "Nije moguće povezati se sa serverom. Provjerite vezu i CORS postavke."
        : error.message || "Greška pri slanju.";
    } finally {
      submitting = false;
      button.disabled = false;
    }
  });

  root.append(form, status);
}
