import { flushPendingQuickCaptures } from "../core/quick-capture.js";
import {
  getFolderCatalogFromBookmarks,
  syncFolderCatalogFromBookmarks
} from "../core/folder-catalog.js";
import {
  hasStoredVaultRecord,
  loadPendingQuickCaptures,
  loadVaultRecord,
  saveVaultRecord
} from "../core/storage.js";
import { sessionLock, sessionSet, sessionStatus, sessionTouch } from "../core/session.js";
import { getBookmarkSearchResults } from "../core/bookmark-search.js";
import { getCurrentPageCandidate, getPageFaviconUrl } from "../core/tabs.js";
import { normalizeFolderPath } from "../core/validation.js";
import {
  createBookmark,
  createVaultRecord,
  decryptBookmarksWithEncodedKey,
  encryptBookmarksWithEncodedKey,
  unlockVaultRecord
} from "../core/vault.js";
import {
  formatDateTime,
  getLocaleTag,
  initializeI18n,
  localizeDocument,
  t
} from "../shared/i18n.js";
import { getLatestVersion } from "../shared/changelog.js";
import { createPasswordStrengthMeter } from "../shared/password-strength-meter.js";
import { createTagChipsInput, createTagList } from "../shared/tag-chips.js";

const MANAGER_PAGE_URL = chrome.runtime.getURL("src/manager/index.html");
const CHANGELOG_PAGE_URL = chrome.runtime.getURL("src/changelog/index.html");
const WELCOME_OPTIONS_URL = chrome.runtime.getURL("src/options/index.html?flow=welcome");

try {
  await initializeI18n();
} finally {
  localizeDocument();
}

const elements = {
  message: document.querySelector("#global-message"),
  changelogBanner: document.querySelector("#changelog-banner"),
  changelogBannerText: document.querySelector("#changelog-banner-text"),
  changelogBannerDismiss: document.querySelector("#changelog-banner-dismiss"),
  setupScreen: document.querySelector("#setup-screen"),
  lockedScreen: document.querySelector("#locked-screen"),
  unlockedScreen: document.querySelector("#unlocked-screen"),
  openSettings: document.querySelector("#open-settings"),
  setupForm: document.querySelector("#setup-form"),
  setupPassword: document.querySelector("#setup-password"),
  setupConfirm: document.querySelector("#setup-confirm"),
  setupHint: document.querySelector("#setup-hint"),
  setupAutolock: document.querySelector("#setup-autolock"),
  openImportOnboarding: document.querySelector("#open-import-onboarding"),
  unlockForm: document.querySelector("#unlock-form"),
  unlockPassword: document.querySelector("#unlock-password"),
  lockedBookmarkCount: document.querySelector("#locked-bookmark-count"),
  lockedHint: document.querySelector("#locked-hint"),
  lockedQuickCaptureStatus: document.querySelector("#locked-quick-capture-status"),
  openManager: document.querySelector("#open-manager"),
  searchInput: document.querySelector("#search-input"),
  saveCurrentPage: document.querySelector("#save-current-page"),
  saveCurrentPageFaviconShell: document.querySelector("#save-current-page-favicon-shell"),
  saveCurrentPageFavicon: document.querySelector("#save-current-page-favicon"),
  savePanel: document.querySelector("#save-panel"),
  savePanelTitle: document.querySelector("#save-panel-title"),
  closeSavePanel: document.querySelector("#close-save-panel"),
  addForm: document.querySelector("#add-form"),
  addTitle: document.querySelector("#bookmark-title"),
  addUrl: document.querySelector("#bookmark-url"),
  folderSelect: document.querySelector("[data-folder-select]"),
  addFolderTrigger: document.querySelector("#bookmark-folder-trigger"),
  addFolderTriggerLabel: document.querySelector("#bookmark-folder-trigger-label"),
  addFolderTriggerCaret: document.querySelector("#bookmark-folder-trigger-caret"),
  addFolderPanel: document.querySelector("#bookmark-folder-panel"),
  addFolderPath: document.querySelector("#bookmark-folder-path"),
  addFolderTree: document.querySelector("#bookmark-folder-tree"),
  addFolderClear: document.querySelector("#bookmark-folder-clear"),
  addFolderEmpty: document.querySelector("#bookmark-folder-empty"),
  addNote: document.querySelector("#bookmark-note"),
  addTagsField: document.querySelector("#bookmark-tags-field"),
  addSubmit: document.querySelector("#add-submit"),
  pageStatus: document.querySelector("#page-status"),
  bookmarkCount: document.querySelector("#bookmark-count"),
  bookmarkList: document.querySelector("#bookmark-list"),
  emptyState: document.querySelector("#empty-state"),
  emptyStateCopy: document.querySelector("#empty-state-copy"),
  emptyStateActions: document.querySelector("#empty-state-actions"),
  emptyStateImport: document.querySelector("#empty-state-import"),
  sessionBadge: document.querySelector("#session-badge"),
  lockNow: document.querySelector("#lock-now")
};

