export const STRENGTH_LEVELS = Object.freeze({
  WEAK: "weak",
  MEDIUM: "medium",
  STRONG: "strong",
  VERY_STRONG: "very-strong"
});

const COMMON_PASSWORDS = new Set([
  "password", "123456", "12345678", "qwerty", "abc123",
  "password1", "111111", "1234567", "iloveyou", "admin",
  "letmein", "welcome", "monkey", "dragon", "master"
]);

export function evaluatePasswordStrength(password) {
  if (!password) return { level: STRENGTH_LEVELS.WEAK, score: 0 };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (password.length < 6) score = Math.min(score, 1);
  if (COMMON_PASSWORDS.has(password.toLowerCase())) score = 0;
  if (/^(.)\1+$/.test(password)) score = 0;

  score = Math.max(0, Math.min(7, score));

  let level;
  if (score <= 1) level = STRENGTH_LEVELS.WEAK;
  else if (score <= 3) level = STRENGTH_LEVELS.MEDIUM;
  else if (score <= 5) level = STRENGTH_LEVELS.STRONG;
  else level = STRENGTH_LEVELS.VERY_STRONG;

  return { level, score };
}
