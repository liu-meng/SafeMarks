import {
  AUTH_SENTINEL,
  DEFAULT_AUTO_LOCK_MINUTES,
  VERSION
} from "./constants.js";
import { base64ToBytes } from "./base64.js";
import {
  decryptJson,
  decryptString,
  deriveKeyFromPassword,
  encryptJson,
  exportKey,
  importKey
} from "./crypto.js";
import { findRevisionHeadIds, mergeVaultPayloads } from "./sync-merge.js";
import {
  SYNC_FORMAT_VERSION,
  SYNC_MANIFEST_FORMAT,
  SYNC_REVISION_FORMAT,
  assertSyncRevisionMatchesSnapshot,
  getSyncRevisionAad,
  normalizeSyncRevision,
  normalizeSyncSnapshot
} from "./sync-schema.js";
import {
  clearPendingSyncRevision,
  clearSyncState,
  loadSyncBaseRevision,
  loadSyncState,
  savePendingSyncRevision,
  saveSyncBaseRevision,
  saveSyncState
} from "./sync-storage.js";
import { loadVaultRecord, saveVaultRecord } from "./storage.js";
import { normalizeVaultRecord } from "./validation.js";
import {
  decryptVaultPayloadWithEncodedKey,
  encryptVaultPayloadWithEncodedKey,
  migrateVaultRecordWithEncodedKey
} from "./vault.js";
import {
  clearLocalFolderHandle,
  createLocalFolderProvider,
  getLocalFolderPermission,
  loadLocalFolderHandle,
  saveLocalFolderHandle
} from "../providers/local-folder.js";

let activeSyncPromise = null;

function createOpaqueId(prefix) {
  const random = new Uint32Array(3);
  globalThis.crypto.getRandomValues(random);
  return `${prefix}_${Date.now()}_${[...random].map((value) => value.toString(36)).join("")}`;
}

function emptyPayload() {
  return { schemaVersion: VERSION, bookmarks: [], tombstones: [] };
}

function sortByCommittedAt(revisions) {
  return [...revisions].sort((left, right) => left.committedAt - right.committedAt);
}

async function decryptSyncRevision(revision, encodedKey) {
  const normalized = normalizeSyncRevision(revision);
  const key = await importKey(encodedKey);
  const snapshot = normalizeSyncSnapshot(await decryptJson(
    normalized.crypto.snapshot,
    key,
    getSyncRevisionAad(normalized.vaultId)
  ));
  assertSyncRevisionMatchesSnapshot(normalized, snapshot);
  return snapshot;
}

async function createSyncRevision({ record, payload, encodedKey, deviceId, parentRevisionIds }) {
  const revisionId = createOpaqueId("rev");
  const committedAt = Date.now();
  const header = {
    format: SYNC_REVISION_FORMAT,
    formatVersion: SYNC_FORMAT_VERSION,
    vaultId: record.vaultId,
    revisionId,
    parentRevisionIds: [...new Set(parentRevisionIds)],
    deviceId,
    committedAt
  };
  const key = await importKey(encodedKey);
  return normalizeSyncRevision({
    ...header,
    crypto: {
      vaultVersion: record.version,
      salt: record.salt,
      kdf: record.kdf,
      auth: record.auth,
      snapshot: await encryptJson(
        {
          vaultId: header.vaultId,
          revisionId: header.revisionId,
          parentRevisionIds: header.parentRevisionIds,
          deviceId: header.deviceId,
          committedAt: header.committedAt,
          payload
        },
        key,
        getSyncRevisionAad(record.vaultId)
      )
    }
  });
}

async function writeRevisionAndManifest(provider, revision, headRevisionIds = [revision.revisionId]) {
  await savePendingSyncRevision(revision);
  await provider.writeRevision(revision);
  await provider.writeManifest({
    format: SYNC_MANIFEST_FORMAT,
    formatVersion: SYNC_FORMAT_VERSION,
    vaultId: revision.vaultId,
    headRevisionIds,
    updatedAt: Date.now()
  });
  await clearPendingSyncRevision();
}

async function persistSuccessfulSync({ state, revision, record, conflictCount = 0 }) {
  await saveSyncBaseRevision(revision);
  return saveSyncState({
    ...state,
    enabled: true,
    provider: "local-folder",
    vaultId: record.vaultId,
    lastSyncedRevisionId: revision.revisionId,
    lastSyncedVaultCiphertext: record.vault.ciphertext,
    lastSyncedAt: Date.now(),
    status: conflictCount > 0 ? "conflict-copies" : "synced",
    conflictCount,
    lastError: null
  });
}

async function mergeRemoteHeads(heads, basePayload, encodedKey) {
  const sorted = sortByCommittedAt(heads);
  let payload = (await decryptSyncRevision(sorted[0], encodedKey)).payload;
  let conflicts = [];
  for (const revision of sorted.slice(1)) {
    const remote = (await decryptSyncRevision(revision, encodedKey)).payload;
    const merged = mergeVaultPayloads({ base: basePayload, local: payload, remote });
    payload = merged.payload;
    conflicts = conflicts.concat(merged.conflicts);
  }
  return { payload, conflicts };
}