const setupStrengthMeter = createPasswordStrengthMeter();
elements.setupPassword.after(setupStrengthMeter.element);
elements.setupPassword.addEventListener("input", (e) => setupStrengthMeter.update(e.target.value));

const addTagEditor = createTagChipsInput();
elements.addTagsField.append(addTagEditor.element);

const state = {
  record: null,
  encodedKey: "",
  bookmarks: [],
  query: "",
  pendingQuickCaptureCount: 0,
  returnWindowId: null,
  lockTimer: null,
  savePanelOpen: false,
  saveMode: "create",
  editingBookmarkId: null,
  detailBookmarkId: null,
  folderPanelOpen: false,
  collapsedFolders: new Set(),
  knownFolderPaths: new Set()
};

function parseReturnWindowId() {
  const rawValue = new URLSearchParams(window.location.search).get("returnWindowId");
  if (!rawValue) {
    return null;
  }

  const windowId = Number(rawValue);
  return Number.isInteger(windowId) && windowId >= 0
    ? windowId
    : null;
}

function getUnlockedSession(response) {
  if (response?.status !== "unlocked" || !response.session) {
    throw new Error(t("会话不可用，请重新解锁。"));
  }

  return response.session;
}

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

async function checkChangelogBanner() {
  const { showChangelogBanner } = await chrome.storage.local.get("showChangelogBanner");
  if (!showChangelogBanner) return;

  const version = getLatestVersion();
  elements.changelogBannerText.textContent = t("v{version} 已更新 — 查看更新日志", { version });
  elements.changelogBanner.hidden = false;
}

function handleChangelogBannerClick() {
  chrome.storage.local.remove("showChangelogBanner").catch(() => {});
  elements.changelogBanner.hidden = true;
  chrome.tabs.create({ url: CHANGELOG_PAGE_URL }).catch(() => {});
}

function handleChangelogBannerDismiss(event) {
  event.stopPropagation();
  chrome.storage.local.remove("showChangelogBanner").catch(() => {});
  elements.changelogBanner.hidden = true;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error(t("复制失败，请稍后重试。"));
    }
  } finally {
    textarea.remove();
  }
}

function getBookmarkCount(record = state.record) {
  return Number.isInteger(record?.meta?.bookmarkCount)
    ? record.meta.bookmarkCount
    : null;
}

function updateLockedBookmarkCount(record = state.record) {
  const count = getBookmarkCount(record);
  elements.lockedBookmarkCount.textContent =
    count === null
      ? t("收藏条数将在首次解锁后同步")
      : t("已保存 {count} 条收藏", { count });
}

function setLockedQuickCaptureStatus() {
  const count = state.pendingQuickCaptureCount;
  elements.lockedQuickCaptureStatus.hidden = count === 0;
  if (count === 0) {
    elements.lockedQuickCaptureStatus.textContent = "";
    return;
  }

  elements.lockedQuickCaptureStatus.textContent =
    t("有 {count} 条快速收藏待写入，解锁后会自动导入保险库。", { count });
}

async function returnToQuickCaptureWindowIfNeeded() {
  if (state.returnWindowId === null) {
    return false;
  }

  try {
    await chrome.windows.update(state.returnWindowId, {
      focused: true
    });
    window.close();
    return true;
  } catch {
    return false;
  }
}

function showScreen(screen) {
  elements.setupScreen.hidden = screen !== "setup";
  elements.lockedScreen.hidden = screen !== "locked";
  elements.unlockedScreen.hidden = screen !== "unlocked";

  if (screen === "locked") {
    updateLockedBookmarkCount();
    setLockedQuickCaptureStatus();
    const hint = state.record?.settings?.passwordHint;
    elements.lockedHint.hidden = !hint;
    elements.lockedHint.textContent = hint ? t("密码提示：") + hint : "";
  }
}

function clearLockTimer() {
  if (state.lockTimer) {
    window.clearTimeout(state.lockTimer);
    state.lockTimer = null;
  }
}

function openImportOnboarding() {
  chrome.tabs.create({ url: WELCOME_OPTIONS_URL });
}

function getSelectedFolderPath() {
  return normalizeFolderPath(elements.addFolderPath.value);
}

function buildFolderPathTree(folderPaths) {
  const root = createFolderNode();

  for (const folderPath of folderPaths) {
    const segments = folderPath.split("/");
    let node = root;

    for (const segment of segments) {
      const path = node.path ? `${node.path}/${segment}` : segment;
      if (!node.children.has(segment)) {
        node.children.set(segment, createFolderNode(segment, path));
      }

      node = node.children.get(segment);
    }
  }

  return root;
}

function setFolderPanelOpen(open) {
  const nextOpen = Boolean(open) && !elements.addFolderTrigger.disabled;
  state.folderPanelOpen = nextOpen;
  elements.addFolderPanel.hidden = !nextOpen;
  elements.addFolderTrigger.setAttribute("aria-expanded", String(nextOpen));
  elements.addFolderTriggerCaret.textContent = nextOpen ? "^" : "v";
}

function syncFolderPickerDisabledState() {
  const disabled = elements.addFolderPath.disabled;
  elements.addFolderTrigger.disabled = disabled;
  elements.addFolderClear.disabled = disabled;

  if (disabled) {
    setFolderPanelOpen(false);
  }
}

