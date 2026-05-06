export const LANGUAGE_PREFERENCES = Object.freeze({
  AUTO: "auto",
  CHINESE: "zh-CN",
  ENGLISH: "en"
});

const DEFAULT_LOCALE = LANGUAGE_PREFERENCES.ENGLISH;
const LANGUAGE_PREFERENCE_STORAGE_KEY = "languagePreference";
const SUPPORTED_LOCALES = new Set([
  LANGUAGE_PREFERENCES.CHINESE,
  LANGUAGE_PREFERENCES.ENGLISH
]);
let activeLanguagePreference = LANGUAGE_PREFERENCES.AUTO;
let activeLocale = DEFAULT_LOCALE;
let initializationPromise = null;
let storageListenerRegistered = false;

const EN_TRANSLATIONS = Object.freeze({
  "SafeMarks 设置": "SafeMarks Settings",
  "SafeMarks 收藏管理": "SafeMarks Bookmark Manager",
  "SafeMarks 快速收藏": "SafeMarks Quick Capture",
  "加密收藏夹": "Encrypted Bookmarks",
  "设置": "Settings",
  "popup 只保留解锁、保存当前页和快速查找；完整维护请到管理页。":
    "The popup is limited to unlock, save current page, and quick search. Use the manager for full maintenance.",
  "首次创建保险库": "Create Your Vault",
  "创建后会立即加密一个空收藏库；常规保存会直接写入密文，锁定状态下的快速收藏会先本地暂存，待解锁后导入保险库。":
    "An empty bookmark vault is encrypted immediately after setup. Regular saves go straight into the encrypted vault, while quick captures created during the locked state are stored locally until the next unlock imports them.",
  "主密码": "Master Password",
  "确认主密码": "Confirm Master Password",
  "自动锁定": "Auto Lock",
  "1 分钟": "1 minute",
  "5 分钟": "5 minutes",
  "15 分钟": "15 minutes",
  "30 分钟": "30 minutes",
  "创建保险库": "Create Vault",
  "保险库已锁定": "Vault Locked",
  "收藏条数将在首次解锁后同步": "Bookmark count will sync after the first unlock",
  "输入主密码后即可查看收藏，并继续保存当前页。":
    "Enter your master password to view bookmarks and keep saving the current page.",
  "解锁": "Unlock",
  "当前保险库": "Current Vault",
  "已解锁": "Unlocked",
  "锁定": "Lock",
  "保存当前页": "Save Current Page",
  "新建收藏": "New Bookmark",
  "正在读取当前页面信息...": "Reading current page details...",
  "取消": "Cancel",
  "标题": "Title",
  "分类目录": "Folder",
  "选择已有目录或新建目录": "Choose an existing folder or create a new one",
  "新建目录": "Create Folder",
  "可选，例如 工作/项目A": "Optional, for example Work/Project A",
  "还没有现有目录，可直接在上方输入新目录。":
    "No existing folders yet. Enter a new folder above to create one.",
  "备注": "Note",
  "可选，记录这条收藏的用途或补充信息":
    "Optional, describe the purpose of this bookmark or add extra context",
  "完成": "Done",
  "收藏列表": "Bookmarks",
  "0 条收藏": "0 bookmarks",
  "管理收藏": "Manage Bookmarks",
  "搜索收藏": "Search Bookmarks",
  "按标题、URL、目录或备注搜索": "Search by title, URL, folder, or note",
  "还没有收藏，先把当前页加入保险库。": "No bookmarks yet. Save the current page to get started.",
  "收藏管理": "Bookmark Manager",
  "集中查找、编辑和删除收藏；设置、导入导出与重置仍保留在设置页。":
    "Search, edit, and delete bookmarks in one place. Settings, import/export, and reset stay on the settings page.",
  "检查中...": "Checking...",
  "会话已锁定": "Session Locked",
  "输入主密码后即可继续查看和维护收藏。":
    "Enter your master password to continue viewing and maintaining bookmarks.",
  "解锁并查看": "Unlock and View",
  "维护收藏列表": "Maintain Bookmarks",
  "检查当前保险库状态中...": "Checking vault status...",
  "加载中...": "Loading...",
  "收藏": "Bookmark",
  "目录": "Folder",
  "保存时间": "Saved At",
  "操作": "Actions",
  "保险库设置": "Vault Settings",
  "管理自动锁定、浏览器导入、备份恢复和数据重置；收藏维护已单独移到管理页。":
    "Manage auto lock, browser import, backup and restore, and data reset. Bookmark maintenance has moved to the manager page.",
  "打开收藏管理": "Open Bookmark Manager",
  "解锁并继续": "Unlock and Continue",
  "快速导入": "Quick Import",
  "从浏览器导入": "Import from Browser",
  "把书签栏、其他书签等原生目录完整带入 SafeMarks，并保留原有目录和分类。":
    "Import native browser folders such as the bookmarks bar and other bookmarks into SafeMarks while preserving the original structure.",
  "保险库状态": "Vault Status",
  "首次初始化可先在 popup 创建主密码；如果已有加密备份，也可以先导入再在当前页解锁。":
    "For first-time setup, create a master password in the popup. If you already have an encrypted backup, import it first and then unlock here.",
  "初始化状态": "Initialization",
  "会话状态": "Session",
  "立即锁定": "Lock Now",
  "在当前页解锁": "Unlock Here",
  "语言": "Language",
  "可跟随浏览器语言；如果浏览器语言不受支持，则默认使用英文。":
    "Follow the browser language, and default to English when the browser language is not supported.",
  "显示语言": "Display Language",
  "跟随浏览器": "Follow Browser",
  "中文": "Chinese",
  "英文": "English",
  "保存语言": "Save Language",
  "超时会清空 `chrome.storage.session` 中的密钥，并要求重新解锁。":
    "Timeout clears the key stored in `chrome.storage.session` and requires unlocking again.",
  "超时时间": "Timeout",
  "保存设置": "Save Settings",
  "备份与恢复": "Backup and Restore",
  "加密备份始终可用；明文导出需要当前会话已经解锁。浏览器导入入口已移到上方。":
    "Encrypted backups are always available. Plain JSON export requires an unlocked session. Browser import is available above.",
  "导出加密 JSON": "Export Encrypted JSON",
  "导出明文 JSON": "Export Plain JSON",
  "导入加密 JSON": "Import Encrypted JSON",
  "重置": "Reset",
  "会删除本地所有密文和当前会话密钥，操作不可撤销。":
    "Delete all local ciphertext data and the current session key. This action cannot be undone.",
  "清空本地数据": "Clear Local Data",
  "输入主密码后才能清空本地数据。": "Enter your master password before clearing local data.",
  "输入密码并清空": "Enter Password and Clear",
  "快捷键": "Shortcuts",
  "SafeMarks 已支持浏览器级快捷键。快速收藏会先弹出专用页面，允许选择已有目录或新增目录；如果当前锁定，提交后会先未加密暂存在本地，等下次解锁后自动写入保险库。":
    "SafeMarks supports browser-level shortcuts. Quick capture opens a dedicated page where you can choose an existing folder or add a new one. If the vault is locked, the capture is stored locally first and imported automatically after the next unlock.",
  "打开快捷键设置": "Open Shortcut Settings",
  "正在读取当前快捷键...": "Loading current shortcuts...",
  "如果浏览器尚未分配快捷键，这里会显示“未分配”。":
    "If the browser has not assigned a shortcut, this section shows “Unassigned”.",
  "快速收藏": "Quick Capture",
  "检查当前会话中...": "Checking current session...",
  "关闭": "Close",
  "正在准备当前页面信息...": "Preparing current page details...",
  "读取中...": "Loading...",
  "已有目录": "Existing Folders",
  "未分类 / 手动输入新目录": "Unfiled / Enter a new folder manually",
  "可新增，例如 工作/项目A": "Optional new folder, for example Work/Project A",
  "正在读取可选目录...": "Loading available folders...",
  "保存": "Save",
  "会话不可用，请重新解锁。": "Session unavailable. Unlock the vault again.",
  "已保存 {count} 条收藏": "{count} bookmarks saved",
  "有 {count} 条快速收藏待写入，解锁后会自动导入保险库。":
    "{count} quick captures are queued and will be imported after unlocking.",
  "点击“保存当前页”后读取当前页面信息。":
    "Page details are loaded after you click “Save Current Page”.",
  "编辑收藏": "Edit Bookmark",
  "保存修改": "Save Changes",
  "可修改标题、URL、分类目录和备注，保存后会覆盖原收藏。":
    "You can edit the title, URL, folder, and note. Saving replaces the original bookmark.",
  "收起详情": "Hide Details",
  "查看详情": "View Details",
  "编辑": "Edit",
  "复制": "Copy",
  "删除": "Delete",
  "{folderPath} · 保存于 {timestamp}": "{folderPath} · Saved {timestamp}",
  "保存于 {timestamp}": "Saved {timestamp}",
  "无备注": "No note",
  "{count} 条收藏": "{count} bookmarks",
  "已解锁 · 约 {minutes} 分钟后自动锁定": "Unlocked · auto-locks in about {minutes} minutes",
  "已导入 {count} 条快速收藏。": "Imported {count} quick captures.",
  "已自动导入 {count} 条快速收藏。": "Imported {count} quick captures automatically.",
  "已因无操作自动锁定，请重新输入主密码。":
    "The vault was auto-locked due to inactivity. Enter your master password again.",
  "{visibleCount} / {totalCount} 条收藏": "{visibleCount} / {totalCount} bookmarks",
  "没有匹配的收藏。": "No matching bookmarks.",
  "可按原生收藏习惯修改标题或 URL 后再保存。":
    "Adjust the title or URL as you would with native bookmarks, then save.",
  "保险库已锁定，请重新解锁。": "Vault locked. Unlock it again.",
  "首次使用需要创建一个主密码。": "Create a master password before first use.",
  "会话已过期，请重新输入主密码。": "Session expired. Enter your master password again.",
  "输入主密码即可解锁。": "Enter your master password to unlock.",
  "主密码不能为空。": "Master password cannot be empty.",
  "两次输入的主密码不一致。": "The two master password entries do not match.",
  "保险库已创建并完成解锁。": "Vault created and unlocked.",
  "尚未初始化，请先创建主密码。": "Not initialized yet. Create a master password first.",
  "已解锁保险库。": "Vault unlocked.",
  "已解锁保险库，并已导入 {count} 条快速收藏。":
    "Vault unlocked and {count} quick captures imported.",
  "解锁失败，请确认主密码。": "Unlock failed. Check your master password.",
  "要编辑的收藏不存在。": "The bookmark to edit does not exist.",
  "收藏已更新。": "Bookmark updated.",
  "当前页已加密保存。": "Current page saved and encrypted.",
  "要删除的收藏不存在。": "The bookmark to delete does not exist.",
  "确认删除“{title}”？": "Delete “{title}”?",
  "收藏已删除。": "Bookmark deleted.",
  "保险库已手动锁定。": "Vault locked manually.",
  "输入主密码后即可继续查看和维护收藏。": "Enter your master password to continue viewing and maintaining bookmarks.",
  "未初始化": "Not Initialized",
  "已解锁 · {minutes} 分钟自动锁定": "Unlocked · auto-locks in {minutes} minutes",
  "会话已解锁": "Session Unlocked",
  "会话已过期": "Session Expired",
  "当前会话已过期，请重新输入主密码。": "Current session expired. Enter your master password again.",
  "保存于 {timestamp}": "Saved {timestamp}",
  "未分类": "Unfiled",
  "当前还没有保险库，先在 popup 创建主密码。": "No vault yet. Create a master password in the popup first.",
  "创建保险库后，这里会显示可维护的收藏列表。":
    "The bookmark list will appear here after the vault is created.",
  "当前会话已过期，请重新解锁后再继续维护收藏。":
    "The current session has expired. Unlock again to continue maintaining bookmarks.",
  "先解锁后，才能查看完整信息并编辑或删除收藏。":
    "Unlock first to view full details and edit or delete bookmarks.",
  "解锁后这里会显示紧凑的收藏维护视图。":
    "A compact bookmark maintenance view appears here after unlocking.",
  "正在按标题、URL、目录和备注筛选收藏。":
    "Filtering bookmarks by title, URL, folder, and note.",
  "紧凑视图已按保存时间倒序展示，可直接在当前页编辑或删除。":
    "The compact view is sorted by saved time in descending order, and you can edit or delete bookmarks directly here.",
  "还没有收藏，先在 popup 保存当前页。": "No bookmarks yet. Save the current page in the popup first.",
  "管理收藏前，先在当前页输入主密码解锁。":
    "Before managing bookmarks, enter your master password on this page to unlock.",
  "当前保险库未初始化。": "The current vault is not initialized.",
  "编辑收藏前，先在当前页输入主密码解锁。":
    "Before editing bookmarks, enter your master password on this page to unlock.",
  "删除收藏前，先在当前页输入主密码解锁。":
    "Before deleting bookmarks, enter your master password on this page to unlock.",
  "已解锁收藏管理页。": "Bookmark manager unlocked.",
  "当前会话已锁定。": "Current session locked.",
  "打开 SafeMarks": "Open SafeMarks",
  "打开扩展 popup，继续解锁、搜索或保存当前页。":
    "Open the extension popup to unlock, search, or save the current page.",
  "快速收藏当前页": "Quick Capture Current Page",
  "打开快速收藏页，选择已有目录或新增目录后再保存。":
    "Open quick capture, choose an existing folder or add a new one, then save.",
  "直接跳到独立管理页，集中编辑和删除收藏。":
    "Jump straight to the dedicated manager page to edit and delete bookmarks in one place.",
  "打开设置页": "Open Settings Page",
  "直接打开 SafeMarks 设置。": "Open SafeMarks settings directly.",
  "未分配": "Unassigned",
  "当前环境不支持读取快捷键": "Shortcut reading is not supported here",
  "请手动打开 chrome://extensions/shortcuts 查看或修改 SafeMarks 的命令绑定。":
    "Open chrome://extensions/shortcuts manually to view or update SafeMarks command bindings.",
  "不可用": "Unavailable",
  "已打开浏览器快捷键设置。修改后回到当前页即可查看最新绑定。":
    "Browser shortcut settings opened. Return to this page after editing to review the latest bindings.",
  "请手动打开 {url} 调整快捷键。": "Open {url} manually to adjust shortcuts.",
  "先创建保险库后，才能从浏览器导入收藏。":
    "Create the vault before importing bookmarks from the browser.",
  "当前会话已解锁，导入时会保留浏览器原有目录和分类。":
    "The current session is unlocked. Import keeps the browser's original folders and categories.",
  "先在上方输入主密码解锁，再从浏览器导入。":
    "Enter your master password above to unlock before importing from the browser.",
  "输入主密码后即可继续在设置页导入、导出或调整保险库设置。":
    "Enter your master password to continue importing, exporting, or adjusting vault settings on the settings page.",
  "已初始化": "Initialized",
  "已锁定": "Locked",
  "已过期": "Expired",
  "当前会话已过期，请在这里重新输入主密码后继续操作。":
    "The current session has expired. Enter your master password here to continue.",
  "当前环境不支持权限申请。": "Permission requests are not supported in this environment.",
  "当前环境不支持读取原生收藏夹。": "Reading native bookmarks is not supported in this environment.",
  "未授予浏览器收藏读取权限，导入已取消。":
    "Browser bookmark access was not granted. Import canceled.",
  "没有可导入的网页收藏，已跳过 {count} 条不支持的项目。":
    "No importable web bookmarks were found. Skipped {count} unsupported items.",
  "浏览器收藏夹中没有可导入的网页收藏。":
    "No importable web bookmarks were found in the browser bookmarks.",
  "已从浏览器导入 {importedCount} 条收藏，跳过 {skippedCount} 条不支持的项目。":
    "Imported {importedCount} bookmarks from the browser and skipped {skippedCount} unsupported items.",
  "自动锁定时间已更新。": "Auto-lock time updated.",
  "当前没有可导出的保险库。": "There is no vault to export.",
  "已导出加密备份。": "Encrypted backup exported.",
  "导出明文前，先在当前页输入主密码解锁。":
    "Before exporting plain JSON, enter your master password on this page to unlock.",
  "明文导出会生成可直接阅读的 JSON，确认继续？":
    "Plain export creates directly readable JSON. Continue?",
  "已导出明文 JSON，请妥善保管。": "Plain JSON exported. Store it securely.",
  "加密备份已导入，可直接在当前页输入原密码解锁。":
    "Encrypted backup imported. Enter the original password on this page to unlock.",
  "导入失败。": "Import failed.",
  "当前保险库未初始化，请先创建主密码后再导入。":
    "The current vault is not initialized. Create a master password before importing.",
  "从浏览器导入前，先在当前页输入主密码解锁。解锁后会自动继续导入。":
    "Before importing from the browser, enter your master password on this page to unlock. Import resumes automatically after unlocking.",
  "从浏览器导入需要先解锁当前保险库。":
    "Unlock the current vault before importing from the browser.",
  "从浏览器导入失败。": "Browser import failed.",
  "当前保险库未初始化，请先创建主密码。":
    "The current vault is not initialized. Create a master password first.",
  "已在设置页解锁保险库。": "Vault unlocked on the settings page.",
  "确认删除本地所有 SafeMarks 数据？": "Delete all local SafeMarks data?",
  "此操作不可撤销，确定继续？": "This action cannot be undone. Continue?",
  "本地数据已清空。": "Local data cleared.",
  "当前已解锁": "Currently Unlocked",
  "保存后会直接写入保险库，并刷新可选目录。":
    "After saving, the bookmark is written directly to the vault and the folder list is refreshed.",
  "当前会话已过期": "Current Session Expired",
  "保存后会先未加密暂存在本地，等下次解锁后自动导入保险库。":
    "After saving, the bookmark is stored locally without encryption first and imported into the vault after the next unlock.",
  "当前已锁定": "Currently Locked",
  "默认": "Default",
  "默认（解锁后显示更多）": "Default (unlock to show more)",
  "当前未解锁，已有目录暂不可选；可直接输入新目录，或先解锁后选择更多已有目录。":
    "The vault is locked, so existing folders are unavailable for now. Enter a new folder directly, or unlock first to choose from more existing folders.",
  "可先选择已有目录，也可以直接在下方输入新目录。":
    "Choose an existing folder first, or enter a new folder below.",
  "当前没有可选目录。可直接在“分类目录”中输入一个新目录，保存后会加入目录列表。":
    "No folders are available yet. Enter a new folder in “Folder” and it will be added to the folder list after saving.",
  "当前没有可快速收藏的页面信息，请重新触发快捷键。":
    "No page details are available for quick capture. Trigger the shortcut again.",
  "已自动导入 {count} 条待写入快速收藏。":
    "Imported {count} queued quick captures automatically.",
  "当前保险库未初始化，请先在 popup 创建主密码。":
    "The current vault is not initialized. Create a master password in the popup first.",
  "已直接写入保险库。": "Saved directly to the vault.",
  "已暂存快速收藏，解锁后自动导入。当前待写入 {count} 条。":
    "Quick capture queued and will be imported after unlocking. {count} items are waiting.",
  "请关闭当前窗口后重新触发快捷键。":
    "Close this window and trigger the shortcut again.",
  "目录列表不可用。": "Folder list unavailable.",
  "SafeMarks（有 {count} 条快速收藏待写入，解锁后自动导入）":
    "SafeMarks ({count} quick captures queued; unlock to import)",
  "SafeMarks 尚未初始化，无法快速收藏。":
    "SafeMarks is not initialized yet, so quick capture is unavailable.",
  "当前环境无法读取标签页信息。": "This environment cannot read tab information.",
  "当前页面无法读取 URL。": "The current page URL cannot be read.",
  "仅支持保存普通网页，不支持浏览器内部页面。":
    "Only regular web pages can be saved. Browser internal pages are not supported.",
  "主密码不正确。": "Incorrect master password.",
  "URL 不能为空。": "URL cannot be empty.",
  "仅支持保存 http 或 https 页面。": "Only http and https pages can be saved.",
  "已复制 URL。": "URL copied.",
  "复制失败，请稍后重试。": "Copy failed. Try again later."
});

