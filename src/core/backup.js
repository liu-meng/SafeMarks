import { normalizeVaultRecord } from "./validation.js";
import { t } from "../shared/i18n.js";

export const BACKUP_REMINDER_INTERVAL_DAYS = 14;
export const BACKUP_REMINDER_INTERVAL_MS =
  BACKUP_REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

export function normalizeBackupReminderState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      lastEncryptedExportAt: null,
      dismissedAt: null
    };
  }

  return {
    lastEncryptedExportAt: normalizeTimestamp(value.lastEncryptedExportAt),
    dismissedAt: normalizeTimestamp(value.dismissedAt)
  };
}

export function getBackupReminderStatus({
  hasVault,
  bookmarkCount = 0,
  reminderState,
  now = Date.now()
}) {
  const state = normalizeBackupReminderState(reminderState);
  const normalizedBookmarkCount = Number.isInteger(bookmarkCount)
    ? bookmarkCount
    : 0;

  if (!hasVault) {
    return {
      shouldShow: false,
      reason: "no-vault",
      ...state
    };
  }

  if (normalizedBookmarkCount <= 0) {
    return {
      shouldShow: false,
      reason: "empty-vault",
      ...state
    };
  }

  const dismissedIsFresh =
    state.dismissedAt !== null &&
    now - state.dismissedAt < BACKUP_REMINDER_INTERVAL_MS;

  if (state.lastEncryptedExportAt === null) {
    return {
      shouldShow: !dismissedIsFresh,
      reason: dismissedIsFresh ? "dismissed" : "never-exported",
      ...state
    };
  }

  const exportIsStale =
    now - state.lastEncryptedExportAt >= BACKUP_REMINDER_INTERVAL_MS;

  return {
    shouldShow: exportIsStale && !dismissedIsFresh,
    reason: exportIsStale
      ? dismissedIsFresh ? "dismissed" : "stale-export"
      : "recent-export",
    ...state
  };
}

export function createRestorePreflight(value, { hasExistingVault = false } = {}) {
  let record;
  try {
    record = normalizeVaultRecord(value);
  } catch {
    throw new Error(t("这不是有效的 SafeMarks 加密备份。"));
  }

  return {
    record,
    hasExistingVault: Boolean(hasExistingVault),
    version: record.version,
    bookmarkCount: record.meta.bookmarkCount,
    autoLockMinutes: record.settings.autoLockMinutes,
    hasPasswordHint: Boolean(record.settings.passwordHint)
  };
}