function appendFolderTreeOptions(container, node, selectedPath) {
  for (const child of sortFolderNodes(node.children.values())) {
    const item = document.createElement("div");
    item.className = "folder-tree-select-node";

    const option = document.createElement("button");
    option.type = "button";
    option.className = "folder-tree-select-option";
    option.title = child.path;
    if (child.path === selectedPath) {
      option.classList.add("is-selected");
    }
    option.addEventListener("click", () => {
      elements.addFolderPath.value = child.path;
      renderFolderTreeSelect();
      setFolderPanelOpen(false);
      elements.addFolderTrigger.focus();
    });

    const label = document.createElement("span");
    label.className = "folder-tree-select-option-label";
    label.textContent = child.name;
    option.append(label);
    item.append(option);

    if (child.children.size > 0) {
      const children = document.createElement("div");
      children.className = "folder-tree-select-children";
      appendFolderTreeOptions(children, child, selectedPath);
      item.append(children);
    }

    container.append(item);
  }
}

function renderFolderTreeSelect() {
  const selectedPath = getSelectedFolderPath();
  const folderCatalog = getFolderCatalogFromBookmarks(state.bookmarks);

  elements.addFolderTriggerLabel.textContent = selectedPath || t("未分类");
  elements.addFolderTree.replaceChildren();
  elements.addFolderClear.classList.toggle("is-selected", !selectedPath);
  elements.addFolderTree.hidden = folderCatalog.length === 0;
  elements.addFolderEmpty.hidden = folderCatalog.length !== 0;

  if (folderCatalog.length === 0) {
    return;
  }

  const tree = buildFolderPathTree(folderCatalog);
  appendFolderTreeOptions(elements.addFolderTree, tree, selectedPath);
}

function resetSaveForm() {
  state.savePanelOpen = false;
  state.saveMode = "create";
  state.editingBookmarkId = null;
  elements.savePanel.hidden = true;
  setFolderPanelOpen(false);
  elements.savePanelTitle.textContent = t("新建收藏");
  elements.addTitle.value = "";
  elements.addUrl.value = "";
  elements.addFolderPath.value = "";
  elements.addNote.value = "";
  addTagEditor.clear();
  elements.addTitle.disabled = true;
  elements.addUrl.disabled = true;
  elements.addFolderPath.disabled = true;
  elements.addNote.disabled = true;
  elements.addSubmit.disabled = true;
  elements.addSubmit.textContent = t("完成");
  elements.pageStatus.textContent = t("点击“保存当前页”后读取当前页面信息。");
  syncFolderPickerDisabledState();
  renderFolderTreeSelect();
}

function openSaveForm(mode, bookmark = null) {
  state.savePanelOpen = true;
  state.saveMode = mode;
  state.editingBookmarkId = bookmark?.id ?? null;
  elements.savePanel.hidden = false;
  setFolderPanelOpen(false);
  elements.addTitle.disabled = false;
  elements.addUrl.disabled = false;
  elements.addFolderPath.disabled = false;
  elements.addNote.disabled = false;
  elements.addSubmit.disabled = false;
  elements.savePanelTitle.textContent = mode === "edit" ? t("编辑收藏") : t("新建收藏");
  elements.addSubmit.textContent = mode === "edit" ? t("保存修改") : t("完成");

  if (mode === "edit" && bookmark) {
    elements.addTitle.value = bookmark.title;
    elements.addUrl.value = bookmark.url;
    elements.addFolderPath.value = bookmark.folderPath;
    elements.addNote.value = bookmark.note;
    addTagEditor.setTags(bookmark.tags);
    elements.pageStatus.textContent = t("可修改标题、URL、分类目录和备注，保存后会覆盖原收藏。");
    syncFolderPickerDisabledState();
    renderFolderTreeSelect();
    return;
  }

  elements.addTitle.value = "";
  elements.addUrl.value = "";
  elements.addFolderPath.value = "";
  elements.addNote.value = "";
  addTagEditor.clear();
  elements.pageStatus.textContent = t("正在读取当前页面信息...");
  syncFolderPickerDisabledState();
  renderFolderTreeSelect();
}

function setSaveTriggerFavicon(faviconUrl) {
  if (!faviconUrl) {
    elements.saveCurrentPageFaviconShell.hidden = true;
    elements.saveCurrentPageFavicon.removeAttribute("src");
    return;
  }

  elements.saveCurrentPageFaviconShell.hidden = false;
  elements.saveCurrentPageFavicon.src = faviconUrl;
}

