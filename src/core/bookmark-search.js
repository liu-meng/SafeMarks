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

const FILTER_PREFIXES = Object.freeze(["tag:", "folder:", "site:"]);

/**
 * Parse structured search syntax from a raw query string.
 * Supports: tag:xxx, folder:xxx, site:xxx
 * Returns { terms, filters: { tags[], folders[], sites[] } }
 */
export function parseSearchQuery(raw = "") {
  const filters = { tags: [], folders: [], sites: [] };
  const terms = [];

  const tokens = raw.trim().split(/\s+/);
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith("tag:") && token.length > 4) {
      filters.tags.push(token.slice(4).toLowerCase());
    } else if (lower.startsWith("folder:") && token.length > 7) {
      filters.folders.push(token.slice(7).toLowerCase());
    } else if (lower.startsWith("site:") && token.length > 5) {
      filters.sites.push(token.slice(5).toLowerCase());
    } else {
      terms.push(token);
    }
  }

  return { terms: terms.join(" "), filters };
}

/**
 * Extract the free-text portion of a query (excludes filter prefixes).
 * Used by highlight to only highlight the text search terms.
 */
export function getFreeTextQuery(query = "") {
  const { terms } = parseSearchQuery(query);
  return terms;
}

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

function matchesFilters(bookmark, filters) {
  if (filters.tags.length > 0) {
    const bookmarkTags = (bookmark.tags || []).map((tag) => tag.toLowerCase());
    if (!filters.tags.every((filterTag) => bookmarkTags.includes(filterTag))) {
      return false;
    }
  }

  if (filters.folders.length > 0) {
    const folderPath = (bookmark.folderPath || "").toLowerCase();
    if (!filters.folders.some((f) => folderPath.includes(f))) {
      return false;
    }
  }

  if (filters.sites.length > 0) {
    const url = (bookmark.url || "").toLowerCase();
    if (!filters.sites.some((site) => url.includes(site))) {
      return false;
    }
  }

  return true;
}

export function getBookmarkSearchResults(bookmarks, query = "", sortBy = "createdAt-desc") {
  const { terms, filters } = parseSearchQuery(query);
  const normalizedTerms = normalizeBookmarkQuery(terms);
  const hasFilters = filters.tags.length > 0 || filters.folders.length > 0 || filters.sites.length > 0;

  let results = [...bookmarks];

  // Apply structured filters
  if (hasFilters) {
    results = results.filter((bookmark) => matchesFilters(bookmark, filters));
  }

  // Apply free-text search
  if (normalizedTerms) {
    results = results
      .map((bookmark) => ({
        bookmark,
        score: scoreBookmark(bookmark, normalizedTerms)
      }))
      .filter((result) => result.score > 0)
      .sort((left, right) => (
        right.score - left.score
          || right.bookmark.createdAt - left.bookmark.createdAt
      ))
      .map((result) => result.bookmark);
  } else {
    // Sort by chosen order when no free-text query
    results = sortBookmarks(results, sortBy);
  }

  return results;
}

function sortBookmarks(bookmarks, sortBy) {
  switch (sortBy) {
    case "createdAt-asc":
      return bookmarks.sort((a, b) => a.createdAt - b.createdAt);
    case "title-asc":
      return bookmarks.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    case "title-desc":
      return bookmarks.sort((a, b) => (b.title || "").localeCompare(a.title || ""));
    case "createdAt-desc":
    default:
      return bookmarks.sort((a, b) => b.createdAt - a.createdAt);
  }
}
