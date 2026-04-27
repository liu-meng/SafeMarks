import { getBookmarkSearchResults } from "../core/bookmark-search.js";
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
  tableHead: document.querySelector("#table-head"),
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
  editingBookmarkId: null
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

function formatTimestamp(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function clearUnlockedState(clearQuery = false) {
  state.encodedKey = "";
  state.bookmarks = [];
  state.editingBookmarkId = null;

  if (clearQuery) {
    state.query = "";
    elements.searchInput.value = "";
  }
}

function setUnlockPanel(visible, copy = "输入主密码后即可继续查看和维护收藏。") {
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
    elements.sessionStatus.textContent = "未初始化";
    elements.lockSession.hidden = true;
    setUnlockPanel(false);
    return;
  }

  if (status === "unlocked" && minutes) {
    elements.sessionStatus.textContent = `已解锁 · ${minutes} 分钟自动锁定`;
    elements.lockSession.hidden = false;
    elements.lockSession.disabled = false;
    setUnlockPanel(false);
    return;
  }

  elements.sessionStatus.textContent =
    status === "expired" ? "会话已过期" : "会话已锁定";
  elements.lockSession.hidden = true;
  elements.lockSession.disabled = true;
  setUnlockPanel(
    true,
    status === "expired"
      ? "当前会话已过期，请重新输入主密码。"
      : "输入主密码后即可继续查看和维护收藏。"
  );
}

async function requireUnlockedSession(copy = "输入主密码后即可继续查看和维护收藏。") {
  const touched = await sessionTouch();
  if (touched.status !== "unlocked" || !touched.session) {
    clearUnlockedState();
    setSessionState(touched.status);
    renderView();
    focusUnlockPanel(copy);
    throw new Error("保险库已锁定，请重新解锁。");
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
    folderInput.placeholder = "可选，例如 工作/项目A";
    folderInput.value = bookmark.folderPath;

    const noteInput = document.createElement("textarea");
    noteInput.className = "textarea";
    noteInput.name = "note";
    noteInput.rows = 3;
    noteInput.placeholder = "可选，记录这条收藏的用途或补充信息";
    noteInput.value = bookmark.note;

    const titleLabel = document.createElement("label");
    titleLabel.className = "label";
    titleLabel.append(document.createElement("span"), titleInput);
    titleLabel.firstChild.textContent = "标题";

    const urlLabel = document.createElement("label");
    urlLabel.className = "label";
    urlLabel.append(document.createElement("span"), urlInput);
    urlLabel.firstChild.textContent = "URL";

    const folderLabel = document.createElement("label");
    folderLabel.className = "label";
    folderLabel.append(document.createElement("span"), folderInput);
    folderLabel.firstChild.textContent = "分类目录";

    const noteLabel = document.createElement("label");
    noteLabel.className = "label manager-edit-note";
    noteLabel.append(document.createElement("span"), noteInput);
    noteLabel.firstChild.textContent = "备注";

    const editGrid = document.createElement("div");
    editGrid.className = "manager-edit-grid";
    editGrid.append(titleLabel, urlLabel, folderLabel, noteLabel);

    const footer = document.createElement("div");
    footer.className = "manager-edit-footer";

    const createdAt = document.createElement("p");
    createdAt.className = "manager-edit-time";
    createdAt.textContent = `保存于 ${formatTimestamp(bookmark.createdAt)}`;

    const actions = document.createElement("div");
    actions.className = "button-row";

    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.className = "button";
    saveButton.textContent = "保存修改";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "ghost-button";
    cancelButton.textContent = "取消";
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
  main.dataset.label = "收藏";

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
  folder.dataset.label = "目录";
  const folderText = document.createElement("p");
  folderText.className = "manager-row-text";
  folderText.textContent = bookmark.folderPath || "未分类";
  folderText.title = folderText.textContent;
  folder.append(folderText);

  const note = document.createElement("div");
  note.className = "manager-row-cell";
  note.dataset.label = "备注";
  const noteText = document.createElement("p");
  noteText.className = "manager-row-text manager-row-note-text";
  noteText.textContent = bookmark.note || "无备注";
  noteText.title = noteText.textContent;
  note.append(noteText);

  const time = document.createElement("div");
  time.className = "manager-row-cell";
  time.dataset.label = "保存时间";
  const timeText = document.createElement("p");
  timeText.className = "manager-row-time";
  timeText.textContent = formatTimestamp(bookmark.createdAt);
  time.append(timeText);

  const actions = document.createElement("div");
  actions.className = "manager-row-cell manager-row-actions";
  actions.dataset.label = "操作";
  actions.append(
    createActionButton("编辑", "manager-action-button", () => handleStartEdit(bookmark.id)),
    createActionButton("删除", "manager-delete-button", () => handleDeleteBookmark(bookmark.id))
  );

  item.append(main, folder, note, time, actions);
  return item;
}

function renderView() {
  const unlocked = state.hasVault && state.sessionState === "unlocked";
  const filteredBookmarks = unlocked
    ? getBookmarkSearchResults(state.bookmarks, state.query)
    : [];

  elements.searchInput.disabled = !unlocked;
  elements.searchInput.value = state.query;
  elements.bookmarkList.replaceChildren();
  elements.tableHead.hidden = true;
  elements.emptyState.hidden = true;

  if (!state.hasVault) {
    elements.bookmarkCount.textContent = "未初始化";
    elements.managerStatus.textContent = "当前还没有保险库，先在 popup 创建主密码。";
    elements.emptyState.textContent = "创建保险库后，这里会显示可维护的收藏列表。";
    elements.emptyState.hidden = false;
    return;
  }

  if (!unlocked) {
    elements.bookmarkCount.textContent =
      state.sessionState === "expired" ? "会话已过期" : "会话已锁定";
    elements.managerStatus.textContent =
      state.sessionState === "expired"
        ? "当前会话已过期，请重新解锁后再继续维护收藏。"
        : "先解锁后，才能查看完整信息并编辑或删除收藏。";
    elements.emptyState.textContent = "解锁后这里会显示紧凑的收藏维护视图。";
    elements.emptyState.hidden = false;
    return;
  }

  elements.bookmarkCount.textContent = state.query.trim()
    ? `${filteredBookmarks.length} / ${state.bookmarks.length} 条收藏`
    : `${state.bookmarks.length} 条收藏`;
  elements.managerStatus.textContent = state.query.trim()
    ? "正在按标题、URL、目录和备注筛选收藏。"
    : "紧凑视图已按保存时间倒序展示，可直接在当前页编辑或删除。";

  if (filteredBookmarks.length === 0) {
    elements.emptyState.textContent =
      state.bookmarks.length === 0
        ? "还没有收藏，先在 popup 保存当前页。"
        : "没有匹配的收藏。";
    elements.emptyState.hidden = false;
    return;
  }

  elements.tableHead.hidden = false;
  for (const bookmark of filteredBookmarks) {
    elements.bookmarkList.append(createManagerRow(bookmark));
  }
}

async function refreshView(message = "") {
  const record = await loadVaultRecord();
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
      state.bookmarks = await decryptBookmarksWithEncodedKey(record, touched.session.encodedKey);
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
    setMessage(message, "success");
  }
}