function getChromeStorage() {
  return globalThis.chrome?.storage?.local ?? null;
}

function getRuntimeErrorMessage() {
  return globalThis.chrome?.runtime?.lastError?.message ?? "";
}

function callStorageMethod(storage, methodName, ...args) {
  return new Promise((resolve, reject) => {
    let settled = false;

    function settle(callback, value) {
      if (settled) {
        return;
      }

      settled = true;
      callback(value);
    }

    try {
      const callback = (result) => {
        const message = getRuntimeErrorMessage();
        if (message) {
          settle(reject, new Error(message));
          return;
        }

        settle(resolve, result);
      };

      const returned = storage[methodName](...args, callback);
      if (returned && typeof returned.then === "function") {
        returned.then(
          callback,
          (error) => {
            settle(reject, error);
          }
        );
      }
    } catch (error) {
      settle(reject, error);
    }
  });
}

function storageGet(storage, key) {
  return callStorageMethod(storage, "get", key).then((result) => result ?? {});
}

function storageSet(storage, value) {
  return callStorageMethod(storage, "set", value).then(() => {});
}

function getBrowserLocale() {
  const browserLocale = globalThis.chrome?.i18n?.getUILanguage?.();
  const pageLocale =
    typeof window !== "undefined" ? window.navigator?.language : "";
  return browserLocale || pageLocale || "";
}

