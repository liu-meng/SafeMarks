import { normalizeBookmarkTags } from "./tags.js";
import { normalizeFolderPath } from "./validation.js";

function getSelectedIdSet(ids) {
  return new Set(Array.isArray(ids) ? ids : []);
}

function normalizeTagKey(tag) {
  return tag.toLowerCase();
}

export function addTagsToBookmarks(bookmarks, ids, tags) {
  const selectedIds = getSelectedIdSet(ids);
  const tagsToAdd = normalizeBookmarkTags(tags);
  if (selectedIds.size === 0 || tagsToAdd.length === 0) {
    return [...bookmarks];
  }

  return bookmarks.map((bookmark) => {
    if (!selectedIds.has(bookmark.id)) {
      return bookmark;
    }

    return {
      ...bookmark,
      tags: normalizeBookmarkTags([...(bookmark.tags ?? []), ...tagsToAdd])
    };
  });
}

export function removeTagsFromBookmarks(bookmarks, ids, tags) {
  const selectedIds = getSelectedIdSet(ids);
  const tagsToRemove = new Set(normalizeBookmarkTags(tags).map(normalizeTagKey));
  if (selectedIds.size === 0 || tagsToRemove.size === 0) {
    return [...bookmarks];
  }

  return bookmarks.map((bookmark) => {
    if (!selectedIds.has(bookmark.id)) {
      return bookmark;
    }

    return {
      ...bookmark,
      tags: normalizeBookmarkTags(bookmark.tags).filter(
        (tag) => !tagsToRemove.has(normalizeTagKey(tag))
      )
    };
  });
}

export function moveBookmarksToFolder(bookmarks, ids, folderPath) {
  const selectedIds = getSelectedIdSet(ids);
  const normalizedFolderPath = normalizeFolderPath(folderPath);
  if (selectedIds.size === 0) {
    return [...bookmarks];
  }

  return bookmarks.map((bookmark) => (
    selectedIds.has(bookmark.id)
      ? { ...bookmark, folderPath: normalizedFolderPath }
      : bookmark
  ));
}

export function deleteBookmarksByIds(bookmarks, ids) {
  const selectedIds = getSelectedIdSet(ids);
  if (selectedIds.size === 0) {
    return [...bookmarks];
  }

  return bookmarks.filter((bookmark) => !selectedIds.has(bookmark.id));
}