function formatTimestamp(timestamp) {
  return formatDateTime(timestamp, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function createFolderNode(name = "", path = "") {
  return {
    name,
    path,
    bookmarks: [],
    children: new Map()
  };
}

function buildBookmarkTree(bookmarks) {
  const root = createFolderNode();

  for (const bookmark of bookmarks) {
    const segments = bookmark.folderPath ? bookmark.folderPath.split("/") : [];
    let node = root;

    for (const segment of segments) {
      const path = node.path ? `${node.path}/${segment}` : segment;
      if (!node.children.has(segment)) {
        node.children.set(segment, createFolderNode(segment, path));
      }

      node = node.children.get(segment);
    }

    node.bookmarks.push(bookmark);
  }

  return root;
}

function countTreeBookmarks(node) {
  let total = node.bookmarks.length;

  for (const child of node.children.values()) {
    total += countTreeBookmarks(child);
  }

  return total;
}

function collectFolderPaths(node, paths = new Set()) {
  for (const child of node.children.values()) {
    paths.add(child.path);
    collectFolderPaths(child, paths);
  }

  return paths;
}

function syncCollapsedFolderState(tree) {
  const currentFolderPaths = collectFolderPaths(tree);
  const nextCollapsedFolders = new Set(
    [...state.collapsedFolders].filter((folderPath) => currentFolderPaths.has(folderPath))
  );

  for (const folderPath of currentFolderPaths) {
    if (!state.knownFolderPaths.has(folderPath)) {
      nextCollapsedFolders.add(folderPath);
    }
  }

  state.collapsedFolders = nextCollapsedFolders;
  state.knownFolderPaths = currentFolderPaths;
}

function sortFolderNodes(nodes) {
  return [...nodes].sort((left, right) => left.name.localeCompare(right.name, getLocaleTag()));
}

function createBookmarkItem(bookmark) {
  const item = document.createElement("li");
  item.className = "bookmark-item";

  const titleRow = document.createElement("div");
  titleRow.className = "bookmark-title-row";

  const titleMain = document.createElement("div");
  titleMain.className = "bookmark-title-main";

  const actionGroup = document.createElement("div");
  actionGroup.className = "bookmark-action-group";

  const faviconShell = document.createElement("span");
  faviconShell.className = "bookmark-favicon-shell";

  const favicon = document.createElement("img");
  favicon.className = "bookmark-favicon";
  favicon.alt = "";
  favicon.referrerPolicy = "no-referrer";

  const titleLink = document.createElement("a");
  titleLink.href = bookmark.url;
  titleLink.target = "_blank";
  titleLink.rel = "noreferrer";
  titleLink.textContent = bookmark.title;

  const detailButton = document.createElement("button");
  detailButton.type = "button";
  detailButton.className = "bookmark-action-button";
  detailButton.textContent =
    state.detailBookmarkId === bookmark.id ? t("收起详情") : t("查看详情");
  detailButton.addEventListener("click", () => {
    handleToggleBookmarkDetail(bookmark.id).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    });
  });

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "bookmark-action-button";
  editButton.textContent = t("编辑");
  editButton.addEventListener("click", () => {
    handleEditBookmark(bookmark.id).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    });
  });

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "bookmark-action-button";
  copyButton.textContent = t("复制");
  copyButton.addEventListener("click", () => {
    copyTextToClipboard(bookmark.url)
      .then(() => {
        setMessage(t("已复制 URL。"), "success");
      })
      .catch((error) => {
        setMessage(
          error instanceof Error ? error.message : t("复制失败，请稍后重试。"),
          "error"
        );
      });
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "bookmark-delete-button";
  deleteButton.textContent = t("删除");
  deleteButton.addEventListener("click", () => {
    handleDeleteBookmark(bookmark.id).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    });
  });

  const faviconUrl = getPageFaviconUrl(bookmark.url);
  if (faviconUrl) {
    favicon.src = faviconUrl;
    favicon.addEventListener("error", () => {
      faviconShell.hidden = true;
    });
    faviconShell.append(favicon);
  } else {
    faviconShell.hidden = true;
  }

  const urlLine = document.createElement("div");
  urlLine.className = "bookmark-url";
  urlLine.textContent = bookmark.url;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = bookmark.folderPath
    ? t("{folderPath} · 保存于 {timestamp}", {
        folderPath: bookmark.folderPath,
        timestamp: formatTimestamp(bookmark.createdAt)
      })
    : t("保存于 {timestamp}", {
        timestamp: formatTimestamp(bookmark.createdAt)
      });

  titleMain.append(faviconShell, titleLink);
  actionGroup.append(detailButton, editButton, copyButton, deleteButton);
  titleRow.append(titleMain);
  item.append(titleRow, urlLine, meta, actionGroup);

  if (bookmark.tags?.length > 0) {
    item.append(createTagList(bookmark.tags));
  }

  if (state.detailBookmarkId === bookmark.id) {
    const detailCard = document.createElement("div");
    detailCard.className = "bookmark-detail-card";

    if (bookmark.folderPath) {
      const detailFolderRow = document.createElement("div");
      detailFolderRow.className = "bookmark-detail-row";
      const detailFolderLabel = document.createElement("span");
      detailFolderLabel.className = "bookmark-detail-label";
      detailFolderLabel.textContent = t("目录");
      const detailFolderValue = document.createElement("div");
      detailFolderValue.className = "bookmark-detail-value";
      detailFolderValue.textContent = bookmark.folderPath;
      detailFolderRow.append(detailFolderLabel, detailFolderValue);
      detailCard.append(detailFolderRow);
    }

    if (bookmark.tags?.length > 0) {
      const detailTagsRow = document.createElement("div");
      detailTagsRow.className = "bookmark-detail-row";
      const detailTagsLabel = document.createElement("span");
      detailTagsLabel.className = "bookmark-detail-label";
      detailTagsLabel.textContent = t("标签");
      detailTagsRow.append(detailTagsLabel, createTagList(bookmark.tags));
      detailCard.append(detailTagsRow);
    }

    const detailUrlRow = document.createElement("div");
    detailUrlRow.className = "bookmark-detail-row";
    const detailUrlLabel = document.createElement("span");
    detailUrlLabel.className = "bookmark-detail-label";
    detailUrlLabel.textContent = "URL";
    const detailUrlValue = document.createElement("a");
    detailUrlValue.className = "bookmark-detail-value";
    detailUrlValue.href = bookmark.url;
    detailUrlValue.target = "_blank";
    detailUrlValue.rel = "noreferrer";
    detailUrlValue.textContent = bookmark.url;
    detailUrlRow.append(detailUrlLabel, detailUrlValue);

    const detailNoteRow = document.createElement("div");
    detailNoteRow.className = "bookmark-detail-row";
    const detailNoteLabel = document.createElement("span");
    detailNoteLabel.className = "bookmark-detail-label";
    detailNoteLabel.textContent = t("备注");
    const detailNoteValue = document.createElement("div");
    detailNoteValue.className = "bookmark-detail-value bookmark-detail-note";
    detailNoteValue.textContent = bookmark.note || t("无备注");
    detailNoteRow.append(detailNoteLabel, detailNoteValue);

    const detailTimeRow = document.createElement("div");
    detailTimeRow.className = "bookmark-detail-row";
    const detailTimeLabel = document.createElement("span");
    detailTimeLabel.className = "bookmark-detail-label";
    detailTimeLabel.textContent = t("保存时间");
    const detailTimeValue = document.createElement("div");
    detailTimeValue.className = "bookmark-detail-value";
    detailTimeValue.textContent = formatTimestamp(bookmark.createdAt);
    detailTimeRow.append(detailTimeLabel, detailTimeValue);

    detailCard.append(detailUrlRow, detailNoteRow, detailTimeRow);
    item.append(detailCard);
  }

  return item;
}

