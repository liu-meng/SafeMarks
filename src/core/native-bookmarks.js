import { createBookmark } from "./vault.js";
import { isSupportedBookmarkUrl } from "./validation.js";

function hasChildren(node) {
  return Array.isArray(node?.children) && node.children.length > 0;
}

function isVirtualRootNode(node) {
  return !node?.url && !node?.parentId;
}

function normalizeFolderSegments(segments, node) {
  const title = typeof node?.title === "string" ? node.title.trim() : "";
  if (!title || isVirtualRootNode(node)) {
    return segments;
  }

  return [...segments, title];
}

function normalizeTimestamp(value, fallbackTimestamp) {
  const timestamp = Number(value);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return timestamp;
  }

  return fallbackTimestamp;
}

function visitBookmarkNode(node, segments, fallbackTimestamp, output) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (typeof node.url === "string" && node.url.length > 0) {
    if (!isSupportedBookmarkUrl(node.url)) {
      output.skippedCount += 1;
      return;
    }

    output.bookmarks.push(createBookmark({
      title: node.title || node.url,
      url: node.url,
      folderPath: segments.join("/"),
      note: "",
      createdAt: normalizeTimestamp(node.dateAdded, fallbackTimestamp)
    }));
    return;
  }

  if (!hasChildren(node)) {
    return;
  }

  const nextSegments = normalizeFolderSegments(segments, node);
  for (const child of node.children) {
    visitBookmarkNode(child, nextSegments, fallbackTimestamp, output);
  }
}

export function flattenNativeBookmarkTree(tree, now = Date.now()) {
  const roots = Array.isArray(tree) ? tree : [];
  const output = {
    bookmarks: [],
    skippedCount: 0
  };
  const fallbackTimestamp = normalizeTimestamp(now, Date.now());

  for (const node of roots) {
    visitBookmarkNode(node, [], fallbackTimestamp, output);
  }

  return output;
}
