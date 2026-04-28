import {
  addFolderPathToCatalog,
  syncFolderCatalogFromBookmarks
} from "./folder-catalog.js";
import {
  clearPendingQuickCaptures,
  loadPendingQuickCaptures,
  savePendingQuickCaptures,
  saveVaultRecord
} from "./storage.js";
import { getCurrentPageCandidate, getPageFaviconUrl } from "./tabs.js";
import {
  createBookmark,
  decryptBookmarksWithEncodedKey,
  encryptBookmarksWithEncodedKey
} from "./vault.js";

export async function getQuickCaptureDraft() {
  const candidate = await getCurrentPageCandidate();
  if (!candidate.supported) {
    throw new Error(candidate.reason);
  }

  return {
    title: candidate.title,
    url: candidate.url,
    faviconUrl: getPageFaviconUrl(candidate.url, candidate.faviconUrl)
  };
}

export function createQuickCaptureBookmark(draft) {
  return createBookmark({
    title: draft.title,
    url: draft.url,
    note: draft.note,
    folderPath: draft.folderPath
  });
}

export async function saveQuickCaptureBookmark({
  bookmark,
  record,
  encodedKey,
  currentBookmarks = null
}) {
  const baseBookmarks = currentBookmarks ?? await decryptBookmarksWithEncodedKey(record, encodedKey);
  const nextBookmarks = [bookmark, ...baseBookmarks];
  const nextRecord = await encryptBookmarksWithEncodedKey(record, nextBookmarks, encodedKey);

  await saveVaultRecord(nextRecord);
  await syncFolderCatalogFromBookmarks(nextBookmarks);

  return {
    bookmark,
    record: nextRecord,
    bookmarks: nextBookmarks,
    bookmarkCount: nextBookmarks.length
  };
}

export async function queueQuickCaptureBookmark(bookmark) {
  const pending = await loadPendingQuickCaptures();
  const nextPending = [bookmark, ...pending];

  await savePendingQuickCaptures(nextPending);
  await addFolderPathToCatalog(bookmark.folderPath);

  return {
    bookmark,
    pendingCount: nextPending.length
  };
}

export async function saveCurrentPageQuickCapture(record, encodedKey) {
  const bookmark = createQuickCaptureBookmark(await getQuickCaptureDraft());
  const currentBookmarks = await decryptBookmarksWithEncodedKey(record, encodedKey);
  const nextBookmarks = [bookmark, ...currentBookmarks];
  const nextRecord = await encryptBookmarksWithEncodedKey(record, nextBookmarks, encodedKey);

  await saveVaultRecord(nextRecord);
  await syncFolderCatalogFromBookmarks(nextBookmarks);

  return {
    bookmark,
    record: nextRecord,
    bookmarks: nextBookmarks,
    bookmarkCount: nextBookmarks.length
  };
}

export async function queueCurrentPageQuickCapture() {
  const bookmark = createQuickCaptureBookmark(await getQuickCaptureDraft());
  return queueQuickCaptureBookmark(bookmark);
}

export async function flushPendingQuickCaptures({
  record,
  encodedKey,
  currentBookmarks = null
}) {
  const pending = await loadPendingQuickCaptures();
  if (pending.length === 0) {
    return {
      record,
      bookmarks: currentBookmarks,
      importedCount: 0
    };
  }

  const baseBookmarks = currentBookmarks ?? await decryptBookmarksWithEncodedKey(record, encodedKey);
  const nextBookmarks = [...pending, ...baseBookmarks];
  const nextRecord = await encryptBookmarksWithEncodedKey(record, nextBookmarks, encodedKey);

  await saveVaultRecord(nextRecord);
  await clearPendingQuickCaptures();
  await syncFolderCatalogFromBookmarks(nextBookmarks);

  return {
    record: nextRecord,
    bookmarks: nextBookmarks,
    importedCount: pending.length
  };
}
