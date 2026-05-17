import { getBookmarkSearchResults } from "../core/bookmark-search.js";
import {
  removeFolderTreeFromBookmarks,
  syncFolderCatalogFromBookmarks
} from "../core/folder-catalog.js";
import { flushPendingQuickCaptures } from "../core/quick-capture.js";
import { loadVaultRecord, saveVaultRecord } from "../core/storage.js";
import {
  sessionLock,
  sessionSet,
  sessionStatus,
  sessionTouch
} from "../core/session.js";
import {
  createBookmark,
  decryptBookmarksWithEncodedKey,
  encryptBookmarksWithEncodedKey,
  unlockVaultRecord
} from "../core/vault.js";
import { formatDateTime, initializeI18n, localizeDocument, t } from "../shared/i18n.js";

try {
  await initializeI18n();
} finally {
  localizeDocument();
}

const elements = {
  hero: document.querySelector("#manager-hero"),
  openSettings: document.querySelector("#open-settings"),
  lockSession: document.querySelector("#lock-session"),
  sessionStatus: document.querySelector("#session-status"),
  unlockPanel: document.querySelector("#unlock-panel"),
  unlockPanelBadge: document.querySelector("#unlock-panel-badge"),
  unlockPanelCopy: document.querySelector("#unlock-panel-copy"),
  unlockForm: document.querySelector("#unlock-form"),
  unlockPassword: document.querySelector("#unlock-password"),
  message: document.querySelector("#manager-message"),
  bookmarkCount: document.querySelector("#bookmark-count"),
  managerStatus: document.querySelector("#manager-status"),
  searchInput: document.querySelector("#search-input"),
  emptyState: document.querySelector("#empty-state"),
  bookmarkList: document.querySelector("#bookmark-list")
};

const state = {
  hasVault: false,
  sessionState: "locked",
  record: null,
  encodedKey: "",
  bookmarks: [],
  query: "",
  editingBookmarkId: null,
  collapsedFolders: new Set(),
  knownFolderPaths: new Set()
};

function formatQuickCaptureImportMessage(importedCount) {
  return t("已自动导入 {count} 条快速收藏。", { count: importedCount });
}

async function refreshQuickCaptureBadge() {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return;
  }

  await chrome.runtime.sendMessage({
    type: "QUICK_CAPTURE_BADGE_REFRESH"
  });
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

function sortFolderNodes(nodes) {
  return [...nodes].sort((left, right) => left.name.localeCompare(right.name));
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

function clearUnlockedState(clearQuery = false) {
  state.encodedKey = "";
  state.bookmarks = [];
  state.editingBookmarkId = null;
  state.collapsedFolders = new Set();
  state.knownFolderPaths = new Set();

  if (clearQuery) {
    state.query = "";
    elements.searchInput.value = "";
  }
}

function setUnlockPanel(visible, copy = t("输入主密码后即可继续查看和维护收藏。")) {
  elements.unlockPanel.hidden = !visible;
  elements.unlockPanelCopy.textContent = copy;

  if (visible) {
    return;
  }

  elements.unlockForm.reset();
}

function focusUnlockPanel(copy) {
  if (!state.hasVault) {
    return;
  }

  setUnlockPanel(true, copy);
  elements.unlockPanel.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
  window.setTimeout(() => {
    elements.unlockPassword.focus();
    elements.unlockPassword.select();
  }, 60);
}

function setSessionState(status, minutes = null) {
  state.sessionState = status;

  if (!state.hasVault) {
    elements.sessionStatus.textContent = t("未初始化");
    elements.lockSession.hidden = true;
    setUnlockPanel(false);
    return;
  }

  if (status === "unlocked" && minutes !== null) {
    elements.sessionStatus.textContent = minutes === 0
      ? t("已解锁 · 关闭浏览器时锁定")
      : t("已解锁 · {minutes} 分钟自动锁定", { minutes });
    elements.lockSession.hidden = false;
    elements.lockSession.disabled = false;
    setUnlockPanel(false);
    return;
  }

  elements.sessionStatus.textContent =
    status === "expired" ? t("会话已过期") : t("会话已锁定");
  elements.lockSession.hidden = true;
  elements.lockSession.disabled = true;
  setUnlockPanel(
    true,
    status === "expired"
      ? t("当前会话已过期，请重新输入主密码。")
      : t("输入主密码后即可继续查看和维护收藏。")
  );
}

async function requireUnlockedSession(copy = t("输入主密码后即可继续查看和维护收藏。")) {
  const touched = await sessionTouch();
  if (touched.status !== "unlocked" || !touched.session) {
    clearUnlockedState();
    setSessionState(touched.status);
    renderView();
    focusUnlockPanel(copy);
    throw new Error(t("保险库已锁定，请重新解锁。"));
  }

  state.encodedKey = touched.session.encodedKey;
  setSessionState("unlocked", touched.session.autoLockMinutes);
  return touched.session;
}

function createActionButton(text, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", () => {
    handler().catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    });
  });
  return button;
}

