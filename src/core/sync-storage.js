import {
  SYNC_BASE_REVISION_STORAGE_KEY,
  SYNC_PENDING_REVISION_STORAGE_KEY,
  SYNC_STATE_STORAGE_KEY
} from "./constants.js";
import { normalizeSyncRevision, normalizeSyncState } from "./sync-schema.js";

function requireLocalStorage() {
  if (!globalThis.chrome?.storage?.local) {
    throw new Error("chrome.storage.local is unavailable.");
  }
  return globalThis.chrome.storage.local;
}

export async function loadSyncState() {
  const stored = await requireLocalStorage().get(SYNC_STATE_STORAGE_KEY);
  return normalizeSyncState(stored[SYNC_STATE_STORAGE_KEY]);
}

export async function saveSyncState(state) {
  const normalized = normalizeSyncState(state);
  await requireLocalStorage().set({ [SYNC_STATE_STORAGE_KEY]: normalized });
  return normalized;
}

export async function loadSyncBaseRevision() {
  const stored = await requireLocalStorage().get(SYNC_BASE_REVISION_STORAGE_KEY);
  const value = stored[SYNC_BASE_REVISION_STORAGE_KEY];
  return value ? normalizeSyncRevision(value) : null;
}

export async function saveSyncBaseRevision(revision) {
  const normalized = normalizeSyncRevision(revision);
  await requireLocalStorage().set({ [SYNC_BASE_REVISION_STORAGE_KEY]: normalized });
  return normalized;
}

export async function loadPendingSyncRevision() {
  const stored = await requireLocalStorage().get(SYNC_PENDING_REVISION_STORAGE_KEY);
  const value = stored[SYNC_PENDING_REVISION_STORAGE_KEY];
  return value ? normalizeSyncRevision(value) : null;
}

export async function savePendingSyncRevision(revision) {
  const normalized = normalizeSyncRevision(revision);
  await requireLocalStorage().set({ [SYNC_PENDING_REVISION_STORAGE_KEY]: normalized });
  return normalized;
}

export async function clearPendingSyncRevision() {
  await requireLocalStorage().remove(SYNC_PENDING_REVISION_STORAGE_KEY);
}

export async function clearSyncState() {
  await requireLocalStorage().remove([
    SYNC_STATE_STORAGE_KEY,
    SYNC_BASE_REVISION_STORAGE_KEY,
    SYNC_PENDING_REVISION_STORAGE_KEY
  ]);
}
