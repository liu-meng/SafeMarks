import { downloadJson, readJsonFile } from "../core/download.js";
import {
  clearVaultRecord,
  loadVaultRecord,
  saveVaultRecord,
  updateVaultSettings
} from "../core/storage.js";
import {
  readSessionRecord,
  sessionLock,
  sessionSet,
  sessionStatus,
  sessionTouch
} from "../core/session.js";
import { decryptBookmarksWithEncodedKey } from "../core/vault.js";
import { normalizeVaultRecord } from "../core/validation.js";

const elements = {
  message: document.querySelector("#options-message"),
  vaultStatus: document.querySelector("#vault-status"),
  sessionStatus: document.querySelector("#session-status"),
  lockSession: document.querySelector("#lock-session"),
  openPopup: document.querySelector("#open-popup"),
  settingsPanel: document.querySelector("#settings-panel"),
  autoLock: document.querySelector("#options-autolock"),
  saveSettings: document.querySelector("#save-settings"),
  exportEncrypted: document.querySelector("#export-encrypted"),
  exportPlain: document.querySelector("#export-plain"),
  importTrigger: document.querySelector("#import-encrypted-trigger"),
  importFile: document.querySelector("#import-encrypted-file"),
  resetData: document.querySelector("#reset-data")
};

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

function setVaultStatus(initialized) {
  elements.vaultStatus.textContent = initialized ? "已初始化" : "未初始化";
  elements.settingsPanel.hidden = !initialized;
  elements.exportEncrypted.disabled = !initialized;
  elements.saveSettings.disabled = !initialized;
  elements.resetData.disabled = !initialized;
}

function setSessionStatus(status, minutes = null) {
  if (status === "unlocked" && minutes) {
    elements.sessionStatus.textContent = `已解锁 · ${minutes} 分钟自动锁定`;
    elements.lockSession.disabled = false;
    elements.exportPlain.disabled = false;
    return;
  }

  elements.sessionStatus.textContent =
    status === "expired" ? "已过期" : "已锁定";
  elements.lockSession.disabled = true;
  elements.exportPlain.disabled = true;
}

async function refreshView(message = "") {
  const record = await loadVaultRecord();
  setVaultStatus(Boolean(record));
  if (record) {
    elements.autoLock.value = String(record.settings.autoLockMinutes);
  }

  const status = await sessionStatus();
  if (status.status === "unlocked" && status.session) {
    const touched = await sessionTouch();
    if (touched.status === "unlocked" && touched.session) {
      setSessionStatus("unlocked", touched.session.autoLockMinutes);
    } else {
      setSessionStatus(touched.status);
    }
  } else {
    setSessionStatus(status.status);
  }

  if (message) {
    setMessage(message, "success");
  }
}

async function handleSaveSettings() {
  try {
    const record = await updateVaultSettings(elements.autoLock.value);
    const session = await readSessionRecord();
    if (session) {
      await sessionSet(session.encodedKey, record.settings.autoLockMinutes);
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
    const session = await readSessionRecord();

    if (!record || !session) {
      throw new Error("当前会话未解锁，无法导出明文。");
    }

    const status = await sessionStatus();
    if (status.status !== "unlocked") {
      throw new Error("当前会话未解锁，无法导出明文。");
    }

    const confirmed = window.confirm("明文导出会生成可直接阅读的 JSON，确认继续？");
    if (!confirmed) {
      return;
    }

    const bookmarks = await decryptBookmarksWithEncodedKey(record, session.encodedKey);
    await sessionTouch();
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
    await refreshView();
    setMessage("加密备份已导入，请回到 popup 使用原密码解锁。", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "导入失败。", "error");
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
    await refreshView();
    setMessage("本地数据已清空。", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

elements.saveSettings.addEventListener("click", handleSaveSettings);
elements.exportEncrypted.addEventListener("click", handleExportEncrypted);
elements.exportPlain.addEventListener("click", handleExportPlain);
elements.importTrigger.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", handleImport);
elements.resetData.addEventListener("click", handleReset);
elements.lockSession.addEventListener("click", async () => {
  await sessionLock();
  await refreshView();
  setMessage("当前会话已锁定。", "success");
});
elements.openPopup.addEventListener("click", () => {
  window.open(chrome.runtime.getURL("src/popup/index.html"), "_blank", "noopener,noreferrer");
});

refreshView().catch((error) => {
  setMessage(error instanceof Error ? error.message : String(error), "error");
});
