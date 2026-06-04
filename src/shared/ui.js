import { t } from "./i18n.js";

export function showMessage(element, text, tone = "info") {
  if (!element) {
    return;
  }

  if (!text) {
    element.hidden = true;
    element.textContent = "";
    element.className = "message message-info";
    return;
  }

  element.hidden = false;
  element.textContent = text;
  element.className = `message message-${tone}`;
}

export function confirmDialog({
  title,
  body = "",
  confirmLabel = t("确认"),
  cancelLabel = t("取消"),
  tone = "info"
}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const titleElement = document.createElement("p");
    titleElement.className = "dialog-title";
    titleElement.textContent = title;

    const bodyElement = document.createElement("p");
    bodyElement.className = "dialog-desc";
    bodyElement.textContent = body;
    bodyElement.hidden = !body;

    const actions = document.createElement("div");
    actions.className = "button-row";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "button-secondary";
    cancelButton.textContent = cancelLabel;

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = tone === "danger" ? "button-danger" : "button";
    confirmButton.textContent = confirmLabel;

    function close(value) {
      backdrop.remove();
      resolve(value);
    }

    cancelButton.addEventListener("click", () => close(false));
    confirmButton.addEventListener("click", () => close(true));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        close(false);
      }
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      }
    });

    actions.append(cancelButton, confirmButton);
    dialog.append(titleElement, bodyElement, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    confirmButton.focus();
  });
}
