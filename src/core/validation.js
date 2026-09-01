import {
  AUTO_LOCK_OPTIONS,
  DEFAULT_AUTO_LOCK_MINUTES,
  KDF_HASH,
  LEGACY_KDF_ITERATIONS,
  LEGACY_VERSION,
  SUPPORTED_VERSIONS,
  VERSION
} from "./constants.js";
import { normalizeBookmarkTags } from "./tags.js";
import { getLocaleTag, t } from "../shared/i18n.js";

function assertObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
}

function assertString(value, message) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }

  return value.trim();
}

function normalizeOptionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveInteger(value, fallback, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

export function normalizeFolderPath(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

export function normalizeFolderCatalog(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniquePaths = new Set();
  for (const path of value) {
    const normalizedPath = normalizeFolderPath(path);
    if (normalizedPath) {
      uniquePaths.add(normalizedPath);
    }
  }

  return [...uniquePaths].sort((left, right) => left.localeCompare(right, getLocaleTag()));
}

function normalizeBookmarkCount(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("Bookmark count is invalid.");
  }

  return count;
}

export function normalizeAutoLockMinutes(value) {
  const minutes = Number(value);
  return AUTO_LOCK_OPTIONS.includes(minutes)
    ? minutes
    : DEFAULT_AUTO_LOCK_MINUTES;
}

export function normalizeEncryptedBlob(value, label = "Encrypted blob") {
  assertObject(value, `${label} is invalid.`);

  return {
    iv: assertString(value.iv, `${label} IV is invalid.`),
    ciphertext: assertString(value.ciphertext, `${label} ciphertext is invalid.`)
  };
}

export function normalizeVaultRecord(value) {
  assertObject(value, "Vault record is invalid.");

  const version = Number(value.version);
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new Error("Unsupported vault version.");
  }

  const normalized = {
    version,
    salt: assertString(value.salt, "Salt is invalid."),
    auth: normalizeEncryptedBlob(value.auth, "Auth blob"),
    vault: normalizeEncryptedBlob(value.vault, "Vault blob"),
    settings: {
      autoLockMinutes: normalizeAutoLockMinutes(value.settings?.autoLockMinutes),
      passwordHint: normalizeOptionalString(value.settings?.passwordHint)
    },
    meta: {
      bookmarkCount: normalizeBookmarkCount(value.meta?.bookmarkCount)
    }
  };

  if (version === VERSION) {
    normalized.vaultId = assertString(value.vaultId, "Vault id is invalid.");
    normalized.kdf = {
      name: value.kdf?.name === "PBKDF2" ? "PBKDF2" : "PBKDF2",
      hash: value.kdf?.hash === KDF_HASH ? KDF_HASH : KDF_HASH,
      iterations: normalizePositiveInteger(value.kdf?.iterations, undefined, "KDF iterations")
    };
  } else if (version === LEGACY_VERSION) {
    normalized.kdf = {
      name: "PBKDF2",
      hash: KDF_HASH,
      iterations: LEGACY_KDF_ITERATIONS
    };
  }

  return normalized;
}

export function isSupportedBookmarkUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function createBookmarkInput({ url, title, note, folderPath, tags }) {
  const normalizedUrl = assertString(url, t("URL 不能为空。"));
  if (!isSupportedBookmarkUrl(normalizedUrl)) {
    throw new Error(t("仅支持保存 http 或 https 页面。"));
  }

  const normalizedTitle = (title ?? "").trim() || normalizedUrl;
  const normalizedNote = normalizeOptionalString(note);
  const normalizedFolderPath = normalizeFolderPath(folderPath);

  return {
    url: normalizedUrl,
    title: normalizedTitle,
    note: normalizedNote,
    folderPath: normalizedFolderPath,
    tags: normalizeBookmarkTags(tags)
  };
}

export function normalizeBookmark(value) {
  assertObject(value, "Bookmark is invalid.");

  const id = assertString(value.id, "Bookmark id is invalid.");
  const input = createBookmarkInput(value);
  const createdAt = Number(value.createdAt);

  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    throw new Error("Bookmark createdAt is invalid.");
  }

  const rawUpdatedAt = Number(value.updatedAt);
  const updatedAt = Number.isFinite(rawUpdatedAt) && rawUpdatedAt > 0
    ? rawUpdatedAt
    : createdAt;

  return {
    id,
    url: input.url,
    title: input.title,
    note: input.note,
    folderPath: input.folderPath,
    tags: input.tags,
    createdAt,
    updatedAt
  };
}

export function normalizeBookmarkList(value) {
  if (!Array.isArray(value)) {
    throw new Error("Bookmark list is invalid.");
  }

  return value.map(normalizeBookmark);
}

export function normalizeTombstone(value) {
  assertObject(value, "Bookmark tombstone is invalid.");
  const deletedAt = Number(value.deletedAt);
  if (!Number.isFinite(deletedAt) || deletedAt <= 0) {
    throw new Error("Bookmark tombstone deletedAt is invalid.");
  }

  return {
    id: assertString(value.id, "Bookmark tombstone id is invalid."),
    deletedAt
  };
}

export function normalizeTombstoneList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const byId = new Map();
  for (const item of value) {
    const tombstone = normalizeTombstone(item);
    const current = byId.get(tombstone.id);
    if (!current || tombstone.deletedAt > current.deletedAt) {
      byId.set(tombstone.id, tombstone);
    }
  }
  return [...byId.values()];
}

export function normalizeVaultPayload(value) {
  if (Array.isArray(value)) {
    return {
      schemaVersion: LEGACY_VERSION,
      bookmarks: normalizeBookmarkList(value),
      tombstones: []
    };
  }

  assertObject(value, "Vault payload is invalid.");
  if (Number(value.schemaVersion) !== VERSION) {
    throw new Error("Unsupported vault payload version.");
  }

  const bookmarks = normalizeBookmarkList(value.bookmarks);
  const bookmarkIds = new Set(bookmarks.map((bookmark) => bookmark.id));
  return {
    schemaVersion: VERSION,
    bookmarks,
    tombstones: normalizeTombstoneList(value.tombstones).filter(
      (tombstone) => !bookmarkIds.has(tombstone.id)
    )
  };
}

export function normalizeSessionRecord(value) {
  assertObject(value, "Session record is invalid.");

  const encodedKey = assertString(value.encodedKey, "Session key is invalid.");
  const lastActivityAt = Number(value.lastActivityAt);
  const expiresAt = Number(value.expiresAt);

  if (!Number.isFinite(lastActivityAt) || !Number.isFinite(expiresAt)) {
    throw new Error("Session timestamps are invalid.");
  }

  return {
    encodedKey,
    autoLockMinutes: normalizeAutoLockMinutes(value.autoLockMinutes),
    lastActivityAt,
    expiresAt
  };
}
