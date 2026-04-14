import { STORAGE_KEYS } from "./constants.js";
import { normalizeAutoLockMinutes, normalizeVaultRecord } from "./validation.js";

function requireChromeStorage() {
  if (!globalThis.chrome?.storage?.local) {
    throw new Error("chrome.storage.local is unavailable.");
  }

  return globalThis.chrome.storage.local;
}

export async function loadVaultRecord() {
  const stored = await requireChromeStorage().get(STORAGE_KEYS);
  const hasData = STORAGE_KEYS.some((key) => Object.hasOwn(stored, key));

  if (!hasData) {
    return null;
  }

  return normalizeVaultRecord(stored);
}

export async function saveVaultRecord(record) {
  const normalized = normalizeVaultRecord(record);
  await requireChromeStorage().set(normalized);
  return normalized;
}

export async function updateVaultSettings(autoLockMinutes) {
  const record = await loadVaultRecord();
  if (!record) {
    throw new Error("Vault is not initialized.");
  }

  const nextRecord = {
    ...record,
    settings: {
      autoLockMinutes: normalizeAutoLockMinutes(autoLockMinutes)
    }
  };

  await saveVaultRecord(nextRecord);
  return nextRecord;
}

export async function clearVaultRecord() {
  await requireChromeStorage().remove(STORAGE_KEYS);
}
