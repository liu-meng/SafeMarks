import { evaluatePasswordStrength, STRENGTH_LEVELS } from "../core/password-strength.js";
import { t } from "./i18n.js";

const LEVEL_LABELS = {
  [STRENGTH_LEVELS.WEAK]: "弱",
  [STRENGTH_LEVELS.MEDIUM]: "中等",
  [STRENGTH_LEVELS.STRONG]: "强",
  [STRENGTH_LEVELS.VERY_STRONG]: "非常强"
};

const LEVEL_COLORS = {
  [STRENGTH_LEVELS.WEAK]: "var(--warn)",
  [STRENGTH_LEVELS.MEDIUM]: "#b8860b",
  [STRENGTH_LEVELS.STRONG]: "var(--accent)",
  [STRENGTH_LEVELS.VERY_STRONG]: "var(--success)"
};

export function createPasswordStrengthMeter() {
  const container = document.createElement("div");
  container.className = "password-strength-meter";
  container.setAttribute("aria-live", "polite");
  container.hidden = true;

  const bar = document.createElement("div");
  bar.className = "password-strength-bar";
  const fill = document.createElement("div");
  fill.className = "password-strength-fill";
  bar.appendChild(fill);

  const label = document.createElement("span");
  label.className = "password-strength-label";

  container.appendChild(bar);
  container.appendChild(label);

  function update(password) {
    if (!password) {
      container.hidden = true;
      return;
    }
    const { level, score } = evaluatePasswordStrength(password);
    container.hidden = false;
    fill.style.width = `${Math.round((score / 7) * 100)}%`;
    fill.style.backgroundColor = LEVEL_COLORS[level];
    label.textContent = t(LEVEL_LABELS[level]);
    label.style.color = LEVEL_COLORS[level];
  }

  return { element: container, update };
}
