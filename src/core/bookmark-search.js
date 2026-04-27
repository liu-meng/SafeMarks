export function normalizeBookmarkQuery(query = "") {
  return typeof query === "string"
    ? query.trim().toLowerCase()
    : "";
}

function getBookmarkSearchIndex(bookmark) {
  return [
    bookmark.title,
    bookmark.url,
    bookmark.folderPath,
    bookmark.note
  ].join("\n").toLowerCase();
}

export function getBookmarkSearchResults(bookmarks, query = "") {
  const normalizedQuery = normalizeBookmarkQuery(query);
  const sortedBookmarks = [...bookmarks].sort((left, right) => right.createdAt - left.createdAt);

  if (!normalizedQuery) {
    return sortedBookmarks;
  }

  return sortedBookmarks.filter((bookmark) => getBookmarkSearchIndex(bookmark).includes(normalizedQuery));
}
