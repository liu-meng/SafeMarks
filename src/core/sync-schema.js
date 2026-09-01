import { normalizeEncryptedBlob, normalizeVaultPayload } from "./validation.js";

export const SYNC_FORMAT_VERSION = 1;
export const SYNC_REVISION_FORMAT = "safemarks-sync-revision";
export const SYNC_MANIFEST_FORMAT = "safemarks-sync-manifest";

function assertObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
}

function assertString(value, message) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value.trim();
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))];
}

function normalizeTimestamp(value, label) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error(`${label} is invalid.`);
  }
  return timestamp;
}

export function getSyncRevisionAad(vaultId) {
  return `${SYNC_REVISION_FORMAT}:${SYNC_FORMAT_VERSION}:${vaultId}`;
}

export function normalizeSyncRevision(value) {
  assertObject(value, "Sync revision is invalid.");
  if (value.format !== SYNC_REVISION_FORMAT || Number(value.formatVersion) !== SYNC_FORMAT_VERSION) {
    throw new Error("Unsupported sync revision format.");
  }
  assertObject(value.crypto, "Sync revision crypto is invalid.");

  const revision = {
    format: SYNC_REVISION_FORMAT,
    formatVersion: SYNC_FORMAT_VERSION,
    vaultId: assertString(value.vaultId, "Sync vault id is invalid."),
    revisionId: assertString(value.revisionId, "Sync revision id is invalid."),
    parentRevisionIds: normalizeStringList(value.parentRevisionIds),
    deviceId: assertString(value.deviceId, "Sync device id is invalid."),
    committedAt: normalizeTimestamp(value.committedAt, "Sync committedAt"),
    crypto: {
      vaultVersion: Number(value.crypto.vaultVersion),
      salt: assertString(value.crypto.salt, "Sync salt is invalid."),
      kdf: {
        name: "PBKDF2",
        hash: value.crypto.kdf?.hash === "SHA-256" ? "SHA-256" : "SHA-256",
        iterations: Number(value.crypto.kdf?.iterations)
      },
      auth: normalizeEncryptedBlob(value.crypto.auth, "Sync auth blob"),
      snapshot: normalizeEncryptedBlob(value.crypto.snapshot, "Sync snapshot")
    }
  };

  if (!Number.isInteger(revision.crypto.kdf.iterations) || revision.crypto.kdf.iterations <= 0) {
    throw new Error("Sync KDF iterations are invalid.");
  }
  return revision;
}

export function normalizeSyncSnapshot(value) {
  assertObject(value, "Sync snapshot is invalid.");
  return {
    vaultId: assertString(value.vaultId, "Sync snapshot vault id is invalid."),
    revisionId: assertString(value.revisionId, "Sync snapshot revision id is invalid."),
    parentRevisionIds: normalizeStringList(value.parentRevisionIds),
    deviceId: assertString(value.deviceId, "Sync snapshot device id is invalid."),
    committedAt: normalizeTimestamp(value.committedAt, "Sync snapshot committedAt"),
    payload: normalizeVaultPayload(value.payload)
  };
}

export function assertSyncRevisionMatchesSnapshot(revision, snapshot) {
  const fieldsMatch = revision.vaultId === snapshot.vaultId
    && revision.revisionId === snapshot.revisionId
    && revision.deviceId === snapshot.deviceId
    && revision.committedAt === snapshot.committedAt
    && JSON.stringify(revision.parentRevisionIds) === JSON.stringify(snapshot.parentRevisionIds);
  if (!fieldsMatch) {
    throw new Error("Sync revision header verification failed.");
  }
}

export function normalizeSyncState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    enabled: source.enabled === true,
    provider: source.provider === "local-folder" ? "local-folder" : null,
    directoryName: typeof source.directoryName === "string" ? source.directoryName : "",
    deviceId: typeof source.deviceId === "string" && source.deviceId
      ? source.deviceId
      : `device_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
    vaultId: typeof source.vaultId === "string" ? source.vaultId : null,
    lastSyncedRevisionId: typeof source.lastSyncedRevisionId === "string" ? source.lastSyncedRevisionId : null,
    lastSyncedVaultCiphertext: typeof source.lastSyncedVaultCiphertext === "string" ? source.lastSyncedVaultCiphertext : null,
    lastSyncedAt: Number.isFinite(Number(source.lastSyncedAt)) ? Number(source.lastSyncedAt) : null,
    status: typeof source.status === "string" ? source.status : "off",
    conflictCount: Number.isInteger(source.conflictCount) && source.conflictCount >= 0 ? source.conflictCount : 0,
    lastError: typeof source.lastError === "string" ? source.lastError : null
  };
}
