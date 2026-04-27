import { downloadJson, readJsonFile } from "../core/download.js";
import {
  clearVaultRecord,
  loadVaultRecord,
  saveVaultRecord,
  updateVaultSettings
} from "../core/storage.js";
import {
  sessionLock,
  sessionSet,
  sessionStatus,
  sessionTouch
} from "../core/session.js";
import { flattenNativeBookmarkTree } from "../core/native-bookmarks.js";
import {
  decryptBookmarksWithEncodedKey,
  encryptBookmarksWithEncodedKey,
  unlockVaultRecord
} from "../core/vault.js";
import { normalizeVaultRecord } from "../core/validation.js";

const MANAGER_PAGE_URL = chrome.runtime.getURL("src/manager/index.html");

const elements = {
  optionsHero: document.querySelector("#options-hero"),
  openManager: document.querySelector("#open-manager"),
  message: document.querySelector("#options-message"),
  vaultStatus: document.querySelector("#vault-status"),
  sessionStatus: document.querySelector("#session-status"),
  lockSession: document.querySelector("#lock-session"),
  focusUnlock: document.querySelector("#focus-unlock"),
  settingsPanel: document.querySelector("#settings-panel"),
  autoLock: document.querySelector("#options-autolock"),
  saveSettings: document.querySelector("#save-settings"),
  exportEncrypted: document.querySelector("#export-encrypted"),
  exportPlain: document.querySelector("#export-plain"),
  importTrigger: document.querySelector("#import-encrypted-trigger"),
  importNative: document.querySelector("#import-native-trigger"),
  importNativeHint: document.querySelector("#import-native-hint"),
  importFile: document.querySelector("#import-encrypted-file"),
  unlockPanel: document.querySelector("#unlock-panel"),
  unlockPanelBadge: document.querySelector("#unlock-panel-badge"),
  unlockPanelCopy: document.querySelector("#unlock-panel-copy"),
  unlockForm: document.querySelector("#unlock-form"),
  unlockPassword: document.querySelector("#unlock-password"),
  resetData: document.querySelector("#reset-data")
};

