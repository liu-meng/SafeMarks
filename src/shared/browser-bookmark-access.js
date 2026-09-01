export const BOOKMARK_ACCESS_ERROR_CODES = Object.freeze({
  PERMISSION_API_UNAVAILABLE: "permission-api-unavailable",
  BOOKMARKS_API_UNAVAILABLE: "bookmarks-api-unavailable"
});

function createAccessError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function requestBrowserBookmarkTree(chromeApi = globalThis.chrome) {
  if (!chromeApi?.permissions?.request) {
    throw createAccessError(BOOKMARK_ACCESS_ERROR_CODES.PERMISSION_API_UNAVAILABLE);
  }

  const granted = await chromeApi.permissions.request({
    permissions: ["bookmarks"]
  });
  if (!granted) {
    return { granted: false, tree: [] };
  }

  if (!chromeApi.bookmarks?.getTree) {
    throw createAccessError(BOOKMARK_ACCESS_ERROR_CODES.BOOKMARKS_API_UNAVAILABLE);
  }

  return {
    granted: true,
    tree: await chromeApi.bookmarks.getTree()
  };
}