function appendTreeContent(listElement, node, queryActive) {
  for (const child of sortFolderNodes(node.children.values())) {
    const group = document.createElement("li");
    group.className = "bookmark-folder-group";

    const expanded = queryActive || !state.collapsedFolders.has(child.path);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "bookmark-folder-toggle";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.addEventListener("click", () => {
      handleToggleFolder(child.path).catch((error) => {
        setMessage(error instanceof Error ? error.message : String(error), "error");
      });
    });

    const folderMain = document.createElement("span");
    folderMain.className = "bookmark-folder-main";

    const folderTitle = document.createElement("span");
    folderTitle.className = "bookmark-folder-title";
    folderTitle.textContent = child.name;

    const folderMeta = document.createElement("span");
    folderMeta.className = "bookmark-folder-meta";
    folderMeta.textContent = t("{count} 条收藏", {
      count: countTreeBookmarks(child)
    });

    const folderCaret = document.createElement("span");
    folderCaret.className = "bookmark-folder-caret";
    folderCaret.setAttribute("aria-hidden", "true");
    folderCaret.textContent = expanded ? "-" : "+";

    folderMain.append(folderTitle, folderMeta);
    toggle.append(folderMain, folderCaret);
    group.append(toggle);

    const nestedList = document.createElement("ul");
    nestedList.className = "bookmark-list bookmark-nested-list";
    nestedList.hidden = !expanded;
    appendTreeContent(nestedList, child, queryActive);
    group.append(nestedList);

    listElement.append(group);
  }

  for (const bookmark of node.bookmarks) {
    listElement.append(createBookmarkItem(bookmark));
  }
}

function updateSessionBadge(expiresAt) {
  if (expiresAt >= Number.MAX_SAFE_INTEGER) {
    elements.sessionBadge.textContent = t("已解锁 · 关闭浏览器时自动锁定");
    return;
  }

  const seconds = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  elements.sessionBadge.textContent = t("已解锁 · 约 {minutes} 分钟后自动锁定", { minutes });
}

function formatQuickCaptureImportMessage(importedCount) {
  return t("已导入 {count} 条快速收藏。", { count: importedCount });
}

async function refreshQuickCaptureBadge() {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return;
  }

  await chrome.runtime.sendMessage({
    type: "QUICK_CAPTURE_BADGE_REFRESH"
  });
}

async function refreshPendingQuickCaptureStatus() {
  const pending = await loadPendingQuickCaptures();
  state.pendingQuickCaptureCount = pending.length;
  setLockedQuickCaptureStatus();
}

function scheduleLocalLock(expiresAt) {
  clearLockTimer();
  updateSessionBadge(expiresAt);

  if (expiresAt >= Number.MAX_SAFE_INTEGER) {
    return;
  }

  const timeout = Math.max(0, expiresAt - Date.now());
  state.lockTimer = window.setTimeout(() => {
    resetUnlockedState();
    showScreen("locked");
    setMessage(t("已因无操作自动锁定，请重新输入主密码。"), "info");
  }, timeout);
}

