import { AUTH_SENTINEL, VERSION } from "./constants.js";
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
  normalizeVaultRecord
} from "./validation.js";
import { bytesToBase64, base64ToBytes } from "./base64.js";

function createBookmarkId() {
  return `bm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createVaultMeta(bookmarks) {
  return {
    bookmarkCount: bookmarks.length
  };
}

export function createBookmark(payload) {
  const input = createBookmarkInput(payload);
  const createdAt = Number(payload?.createdAt);

  return {
    id: createBookmarkId(),
    url: input.url,
    title: input.title,
    note: input.note,
    folderPath: input.folderPath,
    tags: [],
    createdAt:
      Number.isFinite(createdAt) && createdAt > 0
        ? createdAt
        : Date.now()
  };
}

export async function createVaultRecord(password, autoLockMinutes) {
  const saltBytes = randomBytes(16);
  const key = await deriveKeyFromPassword(password, saltBytes);

  const record = {
    version: VERSION,
    salt: bytesToBase64(saltBytes),
    auth: await encryptString(AUTH_SENTINEL, key),
    vault: await encryptJson([], key),
    meta: createVaultMeta([]),
    settings: {
      autoLockMinutes: normalizeAutoLockMinutes(autoLockMinutes)
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
    const key = await deriveKeyFromPassword(password, base64ToBytes(normalized.salt));
    const sentinel = await decryptString(normalized.auth, key);

    if (sentinel !== AUTH_SENTINEL) {
      throw new Error("主密码不正确。");
    }

    const bookmarks = normalizeBookmarkList(await decryptJson(normalized.vault, key));

    return {
      record: normalized,
      bookmarks,
      encodedKey: await exportKey(key)
    };
  } catch (error) {
    if (error instanceof Error && error.message === "主密码不正确。") {
      throw error;
    }

    throw new Error("主密码不正确。");
  }
}

export async function decryptBookmarksWithEncodedKey(record, encodedKey) {
  const normalized = normalizeVaultRecord(record);
  const key = await importKey(encodedKey);
  return normalizeBookmarkList(await decryptJson(normalized.vault, key));
}

export async function encryptBookmarksWithEncodedKey(record, bookmarks, encodedKey) {
  const normalized = normalizeVaultRecord(record);
  const key = await importKey(encodedKey);
  const normalizedBookmarks = normalizeBookmarkList(bookmarks);

  return normalizeVaultRecord({
    ...normalized,
    vault: await encryptJson(normalizedBookmarks, key),
    meta: createVaultMeta(normalizedBookmarks)
  });
}
