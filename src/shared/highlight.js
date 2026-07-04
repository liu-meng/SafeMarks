/**
 * Search result highlighting utilities.
 * Returns DOM fragments with <mark> elements wrapping matched characters.
 */

/**
 * Get indices of characters that match the query via subsequence matching.
 * Returns an array of character indices, or null if no match.
 */
export function getMatchIndices(text, query) {
  if (!text || !query) {
    return null;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const indices = [];
  let queryIndex = 0;

  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i += 1) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      indices.push(i);
      queryIndex += 1;
    }
  }

  return queryIndex === lowerQuery.length ? indices : null;
}

/**
 * Create a DOM fragment with matched characters wrapped in <mark> elements.
 * Falls back to plain text node if no match.
 */
export function highlightText(text, query) {
  const fragment = document.createDocumentFragment();

  if (!query) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  const indices = getMatchIndices(text, query);
  if (!indices || indices.length === 0) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  const indexSet = new Set(indices);
  let currentRun = "";
  let currentIsMatch = false;

  for (let i = 0; i < text.length; i += 1) {
    const isMatch = indexSet.has(i);

    if (i === 0) {
      currentIsMatch = isMatch;
      currentRun = text[i];
      continue;
    }

    if (isMatch === currentIsMatch) {
      currentRun += text[i];
    } else {
      if (currentIsMatch) {
        const mark = document.createElement("mark");
        mark.textContent = currentRun;
        fragment.appendChild(mark);
      } else {
        fragment.appendChild(document.createTextNode(currentRun));
      }
      currentRun = text[i];
      currentIsMatch = isMatch;
    }
  }

  // Flush last run
  if (currentRun) {
    if (currentIsMatch) {
      const mark = document.createElement("mark");
      mark.textContent = currentRun;
      fragment.appendChild(mark);
    } else {
      fragment.appendChild(document.createTextNode(currentRun));
    }
  }

  return fragment;
}
