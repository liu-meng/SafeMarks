import { RECENT_FOLDER_PATHS_STORAGE_KEY } from "./constants.js";
import { normalizeFolderPath } from "./validation.js";

export const MAX_RECENT_FOLDER_PATHS = 8;

function requireChromeStorage() {
  if (!globalThis.chrome?.storage?.local) {
    throw new Error("chrome.storage.local is unavailable.");
  }

  return globalThis.chrome.storage.local;
}

export function normalizeRecentFolderPaths(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const paths = [];

  for (const candidate of value) {
    const folderPath = normalizeFolderPath(candidate);
    const key = folderPath.toLowerCase();
    if (!folderPath || seen.has(key)) {
      continue;
    }

    seen.add(key);
    paths.push(folderPath);

    if (paths.length >= MAX_RECENT_FOLDER_PATHS) {
      break;
    }
  }

  return paths;
}

export function addRecentFolderPath(currentPaths, folderPath) {
  const normalizedFolderPath = normalizeFolderPath(folderPath);
  if (!normalizedFolderPath) {
    return normalizeRecentFolderPaths(currentPaths);
  }

  return normalizeRecentFolderPaths([
    normalizedFolderPath,
    ...normalizeRecentFolderPaths(currentPaths).filter(
      (currentPath) => currentPath.toLowerCase() !== normalizedFolderPath.toLowerCase()
    )
  ]);
}

export async function loadRecentFolderPaths() {
  const stored = await requireChromeStorage().get(RECENT_FOLDER_PATHS_STORAGE_KEY);
  return normalizeRecentFolderPaths(stored[RECENT_FOLDER_PATHS_STORAGE_KEY]);
}

export async function saveRecentFolderPaths(folderPaths) {
  const normalized = normalizeRecentFolderPaths(folderPaths);
  await requireChromeStorage().set({
    [RECENT_FOLDER_PATHS_STORAGE_KEY]: normalized
  });
  return normalized;
}

export async function rememberRecentFolderPath(folderPath) {
  const currentPaths = await loadRecentFolderPaths();
  return saveRecentFolderPaths(addRecentFolderPath(currentPaths, folderPath));
}
