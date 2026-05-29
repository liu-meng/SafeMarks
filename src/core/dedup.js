function normalizeUrlForDedup(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (url.origin + url.pathname.replace(/\/+$/, "") + url.search + url.hash).toLowerCase();
  } catch {
    return rawUrl.toLowerCase().trim();
  }
}

export function findDuplicates(existing, incoming) {
  const existingUrls = new Map();
  for (const bm of existing) {
    const key = normalizeUrlForDedup(bm.url);
    if (!existingUrls.has(key)) existingUrls.set(key, bm);
  }

  const duplicates = [];
  const unique = [];
  for (const bm of incoming) {
    const key = normalizeUrlForDedup(bm.url);
    if (existingUrls.has(key)) {
      duplicates.push({ incoming: bm, existing: existingUrls.get(key) });
    } else {
      unique.push(bm);
    }
  }

  return { duplicates, unique };
}

export function findInternalDuplicates(bookmarks) {
  const urlGroups = new Map();
  for (const bm of bookmarks) {
    const key = normalizeUrlForDedup(bm.url);
    if (!urlGroups.has(key)) urlGroups.set(key, []);
    urlGroups.get(key).push(bm);
  }

  return [...urlGroups.values()].filter((group) => group.length > 1);
}