function createManagerRow(bookmark) {
  const item = document.createElement("li");
  item.className = "bookmark-item";

  if (state.editingBookmarkId === bookmark.id) {
    item.classList.add("manager-edit-item");

    const form = document.createElement("form");
    form.className = "stack manager-edit-form";
    form.addEventListener("submit", (event) => {
      handleEditSubmit(event, bookmark.id).catch((error) => {
        setMessage(error instanceof Error ? error.message : String(error), "error");
      });
    });

    const titleInput = document.createElement("input");
    titleInput.className = "input";
    titleInput.name = "title";
    titleInput.type = "text";
    titleInput.required = true;
    titleInput.value = bookmark.title;
    titleInput.dataset.managerTitleInput = "true";

    const urlInput = document.createElement("input");
    urlInput.className = "input";
    urlInput.name = "url";
    urlInput.type = "url";
    urlInput.required = true;
    urlInput.value = bookmark.url;

    const folderInput = document.createElement("input");
    folderInput.className = "input";
    folderInput.name = "folderPath";
    folderInput.type = "text";
    folderInput.placeholder = t("可选，例如 工作/项目A");
    folderInput.value = bookmark.folderPath;

    const noteInput = document.createElement("textarea");
    noteInput.className = "textarea";
    noteInput.name = "note";
    noteInput.rows = 3;
    noteInput.placeholder = t("可选，记录这条收藏的用途或补充信息");
    noteInput.value = bookmark.note;

    const titleLabel = document.createElement("label");
    titleLabel.className = "label";
    titleLabel.append(document.createElement("span"), titleInput);
    titleLabel.firstChild.textContent = t("标题");

    const urlLabel = document.createElement("label");
    urlLabel.className = "label";
    urlLabel.append(document.createElement("span"), urlInput);
    urlLabel.firstChild.textContent = "URL";

    const folderLabel = document.createElement("label");
    folderLabel.className = "label";
    folderLabel.append(document.createElement("span"), folderInput);
    folderLabel.firstChild.textContent = t("分类目录");

    const noteLabel = document.createElement("label");
    noteLabel.className = "label manager-edit-note";
    noteLabel.append(document.createElement("span"), noteInput);
    noteLabel.firstChild.textContent = t("备注");

    const editGrid = document.createElement("div");
    editGrid.className = "manager-edit-grid";
    editGrid.append(titleLabel, urlLabel, folderLabel, noteLabel);

    const footer = document.createElement("div");
    footer.className = "manager-edit-footer";

    const createdAt = document.createElement("p");
    createdAt.className = "manager-edit-time";
    createdAt.textContent = t("保存于 {timestamp}", {
      timestamp: formatTimestamp(bookmark.createdAt)
    });

    const actions = document.createElement("div");
    actions.className = "button-row";

    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.className = "button";
    saveButton.textContent = t("保存修改");

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "ghost-button";
    cancelButton.textContent = t("取消");
    cancelButton.addEventListener("click", () => {
      state.editingBookmarkId = null;
      renderView();
    });

    actions.append(saveButton, cancelButton);
    footer.append(createdAt, actions);
    form.append(editGrid, footer);
    item.append(form);
    return item;
  }

  item.classList.add("manager-row");

  const main = document.createElement("div");
  main.className = "manager-row-main";
  main.dataset.label = t("收藏");

  const titleLink = document.createElement("a");
  titleLink.className = "manager-row-title";
  titleLink.href = bookmark.url;
  titleLink.target = "_blank";
  titleLink.rel = "noreferrer";
  titleLink.textContent = bookmark.title;
  titleLink.title = bookmark.title;

  const urlLine = document.createElement("p");
  urlLine.className = "manager-row-url";
  urlLine.textContent = bookmark.url;
  urlLine.title = bookmark.url;

  main.append(titleLink, urlLine);

  const folder = document.createElement("div");
  folder.className = "manager-row-cell";
  folder.dataset.label = t("目录");
  const folderText = document.createElement("p");
  folderText.className = "manager-row-text";
  folderText.textContent = bookmark.folderPath || t("未分类");
  folderText.title = folderText.textContent;
  folder.append(folderText);

  const note = document.createElement("div");
  note.className = "manager-row-cell";
  note.dataset.label = t("备注");
  const noteText = document.createElement("p");
  noteText.className = "manager-row-text manager-row-note-text";
  noteText.textContent = bookmark.note || t("无备注");
  noteText.title = noteText.textContent;
  note.append(noteText);

  const time = document.createElement("div");
  time.className = "manager-row-cell";
  time.dataset.label = t("保存时间");
  const timeText = document.createElement("p");
  timeText.className = "manager-row-time";
  timeText.textContent = formatTimestamp(bookmark.createdAt);
  time.append(timeText);

  const actions = document.createElement("div");
  actions.className = "manager-row-cell manager-row-actions";
  actions.dataset.label = t("操作");
  actions.append(
    createActionButton(t("编辑"), "manager-action-button", () => handleStartEdit(bookmark.id)),
    createActionButton(t("复制"), "manager-action-button", async () => {
      await copyTextToClipboard(bookmark.url);
      setMessage(t("已复制 URL。"), "success");
    }),
    createActionButton(t("删除"), "manager-delete-button", () => handleDeleteBookmark(bookmark.id))
  );

  item.append(main, folder, note, time, actions);
  return item;
}

