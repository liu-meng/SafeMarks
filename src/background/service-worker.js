import { AUTO_LOCK_ALARM } from "../core/constants.js";
import {
  createBookmark,
  decryptBookmarksWithEncodedKey,
  encryptBookmarksWithEncodedKey
} from "../core/vault.js";
import { getQuickCaptureDraft, queueQuickCaptureBookmark, saveQuickCaptureBookmark } from "../core/quick-capture.js";
import {
  clearAutoLockAlarm,
  clearSessionRecord,
  createSessionRecord,
  isSessionExpired,
  readSessionRecord,
  scheduleAutoLock,
  writeSessionRecord
} from "../core/session.js";
import {
  hasStoredVaultRecord,
  loadPendingQuickCaptures,
  loadVaultRecord
} from "../core/storage.js";
import { initializeI18n, t } from "../shared/i18n.js";

const COMMANDS = {
  QUICK_CAPTURE: "quick-capture",
  OPEN_MANAGER: "open-manager",
  OPEN_SETTINGS: "open-settings"
};

const PAGE_URLS = {
  manager: chrome.runtime.getURL("src/manager/index.html"),
  onboarding: chrome.runtime.getURL("src/onboarding/index.html"),
  optionsWelcome: chrome.runtime.getURL("src/options/index.html?flow=welcome"),
  quickCapture: chrome.runtime.getURL("src/quick-capture/index.html")
};

const ACTION_STATUS = {
  success: {
    text: "+1",
    color: "#236b3d"
  },
  error: {
    text: "!",
    color: "#8f3d32"
  }
};

let i18nInitializationPromise = null;

function ensureI18n() {
  if (!i18nInitializationPromise) {
    i18nInitializationPromise = initializeI18n().catch((error) => {
      i18nInitializationPromise = null;
      throw error;
    });
  }

  return i18nInitializationPromise;
}

async function handleSessionSet(message) {
  const session = createSessionRecord({
    encodedKey: message.encodedKey,
    autoLockMinutes: message.autoLockMinutes
  });

  await writeSessionRecord(session);
  await scheduleAutoLock(session.expiresAt);

  return {
    status: "unlocked",
    session
  };
}

async function handleSessionTouch() {
  const current = await readSessionRecord();
  if (!current) {
    return { status: "locked", session: null };
  }

  if (isSessionExpired(current)) {
    await clearSessionRecord();
    await clearAutoLockAlarm();
    return { status: "expired", session: null };
  }

  const session = createSessionRecord({
    encodedKey: current.encodedKey,
    autoLockMinutes: current.autoLockMinutes
  });

  await writeSessionRecord(session);
  await scheduleAutoLock(session.expiresAt);

  return {
    status: "unlocked",
    session
  };
}

async function handleSessionLock() {
  await clearSessionRecord();
  await clearAutoLockAlarm();
  return {
    status: "locked",
    session: null
  };
}

async function handleSessionStatus() {
  const session = await readSessionRecord();

  if (!session) {
    return {
      status: "locked",
      session: null
    };
  }

  if (isSessionExpired(session)) {
    await clearSessionRecord();
    await clearAutoLockAlarm();
    return {
      status: "expired",
      session: null
    };
  }

  return {
    status: "unlocked",
    session
  };
}

function formatPendingBadgeText(count) {
  if (!count) {
    return "";
  }

  return count > 99 ? "99+" : String(count);
}

async function refreshActionBadge() {
  await ensureI18n();

  const pending = await loadPendingQuickCaptures();
  const count = pending.length;

  await chrome.action.setBadgeText({
    text: formatPendingBadgeText(count)
  });
  await chrome.action.setBadgeBackgroundColor({
    color: "#12656d"
  });
  await chrome.action.setTitle({
    title: count > 0
      ? t("SafeMarks（有 {count} 条快速收藏待写入，解锁后自动导入）", { count })
      : "SafeMarks"
  });
}

