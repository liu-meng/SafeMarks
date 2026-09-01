import {
  AUTH_SENTINEL,
  DEFAULT_KDF_ITERATIONS,
  KDF_HASH,
  LEGACY_KDF_ITERATIONS,
  VERSION
} from "./constants.js";
import {
  decryptJson,
  decryptString,
  deriveKeyFromPassword,
  encryptJson,
  encryptString,
  exportKey,
  importKey,
  randomBytes
} from "./crypto.js";
import {
  createBookmarkInput,
  normalizeAutoLockMinutes,
  normalizeBookmarkList,
  normalizeTombstoneList,
  normalizeVaultPayload,
  normalizeVaultRecord
} from "./validation.js";
import { bytesToBase64, base64ToBytes } from "./base64.js";
import { t } from "../shared/i18n.js";

function createBookmarkId() {
  return `bm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createVaultId() {
  return `vault_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

function createVaultMeta(bookmarks) {
  return {
    bookmarkCount: bookmarks.length
  };
}

export function createBookmark(payload) {
  const input = createBookmarkInput(payload);
  const createdAt = Number(payload?.createdAt);

  const normalizedCreatedAt =
    Number.isFinite(createdAt) && createdAt > 0
      ? createdAt
      : Date.now();

  return {
    id: createBookmarkId(),
    url: input.url,
    title: input.title,
    note: input.note,
    folderPath: input.folderPath,
    tags: input.tags,
    createdAt: normalizedCreatedAt,
    updatedAt: normalizedCreatedAt
  };
}

function getRecordKdfIterations(record) {
  return record.version === VERSION
    ? record.kdf.iterations
    : LEGACY_KDF_ITERATIONS;
}

function createVaultPayload(bookmarks = [], tombstones = []) {
  return normalizeVaultPayload({
    schemaVersion: VERSION,
    bookmarks,
    tombstones
  });
}

function bookmarkContentFingerprint(bookmark) {
  return JSON.stringify({
    url: bookmark.url,
    title: bookmark.title,
    note: bookmark.note,
    folderPath: bookmark.folderPath,
    tags: bookmark.tags
  });
}

function trackBookmarkChanges(currentPayload, requestedBookmarks, now = Date.now()) {
  const currentById = new Map(
    currentPayload.bookmarks.map((bookmark) => [bookmark.id, bookmark])
  );
  const requested = normalizeBookmarkList(requestedBookmarks).map((bookmark) => {
    const current = currentById.get(bookmark.id);
    if (!current) {
      return {
        ...bookmark,
        updatedAt: bookmark.updatedAt || bookmark.createdAt || now
      };
    }

    return {
      ...bookmark,
      updatedAt: bookmarkContentFingerprint(current) === bookmarkContentFingerprint(bookmark)
        ? current.updatedAt
        : now
    };
  });

  const requestedIds = new Set(requested.map((bookmark) => bookmark.id));
  const tombstones = new Map(
    normalizeTombstoneList(currentPayload.tombstones).map((item) => [item.id, item])
  );

  for (const bookmark of currentPayload.bookmarks) {
    if (!requestedIds.has(bookmark.id)) {
      tombstones.set(bookmark.id, {
        id: bookmark.id,
        deletedAt: now
      });
    }
  }
  for (const bookmark of requested) {
    tombstones.delete(bookmark.id);
  }

  return createVaultPayload(requested, [...tombstones.values()]);
}

export async function createVaultRecord(password, autoLockMinutes, passwordHint = "") {
  const saltBytes = randomBytes(16);
  const key = await deriveKeyFromPassword(password, saltBytes, DEFAULT_KDF_ITERATIONS);

  const record = {
    version: VERSION,
    vaultId: createVaultId(),
    salt: bytesToBase64(saltBytes),
    kdf: {
      name: "PBKDF2",
      hash: KDF_HASH,
      iterations: DEFAULT_KDF_ITERATIONS
    },
    auth: await encryptString(AUTH_SENTINEL, key),
    vault: await encryptJson(createVaultPayload(), key),
    meta: createVaultMeta([]),
    settings: {
      autoLockMinutes: normalizeAutoLockMinutes(autoLockMinutes),
      passwordHint: typeof passwordHint === "string" ? passwordHint.trim() : ""
    }
  };

  return {
    record: normalizeVaultRecord(record),
    encodedKey: await exportKey(key)
  };
}

export async function unlockVaultRecord(record, password) {
  const normalized = normalizeVaultRecord(record);
  try {
    const key = await deriveKeyFromPassword(
      password,
      base64ToBytes(normalized.salt),
      getRecordKdfIterations(normalized)
    );
    const sentinel = await decryptString(normalized.auth, key);

    if (sentinel !== AUTH_SENTINEL) {
      throw new Error(t("主密码不正确。"));
    }

    const payload = normalizeVaultPayload(await decryptJson(normalized.vault, key));

    return {
      record: normalized,
      bookmarks: payload.bookmarks,
      tombstones: payload.tombstones,
      encodedKey: await exportKey(key)
    };
  } catch (error) {
    if (error instanceof Error && error.message === t("主密码不正确。")) {
      throw error;
    }

    throw new Error(t("主密码不正确。"));
  }
}

export async function decryptBookmarksWithEncodedKey(record, encodedKey) {
  return (await decryptVaultPayloadWithEncodedKey(record, encodedKey)).bookmarks;
}

export async function decryptVaultPayloadWithEncodedKey(record, encodedKey) {
  const normalized = normalizeVaultRecord(record);
  const key = await importKey(encodedKey);
  return normalizeVaultPayload(await decryptJson(normalized.vault, key));
}

export async function encryptVaultPayloadWithEncodedKey(record, payload, encodedKey) {
  const normalized = normalizeVaultRecord(record);
  const key = await importKey(encodedKey);
  const normalizedPayload = createVaultPayload(payload.bookmarks, payload.tombstones);
  const nextRecord = normalized.version === VERSION
    ? normalized
    : {
        ...normalized,
        version: VERSION,
        vaultId: createVaultId(),
        kdf: {
          name: "PBKDF2",
          hash: KDF_HASH,
          iterations: LEGACY_KDF_ITERATIONS
        }
      };

  return normalizeVaultRecord({
    ...nextRecord,
    vault: await encryptJson(normalizedPayload, key),
    meta: createVaultMeta(normalizedPayload.bookmarks)
  });
}

export async function migrateVaultRecordWithEncodedKey(record, encodedKey) {
  const normalized = normalizeVaultRecord(record);
  if (normalized.version === VERSION) {
    return normalized;
  }
  const payload = await decryptVaultPayloadWithEncodedKey(normalized, encodedKey);
  return encryptVaultPayloadWithEncodedKey(normalized, payload, encodedKey);
}

export async function encryptBookmarksWithEncodedKey(record, bookmarks, encodedKey) {
  const normalized = normalizeVaultRecord(record);
  const key = await importKey(encodedKey);
  const currentPayload = normalizeVaultPayload(await decryptJson(normalized.vault, key));
  const nextPayload = trackBookmarkChanges(currentPayload, bookmarks);
  return encryptVaultPayloadWithEncodedKey(normalized, nextPayload, encodedKey);
}

export async function changeVaultPassword(record, currentPassword, newPassword, newAutoLockMinutes, newPasswordHint) {
  const unlocked = await unlockVaultRecord(record, currentPassword);
  const saltBytes = randomBytes(16);
  const newKey = await deriveKeyFromPassword(newPassword, saltBytes, DEFAULT_KDF_ITERATIONS);
  const payload = createVaultPayload(unlocked.bookmarks, unlocked.tombstones);

  const nextRecord = normalizeVaultRecord({
    ...unlocked.record,
    version: VERSION,
    vaultId: unlocked.record.vaultId || createVaultId(),
    salt: bytesToBase64(saltBytes),
    kdf: {
      name: "PBKDF2",
      hash: KDF_HASH,
      iterations: DEFAULT_KDF_ITERATIONS
    },
    auth: await encryptString(AUTH_SENTINEL, newKey),
    vault: await encryptJson(payload, newKey),
    settings: {
      ...unlocked.record.settings,
      autoLockMinutes: normalizeAutoLockMinutes(newAutoLockMinutes ?? unlocked.record.settings.autoLockMinutes),
      passwordHint: typeof newPasswordHint === "string" ? newPasswordHint.trim() : unlocked.record.settings.passwordHint
    }
  });

  return {
    record: nextRecord,
    bookmarks: unlocked.bookmarks,
    encodedKey: await exportKey(newKey)
  };
}