export function normalizeLanguagePreference(value) {
  return SUPPORTED_LOCALES.has(value) || value === LANGUAGE_PREFERENCES.AUTO
    ? value
    : LANGUAGE_PREFERENCES.AUTO;
}

export function resolveSupportedLocale(locale = "") {
  if (/^zh\b/i.test(locale)) {
    return LANGUAGE_PREFERENCES.CHINESE;
  }

  return LANGUAGE_PREFERENCES.ENGLISH;
}

export function resolveLocaleFromPreference(preference, browserLocale = getBrowserLocale()) {
  const normalizedPreference = normalizeLanguagePreference(preference);
  return normalizedPreference === LANGUAGE_PREFERENCES.AUTO
    ? resolveSupportedLocale(browserLocale)
    : normalizedPreference;
}

async function readStoredLanguagePreference() {
  const storage = getChromeStorage();
  if (!storage?.get) {
    return LANGUAGE_PREFERENCES.AUTO;
  }

  try {
    const stored = await storageGet(storage, LANGUAGE_PREFERENCE_STORAGE_KEY);
    return normalizeLanguagePreference(stored[LANGUAGE_PREFERENCE_STORAGE_KEY]);
  } catch {
    return LANGUAGE_PREFERENCES.AUTO;
  }
}

function applyLanguagePreference(preference) {
  activeLanguagePreference = normalizeLanguagePreference(preference);
  activeLocale = resolveLocaleFromPreference(activeLanguagePreference);
}

