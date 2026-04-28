import { loadFolderCatalog, saveFolderCatalog } from "./storage.js";
import { normalizeFolderCatalog, normalizeFolderPath } from "./validation.js";

export function getFolderCatalogFromBookmarks(bookmarks = []) {
  return normalizeFolderCatalog(bookmarks.map((bookmark) => bookmark.folderPath));
}

export async function syncFolderCatalogFromBookmarks(bookmarks = []) {
  const catalog = getFolderCatalogFromBookmarks(bookmarks);
  await saveFolderCatalog(catalog);
  return catalog;
}

export async function addFolderPathToCatalog(folderPath) {
  const normalizedFolderPath = normalizeFolderPath(folderPath);
  const currentCatalog = await loadFolderCatalog();

  if (!normalizedFolderPath) {
    return currentCatalog;
  }

  const nextCatalog = normalizeFolderCatalog([
    ...currentCatalog,
    normalizedFolderPath
  ]);
  await saveFolderCatalog(nextCatalog);
  return nextCatalog;
}
