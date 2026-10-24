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

  const style = document.createElement("style");
  style.textContent = `
    .flyrank-widget {
      color: #17243b;
      font: 16px/1.5 Arial, sans-serif;
    }
    .flyrank-widget form {
      display: grid;
      gap: 14px;
      max-width: 520px;
    }
    .flyrank-widget label {
      display: grid;
      gap: 6px;
    }
    .flyrank-widget input,
    .flyrank-widget textarea {
      box-sizing: border-box;
      width: 100%;
      padding: 11px 12px;
      border: 1px solid #ccd5e2;
      border-radius: 8px;
      color: inherit;
      background: #fff;
      font: inherit;
    }
    .flyrank-widget button {
      justify-self: start;
      padding: 11px 16px;
      border: 0;
      border-radius: 8px;
      color: #fff;
      background: #1769aa;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .flyrank-widget button:disabled {
      cursor: wait;
      opacity: .65;
    }
    .flyrank-widget [data-flyrank-status] {
      margin: 10px 0 0;
    }
    .flyrank-widget [data-flyrank-error] {
      color: #a52626;
    }
    .flyrank-widget [data-flyrank-honeypot] {
      position: absolute;
      left: -10000px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    }
  `;
  document.head.append(style);

  const status = document.createElement("p");
  status.setAttribute("data-flyrank-status", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  function showError(message) {
    root.replaceChildren(status);
    status.textContent = message;
    status.setAttribute("data-flyrank-error", "");
  }

  if (!publicKey) {
    showError("Widget nije konfigurisan: nedostaje javni ključ.");
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
    status.textContent = "Učitavanje obrasca...";
    root.replaceChildren(status);

    let response;
    try {
      response = await fetch(
        `${apiOrigin}/api/widgets/${encodeURIComponent(publicKey)}`,
        { headers: { Accept: "application/json" } }
      );
    } catch {
      showError("Obrazac nije moguće učitati. Provjerite mrežnu vezu i CORS postavke.");
      return;
    }

    if (!response.ok) {
      showError(response.status === 404
        ? "Ovaj obrazac nije dostupan."
        : "Obrazac trenutno nije moguće učitati.");
      return;
    }

    let configuration;
    try {
      configuration = await response.json();
    } catch {
      showError("Server je vratio neispravnu konfiguraciju obrasca.");
      return;
    }

    if (
      !configuration
      || configuration.publicKey !== publicKey
      || !Array.isArray(configuration.fields)
      || !configuration.fields.includes("name")
      || !configuration.fields.includes("email")
      || !configuration.fields.includes("message")
    ) {
      showError("Konfiguracija obrasca nije ispravna.");
      return;
    }

    const heading = document.createElement("h3");
    heading.textContent = typeof configuration.name === "string"
      ? configuration.name
      : "Kontaktni obrazac";

    const form = document.createElement("form");
    addField(form, "Ime i prezime", "name", "text");
    addField(form, "Email adresa", "email", "email");
    addField(form, "Poruka", "message", "textarea");

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
    button.textContent = "Pošalji prijavu";
    form.append(button);

    let submitting = false;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submitting) return;

      submitting = true;
      button.disabled = true;
      status.removeAttribute("data-flyrank-error");
      status.textContent = "Slanje prijave...";

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
            throw new Error("Previše pokušaja slanja. Pokušajte ponovo kasnije.");
          }
          if (submissionResponse.status === 413) {
            throw new Error("Obrazac je prevelik. Skratite poruku i pokušajte ponovo.");
          }
          if (submissionResponse.status === 400) {
            throw new Error(
              "Provjerite ime, email adresu i dužinu poruke pa pokušajte ponovo."
            );
          }
          if (submissionResponse.status >= 500) {
            throw new Error("Greška servera. Pokušajte ponovo kasnije.");
          }
          throw new Error(
            result.error || "Prijava nije poslana. Provjerite podatke."
          );
        }

        if (result.success !== true) {
          throw new Error("Prijava nije potvrđena. Pokušajte ponovo.");
        }

        status.textContent = "Prijava je uspješno zaprimljena.";
        form.reset();
      } catch (error) {
        status.textContent = error instanceof TypeError
          ? "Nije moguće povezati se sa serverom. Provjerite vezu i CORS postavke."
          : error.message || "Greška pri slanju prijave.";
        status.setAttribute("data-flyrank-error", "");
      } finally {
        submitting = false;
        button.disabled = false;
      }
    });

    status.textContent = "";
    root.replaceChildren(heading, form, status);
  }

  loadConfiguration();
})();
