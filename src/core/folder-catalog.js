import { loadFolderCatalog, saveFolderCatalog } from "./storage.js";
import { normalizeFolderCatalog, normalizeFolderPath } from "./validation.js";

export function getFolderCatalogFromBookmarks(bookmarks = []) {
  return normalizeFolderCatalog(bookmarks.map((bookmark) => bookmark.folderPath));
}

export function removeFolderTreeFromBookmarks(bookmarks = [], folderPath) {
  const normalizedFolderPath = normalizeFolderPath(folderPath);
  if (!normalizedFolderPath) {
    return {
      nextBookmarks: [...bookmarks],
      removedCount: 0
    };
  }

  const folderPrefix = `${normalizedFolderPath}/`;
  const nextBookmarks = bookmarks.filter((bookmark) => (
    bookmark.folderPath !== normalizedFolderPath
      && !bookmark.folderPath.startsWith(folderPrefix)
  ));

  return {
    nextBookmarks,
    removedCount: bookmarks.length - nextBookmarks.length
  };
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