function createFolderGroup(node, queryActive) {
  const group = document.createElement("li");
  group.className = "bookmark-folder-group manager-folder-group";

  const expanded = queryActive || !state.collapsedFolders.has(node.path);

  const header = document.createElement("div");
  header.className = "manager-folder-header";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "bookmark-folder-toggle manager-folder-toggle";
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.addEventListener("click", () => {
    handleToggleFolder(node.path).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    });
  });

  const folderMain = document.createElement("span");
  folderMain.className = "bookmark-folder-main";

  const folderTitle = document.createElement("span");
  folderTitle.className = "bookmark-folder-title";
  folderTitle.textContent = node.name;

  const folderMeta = document.createElement("span");
  folderMeta.className = "bookmark-folder-meta";
  folderMeta.textContent = t("{count} 条收藏", {
    count: countTreeBookmarks(node)
  });

  const folderCaret = document.createElement("span");
  folderCaret.className = "bookmark-folder-caret";
  folderCaret.setAttribute("aria-hidden", "true");
  folderCaret.textContent = expanded ? "-" : "+";

  folderMain.append(folderTitle, folderMeta);
  toggle.append(folderMain, folderCaret);

  const deleteFolderButton = document.createElement("button");
  deleteFolderButton.type = "button";
  deleteFolderButton.className = "manager-delete-button manager-folder-delete-button";
  deleteFolderButton.textContent = t("删除文件夹");
  deleteFolderButton.disabled = queryActive;
  if (queryActive) {
    deleteFolderButton.title = t("请先清空搜索，再删除文件夹");
  }
  deleteFolderButton.addEventListener("click", () => {
    handleDeleteFolder(node.path).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    });
  });

  header.append(toggle, deleteFolderButton);
  group.append(header);

  const nestedList = document.createElement("ul");
  nestedList.className = "bookmark-list manager-bookmark-list bookmark-nested-list manager-nested-list";
  nestedList.hidden = !expanded;
  appendTreeContent(nestedList, node, queryActive);
  group.append(nestedList);

  return group;
}

function appendTreeContent(listElement, node, queryActive) {
  for (const child of sortFolderNodes(node.children.values())) {
    listElement.append(createFolderGroup(child, queryActive));
  }

  for (const bookmark of node.bookmarks) {
    listElement.append(createManagerRow(bookmark));
  }
}