function registerStorageListener() {
  if (storageListenerRegistered || !globalThis.chrome?.storage?.onChanged?.addListener) {
    return;
  }

  globalThis.chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !Object.hasOwn(changes, LANGUAGE_PREFERENCE_STORAGE_KEY)) {
      return;
    }

    applyLanguagePreference(changes[LANGUAGE_PREFERENCE_STORAGE_KEY].newValue);
  });
  storageListenerRegistered = true;
}

export async function initializeI18n({ force = false } = {}) {
  registerStorageListener();

  if (!force && initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    applyLanguagePreference(await readStoredLanguagePreference());
    return activeLocale;
  })();

  return initializationPromise;
}

export async function setLanguagePreference(preference) {
  const normalizedPreference = normalizeLanguagePreference(preference);
  const storage = getChromeStorage();

  if (storage?.set) {
    await storageSet(storage, {
      [LANGUAGE_PREFERENCE_STORAGE_KEY]: normalizedPreference
    });
  }

  applyLanguagePreference(normalizedPreference);
  return activeLocale;
}

export function getLanguagePreference() {
  return activeLanguagePreference;
}

export function getLocaleTag() {
  return activeLocale;
}

function interpolate(message, substitutions = {}) {
  return message.replace(/\{(\w+)\}/g, (_match, key) => {
    return Object.hasOwn(substitutions, key)
      ? String(substitutions[key])
      : `{${key}}`;
  });
}

