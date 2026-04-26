import { hasStoredVaultRecord, loadVaultRecord, saveVaultRecord } from "../core/storage.js";
import { sessionLock, sessionSet, sessionStatus, sessionTouch } from "../core/session.js";
import { getCurrentPageCandidate, getPageFaviconUrl } from "../core/tabs.js";
import {
  createBookmark,
  createVaultRecord,
  decryptBookmarksWithEncodedKey,
  encryptBookmarksWithEncodedKey,
  unlockVaultRecord
} from "../core/vault.js";

const elements = {
  message: document.querySelector("#global-message"),
  setupScreen: document.querySelector("#setup-screen"),
  lockedScreen: document.querySelector("#locked-screen"),
  unlockedScreen: document.querySelector("#unlocked-screen"),
  openSettings: document.querySelector("#open-settings"),
  setupForm: document.querySelector("#setup-form"),
  setupPassword: document.querySelector("#setup-password"),
  setupConfirm: document.querySelector("#setup-confirm"),
  setupAutolock: document.querySelector("#setup-autolock"),
  unlockForm: document.querySelector("#unlock-form"),
  unlockPassword: document.querySelector("#unlock-password"),
  lockedBookmarkCount: document.querySelector("#locked-bookmark-count"),
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
  addFolderPath: document.querySelector("#bookmark-folder-path"),
  addNote: document.querySelector("#bookmark-note"),
  addSubmit: document.querySelector("#add-submit"),
  pageStatus: document.querySelector("#page-status"),
  bookmarkCount: document.querySelector("#bookmark-count"),
  bookmarkList: document.querySelector("#bookmark-list"),
  emptyState: document.querySelector("#empty-state"),
  sessionBadge: document.querySelector("#session-badge"),
  lockNow: document.querySelector("#lock-now")
};

const state = {
  record: null,
  encodedKey: "",
  bookmarks: [],
  query: "",
  lockTimer: null,
  savePanelOpen: false,
  saveMode: "create",
  editingBookmarkId: null,
  detailBookmarkId: null,
  collapsedFolders: new Set()
};