const state = {
  hasVault: false,
  sessionState: "locked",
  pendingAction: null
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

function openManagerPage() {
  chrome.tabs.create({ url: MANAGER_PAGE_URL });
}

function updateImportHint() {
  if (!state.hasVault) {
    elements.importNativeHint.textContent = "先创建保险库后，才能从浏览器导入收藏。";
    return;
  }

  if (state.sessionState === "unlocked") {
    elements.importNativeHint.textContent = "当前会话已解锁，导入时会保留浏览器原有目录和分类。";
    return;
  }

  elements.importNativeHint.textContent = "先在上方输入主密码解锁，再从浏览器导入。";
}

function setUnlockPanel(visible, copy = "输入主密码后即可继续在设置页导入、导出或调整保险库设置。") {
  elements.unlockPanel.hidden = !visible;
  elements.optionsHero.classList.toggle("options-hero-with-unlock", visible);
  elements.focusUnlock.hidden = !visible;
  elements.unlockPanelCopy.textContent = copy;

  if (!visible) {
    elements.unlockForm.reset();
  }
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

function setVaultStatus(initialized) {
  state.hasVault = initialized;
  elements.vaultStatus.textContent = initialized ? "已初始化" : "未初始化";
  elements.settingsPanel.hidden = !initialized;
  elements.exportEncrypted.disabled = !initialized;
  elements.saveSettings.disabled = !initialized;
  elements.resetData.disabled = !initialized;
  updateImportHint();

  if (!initialized) {
    setUnlockPanel(false);
  }
}

function setSessionState(status, minutes = null) {
  state.sessionState = status;

  if (status === "unlocked" && minutes) {
    elements.sessionStatus.textContent = `已解锁 · ${minutes} 分钟自动锁定`;
    elements.lockSession.disabled = false;
    elements.lockSession.hidden = false;
    elements.unlockPanelBadge.textContent = "会话已解锁";
    setUnlockPanel(false);
    elements.exportPlain.disabled = false;
    updateImportHint();
    return;
  }

  elements.sessionStatus.textContent =
    status === "expired" ? "已过期" : "已锁定";
  elements.lockSession.disabled = true;
  elements.lockSession.hidden = true;
  elements.unlockPanelBadge.textContent =
    status === "expired" ? "会话已过期" : "会话已锁定";
  elements.exportPlain.disabled = true;
  updateImportHint();

  if (state.hasVault) {
    setUnlockPanel(
      true,
      status === "expired"
        ? "当前会话已过期，请在这里重新输入主密码后继续操作。"
        : "输入主密码后即可继续在设置页导入、导出或调整保险库设置。"
    );
  }
}

async function requireUnlockedSession(
  copy = "输入主密码后即可继续在设置页导入、导出或调整保险库设置。"
) {
  const touched = await sessionTouch();
  if (touched.status !== "unlocked" || !touched.session) {
    setSessionState(touched.status);
    focusUnlockPanel(copy);
    throw new Error("保险库已锁定，请重新解锁。");
  }

  setSessionState("unlocked", touched.session.autoLockMinutes);
  return touched.session;
}

function requireChromePermissions() {
  if (!globalThis.chrome?.permissions?.request) {
    throw new Error("当前环境不支持权限申请。");
  }

  return globalThis.chrome.permissions;
}

function requireChromeBookmarks() {
  if (!globalThis.chrome?.bookmarks?.getTree) {
    throw new Error("当前环境不支持读取原生收藏夹。");
  }

  return globalThis.chrome.bookmarks;
}

async function refreshView(message = "") {
  const record = await loadVaultRecord();
  setVaultStatus(Boolean(record));
  if (record) {
    elements.autoLock.value = String(record.settings.autoLockMinutes);
  }

  const status = record ? await sessionStatus() : { status: "locked", session: null };
  if (status.status === "unlocked" && status.session) {
    const touched = await sessionTouch();
    if (touched.status === "unlocked" && touched.session) {
      setSessionState("unlocked", touched.session.autoLockMinutes);
    } else {
      setSessionState(touched.status);
    }
  } else {
    setSessionState(status.status);
  }

  if (message) {
    setMessage(message, "success");
  }
}

async function runNativeImport(record, encodedKey) {
  const granted = await requireChromePermissions().request({
    permissions: ["bookmarks"]
  });
  if (!granted) {
    setMessage("未授予浏览器收藏读取权限，导入已取消。", "info");
    return;
  }

  const tree = await requireChromeBookmarks().getTree();
  const { bookmarks: importedBookmarks, skippedCount } = flattenNativeBookmarkTree(tree);

  if (importedBookmarks.length === 0) {
    setMessage(
      skippedCount > 0
        ? `没有可导入的网页收藏，已跳过 ${skippedCount} 条不支持的项目。`
        : "浏览器收藏夹中没有可导入的网页收藏。",
      "info"
    );
    await refreshView();
    return;
  }

  const currentBookmarks = await decryptBookmarksWithEncodedKey(record, encodedKey);
  const nextRecord = await encryptBookmarksWithEncodedKey(
    record,
    [...currentBookmarks, ...importedBookmarks],
    encodedKey
  );

  await saveVaultRecord(nextRecord);
  await refreshView();
  setMessage(
    `已从浏览器导入 ${importedBookmarks.length} 条收藏，跳过 ${skippedCount} 条不支持的项目。`,
    "success"
  );
}

async function handleSaveSettings() {
  try {
    const record = await updateVaultSettings(elements.autoLock.value);
    const status = await sessionStatus();
    if (status.status === "unlocked" && status.session) {
      await sessionSet(status.session.encodedKey, record.settings.autoLockMinutes);
    }

    await refreshView("自动锁定时间已更新。");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleExportEncrypted() {
  try {
    const record = await loadVaultRecord();
    if (!record) {
      throw new Error("当前没有可导出的保险库。");
    }

    downloadJson(`safemarks-encrypted-${Date.now()}.json`, record);
    setMessage("已导出加密备份。", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleExportPlain() {
  try {
    const record = await loadVaultRecord();
    if (!record) {
      throw new Error("当前没有可导出的保险库。");
    }

    const session = await requireUnlockedSession("导出明文前，先在当前页输入主密码解锁。");
    const confirmed = window.confirm("明文导出会生成可直接阅读的 JSON，确认继续？");
    if (!confirmed) {
      return;
    }

    const bookmarks = await decryptBookmarksWithEncodedKey(record, session.encodedKey);
    downloadJson(`safemarks-plain-${Date.now()}.json`, bookmarks);
    setMessage("已导出明文 JSON，请妥善保管。", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleImport(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) {
    return;
  }

  try {
    const record = normalizeVaultRecord(await readJsonFile(file));
    await saveVaultRecord(record);
    await sessionLock();
    state.pendingAction = null;
    await refreshView();
    setMessage("加密备份已导入，可直接在当前页输入原密码解锁。", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "导入失败。", "error");
  }
}

async function handleImportNativeBookmarks() {
  try {
    const record = await loadVaultRecord();
    if (!record) {
      throw new Error("当前保险库未初始化，请先创建主密码后再导入。");
    }

    const touched = await sessionTouch();
    if (touched.status !== "unlocked" || !touched.session) {
      state.pendingAction = "import-native";
      setSessionState(touched.status);
      focusUnlockPanel("从浏览器导入前，先在当前页输入主密码解锁。解锁后会自动继续导入。");
      setMessage("从浏览器导入需要先解锁当前保险库。", "info");
      return;
    }

    setSessionState("unlocked", touched.session.autoLockMinutes);
    state.pendingAction = null;
    await runNativeImport(record, touched.session.encodedKey);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "从浏览器导入失败。", "error");
  }
}

async function handleUnlockSubmit(event) {
  event.preventDefault();

  try {
    const record = await loadVaultRecord();
    if (!record) {
      throw new Error("当前保险库未初始化，请先创建主密码。");
    }

    const unlocked = await unlockVaultRecord(record, elements.unlockPassword.value);
    const session = getUnlockedSession(await sessionSet(
      unlocked.encodedKey,
      unlocked.record.settings.autoLockMinutes
    ));

    await refreshView();
    setMessage("已在设置页解锁保险库。", "success");

    if (state.pendingAction === "import-native") {
      state.pendingAction = null;
      await runNativeImport(unlocked.record, session.encodedKey);
    }
  } catch (error) {
    setMessage(
      error instanceof Error ? error.message : "解锁失败，请确认主密码。",
      "error"
    );
  }
}

async function handleReset() {
  const confirmed = window.confirm("确认删除本地所有 SafeMarks 数据？");
  if (!confirmed) {
    return;
  }

  const secondConfirmed = window.confirm("此操作不可撤销，确定继续？");
  if (!secondConfirmed) {
    return;
  }

  try {
    await clearVaultRecord();
    await sessionLock();
    state.pendingAction = null;
    await refreshView();
    setMessage("本地数据已清空。", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

elements.openManager.addEventListener("click", openManagerPage);
elements.saveSettings.addEventListener("click", handleSaveSettings);
elements.exportEncrypted.addEventListener("click", handleExportEncrypted);
elements.exportPlain.addEventListener("click", handleExportPlain);
elements.importTrigger.addEventListener("click", () => elements.importFile.click());
elements.importNative.addEventListener("click", handleImportNativeBookmarks);
elements.importFile.addEventListener("change", handleImport);
elements.unlockForm.addEventListener("submit", handleUnlockSubmit);
elements.resetData.addEventListener("click", handleReset);
elements.lockSession.addEventListener("click", async () => {
  await sessionLock();
  state.pendingAction = null;
  await refreshView();
  setMessage("当前会话已锁定。", "success");
});
elements.focusUnlock.addEventListener("click", () => {
  focusUnlockPanel("输入主密码后即可继续在设置页导入、导出或调整保险库设置。");
});
window.addEventListener("focus", () => {
  refreshView().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});

refreshView().catch((error) => {
  setMessage(error instanceof Error ? error.message : String(error), "error");
});
