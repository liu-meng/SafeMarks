import { readJsonFile } from "../core/download.js";
import { loadVaultRecord, saveVaultRecord } from "../core/storage.js";
import { sessionLock, sessionSet, sessionStatus, sessionTouch } from "../core/session.js";
import { getCurrentPageCandidate } from "../core/tabs.js";
import {
  createBookmark,
  createVaultRecord,
  decryptBookmarksWithEncodedKey,
  encryptBookmarksWithEncodedKey,
  unlockVaultRecord
} from "../core/vault.js";
import { normalizeVaultRecord } from "../core/validation.js";

const elements = {
  message: document.querySelector("#global-message"),
  setupScreen: document.querySelector("#setup-screen"),
  lockedScreen: document.querySelector("#locked-screen"),
  unlockedScreen: document.querySelector("#unlocked-screen"),
  setupForm: document.querySelector("#setup-form"),
  setupPassword: document.querySelector("#setup-password"),
  setupConfirm: document.querySelector("#setup-confirm"),
  setupAutolock: document.querySelector("#setup-autolock"),
  unlockForm: document.querySelector("#unlock-form"),
  unlockPassword: document.querySelector("#unlock-password"),
  searchInput: document.querySelector("#search-input"),
  addForm: document.querySelector("#add-form"),
  addTitle: document.querySelector("#bookmark-title"),
  addUrl: document.querySelector("#bookmark-url"),
  addSubmit: document.querySelector("#add-submit"),
  pageStatus: document.querySelector("#page-status"),
  bookmarkCount: document.querySelector("#bookmark-count"),
  bookmarkList: document.querySelector("#bookmark-list"),
  emptyState: document.querySelector("#empty-state"),
  sessionBadge: document.querySelector("#session-badge"),
  lockNow: document.querySelector("#lock-now"),
  openOptions: document.querySelector("#open-options"),
  lockedOpenOptions: document.querySelector("#locked-open-options"),
  lockedImportTrigger: document.querySelector("#locked-import-trigger"),
  lockedImportFile: document.querySelector("#locked-import-file")
};

const state = {
  record: null,
  encodedKey: "",
  bookmarks: [],
  query: "",
  lockTimer: null
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

function showScreen(screen) {
  elements.setupScreen.hidden = screen !== "setup";
  elements.lockedScreen.hidden = screen !== "locked";
  elements.unlockedScreen.hidden = screen !== "unlocked";
}

function clearLockTimer() {
  if (state.lockTimer) {
    window.clearTimeout(state.lockTimer);
    state.lockTimer = null;
  }
}

function formatTimestamp(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
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
  elements.searchInput.value = "";
  elements.addTitle.value = "";
  elements.addUrl.value = "";
}

function renderBookmarks() {
  const query = state.query.trim().toLowerCase();
  const filtered = state.bookmarks.filter((bookmark) => {
    if (!query) {
      return true;
    }

    return (
      bookmark.title.toLowerCase().includes(query) ||
      bookmark.url.toLowerCase().includes(query)
    );
  });

  elements.bookmarkCount.textContent = `${filtered.length} 条收藏`;
  elements.emptyState.hidden = filtered.length > 0;
  elements.bookmarkList.replaceChildren();

  for (const bookmark of filtered) {
    const item = document.createElement("li");
    item.className = "bookmark-item";

    const titleLink = document.createElement("a");
    titleLink.href = bookmark.url;
    titleLink.target = "_blank";
    titleLink.rel = "noreferrer";
    titleLink.textContent = bookmark.title;

    const urlLine = document.createElement("div");
    urlLine.className = "bookmark-url";
    urlLine.textContent = bookmark.url;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `保存于 ${formatTimestamp(bookmark.createdAt)}`;

    item.append(titleLink, urlLine, meta);
    elements.bookmarkList.append(item);
  }
}

async function refreshCurrentPageCandidate() {
  const candidate = await getCurrentPageCandidate();
  if (!candidate.supported) {
    elements.addTitle.value = "";
    elements.addUrl.value = "";
    elements.addTitle.disabled = true;
    elements.addUrl.disabled = true;
    elements.addSubmit.disabled = true;
    elements.pageStatus.textContent = candidate.reason;
    return;
  }

  elements.addTitle.disabled = false;
  elements.addUrl.disabled = false;
  elements.addSubmit.disabled = false;
  elements.addTitle.value = candidate.title;
  elements.addUrl.value = candidate.url;
  elements.pageStatus.textContent = "已读取当前页，可修改标题或 URL 后保存。";
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

async function showUnlocked(record, encodedKey, bookmarks, session) {
  state.record = record;
  state.encodedKey = encodedKey;
  state.bookmarks = [...bookmarks].sort((left, right) => right.createdAt - left.createdAt);
  state.query = "";
  elements.searchInput.value = "";

  showScreen("unlocked");
  renderBookmarks();
  scheduleLocalLock(session.expiresAt);
  await refreshCurrentPageCandidate();
}

async function initialize() {
  try {
    const record = await loadVaultRecord();
    state.record = record;

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
    showScreen(state.record ? "locked" : "setup");
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

async function handleAddSubmit(event) {
  event.preventDefault();

  try {
    await touchSessionState();
    const bookmark = createBookmark({
      title: elements.addTitle.value,
      url: elements.addUrl.value
    });
    const nextBookmarks = [bookmark, ...state.bookmarks];
    const nextRecord = await encryptBookmarksWithEncodedKey(
      state.record,
      nextBookmarks,
      state.encodedKey
    );

    await saveVaultRecord(nextRecord);
    state.record = nextRecord;
    state.bookmarks = nextBookmarks;
    renderBookmarks();
    setMessage("当前页已加密保存。", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleSearchInput() {
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

async function handleImport(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) {
    return;
  }

  try {
    const imported = normalizeVaultRecord(await readJsonFile(file));
    await saveVaultRecord(imported);
    await sessionLock();
    state.record = imported;
    resetUnlockedState();
    showScreen("locked");
    setMessage("已导入加密备份，请使用原主密码解锁。", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "导入失败。", "error");
  }
}

elements.setupForm.addEventListener("submit", handleSetupSubmit);
elements.unlockForm.addEventListener("submit", handleUnlockSubmit);
elements.addForm.addEventListener("submit", handleAddSubmit);
elements.searchInput.addEventListener("input", handleSearchInput);
elements.lockNow.addEventListener("click", handleManualLock);
elements.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
elements.lockedOpenOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
elements.lockedImportTrigger.addEventListener("click", () => elements.lockedImportFile.click());
elements.lockedImportFile.addEventListener("change", handleImport);

window.addEventListener("beforeunload", resetUnlockedState);
window.addEventListener("focus", () => {
  if (state.encodedKey) {
    touchSessionState().catch(() => {});
  }
});

initialize();