function getUnlockedSession(response) {
  if (response?.status !== "unlocked" || !response.session) {
    throw new Error("会话不可用，请重新解锁。");
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

function getBookmarkCount(record = state.record) {
  return Number.isInteger(record?.meta?.bookmarkCount)
    ? record.meta.bookmarkCount
    : null;
}

function updateLockedBookmarkCount(record = state.record) {
  const count = getBookmarkCount(record);
  elements.lockedBookmarkCount.textContent =
    count === null
      ? "收藏条数将在首次解锁后同步"
      : `已保存 ${count} 条收藏`;
}

function showScreen(screen) {
  elements.setupScreen.hidden = screen !== "setup";
  elements.lockedScreen.hidden = screen !== "locked";
  elements.unlockedScreen.hidden = screen !== "unlocked";

  if (screen === "locked") {
    updateLockedBookmarkCount();
  }
}

function clearLockTimer() {
  if (state.lockTimer) {
    window.clearTimeout(state.lockTimer);
    state.lockTimer = null;
  }
}

function resetSaveForm() {
  state.savePanelOpen = false;
  state.saveMode = "create";
  state.editingBookmarkId = null;
  elements.savePanel.hidden = true;
  elements.savePanelTitle.textContent = "新建收藏";
  elements.addTitle.value = "";
  elements.addUrl.value = "";
  elements.addFolderPath.value = "";
  elements.addNote.value = "";
  elements.addTitle.disabled = true;
  elements.addUrl.disabled = true;
  elements.addFolderPath.disabled = true;
  elements.addNote.disabled = true;
  elements.addSubmit.disabled = true;
  elements.addSubmit.textContent = "完成";
  elements.pageStatus.textContent = "点击“保存当前页”后读取当前页面信息。";
}

function openSaveForm(mode, bookmark = null) {
  state.savePanelOpen = true;
  state.saveMode = mode;
  state.editingBookmarkId = bookmark?.id ?? null;
  elements.savePanel.hidden = false;
  elements.addTitle.disabled = false;
  elements.addUrl.disabled = false;
  elements.addFolderPath.disabled = false;
  elements.addNote.disabled = false;
  elements.addSubmit.disabled = false;
  elements.savePanelTitle.textContent = mode === "edit" ? "编辑收藏" : "新建收藏";
  elements.addSubmit.textContent = mode === "edit" ? "保存修改" : "完成";

  if (mode === "edit" && bookmark) {
    elements.addTitle.value = bookmark.title;
    elements.addUrl.value = bookmark.url;
    elements.addFolderPath.value = bookmark.folderPath;
    elements.addNote.value = bookmark.note;
    elements.pageStatus.textContent = "可修改标题、URL、分类目录和备注，保存后会覆盖原收藏。";
    return;
  }

  elements.addTitle.value = "";
  elements.addUrl.value = "";
  elements.addFolderPath.value = "";
  elements.addNote.value = "";
  elements.pageStatus.textContent = "正在读取当前页面信息...";
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
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
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
  return [...nodes].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
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
    state.detailBookmarkId === bookmark.id ? "收起详情" : "查看详情";
  detailButton.addEventListener("click", () => {
    handleToggleBookmarkDetail(bookmark.id).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    });
  });

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "bookmark-action-button";
  editButton.textContent = "编辑";
  editButton.addEventListener("click", () => {
    handleEditBookmark(bookmark.id).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    });
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "bookmark-delete-button";
  deleteButton.textContent = "删除";
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
    ? `${bookmark.folderPath} · 保存于 ${formatTimestamp(bookmark.createdAt)}`
    : `保存于 ${formatTimestamp(bookmark.createdAt)}`;

  titleMain.append(faviconShell, titleLink);
  actionGroup.append(detailButton, editButton, deleteButton);
  titleRow.append(titleMain);
  item.append(titleRow, urlLine, meta, actionGroup);

  if (state.detailBookmarkId === bookmark.id) {
    const detailCard = document.createElement("div");
    detailCard.className = "bookmark-detail-card";

    if (bookmark.folderPath) {
      const detailFolderRow = document.createElement("div");
      detailFolderRow.className = "bookmark-detail-row";
      const detailFolderLabel = document.createElement("span");
      detailFolderLabel.className = "bookmark-detail-label";
      detailFolderLabel.textContent = "目录";
      const detailFolderValue = document.createElement("div");
      detailFolderValue.className = "bookmark-detail-value";
      detailFolderValue.textContent = bookmark.folderPath;
      detailFolderRow.append(detailFolderLabel, detailFolderValue);
      detailCard.append(detailFolderRow);
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
    detailNoteLabel.textContent = "备注";
    const detailNoteValue = document.createElement("div");
    detailNoteValue.className = "bookmark-detail-value bookmark-detail-note";
    detailNoteValue.textContent = bookmark.note || "无备注";
    detailNoteRow.append(detailNoteLabel, detailNoteValue);

    const detailTimeRow = document.createElement("div");
    detailTimeRow.className = "bookmark-detail-row";
    const detailTimeLabel = document.createElement("span");
    detailTimeLabel.className = "bookmark-detail-label";
    detailTimeLabel.textContent = "保存时间";
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
    folderMeta.textContent = `${countTreeBookmarks(child)} 条收藏`;

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
  const seconds = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  elements.sessionBadge.textContent = `已解锁 · 约 ${minutes} 分钟后自动锁定`;
}

function scheduleLocalLock(expiresAt) {
  clearLockTimer();
  updateSessionBadge(expiresAt);

  const timeout = Math.max(0, expiresAt - Date.now());
  state.lockTimer = window.setTimeout(() => {
    resetUnlockedState();
    showScreen("locked");
    setMessage("已因无操作自动锁定，请重新输入主密码。", "info");
  }, timeout);
}

function resetUnlockedState() {
  clearLockTimer();
  state.encodedKey = "";
  state.bookmarks = [];
  state.query = "";
  state.collapsedFolders = new Set();
  elements.searchInput.value = "";
  resetSaveForm();
}

function renderBookmarks() {
  const query = state.query.trim().toLowerCase();
  const filtered = state.bookmarks.filter((bookmark) => {
    if (!query) {
      return true;
    }

    return (
      bookmark.title.toLowerCase().includes(query) ||
      bookmark.url.toLowerCase().includes(query) ||
      bookmark.folderPath.toLowerCase().includes(query)
    );
  });

  elements.bookmarkCount.textContent = query
    ? `${filtered.length} / ${state.bookmarks.length} 条收藏`
    : `${state.bookmarks.length} 条收藏`;
  elements.emptyState.hidden = filtered.length > 0;
  elements.emptyState.textContent = query
    ? "没有匹配的收藏。"
    : "还没有收藏，先把当前页加入保险库。";
  elements.bookmarkList.replaceChildren();
  if (filtered.length === 0) {
    return;
  }

  const tree = buildBookmarkTree(filtered);
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
    return;
  }

  elements.addTitle.disabled = false;
  elements.addUrl.disabled = false;
  elements.addFolderPath.disabled = false;
  elements.addNote.disabled = false;
  elements.addSubmit.disabled = false;
  elements.addTitle.value = candidate.title;
  elements.addUrl.value = candidate.url;
  elements.pageStatus.textContent = "可按原生收藏习惯修改标题或 URL 后再保存。";
}

async function touchSessionState() {
  const response = await sessionTouch();
  if (response.status !== "unlocked" || !response.session) {
    resetUnlockedState();
    showScreen("locked");
    setMessage("保险库已锁定，请重新解锁。", "info");
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
  state.record = await syncBookmarkCount(record, bookmarks);
  state.encodedKey = encodedKey;
  state.bookmarks = [...bookmarks].sort((left, right) => right.createdAt - left.createdAt);
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
}

async function initialize() {
  let hasStoredVault = false;

  try {
    hasStoredVault = await hasStoredVaultRecord();
    const record = hasStoredVault ? await loadVaultRecord() : null;
    state.record = record;
    updateLockedBookmarkCount(record);

    if (!record) {
      showScreen("setup");
      setMessage("首次使用需要创建一个主密码。", "info");
      return;
    }

    const status = await sessionStatus();
    if (status.status === "unlocked" && status.session) {
      const touched = await touchSessionState();
      const bookmarks = await decryptBookmarksWithEncodedKey(record, touched.encodedKey);
      await showUnlocked(record, touched.encodedKey, bookmarks, touched);
      return;
    }

    showScreen("locked");
    setMessage(
      status.status === "expired"
        ? "会话已过期，请重新输入主密码。"
        : "输入主密码即可解锁。",
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
    setMessage("主密码不能为空。", "error");
    return;
  }

  if (password !== confirm) {
    setMessage("两次输入的主密码不一致。", "error");
    return;
  }

  try {
    const created = await createVaultRecord(password, elements.setupAutolock.value);
    const record = await saveVaultRecord(created.record);
    const session = getUnlockedSession(await sessionSet(
      created.encodedKey,
      record.settings.autoLockMinutes
    ));

    await showUnlocked(record, created.encodedKey, [], session);
    elements.setupForm.reset();
    elements.setupAutolock.value = String(record.settings.autoLockMinutes);
    setMessage("保险库已创建并完成解锁。", "success");
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
      setMessage("尚未初始化，请先创建主密码。", "info");
      return;
    }

    const unlocked = await unlockVaultRecord(record, elements.unlockPassword.value);
    const session = getUnlockedSession(await sessionSet(
      unlocked.encodedKey,
      unlocked.record.settings.autoLockMinutes
    ));

    await showUnlocked(
      unlocked.record,
      unlocked.encodedKey,
      unlocked.bookmarks,
      session
    );
    elements.unlockForm.reset();
    setMessage("已解锁保险库。", "success");
  } catch (error) {
    setMessage(
      error instanceof Error ? error.message : "解锁失败，请确认主密码。",
      "error"
    );
  }
}

async function handleOpenSavePanel() {
  try {
    await touchSessionState();
    openSaveForm("create");
    await refreshCurrentPageCandidate();
    if (!elements.addTitle.disabled) {
      elements.addTitle.focus();
      elements.addTitle.select();
    }
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
        throw new Error("要编辑的收藏不存在。");
      }

      const draftBookmark = createBookmark({
        title: elements.addTitle.value,
        url: elements.addUrl.value,
        folderPath: elements.addFolderPath.value,
        note: elements.addNote.value
      });
      const nextBookmarks = state.bookmarks.map((bookmark) =>
        bookmark.id === currentBookmark.id
          ? {
              ...bookmark,
              title: draftBookmark.title,
              url: draftBookmark.url,
              folderPath: draftBookmark.folderPath,
              note: draftBookmark.note
            }
          : bookmark
      );
      await persistBookmarks(nextBookmarks, "收藏已更新。");
    } else {
      const bookmark = createBookmark({
        title: elements.addTitle.value,
        url: elements.addUrl.value,
        folderPath: elements.addFolderPath.value,
        note: elements.addNote.value
      });
      const nextBookmarks = [bookmark, ...state.bookmarks];
      await persistBookmarks(nextBookmarks, "当前页已加密保存。");
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
    throw new Error("要编辑的收藏不存在。");
  }

  openSaveForm("edit", bookmark);
  elements.addTitle.focus();
  elements.addTitle.select();
}

async function handleDeleteBookmark(bookmarkId) {
  const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);
  if (!bookmark) {
    throw new Error("要删除的收藏不存在。");
  }

  const confirmed = window.confirm(`确认删除“${bookmark.title}”？`);
  if (!confirmed) {
    return;
  }

  if (state.editingBookmarkId === bookmarkId) {
    resetSaveForm();
  }

  const nextBookmarks = state.bookmarks.filter((item) => item.id !== bookmarkId);
  await persistBookmarks(nextBookmarks, "收藏已删除。");
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
  setMessage("保险库已手动锁定。", "info");
}

elements.setupForm.addEventListener("submit", handleSetupSubmit);
elements.unlockForm.addEventListener("submit", handleUnlockSubmit);
elements.openSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
elements.saveCurrentPage.addEventListener("click", handleOpenSavePanel);
elements.saveCurrentPageFavicon.addEventListener("error", () => setSaveTriggerFavicon(""));
elements.closeSavePanel.addEventListener("click", resetSaveForm);
elements.addForm.addEventListener("submit", handleAddSubmit);
elements.searchInput.addEventListener("input", handleSearchInput);
elements.lockNow.addEventListener("click", handleManualLock);

window.addEventListener("beforeunload", resetUnlockedState);
window.addEventListener("focus", () => {
  if (state.encodedKey) {
    touchSessionState().catch(() => {});
  }
});

initialize();
