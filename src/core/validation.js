import {
  AUTO_LOCK_OPTIONS,
  DEFAULT_AUTO_LOCK_MINUTES,
  VERSION
} from "./constants.js";

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

  return [...uniquePaths].sort((left, right) => left.localeCompare(right, "zh-CN"));
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
  if (version !== VERSION) {
    throw new Error("Unsupported vault version.");
  }

  return {
    version,
    salt: assertString(value.salt, "Salt is invalid."),
    auth: normalizeEncryptedBlob(value.auth, "Auth blob"),
    vault: normalizeEncryptedBlob(value.vault, "Vault blob"),
    settings: {
      autoLockMinutes: normalizeAutoLockMinutes(value.settings?.autoLockMinutes)
    },
    meta: {
      bookmarkCount: normalizeBookmarkCount(value.meta?.bookmarkCount)
    }
  };
}

export function isSupportedBookmarkUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function createBookmarkInput({ url, title, note, folderPath }) {
  const normalizedUrl = assertString(url, "URL 不能为空。");
  if (!isSupportedBookmarkUrl(normalizedUrl)) {
    throw new Error("仅支持保存 http 或 https 页面。");
  }

  const normalizedTitle = (title ?? "").trim() || normalizedUrl;
  const normalizedNote = normalizeOptionalString(note);
  const normalizedFolderPath = normalizeFolderPath(folderPath);

  return {
    url: normalizedUrl,
    title: normalizedTitle,
    note: normalizedNote,
    folderPath: normalizedFolderPath
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

  return {
    id,
    url: input.url,
    title: input.title,
    note: input.note,
    folderPath: input.folderPath,
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag) => typeof tag === "string")
      : [],
    createdAt
  };
}

export function normalizeBookmarkList(value) {
  if (!Array.isArray(value)) {
    throw new Error("Bookmark list is invalid.");
  }

  return value.map(normalizeBookmark);
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