function renderView() {
  const unlocked = state.hasVault && state.sessionState === "unlocked";
  const filteredBookmarks = unlocked
    ? getBookmarkSearchResults(state.bookmarks, state.query)
    : [];

  elements.searchInput.disabled = !unlocked;
  elements.searchInput.value = state.query;
  elements.bookmarkList.replaceChildren();
  elements.emptyState.hidden = true;

  if (!state.hasVault) {
    elements.bookmarkCount.textContent = t("未初始化");
    elements.managerStatus.textContent = t("当前还没有保险库，先在 popup 创建主密码。");
    elements.emptyState.textContent = t("创建保险库后，这里会显示可维护的收藏列表。");
    elements.emptyState.hidden = false;
    return;
  }

  if (!unlocked) {
    elements.bookmarkCount.textContent =
      state.sessionState === "expired" ? t("会话已过期") : t("会话已锁定");
    elements.managerStatus.textContent =
      state.sessionState === "expired"
        ? t("当前会话已过期，请重新解锁后再继续维护收藏。")
        : t("先解锁后，才能查看完整信息并编辑或删除收藏。");
    elements.emptyState.textContent = t("解锁后这里会显示按目录分组的收藏维护视图。");
    elements.emptyState.hidden = false;
    return;
  }

  elements.bookmarkCount.textContent = state.query.trim()
    ? t("{visibleCount} / {totalCount} 条收藏", {
        visibleCount: filteredBookmarks.length,
        totalCount: state.bookmarks.length
      })
    : t("{count} 条收藏", { count: state.bookmarks.length });
  elements.managerStatus.textContent = state.query.trim()
    ? t("正在按标题、URL、目录和备注筛选收藏。")
    : t("目录树默认折叠，收藏按保存时间倒序展示，可直接在当前页编辑或删除。");

  if (filteredBookmarks.length === 0) {
    if (!state.query.trim()) {
      state.collapsedFolders = new Set();
      state.knownFolderPaths = new Set();
    }
    elements.emptyState.textContent =
      state.bookmarks.length === 0
        ? t("还没有收藏，先在 popup 保存当前页。")
        : t("没有匹配的收藏。");
    elements.emptyState.hidden = false;
    return;
  }

  const queryActive = Boolean(state.query.trim());
  const tree = buildBookmarkTree(filteredBookmarks);
  if (!queryActive) {
    syncCollapsedFolderState(tree);
  }
  appendTreeContent(elements.bookmarkList, tree, queryActive);
}

async function refreshView(message = "") {
  let importedCount = 0;
  let record = await loadVaultRecord();
  state.record = record;
  state.hasVault = Boolean(record);

  if (!record) {
    clearUnlockedState(true);
    setSessionState("locked");
    renderView();
    if (message) {
      setMessage(message, "success");
    }
    return;
  }

  const status = await sessionStatus();
  if (status.status === "unlocked" && status.session) {
    const touched = await sessionTouch();
    if (touched.status === "unlocked" && touched.session) {
      state.encodedKey = touched.session.encodedKey;
      const flushed = await flushPendingQuickCaptures({
        record,
        encodedKey: touched.session.encodedKey
      });
      record = flushed.record;
      state.record = record;
      importedCount = flushed.importedCount;
      state.bookmarks = flushed.bookmarks ?? await decryptBookmarksWithEncodedKey(
        record,
        touched.session.encodedKey
      );
      await syncFolderCatalogFromBookmarks(state.bookmarks);
      if (importedCount > 0) {
        await refreshQuickCaptureBadge();
      }
      setSessionState("unlocked", touched.session.autoLockMinutes);
    } else {
      clearUnlockedState();
      setSessionState(touched.status);
    }
  } else {
    clearUnlockedState();
    setSessionState(status.status);
  }

  renderView();

  if (message) {
    setMessage(
      importedCount > 0
        ? `${message} ${formatQuickCaptureImportMessage(importedCount)}`
        : message,
      "success"
    );
  } else if (importedCount > 0) {
    setMessage(formatQuickCaptureImportMessage(importedCount), "success");
  }
}

async function persistBookmarks(nextBookmarks, successMessage) {
  const session = await requireUnlockedSession(t("管理收藏前，先在当前页输入主密码解锁。"));
  const record = await loadVaultRecord();
  if (!record) {
    throw new Error(t("当前保险库未初始化。"));
  }

  const nextRecord = await encryptBookmarksWithEncodedKey(record, nextBookmarks, session.encodedKey);
  await saveVaultRecord(nextRecord);
  await syncFolderCatalogFromBookmarks(nextBookmarks);
  state.record = nextRecord;
  state.bookmarks = nextBookmarks;
  state.editingBookmarkId = null;
  await refreshView(successMessage);
}

async function handleStartEdit(bookmarkId) {
  await requireUnlockedSession(t("编辑收藏前，先在当前页输入主密码解锁。"));
  const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);
  if (!bookmark) {
    throw new Error(t("要编辑的收藏不存在。"));
  }

  state.editingBookmarkId = bookmarkId;
  renderView();

  const titleInput = elements.bookmarkList.querySelector("[data-manager-title-input='true']");
  if (titleInput instanceof HTMLInputElement) {
    titleInput.focus();
    titleInput.select();
  }
}

