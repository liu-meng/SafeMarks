import { isSupportedBookmarkUrl } from "./validation.js";

export async function getCurrentPageCandidate() {
  if (!globalThis.chrome?.tabs?.query) {
    return {
      supported: false,
      reason: "当前环境无法读取标签页信息。"
    };
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.url) {
    return {
      supported: false,
      reason: "当前页面无法读取 URL。"
    };
  }

  if (!isSupportedBookmarkUrl(tab.url)) {
    return {
      supported: false,
      reason: "仅支持保存普通网页，不支持浏览器内部页面。"
    };
  }

  return {
    supported: true,
    title: tab.title?.trim() || tab.url,
    url: tab.url
  };
}