function resetUnlockedState() {
  clearLockTimer();
  state.encodedKey = "";
  state.bookmarks = [];
  state.query = "";
  state.collapsedFolders = new Set();
  state.knownFolderPaths = new Set();
  elements.searchInput.value = "";
  resetSaveForm();
}

function renderBookmarks() {
  const query = state.query.trim();
  const filtered = getBookmarkSearchResults(state.bookmarks, query);
  const showImportAction = !query && state.bookmarks.length === 0;

  elements.bookmarkCount.textContent = query
    ? t("{visibleCount} / {totalCount} 条收藏", {
        visibleCount: filtered.length,
        totalCount: state.bookmarks.length
      })
    : t("{count} 条收藏", { count: state.bookmarks.length });
  elements.emptyState.hidden = filtered.length > 0;
  elements.emptyStateCopy.textContent = query
    ? t("没有匹配的收藏。")
    : showImportAction
      ? t("还没有收藏，可先保存当前页，或去设置页导入浏览器书签。")
      : t("还没有收藏，先把当前页加入保险库。");
  elements.emptyStateActions.hidden = !showImportAction;
  elements.bookmarkList.replaceChildren();

  if (filtered.length === 0) {
    if (!query) {
      state.collapsedFolders = new Set();
      state.knownFolderPaths = new Set();
    }
    return;
  }

  const tree = buildBookmarkTree(filtered);
  if (!query) {
    syncCollapsedFolderState(tree);
  }
  appendTreeContent(elements.bookmarkList, tree, Boolean(query));
}

async function persistBookmarks(nextBookmarks, successMessage) {
  await touchSessionState();
  const nextRecord = await encryptBookmarksWithEncodedKey(
    state.record,
    nextBookmarks,
    state.encodedKey
  );

  await saveVaultRecord(nextRecord);
  await syncFolderCatalogFromBookmarks(nextBookmarks);
  state.record = nextRecord;
  state.bookmarks = nextBookmarks;
  if (state.detailBookmarkId && !nextBookmarks.some((bookmark) => bookmark.id === state.detailBookmarkId)) {
    state.detailBookmarkId = null;
  }
  renderBookmarks();
  updateLockedBookmarkCount(nextRecord);
  if (successMessage) {
    setMessage(successMessage, "success");
  }
}

async function refreshCurrentPageCandidate() {
  const candidate = await getCurrentPageCandidate();
  setSaveTriggerFavicon(candidate.supported ? candidate.faviconUrl : "");

  if (!candidate.supported) {
    elements.addTitle.value = "";
    elements.addUrl.value = "";
    elements.addFolderPath.value = "";
    elements.addNote.value = "";
    elements.addTitle.disabled = true;
    elements.addUrl.disabled = true;
    elements.addFolderPath.disabled = true;
    elements.addNote.disabled = true;
    elements.addSubmit.disabled = true;
    elements.pageStatus.textContent = candidate.reason;
    syncFolderPickerDisabledState();
    renderFolderTreeSelect();
    return candidate;
  }

  elements.addTitle.disabled = false;
  elements.addUrl.disabled = false;
  elements.addFolderPath.disabled = false;
  elements.addNote.disabled = false;
  elements.addSubmit.disabled = false;
  elements.addTitle.value = candidate.title;
  elements.addUrl.value = candidate.url;
  elements.pageStatus.textContent = t("可按原生收藏习惯修改标题或 URL 后再保存。");
  syncFolderPickerDisabledState();
  renderFolderTreeSelect();
  return candidate;
}

async function openCurrentPageSavePanel({ touchSession = true } = {}) {
  if (touchSession) {
    await touchSessionState();
  }

  openSaveForm("create");
  const candidate = await refreshCurrentPageCandidate();
  if (!elements.addTitle.disabled) {
    elements.addTitle.focus();
    elements.addTitle.select();
  }

  return candidate;
}

async function touchSessionState() {
  const response = await sessionTouch();
  if (response.status !== "unlocked" || !response.session) {
    resetUnlockedState();
    showScreen("locked");
    setMessage(t("保险库已锁定，请重新解锁。"), "info");
    throw new Error("Session is locked.");
  }

  scheduleLocalLock(response.session.expiresAt);
  return response.session;
}

async function syncBookmarkCount(record, bookmarks) {
  if (record.meta?.bookmarkCount === bookmarks.length) {
    return record;
  }

  const nextRecord = await saveVaultRecord({
    ...record,
    meta: {
      bookmarkCount: bookmarks.length
    }
  });
  updateLockedBookmarkCount(nextRecord);
  return nextRecord;
}

