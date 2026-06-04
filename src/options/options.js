import { downloadJson, readJsonFile } from "../core/download.js";
import {
  BACKUP_REMINDER_INTERVAL_DAYS,
  createRestorePreflight,
  getBackupReminderStatus
} from "../core/backup.js";
import { syncFolderCatalogFromBookmarks } from "../core/folder-catalog.js";
import { flushPendingQuickCaptures } from "../core/quick-capture.js";
import {
  clearFolderCatalog,
  clearPendingQuickCaptures,
  clearVaultRecord,
  loadBackupReminderState,
  loadVaultRecord,
  saveBackupReminderState,
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
  changeVaultPassword,
  createVaultRecord,
  decryptBookmarksWithEncodedKey,
  encryptBookmarksWithEncodedKey,
  unlockVaultRecord
} from "../core/vault.js";
import { findDuplicates } from "../core/dedup.js";
import {
  getLanguagePreference,
  formatDateTime,
  initializeI18n,
  localizeDocument,
  setLanguagePreference,
  t
} from "../shared/i18n.js";
import { createPasswordStrengthMeter } from "../shared/password-strength-meter.js";
import { confirmDialog, showMessage } from "../shared/ui.js";

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
  welcomeSetupHint: document.querySelector("#welcome-setup-hint"),
  welcomeSetupAutolock: document.querySelector("#welcome-setup-autolock"),
  welcomeImportBackup: document.querySelector("#welcome-import-backup"),
  welcomeImportStage: document.querySelector("#welcome-import-stage"),
  welcomeImportCopy: document.querySelector("#welcome-import-copy"),
  welcomeImportTrigger: document.querySelector("#welcome-import-trigger"),
  welcomeImportSkip: document.querySelector("#welcome-import-skip"),
  welcomeCompleteStage: document.querySelector("#welcome-complete-stage"),
  welcomeCompleteCopy: document.querySelector("#welcome-complete-copy"),
  welcomeCompleteOpenManager: document.querySelector("#welcome-complete-open-manager"),
  welcomeCompleteOpenPopup: document.querySelector("#welcome-complete-open-popup"),
  welcomeCompleteExportBackup: document.querySelector("#welcome-complete-export-backup"),
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
  changePasswordSection: document.querySelector("#change-password-section"),
  autoLock: document.querySelector("#options-autolock"),
  saveSettings: document.querySelector("#save-settings"),
  exportEncrypted: document.querySelector("#export-encrypted"),
  exportPlain: document.querySelector("#export-plain"),
  backupLastExport: document.querySelector("#backup-last-export"),
  backupReminder: document.querySelector("#backup-reminder"),
  backupReminderTitle: document.querySelector("#backup-reminder-title"),
  backupReminderCopy: document.querySelector("#backup-reminder-copy"),
  backupReminderExport: document.querySelector("#backup-reminder-export"),
  backupReminderDismiss: document.querySelector("#backup-reminder-dismiss"),
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
  changePasswordTrigger: document.querySelector("#change-password-trigger"),
  changePasswordPanel: document.querySelector("#change-password-panel"),
  changePasswordForm: document.querySelector("#change-password-form"),
  changeCurrentPassword: document.querySelector("#change-current-password"),
  changeNewPassword: document.querySelector("#change-new-password"),
  changePasswordHint: document.querySelector("#change-password-hint"),
  changeConfirmPassword: document.querySelector("#change-confirm-password"),
  changePasswordSubmit: document.querySelector("#change-password-submit"),
  changePasswordCancel: document.querySelector("#change-password-cancel"),
  resetData: document.querySelector("#reset-data"),
  resetConfirmPanel: document.querySelector("#reset-confirm-panel"),
  resetConfirmForm: document.querySelector("#reset-confirm-form"),
  resetPassword: document.querySelector("#reset-password"),
  resetConfirmSubmit: document.querySelector("#reset-confirm-submit"),
  resetConfirmCancel: document.querySelector("#reset-confirm-cancel")
};