async function performFolderSync({ encodedKey, provider }) {
  let state = await loadSyncState();
  if (!state.enabled || state.provider !== "local-folder") {
    throw new Error("尚未启用同步文件夹。");
  }

  let record = await loadVaultRecord();
  if (!record) {
    throw new Error("当前没有可同步的保险库。");
  }

  try {
    if (record.version !== VERSION) {
      record = await migrateVaultRecordWithEncodedKey(record, encodedKey);
      record = await saveVaultRecord(record);
    }

    if (state.vaultId && state.vaultId !== record.vaultId) {
      throw new Error("同步文件夹连接的是另一个保险库，请先断开后重新选择。");
    }

    state = await saveSyncState({ ...state, vaultId: record.vaultId, status: "syncing", lastError: null });
    const allRevisions = await provider.listRevisions();
    const otherVaults = new Set(
      allRevisions.filter((revision) => revision.vaultId !== record.vaultId).map((revision) => revision.vaultId)
    );
    const revisions = allRevisions.filter((revision) => revision.vaultId === record.vaultId);
    if (revisions.length === 0 && otherVaults.size > 0) {
      throw new Error("所选文件夹中已有另一个 SafeMarks 保险库，请选择专用空文件夹。");
    }

    const localPayload = await decryptVaultPayloadWithEncodedKey(record, encodedKey);
    if (revisions.length === 0) {
      const revision = await createSyncRevision({
        record,
        payload: localPayload,
        encodedKey,
        deviceId: state.deviceId,
        parentRevisionIds: []
      });
      await writeRevisionAndManifest(provider, revision);
      return persistSuccessfulSync({ state, revision, record });
    }

    const byId = new Map(revisions.map((revision) => [revision.revisionId, revision]));
    const headIds = findRevisionHeadIds(revisions);
    const heads = headIds.map((id) => byId.get(id)).filter(Boolean);
    if (heads.length === 0) {
      throw new Error("同步目录中的修订关系无效。");
    }

    const localUnchanged = state.lastSyncedVaultCiphertext === record.vault.ciphertext;
    const remoteUnchanged = heads.length === 1 && heads[0].revisionId === state.lastSyncedRevisionId;

    if (remoteUnchanged) {
      if (localUnchanged) {
        return saveSyncState({ ...state, status: "synced", lastSyncedAt: Date.now(), lastError: null });
      }
      // Local-only changes, including a master-password rotation, can advance
      // the known remote head without decrypting history encrypted by the old key.
      const revision = await createSyncRevision({
        record,
        payload: localPayload,
        encodedKey,
        deviceId: state.deviceId,
        parentRevisionIds: headIds
      });
      await writeRevisionAndManifest(provider, revision);
      return persistSuccessfulSync({ state, revision, record });
    }

    const remoteUsesDifferentKey = heads.some((revision) => (
      revision.crypto.salt !== record.salt
      || revision.crypto.kdf.iterations !== record.kdf.iterations
      || revision.crypto.auth.ciphertext !== record.auth.ciphertext
    ));
    if (remoteUsesDifferentKey) {
      const error = new Error("云端保险库的主密码已更改。请使用新主密码恢复云端版本；恢复前会下载当前本地加密备份。");
      error.code = "REMOTE_PASSWORD_CHANGED";
      throw error;
    }

    const baseRevision = state.lastSyncedRevisionId
      ? byId.get(state.lastSyncedRevisionId) ?? await loadSyncBaseRevision()
      : null;
    let basePayload = emptyPayload();
    if (baseRevision && baseRevision.vaultId === record.vaultId) {
      basePayload = (await decryptSyncRevision(baseRevision, encodedKey)).payload;
    }

    const remoteMerged = await mergeRemoteHeads(heads, basePayload, encodedKey);

    if (localUnchanged && heads.length === 1) {
      record = await encryptVaultPayloadWithEncodedKey(record, remoteMerged.payload, encodedKey);
      record = await saveVaultRecord(record);
      return persistSuccessfulSync({
        state,
        revision: heads[0],
        record,
        conflictCount: remoteMerged.conflicts.length
      });
    }

    let mergedPayload = localPayload;
    let conflicts = [...remoteMerged.conflicts];
    if (heads.length > 0) {
      const merged = mergeVaultPayloads({
        base: basePayload,
        local: localPayload,
        remote: remoteMerged.payload
      });
      mergedPayload = merged.payload;
      conflicts = conflicts.concat(merged.conflicts);
      record = await encryptVaultPayloadWithEncodedKey(record, mergedPayload, encodedKey);
      record = await saveVaultRecord(record);
    }

    const revision = await createSyncRevision({
      record,
      payload: mergedPayload,
      encodedKey,
      deviceId: state.deviceId,
      parentRevisionIds: headIds
    });
    await writeRevisionAndManifest(provider, revision);
    return persistSuccessfulSync({ state, revision, record, conflictCount: conflicts.length });
  } catch (error) {
    await saveSyncState({
      ...state,
      status: error?.code === "FOLDER_PERMISSION_REQUIRED"
        ? "folder-permission"
        : error?.code === "REMOTE_PASSWORD_CHANGED"
          ? "remote-password-changed"
          : "error",
      lastError: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export async function connectLocalFolderSync(handle) {
  const permission = await getLocalFolderPermission(handle, { request: true });
  if (permission !== "granted") {
    throw new Error("未授予同步文件夹读写权限。");
  }
  await saveLocalFolderHandle(handle);
  const current = await loadSyncState();
  return saveSyncState({
    ...current,
    enabled: true,
    provider: "local-folder",
    directoryName: handle.name,
    status: "ready",
    lastError: null
  });
}

export async function disconnectLocalFolderSync() {
  await clearLocalFolderHandle();
  await clearSyncState();
}

export async function markFolderSyncDirty() {
  const state = await loadSyncState();
  if (!state.enabled || state.provider !== "local-folder" || state.status === "syncing") {
    return state;
  }
  return saveSyncState({ ...state, status: "local-dirty", lastError: null });
}

export async function getLocalFolderSyncOverview() {
  const state = await loadSyncState();
  const provider = createLocalFolderProvider();
  const folder = await provider.getStatus();
  return { state, folder };
}

export function syncLocalFolderNow({ encodedKey, provider = createLocalFolderProvider() }) {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }
  activeSyncPromise = performFolderSync({ encodedKey, provider })
    .finally(() => {
      activeSyncPromise = null;
    });
  return activeSyncPromise;
}

async function deriveRevisionKey(revision, password) {
  const normalized = normalizeSyncRevision(revision);
  const key = await deriveKeyFromPassword(
    password,
    base64ToBytes(normalized.crypto.salt),
    normalized.crypto.kdf.iterations
  );
  try {
    if (await decryptString(normalized.crypto.auth, key) !== AUTH_SENTINEL) {
      throw new Error("密码错误");
    }
  } catch {
    throw new Error("主密码不正确，无法恢复云端保险库。");
  }
  return key;
}

export async function restoreVaultFromLocalFolder({ password, provider = createLocalFolderProvider() }) {
  const revisions = await provider.listRevisions();
  if (revisions.length === 0) {
    throw new Error("同步文件夹中没有 SafeMarks 修订。");
  }
  const vaultIds = [...new Set(revisions.map((revision) => revision.vaultId))];
  if (vaultIds.length !== 1) {
    throw new Error("同步文件夹包含多个保险库，请为 SafeMarks 选择专用文件夹。");
  }
  const vaultId = vaultIds[0];
  const vaultRevisions = revisions.filter((revision) => revision.vaultId === vaultId);
  const byId = new Map(vaultRevisions.map((revision) => [revision.revisionId, revision]));
  const heads = findRevisionHeadIds(vaultRevisions).map((id) => byId.get(id)).filter(Boolean);
  const newest = sortByCommittedAt(heads).at(-1);
  const key = await deriveRevisionKey(newest, password);
  const encodedKey = await exportKey(key);
  const remoteMerged = await mergeRemoteHeads(heads, emptyPayload(), encodedKey);
  const record = normalizeVaultRecord({
    version: VERSION,
    vaultId,
    salt: newest.crypto.salt,
    kdf: newest.crypto.kdf,
    auth: newest.crypto.auth,
    vault: await encryptJson(remoteMerged.payload, key),
    settings: {
      autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
      passwordHint: ""
    },
    meta: {
      bookmarkCount: remoteMerged.payload.bookmarks.length
    }
  });
  await saveVaultRecord(record);

  const state = await loadSyncState();
  await saveSyncState({
    ...state,
    enabled: true,
    provider: "local-folder",
    vaultId,
    lastSyncedRevisionId: heads.length === 1 ? newest.revisionId : null,
    lastSyncedVaultCiphertext: record.vault.ciphertext,
    lastSyncedAt: Date.now(),
    status: heads.length === 1 ? "synced" : "local-dirty",
    conflictCount: remoteMerged.conflicts.length,
    lastError: null
  });
  if (heads.length === 1) {
    await saveSyncBaseRevision(newest);
  }
  return { record, encodedKey, conflicts: remoteMerged.conflicts };
}

export async function requestStoredFolderPermission() {
  const handle = await loadLocalFolderHandle();
  if (!handle) {
    throw new Error("尚未选择同步文件夹。");
  }
  const permission = await getLocalFolderPermission(handle, { request: true });
  if (permission !== "granted") {
    throw new Error("未授予同步文件夹读写权限。");
  }
  return saveSyncState({ ...(await loadSyncState()), status: "ready", lastError: null });
}
