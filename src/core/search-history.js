/**
 * Search history persistence.
 * Stores the most recent search queries in chrome.storage.local.
 */

const STORAGE_KEY = "searchHistory";
const MAX_HISTORY = 10;

export async function loadSearchHistory() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const history = result[STORAGE_KEY];
    return Array.isArray(history) ? history.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

export async function addSearchHistoryEntry(query) {
  const trimmed = (query || "").trim();
  if (!trimmed) {
    return;
  }

  const history = await loadSearchHistory();
  const filtered = history.filter((item) => item !== trimmed);
  filtered.unshift(trimmed);
  const updated = filtered.slice(0, MAX_HISTORY);

  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
}

export async function clearSearchHistory() {
  await chrome.storage.local.remove(STORAGE_KEY);
}
