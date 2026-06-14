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

export function renameFolderTreeInBookmarks(bookmarks = [], fromPath, toPath) {
  const normalizedFromPath = normalizeFolderPath(fromPath);
  const normalizedToPath = normalizeFolderPath(toPath);

  if (!normalizedFromPath || !normalizedToPath || normalizedFromPath === normalizedToPath) {
    return {
      nextBookmarks: [...bookmarks],
      renamedCount: 0,
      conflict: false,
      targetPath: normalizedToPath
    };
  }

  const fromPrefix = `${normalizedFromPath}/`;
  const toPrefix = `${normalizedToPath}/`;
  const isInSourceTree = (folderPath = "") => (
    folderPath === normalizedFromPath || folderPath.startsWith(fromPrefix)
  );
  const targetInsideSource = normalizedToPath.startsWith(fromPrefix);
  const targetExists = bookmarks.some((bookmark) => (
    !isInSourceTree(bookmark.folderPath)
      && (bookmark.folderPath === normalizedToPath || bookmark.folderPath.startsWith(toPrefix))
  ));

  if (targetInsideSource || targetExists) {
    return {
      nextBookmarks: [...bookmarks],
      renamedCount: 0,
      conflict: true,
      targetPath: normalizedToPath
    };
  }

  let renamedCount = 0;
  const nextBookmarks = bookmarks.map((bookmark) => {
    if (bookmark.folderPath === normalizedFromPath) {
      renamedCount += 1;
      return {
        ...bookmark,
        folderPath: normalizedToPath
      };
    }

    if (bookmark.folderPath.startsWith(fromPrefix)) {
      renamedCount += 1;
      return {
        ...bookmark,
        folderPath: `${normalizedToPath}/${bookmark.folderPath.slice(fromPrefix.length)}`
      };
    }

    return bookmark;
  });

  return {
    nextBookmarks,
    renamedCount,
    conflict: false,
    targetPath: normalizedToPath
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
