import { downloadJson, readJsonFile } from "../core/download.js";
import { syncFolderCatalogFromBookmarks } from "../core/folder-catalog.js";
import { flushPendingQuickCaptures } from "../core/quick-capture.js";
import {
  clearFolderCatalog,
  clearPendingQuickCaptures,
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
  createVaultRecord,
  decryptBookmarksWithEncodedKey,
  encryptBookmarksWithEncodedKey,
  unlockVaultRecord
} from "../core/vault.js";
import { normalizeVaultRecord } from "../core/validation.js";
import {
  getLanguagePreference,
  initializeI18n,
  localizeDocument,
  setLanguagePreference,
  t
} from "../shared/i18n.js";

const MANAGER_PAGE_URL = chrome.runtime.getURL("src/manager/index.html");
const SHORTCUT_SETTINGS_URL = "chrome://extensions/shortcuts";
const FLOW_MODES = Object.freeze({
  NONE: "none",
  WELCOME: "welcome"
});
const WELCOME_STAGES = Object.freeze({
  HIDDEN: "hidden",
  SETUP: "setup",
  IMPORT: "import",
  COMPLETE: "complete"
});

try {
  await initializeI18n();
} finally {
  localizeDocument();
}

const SHORTCUT_COMMANDS = [
  {
    name: "_execute_action",
    title: "打开 SafeMarks",
    description: "打开扩展 popup，继续解锁、搜索或保存当前页。"
  },
  {
    name: "quick-capture",
    title: "快速收藏当前页",
    description: "打开快速收藏页，选择已有目录或新增目录后再保存。"
  },
  {
    name: "open-manager",
    title: "打开收藏管理",
    description: "直接跳到独立管理页，集中编辑和删除收藏。"
  },
  {
    name: "open-settings",
    title: "打开设置页",
    description: "直接打开 SafeMarks 设置。"
  }
];

const elements = {
  welcomePanel: document.querySelector("#welcome-panel"),
  welcomeEyebrow: document.querySelector("#welcome-eyebrow"),
  welcomeTitle: document.querySelector("#welcome-title"),
  welcomeDescription: document.querySelector("#welcome-description"),
  welcomeStepBadge: document.querySelector("#welcome-step-badge"),
  welcomeSetupStage: document.querySelector("#welcome-setup-stage"),
  welcomeSetupForm: document.querySelector("#welcome-setup-form"),
  welcomeSetupPassword: document.querySelector("#welcome-setup-password"),
  welcomeSetupConfirm: document.querySelector("#welcome-setup-confirm"),
  welcomeSetupAutolock: document.querySelector("#welcome-setup-autolock"),
  welcomeImportBackup: document.querySelector("#welcome-import-backup"),
  welcomeImportStage: document.querySelector("#welcome-import-stage"),
  welcomeImportCopy: document.querySelector("#welcome-import-copy"),
  welcomeImportTrigger: document.querySelector("#welcome-import-trigger"),
  welcomeCompleteStage: document.querySelector("#welcome-complete-stage"),
  welcomeCompleteCopy: document.querySelector("#welcome-complete-copy"),
  welcomeCompleteOpenManager: document.querySelector("#welcome-complete-open-manager"),
  optionsHero: document.querySelector("#options-hero"),
  openManager: document.querySelector("#open-manager"),
  message: document.querySelector("#options-message"),
  vaultStatus: document.querySelector("#vault-status"),
  sessionStatus: document.querySelector("#session-status"),
  lockSession: document.querySelector("#lock-session"),
  focusUnlock: document.querySelector("#focus-unlock"),
  languagePreference: document.querySelector("#language-preference"),
  saveLanguage: document.querySelector("#save-language"),
  settingsPanel: document.querySelector("#settings-panel"),
  autoLock: document.querySelector("#options-autolock"),
  saveSettings: document.querySelector("#save-settings"),
  exportEncrypted: document.querySelector("#export-encrypted"),
  exportPlain: document.querySelector("#export-plain"),
  importTrigger: document.querySelector("#import-encrypted-trigger"),
  importNative: document.querySelector("#import-native-trigger"),
  importNativeHint: document.querySelector("#import-native-hint"),
  importFile: document.querySelector("#import-encrypted-file"),
  openShortcutSettings: document.querySelector("#open-shortcut-settings"),
  shortcutList: document.querySelector("#shortcut-list"),
  unlockPanel: document.querySelector("#unlock-panel"),
  unlockPanelBadge: document.querySelector("#unlock-panel-badge"),
  unlockPanelCopy: document.querySelector("#unlock-panel-copy"),
  unlockForm: document.querySelector("#unlock-form"),
  unlockPassword: document.querySelector("#unlock-password"),
  resetData: document.querySelector("#reset-data"),
  resetConfirmPanel: document.querySelector("#reset-confirm-panel"),
  resetConfirmForm: document.querySelector("#reset-confirm-form"),
  resetPassword: document.querySelector("#reset-password"),
  resetConfirmSubmit: document.querySelector("#reset-confirm-submit"),
  resetConfirmCancel: document.querySelector("#reset-confirm-cancel")
};

