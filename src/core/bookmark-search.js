export function normalizeBookmarkQuery(query = "") {
  return typeof query === "string"
    ? query.trim().toLowerCase()
    : "";
}

const FIELD_WEIGHTS = Object.freeze({
  title: 500,
  tags: 400,
  folderPath: 300,
  note: 200,
  url: 100
});

function getSearchFields(bookmark) {
  return [
    { name: "title", value: bookmark.title ?? "" },
    { name: "tags", value: Array.isArray(bookmark.tags) ? bookmark.tags.join(" ") : "" },
    { name: "folderPath", value: bookmark.folderPath ?? "" },
    { name: "note", value: bookmark.note ?? "" },
    { name: "url", value: bookmark.url ?? "" }
  ];
}

function getSubsequenceDistance(value, query) {
  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;

  for (let valueIndex = 0; valueIndex < value.length && queryIndex < query.length; valueIndex += 1) {
    if (value[valueIndex] !== query[queryIndex]) {
      continue;
    }

    if (firstMatch === -1) {
      firstMatch = valueIndex;
    }
    lastMatch = valueIndex;
    queryIndex += 1;
  }

  if (queryIndex < query.length) {
    return null;
  }

  return lastMatch - firstMatch + 1;
}

function scoreField(field, query) {
  const value = field.value.toLowerCase();
  if (!value) {
    return 0;
  }

  const weight = FIELD_WEIGHTS[field.name] ?? 0;
  const exactIndex = value.indexOf(query);
  if (exactIndex !== -1) {
    return 10_000 + weight - exactIndex;
  }

  const distance = getSubsequenceDistance(value, query);
  if (distance === null) {
    return 0;
  }

  return 1_000 + weight - distance;
}

function scoreBookmark(bookmark, query) {
  return Math.max(
    0,
    ...getSearchFields(bookmark).map((field) => scoreField(field, query))
  );
}

export function getBookmarkSearchResults(bookmarks, query = "") {
  const normalizedQuery = normalizeBookmarkQuery(query);
  const sortedBookmarks = [...bookmarks].sort((left, right) => right.createdAt - left.createdAt);

  if (!normalizedQuery) {
    return sortedBookmarks;
  }

  return sortedBookmarks
    .map((bookmark) => ({
      bookmark,
      score: scoreBookmark(bookmark, normalizedQuery)
    }))
    .filter((result) => result.score > 0)
    .sort((left, right) => (
      right.score - left.score
        || right.bookmark.createdAt - left.bookmark.createdAt
    ))
    .map((result) => result.bookmark);
}
