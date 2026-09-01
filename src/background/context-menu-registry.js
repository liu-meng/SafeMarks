export const CONTEXT_MENU_ITEMS = Object.freeze([
  Object.freeze({
    id: "safemarks-save-page",
    title: "保存到 SafeMarks",
    contexts: Object.freeze(["page", "link"])
  }),
  Object.freeze({
    id: "safemarks-save-selection",
    title: "保存到 SafeMarks（含选中文本）",
    contexts: Object.freeze(["selection"])
  })
]);

function callContextMenuApi(invoke, getLastError) {
  return new Promise((resolve, reject) => {
    invoke(() => {
      const lastError = getLastError();
      if (lastError) {
        reject(new Error(lastError.message || String(lastError)));
        return;
      }
      resolve();
    });
  });
}

export function createContextMenuRegistrar({
  contextMenus,
  getLastError = () => null,
  translate = (value) => value
}) {
  if (!contextMenus?.removeAll || !contextMenus?.create) {
    throw new Error("chrome.contextMenus is unavailable.");
  }

  let activeRegistration = null;

  async function registerOnce() {
    await callContextMenuApi(
      (callback) => contextMenus.removeAll(callback),
      getLastError
    );

    for (const item of CONTEXT_MENU_ITEMS) {
      await callContextMenuApi(
        (callback) => contextMenus.create({
          ...item,
          contexts: [...item.contexts],
          title: translate(item.title)
        }, callback),
        getLastError
      );
    }
  }

  return function registerContextMenus() {
    if (activeRegistration) {
      return activeRegistration;
    }

    activeRegistration = registerOnce().finally(() => {
      activeRegistration = null;
    });
    return activeRegistration;
  };
}