async function flashActionStatus(status, title) {
  const actionStatus = ACTION_STATUS[status];
  if (!actionStatus) {
    await refreshActionBadge();
    return;
  }

  await chrome.action.setBadgeText({
    text: actionStatus.text
  });
  await chrome.action.setBadgeBackgroundColor({
    color: actionStatus.color
  });
  await chrome.action.setTitle({ title });

  globalThis.setTimeout(() => {
    refreshActionBadge().catch(() => {});
  }, 1600);
}

async function handleQuickCaptureCommand() {
  await ensureI18n();

  const hasVault = await hasStoredVaultRecord();
  if (!hasVault) {
    await flashActionStatus("error", t("SafeMarks 尚未初始化，无法快速收藏。"));
    return;
  }

  const draft = await getQuickCaptureDraft();
  const pageUrl = new URL(PAGE_URLS.quickCapture);
  pageUrl.search = new URLSearchParams({
    title: draft.title,
    url: draft.url,
    faviconUrl: draft.faviconUrl
  }).toString();

  await chrome.windows.create({
    url: pageUrl.toString(),
    type: "popup",
    width: 460,
    height: 720,
    focused: true
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    SESSION_SET: () => handleSessionSet(message),
    SESSION_TOUCH: () => handleSessionTouch(),
    SESSION_LOCK: () => handleSessionLock(),
    SESSION_STATUS: () => handleSessionStatus(),
    QUICK_CAPTURE_BADGE_REFRESH: () => refreshActionBadge().then(() => ({ status: "ok" }))
  };

  const handler = handlers[message?.type];
  if (!handler) {
    return false;
  }

  handler()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTO_LOCK_ALARM) {
    return;
  }

  await clearSessionRecord();
  await clearAutoLockAlarm();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === COMMANDS.QUICK_CAPTURE) {
    try {
      await handleQuickCaptureCommand();
    } catch (error) {
      await flashActionStatus(
        "error",
        error instanceof Error ? error.message : String(error)
      );
    }
    return;
  }

  if (command === COMMANDS.OPEN_MANAGER) {
    await chrome.tabs.create({ url: PAGE_URLS.manager });
    return;
  }

  if (command === COMMANDS.OPEN_SETTINGS) {
    await chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  refreshActionBadge().catch(() => {});
  setupContextMenus();

  if (details.reason === "install") {
    chrome.tabs.create({ url: PAGE_URLS.onboarding }).catch(() => {});
  }

  if (details.reason === "update") {
    chrome.storage.local.set({ showChangelogBanner: true }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  refreshActionBadge().catch(() => {});
  setupContextMenus();
});

refreshActionBadge().catch(() => {});

async function setupContextMenus() {
  await ensureI18n();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "safemarks-save-page",
      title: t("保存到 SafeMarks"),
      contexts: ["page", "link"]
    });
    chrome.contextMenus.create({
      id: "safemarks-save-selection",
      title: t("保存到 SafeMarks（含选中文本）"),
      contexts: ["selection"]
    });
  });
}

async function handleContextMenuClick(info, tab) {
  await ensureI18n();

  const hasVault = await hasStoredVaultRecord();
  if (!hasVault) {
    await flashActionStatus("error", t("SafeMarks 尚未初始化，无法快速收藏。"));
    return;
  }

  const url = info.linkUrl || info.pageUrl;
  if (!url) return;

  const bookmark = createBookmark({
    url,
    title: tab?.title?.trim() || url,
    note: info.selectionText?.trim() || "",
    folderPath: ""
  });

  const sessionResult = await handleSessionStatus();
  if (sessionResult.status === "unlocked" && sessionResult.session) {
    const record = await loadVaultRecord();
    await saveQuickCaptureBookmark({ bookmark, record, encodedKey: sessionResult.session.encodedKey });
    await flashActionStatus("success", t("当前页已加密保存。"));
  } else {
    await queueQuickCaptureBookmark(bookmark);
    await refreshActionBadge();
    await flashActionStatus("success", t("已暂存，解锁后自动导入。"));
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab).catch((error) => {
    flashActionStatus("error", error instanceof Error ? error.message : String(error)).catch(() => {});
  });
});