const state = {
  hasVault: false,
  flowMode: parseFlowMode(),
  sessionState: "locked",
  pendingAction: null,
  welcomeStage: WELCOME_STAGES.HIDDEN
};

function parseFlowMode() {
  return new URLSearchParams(window.location.search).get("flow") === FLOW_MODES.WELCOME
    ? FLOW_MODES.WELCOME
    : FLOW_MODES.NONE;
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

function getVaultBookmarkCount(record) {
  return Number.isInteger(record?.meta?.bookmarkCount) ? record.meta.bookmarkCount : 0;
}

function resetWelcomeSetupForm() {
  elements.welcomeSetupForm.reset();
  elements.welcomeSetupAutolock.value = "5";
}

function getWelcomeStage(record) {
  if (!record) {
    return WELCOME_STAGES.SETUP;
  }

  if (state.flowMode !== FLOW_MODES.WELCOME) {
    return WELCOME_STAGES.HIDDEN;
  }

  return getVaultBookmarkCount(record) > 0
    ? WELCOME_STAGES.COMPLETE
    : WELCOME_STAGES.IMPORT;
}

function renderWelcomePanel(record) {
  const nextStage = getWelcomeStage(record);
  const previousStage = state.welcomeStage;
  state.welcomeStage = nextStage;

  elements.welcomePanel.hidden = nextStage === WELCOME_STAGES.HIDDEN;
  elements.welcomeSetupStage.hidden = nextStage !== WELCOME_STAGES.SETUP;
  elements.welcomeImportStage.hidden = nextStage !== WELCOME_STAGES.IMPORT;
  elements.welcomeCompleteStage.hidden = nextStage !== WELCOME_STAGES.COMPLETE;

  if (nextStage === WELCOME_STAGES.HIDDEN) {
    return;
  }

  if (nextStage === WELCOME_STAGES.SETUP && previousStage !== WELCOME_STAGES.SETUP) {
    resetWelcomeSetupForm();
  }

  if (nextStage === WELCOME_STAGES.SETUP) {
    elements.welcomeEyebrow.textContent =
      state.flowMode === FLOW_MODES.WELCOME
        ? t("首次开始")
        : t("当前还没有保险库");
    elements.welcomeTitle.textContent =
      state.flowMode === FLOW_MODES.WELCOME
        ? t("欢迎使用 SafeMarks")
        : t("先设置主密码");
    elements.welcomeDescription.textContent =
      state.flowMode === FLOW_MODES.WELCOME
        ? t("先设置主密码，再把浏览器里已有的书签带进来。")
        : t("设置好主密码后，就能在当前页导入浏览器书签或恢复加密备份。");
    elements.welcomeStepBadge.textContent = t("第 1 步 / 2");
    return;
  }

  if (nextStage === WELCOME_STAGES.IMPORT) {
    elements.welcomeEyebrow.textContent = t("下一步");
    elements.welcomeTitle.textContent = t("导入现有书签");
    elements.welcomeDescription.textContent = t("现在可以把浏览器里已有的书签带进来了。");
    elements.welcomeStepBadge.textContent = t("第 2 步 / 2");
    elements.welcomeImportCopy.textContent =
      state.sessionState === "unlocked"
        ? t("当前已解锁。建议先导入浏览器书签，原有目录会一起保留。")
        : t("当前已锁定。先在本页解锁，再继续导入。");
    return;
  }

  elements.welcomeEyebrow.textContent = t("准备好了");
  elements.welcomeTitle.textContent = t("可以开始用了");
  elements.welcomeDescription.textContent =
    state.sessionState === "unlocked"
      ? t("现有书签已准备好。接下来可以去管理页整理，或用工具栏保存当前页。")
      : t("数据已经准备好。先在本页解锁，再继续整理收藏。");
  elements.welcomeStepBadge.textContent = t("已完成");
  elements.welcomeCompleteCopy.textContent =
    state.sessionState === "unlocked"
      ? t("现有书签已准备好。接下来可以去管理页整理，或用工具栏保存当前页。")
      : t("数据已经准备好。先在本页解锁，再继续整理收藏。");
}

function openManagerPage() {
  chrome.tabs.create({ url: MANAGER_PAGE_URL });
}

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

function formatShortcut(shortcut) {
  return shortcut?.trim() || t("未分配");
}

function renderShortcutList(commands = []) {
  elements.shortcutList.replaceChildren();

  const commandMap = new Map(commands.map((command) => [command.name, command]));

  for (const shortcutCommand of SHORTCUT_COMMANDS) {
    const currentCommand = commandMap.get(shortcutCommand.name);
    const item = document.createElement("div");
    item.className = "shortcut-item";

    const copy = document.createElement("div");
    copy.className = "stack shortcut-copy";

    const title = document.createElement("strong");
    title.textContent = t(shortcutCommand.title);

    const description = document.createElement("p");
    description.className = "helper-text";
    description.textContent = t(shortcutCommand.description);

    const binding = document.createElement("span");
    binding.className = "badge shortcut-binding";
    binding.textContent = formatShortcut(currentCommand?.shortcut);

    if (!currentCommand?.shortcut) {
      binding.classList.add("shortcut-binding-empty");
    }

    copy.append(title, description);
    item.append(copy, binding);
    elements.shortcutList.append(item);
  }
}

function renderShortcutListUnavailable() {
  elements.shortcutList.replaceChildren();

  const item = document.createElement("div");
  item.className = "shortcut-item";

  const copy = document.createElement("div");
  copy.className = "stack shortcut-copy";

  const title = document.createElement("strong");
  title.textContent = t("当前环境不支持读取快捷键");

  const description = document.createElement("p");
  description.className = "helper-text";
  description.textContent = t("请手动打开 chrome://extensions/shortcuts 查看或修改 SafeMarks 的命令绑定。");

  const binding = document.createElement("span");
  binding.className = "badge shortcut-binding shortcut-binding-empty";
  binding.textContent = t("不可用");

  copy.append(title, description);
  item.append(copy, binding);
  elements.shortcutList.append(item);
}

async function refreshShortcutList() {
  if (!globalThis.chrome?.commands?.getAll) {
    renderShortcutListUnavailable();
    return;
  }

  const commands = await chrome.commands.getAll();
  renderShortcutList(commands);
}

async function openShortcutSettingsPage() {
  try {
    await chrome.tabs.create({ url: SHORTCUT_SETTINGS_URL });
    setMessage(t("已打开浏览器快捷键设置。修改后回到当前页即可查看最新绑定。"), "success");
  } catch {
    setMessage(t("请手动打开 {url} 调整快捷键。", {
      url: SHORTCUT_SETTINGS_URL
    }), "info");
  }
}

function updateImportHint() {
  if (!state.hasVault) {
    elements.importNativeHint.textContent = t("先创建保险库后，才能从浏览器导入收藏。");
    return;
  }

  if (state.sessionState === "unlocked") {
    elements.importNativeHint.textContent = t("当前会话已解锁，导入时会保留浏览器原有目录和分类。");
    return;
  }

  elements.importNativeHint.textContent = t("先在上方输入主密码解锁，再从浏览器导入。");
}

function syncLanguagePreferenceControl() {
  elements.languagePreference.value = getLanguagePreference();
}

function setResetConfirmVisible(visible) {
  elements.resetConfirmPanel.hidden = !visible;

  if (visible) {
    window.setTimeout(() => {
      elements.resetPassword.focus();
      elements.resetPassword.select();
    }, 40);
    return;
  }

  elements.resetConfirmForm.reset();
  elements.resetConfirmSubmit.disabled = false;
  elements.resetConfirmCancel.disabled = false;
}

function setUnlockPanel(visible, copy = t("输入主密码后即可继续在设置页导入、导出或调整保险库设置。")) {
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
  elements.vaultStatus.textContent = initialized ? t("已初始化") : t("未初始化");
  elements.settingsPanel.hidden = !initialized;
  elements.exportEncrypted.disabled = !initialized;
  elements.saveSettings.disabled = !initialized;
  elements.resetData.disabled = !initialized;
  updateImportHint();

  if (!initialized) {
    setUnlockPanel(false);
    setResetConfirmVisible(false);
  }
}

function setSessionState(status, minutes = null) {
  state.sessionState = status;

  if (status === "unlocked" && minutes) {
    elements.sessionStatus.textContent = t("已解锁 · {minutes} 分钟自动锁定", { minutes });
    elements.lockSession.disabled = false;
    elements.lockSession.hidden = false;
    elements.unlockPanelBadge.textContent = t("会话已解锁");
    setUnlockPanel(false);
    elements.exportPlain.disabled = false;
    updateImportHint();
    return;
  }

  elements.sessionStatus.textContent =
    status === "expired" ? t("已过期") : t("已锁定");
  elements.lockSession.disabled = true;
  elements.lockSession.hidden = true;
  elements.unlockPanelBadge.textContent =
    status === "expired" ? t("会话已过期") : t("会话已锁定");
  elements.exportPlain.disabled = true;
  updateImportHint();

  if (state.hasVault) {
    setUnlockPanel(
      true,
      status === "expired"
        ? t("当前会话已过期，请在这里重新输入主密码后继续操作。")
        : t("输入主密码后即可继续在设置页导入、导出或调整保险库设置。")
    );
  }
}

async function requireUnlockedSession(
  copy = t("输入主密码后即可继续在设置页导入、导出或调整保险库设置。")
) {
  const touched = await sessionTouch();
  if (touched.status !== "unlocked" || !touched.session) {
    setSessionState(touched.status);
    focusUnlockPanel(copy);
    throw new Error(t("保险库已锁定，请重新解锁。"));
  }

  setSessionState("unlocked", touched.session.autoLockMinutes);
  return touched.session;
}

function requireChromePermissions() {
  if (!globalThis.chrome?.permissions?.request) {
    throw new Error(t("当前环境不支持权限申请。"));
  }

  return globalThis.chrome.permissions;
}

function requireChromeBookmarks() {
  if (!globalThis.chrome?.bookmarks?.getTree) {
    throw new Error(t("当前环境不支持读取原生收藏夹。"));
  }

  return globalThis.chrome.bookmarks;
}

async function refreshView(message = "") {
  let importedCount = 0;
  let record = await loadVaultRecord();
  setVaultStatus(Boolean(record));
  if (record) {
    elements.autoLock.value = String(record.settings.autoLockMinutes);
  }

  const status = record ? await sessionStatus() : { status: "locked", session: null };
  if (status.status === "unlocked" && status.session) {
    const touched = await sessionTouch();
    if (touched.status === "unlocked" && touched.session) {
      const currentBookmarks = await decryptBookmarksWithEncodedKey(record, touched.session.encodedKey);
      const flushed = await flushPendingQuickCaptures({
        record,
        encodedKey: touched.session.encodedKey,
        currentBookmarks
      });
      record = flushed.record;
      importedCount = flushed.importedCount;
      await syncFolderCatalogFromBookmarks(flushed.bookmarks ?? currentBookmarks);
      if (importedCount > 0) {
        await refreshQuickCaptureBadge();
      }

      setSessionState("unlocked", touched.session.autoLockMinutes);
    } else {
      setSessionState(touched.status);
    }
  } else {
    setSessionState(status.status);
  }

  renderWelcomePanel(record);

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

async function runNativeImport(record, encodedKey) {
  const granted = await requireChromePermissions().request({
    permissions: ["bookmarks"]
  });
  if (!granted) {
    setMessage(t("未授予浏览器收藏读取权限，导入已取消。"), "info");
    return;
  }

  const tree = await requireChromeBookmarks().getTree();
  const { bookmarks: importedBookmarks, skippedCount } = flattenNativeBookmarkTree(tree);

  if (importedBookmarks.length === 0) {
    setMessage(
      skippedCount > 0
        ? t("没有可导入的网页收藏，已跳过 {count} 条不支持的项目。", {
            count: skippedCount
          })
        : t("浏览器收藏夹中没有可导入的网页收藏。"),
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
  await syncFolderCatalogFromBookmarks([...currentBookmarks, ...importedBookmarks]);
  await refreshView();
  setMessage(
    t("已从浏览器导入 {importedCount} 条收藏，跳过 {skippedCount} 条不支持的项目。", {
      importedCount: importedBookmarks.length,
      skippedCount
    }),
    "success"
  );
}

async function handleWelcomeSetupSubmit(event) {
  event.preventDefault();

  const password = elements.welcomeSetupPassword.value;
  const confirm = elements.welcomeSetupConfirm.value;

  if (!password) {
    setMessage(t("主密码不能为空。"), "error");
    return;
  }

  if (password !== confirm) {
    setMessage(t("两次输入的主密码不一致。"), "error");
    return;
  }

  try {
    const created = await createVaultRecord(password, elements.welcomeSetupAutolock.value);
    const record = await saveVaultRecord(created.record);
    getUnlockedSession(await sessionSet(
      created.encodedKey,
      record.settings.autoLockMinutes
    ));

    resetWelcomeSetupForm();
    await refreshView(t("已创建并解锁。下一步建议导入浏览器书签。"));
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleSaveSettings() {
  try {
    const record = await updateVaultSettings(elements.autoLock.value);
    const status = await sessionStatus();
    if (status.status === "unlocked" && status.session) {
      await sessionSet(status.session.encodedKey, record.settings.autoLockMinutes);
    }

    await refreshView(t("自动锁定时间已更新。"));
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleSaveLanguage() {
  try {
    elements.saveLanguage.disabled = true;
    await setLanguagePreference(elements.languagePreference.value);
    await refreshQuickCaptureBadge();
    window.location.reload();
  } catch (error) {
    elements.saveLanguage.disabled = false;
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleExportEncrypted() {
  try {
    const record = await loadVaultRecord();
    if (!record) {
      throw new Error(t("当前没有可导出的保险库。"));
    }

    downloadJson(`safemarks-encrypted-${Date.now()}.json`, record);
    setMessage(t("已导出加密备份。"), "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleExportPlain() {
  try {
    const record = await loadVaultRecord();
    if (!record) {
      throw new Error(t("当前没有可导出的保险库。"));
    }

    const session = await requireUnlockedSession(t("导出明文前，先在当前页输入主密码解锁。"));
    const confirmed = window.confirm(t("明文导出会生成可直接阅读的 JSON，确认继续？"));
    if (!confirmed) {
      return;
    }

    const bookmarks = await decryptBookmarksWithEncodedKey(record, session.encodedKey);
    downloadJson(`safemarks-plain-${Date.now()}.json`, bookmarks);
    setMessage(t("已导出明文 JSON，请妥善保管。"), "success");
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
    await clearFolderCatalog();
    await clearPendingQuickCaptures();
    await sessionLock();
    state.pendingAction = null;
    await refreshQuickCaptureBadge();
    await refreshView();
    setMessage(t("加密备份已导入，可直接在当前页输入原密码解锁。"), "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : t("导入失败。"), "error");
  }
}

async function handleImportNativeBookmarks() {
  try {
    const record = await loadVaultRecord();
    if (!record) {
      throw new Error(t("当前保险库未初始化，请先创建主密码后再导入。"));
    }

    const touched = await sessionTouch();
    if (touched.status !== "unlocked" || !touched.session) {
      state.pendingAction = "import-native";
      setSessionState(touched.status);
      renderWelcomePanel(record);
      focusUnlockPanel(t("从浏览器导入前，先在当前页输入主密码解锁。解锁后会自动继续导入。"));
      setMessage(t("从浏览器导入需要先解锁当前保险库。"), "info");
      return;
    }

    setSessionState("unlocked", touched.session.autoLockMinutes);
    state.pendingAction = null;
    await runNativeImport(record, touched.session.encodedKey);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : t("从浏览器导入失败。"), "error");
  }
}

async function handleUnlockSubmit(event) {
  event.preventDefault();

  try {
    const record = await loadVaultRecord();
    if (!record) {
      throw new Error(t("当前保险库未初始化，请先创建主密码。"));
    }

    const unlocked = await unlockVaultRecord(record, elements.unlockPassword.value);
    const session = getUnlockedSession(await sessionSet(
      unlocked.encodedKey,
      unlocked.record.settings.autoLockMinutes
    ));

    await refreshView(t("已在设置页解锁保险库。"));

    if (state.pendingAction === "import-native") {
      state.pendingAction = null;
      await runNativeImport(unlocked.record, session.encodedKey);
    }
  } catch (error) {
    setMessage(
      error instanceof Error ? error.message : t("解锁失败，请确认主密码。"),
      "error"
    );
  }
}

async function handleReset() {
  setResetConfirmVisible(true);
}

async function handleResetConfirm(event) {
  event.preventDefault();

  const record = await loadVaultRecord();
  if (!record) {
    throw new Error(t("当前保险库未初始化，请先创建主密码。"));
  }

  elements.resetConfirmSubmit.disabled = true;
  elements.resetConfirmCancel.disabled = true;

  try {
    await unlockVaultRecord(record, elements.resetPassword.value);
  } catch (error) {
    elements.resetConfirmSubmit.disabled = false;
    elements.resetConfirmCancel.disabled = false;
    throw error;
  }

  const confirmed = window.confirm(t("此操作不可撤销，确定继续？"));
  if (!confirmed) {
    setResetConfirmVisible(false);
    return;
  }

  try {
    await clearVaultRecord();
    await sessionLock();
    state.pendingAction = null;
    setResetConfirmVisible(false);
    await refreshQuickCaptureBadge();
    await refreshView();
    setMessage(t("本地数据已清空。"), "success");
  } catch (error) {
    elements.resetConfirmSubmit.disabled = false;
    elements.resetConfirmCancel.disabled = false;
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

elements.welcomeSetupForm.addEventListener("submit", handleWelcomeSetupSubmit);
elements.welcomeImportBackup.addEventListener("click", () => elements.importFile.click());
elements.welcomeImportTrigger.addEventListener("click", handleImportNativeBookmarks);
elements.welcomeCompleteOpenManager.addEventListener("click", openManagerPage);
elements.openManager.addEventListener("click", openManagerPage);
elements.saveLanguage.addEventListener("click", () => {
  handleSaveLanguage().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});
elements.saveSettings.addEventListener("click", handleSaveSettings);
elements.exportEncrypted.addEventListener("click", handleExportEncrypted);
elements.exportPlain.addEventListener("click", handleExportPlain);
elements.importTrigger.addEventListener("click", () => elements.importFile.click());
elements.importNative.addEventListener("click", handleImportNativeBookmarks);
elements.importFile.addEventListener("change", handleImport);
elements.openShortcutSettings.addEventListener("click", () => {
  openShortcutSettingsPage().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});
elements.unlockForm.addEventListener("submit", handleUnlockSubmit);
elements.resetData.addEventListener("click", handleReset);
elements.resetConfirmForm.addEventListener("submit", (event) => {
  handleResetConfirm(event).catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});
elements.resetConfirmCancel.addEventListener("click", () => {
  setResetConfirmVisible(false);
});
elements.lockSession.addEventListener("click", async () => {
  await sessionLock();
  state.pendingAction = null;
  await refreshView();
  setMessage(t("当前会话已锁定。"), "success");
});
elements.focusUnlock.addEventListener("click", () => {
  focusUnlockPanel(t("输入主密码后即可继续在设置页导入、导出或调整保险库设置。"));
});
window.addEventListener("focus", () => {
  syncLanguagePreferenceControl();
  refreshView().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
  refreshShortcutList().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});

syncLanguagePreferenceControl();
refreshView().catch((error) => {
  setMessage(error instanceof Error ? error.message : String(error), "error");
});
refreshShortcutList().catch((error) => {
  setMessage(error instanceof Error ? error.message : String(error), "error");
});
