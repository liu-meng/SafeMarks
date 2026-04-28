import { loadFolderCatalog, loadVaultRecord } from "../core/storage.js";
import { sessionStatus, sessionTouch } from "../core/session.js";
import { decryptBookmarksWithEncodedKey } from "../core/vault.js";
import {
  createQuickCaptureBookmark,
  flushPendingQuickCaptures,
  queueQuickCaptureBookmark,
  saveQuickCaptureBookmark
} from "../core/quick-capture.js";
import { syncFolderCatalogFromBookmarks } from "../core/folder-catalog.js";
import { initializeI18n, localizeDocument, t } from "../shared/i18n.js";

await initializeI18n();
localizeDocument();

const elements = {
  mode: document.querySelector("#capture-mode"),
  helper: document.querySelector("#capture-helper"),
  message: document.querySelector("#capture-message"),
  closeWindow: document.querySelector("#close-window"),
  previewFaviconShell: document.querySelector("#preview-favicon-shell"),
  previewFavicon: document.querySelector("#preview-favicon"),
  previewTitle: document.querySelector("#preview-title"),
  previewUrl: document.querySelector("#preview-url"),
  form: document.querySelector("#quick-capture-form"),
  title: document.querySelector("#capture-title"),
  url: document.querySelector("#capture-url"),
  existingFolderSelect: document.querySelector("#existing-folder-select"),
  folderPath: document.querySelector("#capture-folder-path"),
  folderHelper: document.querySelector("#folder-helper"),
  submit: document.querySelector("#capture-submit"),
  openUnlock: document.querySelector("#open-unlock"),
  openSettings: document.querySelector("#open-settings")
};

const state = {
  draft: null,
  folderCatalog: [],
  sessionState: "locked"
};

const POPUP_PAGE_URL = chrome.runtime.getURL("src/popup/index.html");

function setMessage(text, tone = "info") {
  if (!text) {
    elements.message.hidden = true;
    elements.message.textContent = "";
    elements.message.className = "message message-info";
    return;
  }

  elements.message.hidden = false;
  elements.message.textContent = text;
  elements.message.className = `message message-${tone}`;
}

function setMode(status) {
  state.sessionState = status;

  if (status === "unlocked") {
    elements.mode.textContent = t("当前已解锁");
    elements.helper.textContent = t("保存后会直接写入保险库，并刷新可选目录。");
    elements.submit.textContent = t("保存");
    elements.openUnlock.hidden = true;
    return;
  }

  if (status === "expired") {
    elements.mode.textContent = t("当前会话已过期");
    elements.helper.textContent = t("保存后会先未加密暂存在本地，等下次解锁后自动导入保险库。");
    elements.submit.textContent = t("保存");
    elements.openUnlock.hidden = false;
    return;
  }

  elements.mode.textContent = t("当前已锁定");
  elements.helper.textContent = t("保存后会先未加密暂存在本地，等下次解锁后自动导入保险库。");
  elements.submit.textContent = t("保存");
  elements.openUnlock.hidden = false;
}

function setPreviewFavicon(faviconUrl) {
  if (!faviconUrl) {
    elements.previewFaviconShell.hidden = true;
    elements.previewFavicon.removeAttribute("src");
    return;
  }

  elements.previewFaviconShell.hidden = false;
  elements.previewFavicon.src = faviconUrl;
}

function renderFolderOptions() {
  const currentValue = elements.folderPath.value.trim();
  elements.existingFolderSelect.replaceChildren();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent =
    state.sessionState === "unlocked"
      ? t("默认")
      : t("默认（解锁后显示更多）");
  elements.existingFolderSelect.append(defaultOption);

  if (state.sessionState !== "unlocked") {
    elements.existingFolderSelect.value = "";
    elements.existingFolderSelect.disabled = true;
    elements.folderHelper.textContent = t("当前未解锁，已有目录暂不可选；可直接输入新目录，或先解锁后选择更多已有目录。");
    return;
  }

  for (const folderPath of state.folderCatalog) {
    const option = document.createElement("option");
    option.value = folderPath;
    option.textContent = folderPath;
    elements.existingFolderSelect.append(option);
  }

  if (currentValue && state.folderCatalog.includes(currentValue)) {
    elements.existingFolderSelect.value = currentValue;
  } else {
    elements.existingFolderSelect.value = "";
  }

  if (state.folderCatalog.length > 0) {
    elements.folderHelper.textContent = t("可先选择已有目录，也可以直接在下方输入新目录。");
    elements.existingFolderSelect.disabled = false;
    return;
  }

  elements.folderHelper.textContent =
    t("当前没有可选目录。可直接在“分类目录”中输入一个新目录，保存后会加入目录列表。");
  elements.existingFolderSelect.disabled = false;
}

function parseDraftFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const title = params.get("title")?.trim() ?? "";
  const url = params.get("url")?.trim() ?? "";
  const faviconUrl = params.get("faviconUrl")?.trim() ?? "";

  if (!title || !url) {
    throw new Error(t("当前没有可快速收藏的页面信息，请重新触发快捷键。"));
  }

  return { title, url, faviconUrl };
}

function applyDraftToForm(draft) {
  state.draft = draft;
  elements.title.value = draft.title;
  elements.url.value = draft.url;
  elements.previewTitle.textContent = draft.title;
  elements.previewUrl.textContent = draft.url;
  setPreviewFavicon(draft.faviconUrl);
}

async function refreshFolderCatalog() {
  const record = await loadVaultRecord();
  const status = record ? await sessionStatus() : { status: "locked", session: null };
  setMode(status.status);

  if (!record) {
    state.folderCatalog = [];
    renderFolderOptions();
    return;
  }

  if (status.status === "unlocked" && status.session) {
    const currentBookmarks = await decryptBookmarksWithEncodedKey(record, status.session.encodedKey);
    const flushed = await flushPendingQuickCaptures({
      record,
      encodedKey: status.session.encodedKey,
      currentBookmarks
    });
    if (flushed.importedCount > 0) {
      await refreshQuickCaptureBadge();
      setMessage(t("已自动导入 {count} 条待写入快速收藏。", {
        count: flushed.importedCount
      }), "success");
    }

    state.folderCatalog = await syncFolderCatalogFromBookmarks(flushed.bookmarks ?? currentBookmarks);
    renderFolderOptions();
    return;
  }

  state.folderCatalog = await loadFolderCatalog();
  renderFolderOptions();
}

async function refreshQuickCaptureBadge() {
  await chrome.runtime.sendMessage({
    type: "QUICK_CAPTURE_BADGE_REFRESH"
  });
}

function syncFolderSelectFromInput() {
  const value = elements.folderPath.value.trim();
  elements.existingFolderSelect.value = state.folderCatalog.includes(value)
    ? value
    : "";
}

async function handleSubmit(event) {
  event.preventDefault();

  try {
    const record = await loadVaultRecord();
    if (!record) {
      throw new Error(t("当前保险库未初始化，请先在 popup 创建主密码。"));
    }

    elements.submit.disabled = true;

    const bookmark = createQuickCaptureBookmark({
      title: elements.title.value,
      url: elements.url.value,
      folderPath: elements.folderPath.value
    });
    const touched = await sessionTouch();

    if (touched.status === "unlocked" && touched.session) {
      await saveQuickCaptureBookmark({
        bookmark,
        record,
        encodedKey: touched.session.encodedKey
      });
      await refreshQuickCaptureBadge();
      setMode("unlocked");
      setMessage(t("已直接写入保险库。"), "success");
      window.setTimeout(() => {
        window.close();
      }, 420);
      return;
    }

    const queued = await queueQuickCaptureBookmark(bookmark);
    await refreshQuickCaptureBadge();
    setMode(touched.status);
    setMessage(
      t("已暂存快速收藏，解锁后自动导入。当前待写入 {count} 条。", {
        count: queued.pendingCount
      }),
      "success"
    );
    state.folderCatalog = await loadFolderCatalog();
    renderFolderOptions();
    window.setTimeout(() => {
      window.close();
    }, 520);
  } catch (error) {
    elements.submit.disabled = false;
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function initialize() {
  try {
    applyDraftToForm(parseDraftFromQuery());
    await refreshFolderCatalog();
  } catch (error) {
    elements.form.querySelectorAll("input, select, button").forEach((element) => {
      element.disabled = true;
    });
    setMessage(error instanceof Error ? error.message : String(error), "error");
    elements.helper.textContent = t("请关闭当前窗口后重新触发快捷键。");
    elements.folderHelper.textContent = t("目录列表不可用。");
  }
}

async function openUnlockWindow() {
  const currentWindow = await chrome.windows.getCurrent();
  const popupUrl = new URL(POPUP_PAGE_URL);
  popupUrl.search = new URLSearchParams({
    returnWindowId: String(currentWindow.id)
  }).toString();

  await chrome.windows.create({
    url: popupUrl.toString(),
    type: "popup",
    width: 420,
    height: 720,
    focused: true
  });
}

elements.closeWindow.addEventListener("click", () => window.close());
elements.openUnlock.addEventListener("click", () => {
  openUnlockWindow().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});
elements.openSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
elements.existingFolderSelect.addEventListener("change", () => {
  elements.folderPath.value = elements.existingFolderSelect.value;
});
elements.folderPath.addEventListener("input", syncFolderSelectFromInput);
elements.previewFavicon.addEventListener("error", () => setPreviewFavicon(""));
elements.form.addEventListener("submit", handleSubmit);
window.addEventListener("focus", () => {
  refreshFolderCatalog().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});

initialize().catch((error) => {
  setMessage(error instanceof Error ? error.message : String(error), "error");
});