async function persistBookmarks(nextBookmarks, successMessage) {
  const session = await requireUnlockedSession("管理收藏前，先在当前页输入主密码解锁。");
  const record = await loadVaultRecord();
  if (!record) {
    throw new Error("当前保险库未初始化。");
  }

  const nextRecord = await encryptBookmarksWithEncodedKey(record, nextBookmarks, session.encodedKey);
  await saveVaultRecord(nextRecord);
  state.record = nextRecord;
  state.bookmarks = nextBookmarks;
  state.editingBookmarkId = null;
  await refreshView(successMessage);
}

async function handleStartEdit(bookmarkId) {
  await requireUnlockedSession("编辑收藏前，先在当前页输入主密码解锁。");
  const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);
  if (!bookmark) {
    throw new Error("要编辑的收藏不存在。");
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
    throw new Error("要编辑的收藏不存在。");
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

  await persistBookmarks(nextBookmarks, "收藏已更新。");
}

async function handleDeleteBookmark(bookmarkId) {
  const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);
  if (!bookmark) {
    throw new Error("要删除的收藏不存在。");
  }

  await requireUnlockedSession("删除收藏前，先在当前页输入主密码解锁。");
  const confirmed = window.confirm(`确认删除“${bookmark.title}”？`);
  if (!confirmed) {
    return;
  }

  const nextBookmarks = state.bookmarks.filter((item) => item.id !== bookmarkId);
  await persistBookmarks(nextBookmarks, "收藏已删除。");
}

async function handleUnlockSubmit(event) {
  event.preventDefault();

  try {
    const record = await loadVaultRecord();
    if (!record) {
      throw new Error("当前保险库未初始化，请先创建主密码。");
    }

    const unlocked = await unlockVaultRecord(record, elements.unlockPassword.value);
    await sessionSet(
      unlocked.encodedKey,
      unlocked.record.settings.autoLockMinutes
    );

    await refreshView("已解锁收藏管理页。");
  } catch (error) {
    setMessage(
      error instanceof Error ? error.message : "解锁失败，请确认主密码。",
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
  setMessage("当前会话已锁定。", "success");
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