const welcomeStrengthMeter = createPasswordStrengthMeter();
elements.welcomeSetupPassword.after(welcomeStrengthMeter.element);
elements.welcomeSetupPassword.addEventListener("input", (e) => welcomeStrengthMeter.update(e.target.value));

const changeStrengthMeter = createPasswordStrengthMeter();
elements.changeNewPassword.after(changeStrengthMeter.element);

elements.changeNewPassword.addEventListener("input", (e) => changeStrengthMeter.update(e.target.value));

const state = {
  hasVault: false,
  flowMode: parseFlowMode(),
  sessionState: "locked",
  pendingAction: null,
  welcomeStage: WELCOME_STAGES.HIDDEN,
  welcomeImportSkipped: false,
  backupReminderState: null
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
  showMessage(elements.message, text, tone);
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

  return getVaultBookmarkCount(record) > 0 || state.welcomeImportSkipped
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
        ? t("先设置主密码，再把浏览器里已有的书签带进来；SafeMarks 不需要账号，也不提供云同步。")
        : t("设置好主密码后，就能在当前页导入浏览器书签或恢复加密备份。");
    elements.welcomeStepBadge.textContent = t("第 1 步 / 3");
    return;
  }

  if (nextStage === WELCOME_STAGES.IMPORT) {
    elements.welcomeEyebrow.textContent = t("下一步");
    elements.welcomeTitle.textContent = t("导入现有书签");
    elements.welcomeDescription.textContent = t("现在可以把浏览器里已有的书签带进来了。");
    elements.welcomeStepBadge.textContent = t("第 2 步 / 3");
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
      ? t("SafeMarks 已准备好。接下来可以保存当前页、使用快速收藏，并定期导出加密备份。")
      : t("SafeMarks 已准备好。先在本页解锁，再继续整理收藏或导出备份。");
  elements.welcomeStepBadge.textContent = t("第 3 步 / 3");
  elements.welcomeCompleteCopy.textContent =
    state.sessionState === "unlocked"
      ? t("主密码无法找回；锁定状态下的快速收藏会先临时未加密暂存，解锁后自动写入保险库。建议现在导出一次加密备份。")
      : t("主密码无法找回；锁定状态下的快速收藏会先临时未加密暂存。解锁后可整理收藏并导出加密备份。");
}

function openManagerPage() {
  chrome.tabs.create({ url: MANAGER_PAGE_URL });
}

async function openPopupPage() {
  if (globalThis.chrome?.action?.openPopup) {
    await chrome.action.openPopup();
    return;
  }

  setMessage(t("请点击浏览器工具栏上的 SafeMarks 图标打开 popup。"), "info");
}

function formatQuickCaptureImportMessage(importedCount) {
  return t("已自动导入 {count} 条快速收藏。", { count: importedCount });
}

