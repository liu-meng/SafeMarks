import {
  BACKUP_REMINDER_STORAGE_KEY,
  FOLDER_CATALOG_STORAGE_KEY,
  PENDING_QUICK_CAPTURES_STORAGE_KEY,
  RECENT_FOLDER_PATHS_STORAGE_KEY,
  SYNC_BASE_REVISION_STORAGE_KEY,
  SYNC_PENDING_REVISION_STORAGE_KEY,
  SYNC_STATE_STORAGE_KEY,
  STORAGE_KEYS
} from "./constants.js";
import { normalizeBackupReminderState } from "./backup.js";
import {
  normalizeAutoLockMinutes,
  normalizeBookmarkList,
  normalizeFolderCatalog,
  normalizeVaultRecord
} from "./validation.js";

const VAULT_PRESENCE_KEYS = ["version", "salt", "auth", "vault"];

function requireChromeStorage() {
  if (!globalThis.chrome?.storage?.local) {
    throw new Error("chrome.storage.local is unavailable.");
  }

  return globalThis.chrome.storage.local;
}

function readStoredVaultData() {
  return requireChromeStorage().get(STORAGE_KEYS);
}

function readPendingQuickCaptureData() {
  return requireChromeStorage().get(PENDING_QUICK_CAPTURES_STORAGE_KEY);
}

function readFolderCatalogData() {
  return requireChromeStorage().get(FOLDER_CATALOG_STORAGE_KEY);
}

function readBackupReminderData() {
  return requireChromeStorage().get(BACKUP_REMINDER_STORAGE_KEY);
}

export function hasVaultRecordData(stored) {
  if (!stored || typeof stored !== "object") {
    return false;
  }

  return VAULT_PRESENCE_KEYS.some((key) => Object.hasOwn(stored, key));
}

export async function hasStoredVaultRecord() {
  return hasVaultRecordData(await readStoredVaultData());
}

export async function loadVaultRecord() {
  const stored = await readStoredVaultData();
  const hasData = hasVaultRecordData(stored);

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
      ...record.settings,
      autoLockMinutes: normalizeAutoLockMinutes(autoLockMinutes)
    }
  };

  await saveVaultRecord(nextRecord);
  return nextRecord;
}

export async function clearVaultRecord() {
  await requireChromeStorage().remove([
    BACKUP_REMINDER_STORAGE_KEY,
    FOLDER_CATALOG_STORAGE_KEY,
    RECENT_FOLDER_PATHS_STORAGE_KEY,
    SYNC_BASE_REVISION_STORAGE_KEY,
    SYNC_PENDING_REVISION_STORAGE_KEY,
    SYNC_STATE_STORAGE_KEY,
    ...STORAGE_KEYS,
    PENDING_QUICK_CAPTURES_STORAGE_KEY
  ]);
}

export async function loadPendingQuickCaptures() {
  const stored = await readPendingQuickCaptureData();
  const pending = stored[PENDING_QUICK_CAPTURES_STORAGE_KEY];
  if (!pending) {
    return [];
  }

  return normalizeBookmarkList(pending);
}

export async function savePendingQuickCaptures(bookmarks) {
  const normalized = normalizeBookmarkList(bookmarks);
  await requireChromeStorage().set({
    [PENDING_QUICK_CAPTURES_STORAGE_KEY]: normalized
  });
  return normalized;
}

export async function clearPendingQuickCaptures() {
  await requireChromeStorage().remove(PENDING_QUICK_CAPTURES_STORAGE_KEY);
}

export async function loadFolderCatalog() {
  const stored = await readFolderCatalogData();
  return normalizeFolderCatalog(stored[FOLDER_CATALOG_STORAGE_KEY]);
}

export async function saveFolderCatalog(folderPaths) {
  const normalized = normalizeFolderCatalog(folderPaths);
  await requireChromeStorage().set({
    [FOLDER_CATALOG_STORAGE_KEY]: normalized
  });
  return normalized;
}

export async function clearFolderCatalog() {
  await requireChromeStorage().remove(FOLDER_CATALOG_STORAGE_KEY);
}

export async function loadBackupReminderState() {
  const stored = await readBackupReminderData();
  return normalizeBackupReminderState(stored[BACKUP_REMINDER_STORAGE_KEY]);
}

export async function saveBackupReminderState(state) {
  const normalized = normalizeBackupReminderState(state);
  await requireChromeStorage().set({
    [BACKUP_REMINDER_STORAGE_KEY]: normalized
  });
  return normalized;
}