async function handleEditSubmit(event, bookmarkId) {
  event.preventDefault();
  const currentBookmark = state.bookmarks.find((bookmark) => bookmark.id === bookmarkId);
  if (!currentBookmark) {
    throw new Error(t("要编辑的收藏不存在。"));
  }

  const formData = new FormData(event.currentTarget);
  const draftBookmark = createBookmark({
    title: formData.get("title"),
    url: formData.get("url"),
    folderPath: formData.get("folderPath"),
    note: formData.get("note")
  });
  const nextBookmarks = state.bookmarks.map((bookmark) =>
    bookmark.id === bookmarkId
      ? {
          ...bookmark,
          title: draftBookmark.title,
          url: draftBookmark.url,
          folderPath: draftBookmark.folderPath,
          note: draftBookmark.note
        }
      : bookmark
  );

  await persistBookmarks(nextBookmarks, t("收藏已更新。"));
}

async function handleDeleteBookmark(bookmarkId) {
  const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);
  if (!bookmark) {
    throw new Error(t("要删除的收藏不存在。"));
  }

  await requireUnlockedSession(t("删除收藏前，先在当前页输入主密码解锁。"));
  const confirmed = window.confirm(t("确认删除“{title}”？", { title: bookmark.title }));
  if (!confirmed) {
    return;
  }

  const nextBookmarks = state.bookmarks.filter((item) => item.id !== bookmarkId);
  await persistBookmarks(nextBookmarks, t("收藏已删除。"));
}

async function handleDeleteFolder(folderPath) {
  await requireUnlockedSession(t("删除文件夹前，先在当前页输入主密码解锁。"));

  if (state.query.trim()) {
    throw new Error(t("请先清空搜索，再删除文件夹"));
  }

  const { nextBookmarks, removedCount } = removeFolderTreeFromBookmarks(
    state.bookmarks,
    folderPath
  );
  if (removedCount === 0) {
    throw new Error(t("要删除的文件夹不存在。"));
  }

  const confirmed = window.confirm(
    t("确认删除文件夹“{folderPath}”及其子目录中的 {count} 条收藏？", {
      folderPath,
      count: removedCount
    })
  );
  if (!confirmed) {
    return;
  }

  await persistBookmarks(nextBookmarks, t("文件夹已删除。"));
}

async function handleToggleFolder(folderPath) {
  await requireUnlockedSession(t("管理收藏前，先在当前页输入主密码解锁。"));

  if (state.collapsedFolders.has(folderPath)) {
    state.collapsedFolders.delete(folderPath);
  } else {
    state.collapsedFolders.add(folderPath);
  }

  renderView();
}

async function handleUnlockSubmit(event) {
  event.preventDefault();

  try {
    const record = await loadVaultRecord();
    if (!record) {
      throw new Error(t("当前保险库未初始化，请先创建主密码。"));
    }

    const unlocked = await unlockVaultRecord(record, elements.unlockPassword.value);
    await sessionSet(
      unlocked.encodedKey,
      unlocked.record.settings.autoLockMinutes
    );

    await refreshView(t("已解锁收藏管理页。"));
  } catch (error) {
    setMessage(
      error instanceof Error ? error.message : t("解锁失败，请确认主密码。"),
      "error"
    );
  }
}

function handleSearchInput() {
  state.query = elements.searchInput.value;
  renderView();

  if (state.sessionState !== "unlocked") {
    return;
  }

  sessionTouch()
    .then((response) => {
      if (response.status === "unlocked" && response.session) {
        state.encodedKey = response.session.encodedKey;
        setSessionState("unlocked", response.session.autoLockMinutes);
        return;
      }

      refreshView().catch((error) => {
        setMessage(error instanceof Error ? error.message : String(error), "error");
      });
    })
    .catch(() => {});
}

elements.openSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
elements.lockSession.addEventListener("click", async () => {
  await sessionLock();
  clearUnlockedState();
  await refreshView();
  setMessage(t("当前会话已锁定。"), "success");
});
elements.unlockForm.addEventListener("submit", handleUnlockSubmit);
elements.searchInput.addEventListener("input", handleSearchInput);
window.addEventListener("focus", () => {
  refreshView().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});

refreshView().catch((error) => {
  setMessage(error instanceof Error ? error.message : String(error), "error");
});
