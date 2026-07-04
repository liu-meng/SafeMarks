export const MAX_BOOKMARK_TAGS = 20;
export const MAX_TAG_LENGTH = 32;

function normalizeTagText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .slice(0, MAX_TAG_LENGTH)
    .trim();
}

export function normalizeBookmarkTags(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const tags = [];

  for (const candidate of value) {
    const tag = normalizeTagText(candidate);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) {
      continue;
    }

    seen.add(key);
    tags.push(tag);

    if (tags.length >= MAX_BOOKMARK_TAGS) {
      break;
    }
  }

  return tags;
}

/**
 * Collect all unique tags from bookmarks with their usage counts.
 * Returns a Map<string, number> of tag -> count, sorted by count desc.
 */
export function getTagCounts(bookmarks) {
  const counts = new Map();

  for (const bookmark of bookmarks) {
    if (!Array.isArray(bookmark.tags)) {
      continue;
    }
    for (const tag of bookmark.tags) {
      const key = tag.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return new Map(
    [...counts.entries()].sort((a, b) => b[1] - a[1])
  );
}

/**
 * Rename a tag across all bookmarks.
 * Returns a new bookmark array (does not mutate input).
 */
export function renameTagInBookmarks(bookmarks, oldTag, newTag) {
  const normalizedNew = normalizeTagText(newTag);
  if (!normalizedNew) {
    return bookmarks;
  }

  const oldLower = oldTag.toLowerCase();

  return bookmarks.map((bookmark) => {
    if (!Array.isArray(bookmark.tags)) {
      return bookmark;
    }

    const hasOld = bookmark.tags.some((t) => t.toLowerCase() === oldLower);
    if (!hasOld) {
      return bookmark;
    }

    const newTags = bookmark.tags.map((t) =>
      t.toLowerCase() === oldLower ? normalizedNew : t
    );

    return { ...bookmark, tags: normalizeBookmarkTags(newTags) };
  });
}

/**
 * Merge multiple source tags into a single target tag.
 * Returns a new bookmark array.
 */
export function mergeTagsInBookmarks(bookmarks, sourceTags, targetTag) {
  const normalizedTarget = normalizeTagText(targetTag);
  if (!normalizedTarget || sourceTags.length === 0) {
    return bookmarks;
  }

  const sourceSet = new Set(sourceTags.map((t) => t.toLowerCase()));

  return bookmarks.map((bookmark) => {
    if (!Array.isArray(bookmark.tags)) {
      return bookmark;
    }

    const hasSource = bookmark.tags.some((t) => sourceSet.has(t.toLowerCase()));
    if (!hasSource) {
      return bookmark;
    }

    const filtered = bookmark.tags.filter((t) => !sourceSet.has(t.toLowerCase()));
    const withTarget = [...filtered, normalizedTarget];

    return { ...bookmark, tags: normalizeBookmarkTags(withTarget) };
  });
}

/**
 * Delete a tag from all bookmarks.
 * Returns a new bookmark array.
 */
export function deleteTagFromBookmarks(bookmarks, tag) {
  const tagLower = tag.toLowerCase();

  return bookmarks.map((bookmark) => {
    if (!Array.isArray(bookmark.tags)) {
      return bookmark;
    }

    const hasTag = bookmark.tags.some((t) => t.toLowerCase() === tagLower);
    if (!hasTag) {
      return bookmark;
    }

    const newTags = bookmark.tags.filter((t) => t.toLowerCase() !== tagLower);
    return { ...bookmark, tags: newTags };
  });
}