export function t(message, substitutions) {
  const template = activeLocale === LANGUAGE_PREFERENCES.ENGLISH
    ? EN_TRANSLATIONS[message] ?? message
    : message;
  return interpolate(template, substitutions);
}

export function formatDateTime(value, options) {
  return new Intl.DateTimeFormat(getLocaleTag(), options).format(value);
}

function localizeTextNode(node) {
  const original = node.textContent ?? "";
  const trimmed = original.trim();
  if (!trimmed) {
    return;
  }

  const localized = t(trimmed);
  if (localized === trimmed) {
    return;
  }

  const start = original.indexOf(trimmed);
  node.textContent =
    `${original.slice(0, start)}${localized}${original.slice(start + trimmed.length)}`;
}

export function localizeDocument(root = document) {
  root.documentElement?.setAttribute("lang", getLocaleTag());
  if (typeof root.title === "string" && root.title) {
    root.title = t(root.title);
  }

  const attributeSelector = "[placeholder], [aria-label], [title]";
  root.querySelectorAll?.(attributeSelector).forEach((element) => {
    for (const attributeName of ["placeholder", "aria-label", "title"]) {
      const value = element.getAttribute(attributeName);
      if (value) {
        element.setAttribute(attributeName, t(value));
      }
    }
  });

  const body = root.body ?? root;
  const walker = root.createTreeWalker?.(
    body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.parentElement) {
          return NodeFilter.FILTER_REJECT;
        }

        const tagName = node.parentElement.tagName;
        if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  while (walker) {
    const currentNode = walker.nextNode();
    if (!currentNode) {
      break;
    }
    localizeTextNode(currentNode);
  }
}