async function showUnlocked(record, encodedKey, bookmarks, session) {
  const flushed = await flushPendingQuickCaptures({
    record,
    encodedKey,
    currentBookmarks: bookmarks
  });
  if (flushed.importedCount > 0) {
    await refreshQuickCaptureBadge();
  }

  state.pendingQuickCaptureCount = 0;
  state.record = await syncBookmarkCount(flushed.record, flushed.bookmarks ?? bookmarks);
  state.encodedKey = encodedKey;
  state.bookmarks = [...(flushed.bookmarks ?? bookmarks)];
  await syncFolderCatalogFromBookmarks(state.bookmarks);
  state.query = "";
  elements.searchInput.value = "";
  resetSaveForm();

  showScreen("unlocked");
  renderBookmarks();
  scheduleLocalLock(session.expiresAt);
  try {
    await refreshCurrentPageCandidate();
  } catch {
    setSaveTriggerFavicon("");
  }

  return {
    importedCount: flushed.importedCount
  };
}

async function initialize() {
  let hasStoredVault = false;

  try {
    state.returnWindowId = parseReturnWindowId();
    await refreshPendingQuickCaptureStatus();
    hasStoredVault = await hasStoredVaultRecord();
    const record = hasStoredVault ? await loadVaultRecord() : null;
    state.record = record;
    updateLockedBookmarkCount(record);

    if (!record) {
      showScreen("setup");
      setMessage(t("首次使用需要创建一个主密码。"), "info");
      return;
    }

    const status = await sessionStatus();
    if (status.status === "unlocked" && status.session) {
      const touched = await touchSessionState();
      const bookmarks = await decryptBookmarksWithEncodedKey(record, touched.encodedKey);
      const { importedCount } = await showUnlocked(record, touched.encodedKey, bookmarks, touched);
      if (state.returnWindowId !== null) {
        await returnToQuickCaptureWindowIfNeeded();
        return;
      }
      if (importedCount > 0) {
        setMessage(formatQuickCaptureImportMessage(importedCount), "success");
      }
      return;
    }

    showScreen("locked");
    setMessage(
      status.status === "expired"
        ? t("会话已过期，请重新输入主密码。")
        : t("输入主密码即可解锁。"),
      "info"
    );
  } catch (error) {
    showScreen(hasStoredVault || state.record ? "locked" : "setup");
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleSetupSubmit(event) {
  event.preventDefault();
  const password = elements.setupPassword.value;
  const confirm = elements.setupConfirm.value;

  if (!password) {
    setMessage(t("主密码不能为空。"), "error");
    return;
  }

  if (password !== confirm) {
    setMessage(t("两次输入的主密码不一致。"), "error");
    return;
  }

  try {
    const created = await createVaultRecord(password, elements.setupAutolock.value, elements.setupHint.value);
    const record = await saveVaultRecord(created.record);
    const session = getUnlockedSession(await sessionSet(
      created.encodedKey,
      record.settings.autoLockMinutes
    ));

    await showUnlocked(record, created.encodedKey, [], session);
    const candidate = await openCurrentPageSavePanel({ touchSession: false });
    elements.setupForm.reset();
    elements.setupAutolock.value = String(record.settings.autoLockMinutes);
    setMessage(
      candidate?.supported
        ? t("已创建并解锁。当前页保存面板已打开。")
        : t("已创建并解锁。当前页面暂时不能直接保存，可先导入浏览器书签，或切到普通网页后再试。"),
      "success"
    );
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleUnlockSubmit(event) {
  event.preventDefault();
  try {
    const record = await loadVaultRecord();
    if (!record) {
      showScreen("setup");
      setMessage(t("尚未初始化，请先创建主密码。"), "info");
      return;
    }

    const unlocked = await unlockVaultRecord(record, elements.unlockPassword.value);
    const session = getUnlockedSession(await sessionSet(
      unlocked.encodedKey,
      unlocked.record.settings.autoLockMinutes
    ));

    const { importedCount } = await showUnlocked(
      unlocked.record,
      unlocked.encodedKey,
      unlocked.bookmarks,
      session
    );
    elements.unlockForm.reset();
    if (state.returnWindowId !== null) {
      await returnToQuickCaptureWindowIfNeeded();
      return;
    }
    setMessage(
      importedCount > 0
        ? t("已解锁保险库，并已导入 {count} 条快速收藏。", { count: importedCount })
        : t("已解锁保险库。"),
      "success"
    );
  } catch (error) {
    setMessage(
      error instanceof Error ? error.message : t("解锁失败，请确认主密码。"),
      "error"
    );
  }
}

async function handleOpenSavePanel() {
  try {
    await openCurrentPageSavePanel();
  } catch {
    // touchSessionState 已处理提示与锁定状态
  }
}

async function handleAddSubmit(event) {
  event.preventDefault();

  try {
    if (state.saveMode === "edit") {
      const currentBookmark = state.bookmarks.find((bookmark) => bookmark.id === state.editingBookmarkId);
      if (!currentBookmark) {
        throw new Error(t("要编辑的收藏不存在。"));
      }

      const draftBookmark = createBookmark({
        title: elements.addTitle.value,
        url: elements.addUrl.value,
        folderPath: elements.addFolderPath.value,
        note: elements.addNote.value,
        tags: addTagEditor.getTags()
      });
      const nextBookmarks = state.bookmarks.map((bookmark) =>
        bookmark.id === currentBookmark.id
          ? {
              ...bookmark,
              title: draftBookmark.title,
              url: draftBookmark.url,
              folderPath: draftBookmark.folderPath,
              note: draftBookmark.note,
              tags: draftBookmark.tags
            }
          : bookmark
      );
      await persistBookmarks(nextBookmarks, t("收藏已更新。"));
    } else {
      const bookmark = createBookmark({
        title: elements.addTitle.value,
        url: elements.addUrl.value,
        folderPath: elements.addFolderPath.value,
        note: elements.addNote.value,
        tags: addTagEditor.getTags()
      });
      const nextBookmarks = [bookmark, ...state.bookmarks];
      await persistBookmarks(nextBookmarks, t("当前页已加密保存。"));
    }

    resetSaveForm();
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleToggleBookmarkDetail(bookmarkId) {
  await touchSessionState();
  state.detailBookmarkId =
    state.detailBookmarkId === bookmarkId ? null : bookmarkId;
  renderBookmarks();
}

async function handleToggleFolder(folderPath) {
  await touchSessionState();

  if (state.collapsedFolders.has(folderPath)) {
    state.collapsedFolders.delete(folderPath);
  } else {
    state.collapsedFolders.add(folderPath);
  }

  renderBookmarks();
}

async function handleEditBookmark(bookmarkId) {
  await touchSessionState();
  const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);
  if (!bookmark) {
    throw new Error(t("要编辑的收藏不存在。"));
  }

  openSaveForm("edit", bookmark);
  elements.addTitle.focus();
  elements.addTitle.select();
}

async function handleDeleteBookmark(bookmarkId) {
  const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);
  if (!bookmark) {
    throw new Error(t("要删除的收藏不存在。"));
  }

  const confirmed = window.confirm(t("确认删除“{title}”？", { title: bookmark.title }));
  if (!confirmed) {
    return;
  }

  if (state.editingBookmarkId === bookmarkId) {
    resetSaveForm();
  }

  const nextBookmarks = state.bookmarks.filter((item) => item.id !== bookmarkId);
  await persistBookmarks(nextBookmarks, t("收藏已删除。"));
}

function handleFolderTriggerClick() {
  const nextOpen = !state.folderPanelOpen;
  setFolderPanelOpen(nextOpen);

  if (nextOpen) {
    renderFolderTreeSelect();
    elements.addFolderPath.focus();
    elements.addFolderPath.select();
  }
}

function handleFolderClear() {
  elements.addFolderPath.value = "";
  renderFolderTreeSelect();
  setFolderPanelOpen(false);
  elements.addFolderTrigger.focus();
}

function handleFolderInput() {
  renderFolderTreeSelect();
}

function handleFolderPickerKeydown(event) {
  if (event.key !== "Escape") {
    return;
  }

  event.preventDefault();
  setFolderPanelOpen(false);
  elements.addFolderTrigger.focus();
}

function handleDocumentClick(event) {
  if (!state.folderPanelOpen) {
    return;
  }

  if (elements.folderSelect.contains(event.target)) {
    return;
  }

  setFolderPanelOpen(false);
}

function handleSearchInput() {
  state.query = elements.searchInput.value;
  renderBookmarks();
  touchSessionState().catch(() => {});
}

async function handleManualLock() {
  await sessionLock();
  resetUnlockedState();
  showScreen("locked");
  setMessage(t("保险库已手动锁定。"), "info");
}

elements.setupForm.addEventListener("submit", handleSetupSubmit);
elements.openImportOnboarding.addEventListener("click", openImportOnboarding);
elements.unlockForm.addEventListener("submit", handleUnlockSubmit);
elements.openSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
elements.openManager.addEventListener("click", () => chrome.tabs.create({ url: MANAGER_PAGE_URL }));
elements.emptyStateImport.addEventListener("click", openImportOnboarding);
elements.changelogBanner.addEventListener("click", handleChangelogBannerClick);
elements.changelogBannerDismiss.addEventListener("click", handleChangelogBannerDismiss);
elements.saveCurrentPage.addEventListener("click", handleOpenSavePanel);
elements.saveCurrentPageFavicon.addEventListener("error", () => setSaveTriggerFavicon(""));
elements.closeSavePanel.addEventListener("click", resetSaveForm);
elements.addFolderTrigger.addEventListener("click", handleFolderTriggerClick);
elements.addFolderPath.addEventListener("input", handleFolderInput);
elements.addFolderPanel.addEventListener("keydown", handleFolderPickerKeydown);
elements.addFolderClear.addEventListener("click", handleFolderClear);
elements.addForm.addEventListener("submit", handleAddSubmit);
elements.searchInput.addEventListener("input", handleSearchInput);
elements.lockNow.addEventListener("click", handleManualLock);

document.addEventListener("click", handleDocumentClick);
window.addEventListener("beforeunload", resetUnlockedState);
window.addEventListener("focus", () => {
  refreshPendingQuickCaptureStatus().catch(() => {});
  if (state.encodedKey) {
    touchSessionState().catch(() => {});
  }
});

initialize();
checkChangelogBanner().catch(() => {});