function formatBackupTimestamp(timestamp) {
  if (!timestamp) {
    return t("暂无记录");
  }

  return formatDateTime(timestamp, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function formatBackupCount(count) {
  return count === null ? t("未知") : String(count);
}

function formatAutoLockSummary(minutes) {
  return minutes === 0
    ? t("关闭浏览器时锁定")
    : t("{minutes} 分钟", { minutes });
}

function formatRestorePreflightMessage(preflight) {
  const overwriteWarning = preflight.hasExistingVault
    ? t("导入会覆盖当前本地保险库，并清空待写入的快速收藏。")
    : t("导入会创建本地保险库，并清空待写入的快速收藏。");

  return [
    t("加密备份预检已通过。"),
    "",
    t("版本：{version}", { version: preflight.version }),
    t("收藏数：{count}", { count: formatBackupCount(preflight.bookmarkCount) }),
    t("自动锁定：{value}", {
      value: formatAutoLockSummary(preflight.autoLockMinutes)
    }),
    t("密码提示：{value}", {
      value: preflight.hasPasswordHint ? t("有") : t("无")
    }),
    "",
    overwriteWarning,
    t("导入后需要使用该备份的原主密码解锁。确认继续？")
  ].join("\n");
}

async function renderBackupReminder(record) {
  const reminderState = await loadBackupReminderState();
  state.backupReminderState = reminderState;

  elements.backupLastExport.textContent = t("上次加密备份：{timestamp}", {
    timestamp: formatBackupTimestamp(reminderState.lastEncryptedExportAt)
  });

  const status = getBackupReminderStatus({
    hasVault: Boolean(record),
    bookmarkCount: getVaultBookmarkCount(record),
    reminderState
  });

  elements.backupReminder.hidden = !status.shouldShow;
  if (!status.shouldShow) {
    return;
  }

  if (status.reason === "never-exported") {
    elements.backupReminderTitle.textContent = t("建议立即导出加密备份");
    elements.backupReminderCopy.textContent =
      t("当前保险库已有收藏，但还没有加密备份记录。导出加密 JSON 后，即使浏览器本地数据丢失也能恢复。");
    return;
  }

  elements.backupReminderTitle.textContent =
    t("距离上次加密备份已超过 {days} 天", {
      days: BACKUP_REMINDER_INTERVAL_DAYS
    });
  elements.backupReminderCopy.textContent =
    t("SafeMarks 只保存本地密文。请定期导出加密 JSON，避免浏览器数据丢失后无法恢复。");
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

function setChangePasswordVisible(visible) {
  elements.changePasswordPanel.hidden = !visible;

  if (visible) {
    window.setTimeout(() => {
      elements.changeCurrentPassword.focus();
      elements.changeCurrentPassword.select();
    }, 40);
    return;
  }

  elements.changePasswordForm.reset();
  changeStrengthMeter.update("");
  elements.changePasswordSubmit.disabled = false;
  elements.changePasswordCancel.disabled = false;
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
  elements.changePasswordSection.hidden = !initialized;
  elements.exportEncrypted.disabled = !initialized;
  elements.saveSettings.disabled = !initialized;
  elements.resetData.disabled = !initialized;
  updateImportHint();

  if (!initialized) {
    setUnlockPanel(false);
    setChangePasswordVisible(false);
    setResetConfirmVisible(false);
  }
}

function setSessionState(status, minutes = null) {
  state.sessionState = status;

  if (status === "unlocked" && minutes !== null) {
    elements.sessionStatus.textContent = minutes === 0
      ? t("已解锁 · 关闭浏览器时锁定")
      : t("已解锁 · {minutes} 分钟自动锁定", { minutes });
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
  await renderBackupReminder(record);

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
  const { duplicates, unique } = findDuplicates(currentBookmarks, importedBookmarks);

  let finalImport;
  if (duplicates.length > 0) {
    const choice = await showDedupDialog(duplicates.length, importedBookmarks.length);
    if (choice === "skip") {
      finalImport = unique;
    } else if (choice === "overwrite") {
      const dupUrls = new Set(duplicates.map((d) => normalizeUrlForDedup(d.incoming.url)));
      const filtered = currentBookmarks.filter((bm) => !dupUrls.has(normalizeUrlForDedup(bm.url)));
      const nextRecord = await encryptBookmarksWithEncodedKey(record, [...filtered, ...importedBookmarks], encodedKey);
      await saveVaultRecord(nextRecord);
      await syncFolderCatalogFromBookmarks([...filtered, ...importedBookmarks]);
      await refreshView();
      setMessage(
        t("已从浏览器导入 {importedCount} 条收藏（覆盖 {dupCount} 条重复），跳过 {skippedCount} 条不支持的项目。", {
          importedCount: importedBookmarks.length,
          dupCount: duplicates.length,
          skippedCount
        }),
        "success"
      );
      return;
    } else {
      finalImport = importedBookmarks;
    }
  } else {
    finalImport = importedBookmarks;
  }

  const nextRecord = await encryptBookmarksWithEncodedKey(record, [...currentBookmarks, ...finalImport], encodedKey);
  await saveVaultRecord(nextRecord);
  await syncFolderCatalogFromBookmarks([...currentBookmarks, ...finalImport]);
  await refreshView();
  setMessage(
    duplicates.length > 0 && finalImport.length < importedBookmarks.length
      ? t("已从浏览器导入 {importedCount} 条收藏（跳过 {dupCount} 条重复），跳过 {skippedCount} 条不支持的项目。", {
          importedCount: finalImport.length,
          dupCount: duplicates.length,
          skippedCount
        })
      : t("已从浏览器导入 {importedCount} 条收藏，跳过 {skippedCount} 条不支持的项目。", {
          importedCount: finalImport.length,
          skippedCount
        }),
    "success"
  );
}

function normalizeUrlForDedup(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (url.origin + url.pathname.replace(/\/+$/, "") + url.search + url.hash).toLowerCase();
  } catch {
    return rawUrl.toLowerCase().trim();
  }
}

function showDedupDialog(dupCount, totalCount) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dedup-dialog-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "dedup-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const title = document.createElement("p");
    title.className = "dedup-dialog-title";
    title.textContent = t("发现 {dupCount} 条重复（共 {totalCount} 条待导入）", { dupCount, totalCount });

    const buttons = document.createElement("div");
    buttons.className = "button-row";

    const choices = [
      { key: "skip", label: t("跳过重复"), cls: "button" },
      { key: "overwrite", label: t("覆盖已有"), cls: "button-secondary" },
      { key: "all", label: t("全部导入"), cls: "button-secondary" }
    ];

    for (const { key, label, cls } of choices) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = cls;
      btn.textContent = label;
      btn.addEventListener("click", () => {
        backdrop.remove();
        resolve(key);
      });
      buttons.appendChild(btn);
    }

    dialog.appendChild(title);
    dialog.appendChild(buttons);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
  });
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
    const created = await createVaultRecord(password, elements.welcomeSetupAutolock.value, elements.welcomeSetupHint.value);
    const record = await saveVaultRecord(created.record);
    getUnlockedSession(await sessionSet(
      created.encodedKey,
      record.settings.autoLockMinutes
    ));

    state.welcomeImportSkipped = false;
    resetWelcomeSetupForm();
    await refreshView(t("已创建并解锁。下一步建议导入浏览器书签。"));
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleWelcomeImportSkip() {
  state.welcomeImportSkipped = true;
  await refreshView(t("已跳过浏览器书签导入。之后仍可在设置页导入。"));
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

    const exportedAt = Date.now();
    downloadJson(`safemarks-encrypted-${exportedAt}.json`, record);
    await saveBackupReminderState({
      ...state.backupReminderState,
      lastEncryptedExportAt: exportedAt,
      dismissedAt: null
    });
    await renderBackupReminder(record);
    setMessage(t("已导出加密备份。"), "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  }
}

async function handleBackupReminderDismiss() {
  try {
    await saveBackupReminderState({
      ...state.backupReminderState,
      dismissedAt: Date.now()
    });
    await renderBackupReminder(await loadVaultRecord());
    setMessage(t("已关闭本次备份提醒。"), "info");
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
    const confirmed = await confirmDialog({
      title: t("确认导出明文 JSON？"),
      body: t("明文导出会生成可直接阅读的 JSON。导出后请自行妥善保管。"),
      confirmLabel: t("导出明文"),
      tone: "danger"
    });
    if (!confirmed) {
      setMessage(t("已取消明文导出。"), "info");
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
    let payload;
    try {
      payload = await readJsonFile(file);
    } catch {
      throw new Error(t("这不是有效的 SafeMarks 加密备份。"));
    }

    const preflight = createRestorePreflight(payload, {
      hasExistingVault: Boolean(await loadVaultRecord())
    });
    const confirmed = await confirmDialog({
      title: t("确认导入加密备份？"),
      body: formatRestorePreflightMessage(preflight),
      confirmLabel: t("导入并覆盖"),
      tone: "danger"
    });
    if (!confirmed) {
      setMessage(t("已取消导入加密备份。"), "info");
      return;
    }

    await saveVaultRecord(preflight.record);
    await clearFolderCatalog();
    await clearPendingQuickCaptures();
    await sessionLock();
    state.pendingAction = null;
    state.welcomeImportSkipped = false;
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
    state.welcomeImportSkipped = false;
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
      state.welcomeImportSkipped = false;
      await runNativeImport(unlocked.record, session.encodedKey);
    }
  } catch (error) {
    setMessage(
      error instanceof Error ? error.message : t("解锁失败，请确认主密码。"),
      "error"
    );
  }
}

function handleChangePassword() {
  setChangePasswordVisible(true);
}

async function handleChangePasswordSubmit(event) {
  event.preventDefault();

  const currentPassword = elements.changeCurrentPassword.value;
  const newPassword = elements.changeNewPassword.value;
  const confirmPassword = elements.changeConfirmPassword.value;

  if (!newPassword) {
    setMessage(t("新密码不能为空。"), "error");
    return;
  }

  if (newPassword !== confirmPassword) {
    setMessage(t("两次输入的新密码不一致。"), "error");
    return;
  }

  if (newPassword === currentPassword) {
    setMessage(t("新密码不能与当前密码相同。"), "error");
    return;
  }

  const record = await loadVaultRecord();
  if (!record) {
    throw new Error(t("当前保险库未初始化，请先创建主密码。"));
  }

  elements.changePasswordSubmit.disabled = true;
  elements.changePasswordCancel.disabled = true;

  try {
    const changed = await changeVaultPassword(record, currentPassword, newPassword, undefined, elements.changePasswordHint.value);
    await saveVaultRecord(changed.record);
    await syncFolderCatalogFromBookmarks(changed.bookmarks);
    getUnlockedSession(await sessionSet(
      changed.encodedKey,
      changed.record.settings.autoLockMinutes
    ));

    setChangePasswordVisible(false);
    await refreshView(t("主密码已修改。"));
  } catch (error) {
    elements.changePasswordSubmit.disabled = false;
    elements.changePasswordCancel.disabled = false;
    throw error;
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

  const confirmed = await confirmDialog({
    title: t("确认清空本地数据？"),
    body: t("此操作会删除本地保险库、当前会话和待写入快速收藏，且不可撤销。"),
    confirmLabel: t("清空本地数据"),
    tone: "danger"
  });
  if (!confirmed) {
    setResetConfirmVisible(false);
    setMessage(t("已取消清空本地数据。"), "info");
    return;
  }

  try {
    await clearVaultRecord();
    await sessionLock();
    state.pendingAction = null;
    state.welcomeImportSkipped = false;
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
elements.welcomeImportSkip.addEventListener("click", () => {
  handleWelcomeImportSkip().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});
elements.welcomeCompleteOpenManager.addEventListener("click", openManagerPage);
elements.welcomeCompleteOpenPopup.addEventListener("click", () => {
  openPopupPage().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});
elements.welcomeCompleteExportBackup.addEventListener("click", handleExportEncrypted);
elements.openManager.addEventListener("click", openManagerPage);
elements.saveLanguage.addEventListener("click", () => {
  handleSaveLanguage().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});
elements.saveSettings.addEventListener("click", handleSaveSettings);
elements.exportEncrypted.addEventListener("click", handleExportEncrypted);
elements.backupReminderExport.addEventListener("click", handleExportEncrypted);
elements.backupReminderDismiss.addEventListener("click", handleBackupReminderDismiss);
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
elements.changePasswordTrigger.addEventListener("click", handleChangePassword);
elements.changePasswordForm.addEventListener("submit", (event) => {
  handleChangePasswordSubmit(event).catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});
elements.changePasswordCancel.addEventListener("click", () => {
  setChangePasswordVisible(false);
});
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
