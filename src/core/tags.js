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
