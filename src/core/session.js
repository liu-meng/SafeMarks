import {
  AUTO_LOCK_ALARM,
  DEFAULT_AUTO_LOCK_MINUTES,
  SESSION_STORAGE_KEY
} from "./constants.js";
import {
  normalizeAutoLockMinutes,
  normalizeSessionRecord
} from "./validation.js";

function requireSessionStorage() {
  if (!globalThis.chrome?.storage?.session) {
    throw new Error("chrome.storage.session is unavailable.");
  }

  return globalThis.chrome.storage.session;
}

export function minutesToMilliseconds(minutes) {
  return normalizeAutoLockMinutes(minutes) * 60 * 1000;
}

export function createSessionRecord({
  encodedKey,
  autoLockMinutes = DEFAULT_AUTO_LOCK_MINUTES,
  now = Date.now()
}) {
  return normalizeSessionRecord({
    encodedKey,
    autoLockMinutes,
    lastActivityAt: now,
    expiresAt: now + minutesToMilliseconds(autoLockMinutes)
  });
}

export function isSessionExpired(record, now = Date.now()) {
  return !record || record.expiresAt <= now;
}

export async function readSessionRecord() {
  const stored = await requireSessionStorage().get(SESSION_STORAGE_KEY);
  if (!stored[SESSION_STORAGE_KEY]) {
    return null;
  }

  return normalizeSessionRecord(stored[SESSION_STORAGE_KEY]);
}

export async function writeSessionRecord(record) {
  const normalized = normalizeSessionRecord(record);
  await requireSessionStorage().set({
    [SESSION_STORAGE_KEY]: normalized
  });
  return normalized;
}

export async function clearSessionRecord() {
  await requireSessionStorage().remove(SESSION_STORAGE_KEY);
}

export async function scheduleAutoLock(expiresAt) {
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  await chrome.alarms.create(AUTO_LOCK_ALARM, { when: expiresAt });
}

export async function clearAutoLockAlarm() {
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
}

export async function sendSessionMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

export async function sessionSet(encodedKey, autoLockMinutes) {
  return sendSessionMessage("SESSION_SET", {
    encodedKey,
    autoLockMinutes
  });
}

export async function sessionTouch() {
  return sendSessionMessage("SESSION_TOUCH");
}

export async function sessionLock() {
  return sendSessionMessage("SESSION_LOCK");
}

export async function sessionStatus() {
  return sendSessionMessage("SESSION_STATUS");
}
