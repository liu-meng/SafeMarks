import { getBookmarkSearchResults } from "../core/bookmark-search.js";
import {
  removeFolderTreeFromBookmarks,
  renameFolderTreeInBookmarks,
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
import {
  addTagsToBookmarks,
  deleteBookmarksByIds,
  moveBookmarksToFolder,
  removeTagsFromBookmarks
} from "../core/batch.js";
import { findInternalDuplicates } from "../core/dedup.js";
import { formatDateTime, initializeI18n, localizeDocument, t } from "../shared/i18n.js";
import { createTagChipsInput, createTagList } from "../shared/tag-chips.js";
import { confirmDialog, showMessage } from "../shared/ui.js";

try {
  await initializeI18n();
} finally {
  localizeDocument();
}

const elements = {
  hero: document.querySelector("#manager-hero"),
  openSettings: document.querySelector("#open-settings"),
  lockSession: document.querySelector("#lock-session"),
  allBookmarksNav: document.querySelector("#all-bookmarks-nav"),
  searchNav: document.querySelector("#search-nav"),
  sidebarSettings: document.querySelector("#sidebar-settings"),
  sidebarBookmarkCount: document.querySelector("#sidebar-bookmark-count"),
  folderTree: document.querySelector("#folder-tree"),
  folderTreeEmpty: document.querySelector("#folder-tree-empty"),
  sessionStatus: document.querySelector("#session-status"),
  unlockPanel: document.querySelector("#unlock-panel"),
  unlockPanelBadge: document.querySelector("#unlock-panel-badge"),
  unlockPanelCopy: document.querySelector("#unlock-panel-copy"),
  unlockForm: document.querySelector("#unlock-form"),
  unlockPassword: document.querySelector("#unlock-password"),
  message: document.querySelector("#manager-message"),
  bookmarkCount: document.querySelector("#bookmark-count"),
  findDuplicates: document.querySelector("#find-duplicates"),
  managerListTitle: document.querySelector("#manager-list-title"),
  managerStatus: document.querySelector("#manager-status"),
  searchInput: document.querySelector("#search-input"),
  batchToolbar: document.querySelector("#batch-toolbar"),
  batchSelectionCount: document.querySelector("#batch-selection-count"),
  selectVisible: document.querySelector("#select-visible"),
  clearSelection: document.querySelector("#clear-selection"),
  batchFolderPath: document.querySelector("#batch-folder-path"),
  batchMove: document.querySelector("#batch-move"),
  batchAddTagsField: document.querySelector("#batch-add-tags-field"),
  batchAddTags: document.querySelector("#batch-add-tags"),
  batchRemoveTagsField: document.querySelector("#batch-remove-tags-field"),
  batchRemoveTags: document.querySelector("#batch-remove-tags"),
  batchDelete: document.querySelector("#batch-delete"),
  emptyState: document.querySelector("#empty-state"),
  bookmarkList: document.querySelector("#bookmark-list")
};

const batchAddTagEditor = createTagChipsInput({
  label: t("添加标签"),
  placeholder: t("输入要添加的标签")
});
const batchRemoveTagEditor = createTagChipsInput({
  label: t("移除标签"),
  placeholder: t("输入要移除的标签")
});
elements.batchAddTagsField.append(batchAddTagEditor.element);
elements.batchRemoveTagsField.append(batchRemoveTagEditor.element);

const state = {
  hasVault: false,
  sessionState: "locked",
  record: null,
  encodedKey: "",
  bookmarks: [],
  query: "",
  activeFolderPath: null,
  editingBookmarkId: null,
  selectedBookmarkIds: new Set(),
  visibleBookmarkIds: [],
  collapsedFolders: new Set(),
  knownFolderPaths: new Set(),
  openFolderMenuPath: null
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
  showMessage(elements.message, text, tone);
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

function getBookmarkDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function getFaviconUrl(url) {
  if (!globalThis.chrome?.runtime?.getURL) {
    return "";
  }

  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
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

function folderContainsBookmark(folderPath, bookmark) {
  if (folderPath === null) {
    return true;
  }

  if (folderPath === "") {
    return !bookmark.folderPath;
  }

  return bookmark.folderPath === folderPath || bookmark.folderPath.startsWith(`${folderPath}/`);
}

function getFolderLabel(folderPath) {
  if (folderPath === null) {
    return t("全部收藏");
  }

  return folderPath || t("未分类");
}

function getFolderNodeByPath(node, folderPath) {
  if (folderPath === null) {
    return node;
  }

  if (folderPath === "") {
    return node.bookmarks.length > 0 ? node : null;
  }

  const segments = folderPath.split("/");
  let current = node;

  for (const segment of segments) {
    current = current.children.get(segment);
    if (!current) {
      return null;
    }
  }

  return current;
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

function shouldCollapseFolderByDefault(folderPath) {
  const segments = folderPath.split("/");
  return segments.length > 1;
}

function syncCollapsedFolderState(tree) {
  const currentFolderPaths = collectFolderPaths(tree);
  const nextCollapsedFolders = new Set(
    [...state.collapsedFolders].filter((folderPath) => currentFolderPaths.has(folderPath))
  );

  for (const folderPath of currentFolderPaths) {
    if (!state.knownFolderPaths.has(folderPath) && shouldCollapseFolderByDefault(folderPath)) {
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
  state.selectedBookmarkIds = new Set();
  state.visibleBookmarkIds = [];
  state.activeFolderPath = null;
  state.collapsedFolders = new Set();
  state.knownFolderPaths = new Set();
  state.openFolderMenuPath = null;

  if (clearQuery) {
    state.query = "";
    elements.searchInput.value = "";
  }
}

function pruneSelection() {
  const bookmarkIds = new Set(state.bookmarks.map((bookmark) => bookmark.id));
  state.selectedBookmarkIds = new Set(
    [...state.selectedBookmarkIds].filter((bookmarkId) => bookmarkIds.has(bookmarkId))
  );
}

function getSelectedIds() {
  return [...state.selectedBookmarkIds];
}

function setBookmarkSelected(bookmarkId, selected) {
  if (selected) {
    state.selectedBookmarkIds.add(bookmarkId);
  } else {
    state.selectedBookmarkIds.delete(bookmarkId);
  }
  renderView();
}

function renderBatchToolbar(unlocked, visibleBookmarks) {
  pruneSelection();
  state.visibleBookmarkIds = visibleBookmarks.map((bookmark) => bookmark.id);

  const selectedCount = state.selectedBookmarkIds.size;
  elements.batchToolbar.hidden = !unlocked || selectedCount === 0;
  elements.batchSelectionCount.textContent = t("已选择 {count} 条", { count: selectedCount });
  elements.selectVisible.disabled = !unlocked || visibleBookmarks.length === 0;
  elements.clearSelection.disabled = selectedCount === 0;
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

const ACTION_ICON_SVG = Object.freeze({
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4.8L19.3 9.5a2.1 2.1 0 0 0 0-3L17.5 4.7a2.1 2.1 0 0 0-3 0L4 15.2V20Zm2-2v-1.9l9.9-9.9 1.9 1.9L7.9 18H6Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8V5.8C8 4.8 8.8 4 9.8 4h8.4c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H16v2.2c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8V9.8C4 8.8 4.8 8 5.8 8H8Zm2 0h4.2c1 0 1.8.8 1.8 1.8V14h2V6h-8v2Zm-4 2v8h8v-8H6Z"/></svg>',
  delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v1h4v2H4V5h4Zm2 0h4V4h-4v1Zm-3 4h2v10h6V9h2v10c0 1.1-.9 2-2 2H9c-1.1 0-2-.9-2-2V9Zm4 0h2v8h-2V9Z"/></svg>'
});

function createActionButton(text, className, handler, iconName = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = iconName ? `${className} manager-icon-button` : className;
  button.setAttribute("aria-label", text);
  button.title = text;
  if (iconName && ACTION_ICON_SVG[iconName]) {
    button.innerHTML = ACTION_ICON_SVG[iconName];
  } else {
    button.textContent = text;
  }
  button.addEventListener("click", () => {
    handler().catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    });
  });
  return button;
}

function setNavButtonActive(button, active) {
  button.classList.toggle("is-active", active);
  if (active) {
    button.setAttribute("aria-current", "page");
  } else {
    button.removeAttribute("aria-current");
  }
}

function createSidebarFolderButton({
  label,
  count,
  folderPath,
  depth = 0,
  hasChildren = false,
  expanded = true,
  queryActive = false,
  deletable = false
}) {
  const row = document.createElement("div");
  row.className = "manager-folder-tree-row";
  row.style.setProperty("--folder-depth", String(depth));

  if (hasChildren) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "manager-folder-toggle-button";
    toggle.textContent = expanded ? "-" : "+";
    toggle.setAttribute("aria-label", expanded ? t("折叠文件夹") : t("展开文件夹"));
    toggle.addEventListener("click", () => {
      handleToggleFolder(folderPath).catch((error) => {
        setMessage(error instanceof Error ? error.message : String(error), "error");
      });
    });
    row.append(toggle);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "manager-folder-toggle-spacer";
    row.append(spacer);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "manager-folder-tree-button";
  button.classList.toggle("is-active", state.activeFolderPath === folderPath);
  button.setAttribute("aria-pressed", String(state.activeFolderPath === folderPath));
  button.addEventListener("click", () => {
    handleSelectFolder(folderPath, { toggle: hasChildren }).catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    });
  });

  const title = document.createElement("span");
  title.className = "manager-folder-tree-title";
  title.textContent = label;
  title.title = label;

  const meta = document.createElement("span");
  meta.className = "manager-folder-tree-count";
  meta.textContent = String(count);

  button.append(title, meta);
  row.append(button);

  if (deletable) {
    const menuWrap = document.createElement("span");
    menuWrap.className = "manager-folder-menu-wrap";

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "manager-folder-menu-button";
    menuButton.textContent = "⋯";
    menuButton.setAttribute("aria-label", t("文件夹操作"));
    menuButton.setAttribute("aria-expanded", String(state.openFolderMenuPath === folderPath));
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      state.openFolderMenuPath = state.openFolderMenuPath === folderPath ? null : folderPath;
      renderView();
    });
    menuWrap.append(menuButton);

    if (state.openFolderMenuPath === folderPath) {
      const menu = document.createElement("div");
      menu.className = "manager-folder-menu";
      menu.setAttribute("role", "menu");

      const renameButton = document.createElement("button");
      renameButton.type = "button";
      renameButton.className = "manager-folder-menu-item";
      renameButton.textContent = t("重命名");
      renameButton.setAttribute("role", "menuitem");
      renameButton.addEventListener("click", (event) => {
        event.stopPropagation();
        state.openFolderMenuPath = null;
        handleRenameFolder(folderPath).catch((error) => {
          setMessage(error instanceof Error ? error.message : String(error), "error");
        });
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "manager-folder-menu-item manager-folder-menu-danger";
      deleteButton.textContent = t("删除");
      deleteButton.setAttribute("role", "menuitem");
      deleteButton.disabled = queryActive;
      if (queryActive) {
        deleteButton.title = t("请先清空搜索，再删除文件夹");
      }
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        state.openFolderMenuPath = null;
        handleDeleteFolder(folderPath).catch((error) => {
          setMessage(error instanceof Error ? error.message : String(error), "error");
        });
      });

      menu.append(renameButton, deleteButton);
      menuWrap.append(menu);
    }

    if (queryActive) {
      menuButton.title = t("搜索时仍可重命名，删除前请先清空搜索");
    }
    row.append(menuWrap);
  }

  return row;
}

function createSidebarFolderNode(node, depth, queryActive) {
  const item = document.createElement("li");
  item.className = "manager-folder-tree-item";

  const expanded = queryActive || !state.collapsedFolders.has(node.path);
  const hasChildren = node.children.size > 0;

  item.append(createSidebarFolderButton({
    label: node.name,
    count: countTreeBookmarks(node),
    folderPath: node.path,
    depth,
    hasChildren,
    expanded,
    queryActive,
    deletable: true
  }));

  if (hasChildren) {
    const nestedList = document.createElement("ul");
    nestedList.className = "manager-folder-tree manager-folder-tree-nested";
    nestedList.hidden = !expanded;

    for (const child of sortFolderNodes(node.children.values())) {
      nestedList.append(createSidebarFolderNode(child, depth + 1, queryActive));
    }

    item.append(nestedList);
  }

  return item;
}

function renderSidebar(unlocked) {
  elements.sidebarBookmarkCount.textContent = String(state.bookmarks.length);
  elements.folderTree.replaceChildren();
  elements.folderTreeEmpty.hidden = true;
  setNavButtonActive(elements.allBookmarksNav, state.activeFolderPath === null);

  if (!unlocked) {
    elements.folderTreeEmpty.textContent = state.hasVault
      ? t("解锁后显示目录树")
      : t("创建保险库后显示目录树");
    elements.folderTreeEmpty.hidden = false;
    return null;
  }

  const tree = buildBookmarkTree(state.bookmarks);
  syncCollapsedFolderState(tree);

  if (!getFolderNodeByPath(tree, state.activeFolderPath)) {
    state.activeFolderPath = null;
    setNavButtonActive(elements.allBookmarksNav, true);
  }

  const queryActive = Boolean(state.query.trim());
  if (tree.bookmarks.length > 0) {
    const unfiledItem = document.createElement("li");
    unfiledItem.className = "manager-folder-tree-item";
    unfiledItem.append(createSidebarFolderButton({
      label: t("未分类"),
      count: tree.bookmarks.length,
      folderPath: "",
      depth: 0
    }));
    elements.folderTree.append(unfiledItem);
  }

  for (const child of sortFolderNodes(tree.children.values())) {
    elements.folderTree.append(createSidebarFolderNode(child, 0, queryActive));
  }

  if (state.bookmarks.length === 0) {
    elements.folderTreeEmpty.textContent = t("还没有文件夹");
    elements.folderTreeEmpty.hidden = false;
  }

  return tree;
}

function createManagerRow(bookmark) {
  const item = document.createElement("li");
  item.className = "bookmark-item";

  if (state.editingBookmarkId === bookmark.id) {
    item.classList.add("manager-edit-item");
    const tagEditor = createTagChipsInput({
      initialTags: bookmark.tags
    });

    const form = document.createElement("form");
    form.className = "stack manager-edit-form";
    form.addEventListener("submit", (event) => {
      handleEditSubmit(event, bookmark.id, tagEditor.getTags()).catch((error) => {
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
    tagEditor.element.classList.add("manager-edit-tags");
    editGrid.append(titleLabel, urlLabel, folderLabel, noteLabel, tagEditor.element);

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

  const selectCell = document.createElement("label");
  selectCell.className = "manager-row-select";
  selectCell.dataset.label = t("选择");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selectedBookmarkIds.has(bookmark.id);
  checkbox.setAttribute("aria-label", t("选择“{title}”", { title: bookmark.title }));
  checkbox.addEventListener("change", () => {
    setBookmarkSelected(bookmark.id, checkbox.checked);
  });
  selectCell.append(checkbox);

  const favicon = document.createElement("span");
  favicon.className = "manager-row-favicon";
  const faviconUrl = getFaviconUrl(bookmark.url);
  if (faviconUrl) {
    const faviconImage = document.createElement("img");
    faviconImage.alt = "";
    faviconImage.src = faviconUrl;
    faviconImage.width = 16;
    faviconImage.height = 16;
    favicon.append(faviconImage);
  } else {
    favicon.textContent = (getBookmarkDomain(bookmark.url) || bookmark.title || "S").charAt(0).toUpperCase();
  }

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
  urlLine.textContent = getBookmarkDomain(bookmark.url);
  urlLine.title = bookmark.url;

  main.append(titleLink, urlLine);
  if (bookmark.tags?.length > 0) {
    main.append(createTagList(bookmark.tags));
  }

  const note = document.createElement("div");
  note.className = "manager-row-cell manager-row-note-cell";
  note.dataset.label = t("备注");
  const noteText = document.createElement("p");
  noteText.className = "manager-row-text manager-row-note-text";
  noteText.textContent = bookmark.note || t("无备注");
  noteText.title = noteText.textContent;
  note.append(noteText);

  const time = document.createElement("div");
  time.className = "manager-row-cell manager-row-time-cell";
  time.dataset.label = t("保存时间");
  const timeText = document.createElement("p");
  timeText.className = "manager-row-time";
  timeText.textContent = formatTimestamp(bookmark.createdAt);
  time.append(timeText);

  const actions = document.createElement("div");
  actions.className = "manager-row-cell manager-row-actions";
  actions.dataset.label = t("操作");
  actions.append(
    createActionButton(t("编辑"), "manager-action-button", () => handleStartEdit(bookmark.id), "edit"),
    createActionButton(t("复制"), "manager-action-button", async () => {
      await copyTextToClipboard(bookmark.url);
      setMessage(t("已复制 URL。"), "success");
    }, "copy"),
    createActionButton(t("删除"), "manager-delete-button", () => handleDeleteBookmark(bookmark.id), "delete")
  );

  item.append(selectCell, favicon, main, note, time, actions);
  return item;
}

function renderView() {
  const unlocked = state.hasVault && state.sessionState === "unlocked";
  const searchResults = unlocked
    ? getBookmarkSearchResults(state.bookmarks, state.query)
    : [];
  renderSidebar(unlocked);
  const filteredBookmarks = searchResults.filter((bookmark) =>
    folderContainsBookmark(state.activeFolderPath, bookmark)
  );
  const activeFolderLabel = getFolderLabel(state.activeFolderPath);

  elements.searchInput.disabled = !unlocked;
  elements.findDuplicates.hidden = !unlocked;
  elements.searchInput.value = state.query;
  elements.bookmarkList.replaceChildren();
  elements.emptyState.hidden = true;
  elements.managerListTitle.textContent = activeFolderLabel;
  renderBatchToolbar(unlocked, filteredBookmarks);

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
    elements.emptyState.textContent = t("解锁后这里会显示目录和收藏列表。");
    elements.emptyState.hidden = false;
    return;
  }

  const filtering = state.query.trim() || state.activeFolderPath !== null;
  elements.bookmarkCount.textContent = filtering
    ? t("{visibleCount} / {totalCount} 条收藏", {
        visibleCount: filteredBookmarks.length,
        totalCount: state.bookmarks.length
      })
    : t("{count} 条收藏", { count: state.bookmarks.length });
  elements.managerStatus.textContent = state.query.trim()
    ? t("正在按标题、URL、目录、备注和标签模糊搜索收藏。")
    : state.activeFolderPath !== null
      ? t("正在查看“{folder}”及其子目录中的收藏。", { folder: activeFolderLabel })
      : t("左侧选择目录，右侧按保存时间倒序展示收藏，可直接编辑或删除。");

  if (filteredBookmarks.length === 0) {
    if (!state.query.trim()) {
      if (state.bookmarks.length === 0) {
        state.collapsedFolders = new Set();
        state.knownFolderPaths = new Set();
      }
    }
    elements.emptyState.textContent =
      state.bookmarks.length === 0
        ? t("还没有收藏，先在 popup 保存当前页。")
        : t("没有匹配的收藏。");
    elements.emptyState.hidden = false;
    return;
  }

  for (const bookmark of filteredBookmarks) {
    elements.bookmarkList.append(createManagerRow(bookmark));
  }
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
  pruneSelection();
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

async function handleEditSubmit(event, bookmarkId, tags) {
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
    note: formData.get("note"),
    tags
  });
  const nextBookmarks = state.bookmarks.map((bookmark) =>
    bookmark.id === bookmarkId
      ? {
          ...bookmark,
          title: draftBookmark.title,
          url: draftBookmark.url,
          folderPath: draftBookmark.folderPath,
          note: draftBookmark.note,
          tags: draftBookmark.tags
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
  const confirmed = await confirmDialog({
    title: t("确认删除收藏？"),
    body: t("将删除“{title}”。此操作不可撤销。", { title: bookmark.title }),
    confirmLabel: t("删除"),
    tone: "danger"
  });
  if (!confirmed) {
    setMessage(t("已取消删除。"), "info");
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

  const confirmed = await confirmDialog({
    title: t("确认删除文件夹？"),
    body: t("将删除文件夹“{folderPath}”及其子目录中的 {count} 条收藏。此操作不可撤销。", {
      folderPath,
      count: removedCount
    }),
    confirmLabel: t("删除文件夹"),
    tone: "danger"
  });
  if (!confirmed) {
    setMessage(t("已取消删除文件夹。"), "info");
    return;
  }

  await persistBookmarks(nextBookmarks, t("文件夹已删除。"));
}

async function handleRenameFolder(folderPath) {
  await requireUnlockedSession(t("重命名文件夹前，先在当前页输入主密码解锁。"));

  const nextPath = window.prompt(t("输入新的文件夹路径"), folderPath);
  if (nextPath === null) {
    setMessage(t("已取消重命名文件夹。"), "info");
    renderView();
    return;
  }

  if (!nextPath.trim()) {
    throw new Error(t("文件夹名称不能为空。"));
  }

  const { nextBookmarks, renamedCount, conflict, targetPath } = renameFolderTreeInBookmarks(
    state.bookmarks,
    folderPath,
    nextPath
  );

  if (conflict) {
    throw new Error(t("目标文件夹已存在，请换一个名称。"));
  }

  if (renamedCount === 0) {
    setMessage(t("文件夹名称没有变化。"), "info");
    renderView();
    return;
  }

  state.activeFolderPath = targetPath;
  await persistBookmarks(nextBookmarks, t("文件夹已重命名。"));
}

async function handleSelectFolder(folderPath, options = {}) {
  if (folderPath !== null) {
    await requireUnlockedSession(t("查看文件夹前，先在当前页输入主密码解锁。"));
  }

  state.activeFolderPath = folderPath;
  state.editingBookmarkId = null;
  state.openFolderMenuPath = null;

  if (options.toggle && folderPath !== null) {
    if (state.collapsedFolders.has(folderPath)) {
      state.collapsedFolders.delete(folderPath);
    } else {
      state.collapsedFolders.add(folderPath);
    }
  }

  renderView();
}

function handleSearchNav() {
  state.activeFolderPath = null;
  state.openFolderMenuPath = null;
  renderView();
  elements.searchInput.focus();
  elements.searchInput.select();
}

function handleSelectVisible() {
  for (const bookmarkId of state.visibleBookmarkIds) {
    state.selectedBookmarkIds.add(bookmarkId);
  }
  renderView();
}

function handleClearSelection() {
  state.selectedBookmarkIds = new Set();
  renderView();
}

async function handleBatchMove() {
  const selectedIds = getSelectedIds();
  if (selectedIds.length === 0) {
    return;
  }

  const nextBookmarks = moveBookmarksToFolder(
    state.bookmarks,
    selectedIds,
    elements.batchFolderPath.value
  );
  await persistBookmarks(nextBookmarks, t("已移动 {count} 条收藏。", { count: selectedIds.length }));
  elements.batchFolderPath.value = "";
}

async function handleBatchAddTags() {
  const selectedIds = getSelectedIds();
  const tags = batchAddTagEditor.getTags();
  if (selectedIds.length === 0 || tags.length === 0) {
    throw new Error(t("请先选择收藏并输入要添加的标签。"));
  }

  const nextBookmarks = addTagsToBookmarks(state.bookmarks, selectedIds, tags);
  await persistBookmarks(nextBookmarks, t("已为 {count} 条收藏添加标签。", { count: selectedIds.length }));
  batchAddTagEditor.clear();
}

async function handleBatchRemoveTags() {
  const selectedIds = getSelectedIds();
  const tags = batchRemoveTagEditor.getTags();
  if (selectedIds.length === 0 || tags.length === 0) {
    throw new Error(t("请先选择收藏并输入要移除的标签。"));
  }

  const nextBookmarks = removeTagsFromBookmarks(state.bookmarks, selectedIds, tags);
  await persistBookmarks(nextBookmarks, t("已从 {count} 条收藏移除标签。", { count: selectedIds.length }));
  batchRemoveTagEditor.clear();
}

async function handleBatchDelete() {
  const selectedIds = getSelectedIds();
  if (selectedIds.length === 0) {
    return;
  }

  const confirmed = await confirmDialog({
    title: t("确认批量删除？"),
    body: t("将删除选中的 {count} 条收藏。此操作不可撤销。", {
      count: selectedIds.length
    }),
    confirmLabel: t("删除选中收藏"),
    tone: "danger"
  });
  if (!confirmed) {
    setMessage(t("已取消批量删除。"), "info");
    return;
  }

  const nextBookmarks = deleteBookmarksByIds(state.bookmarks, selectedIds);
  state.selectedBookmarkIds = new Set();
  await persistBookmarks(nextBookmarks, t("已删除 {count} 条收藏。", { count: selectedIds.length }));
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

async function handleFindDuplicates() {
  const groups = findInternalDuplicates(state.bookmarks);
  if (groups.length === 0) {
    setMessage(t("没有发现重复收藏。"), "info");
    return;
  }

  const backdrop = document.createElement("div");
  backdrop.className = "dedup-dialog-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "dedup-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.style.maxWidth = "520px";
  dialog.style.maxHeight = "80vh";
  dialog.style.overflowY = "auto";

  const title = document.createElement("p");
  title.className = "dedup-dialog-title";
  title.textContent = t("发现 {count} 组重复收藏", { count: groups.length });
  dialog.appendChild(title);

  const panel = document.createElement("div");
  panel.className = "dedup-panel";

  for (const group of groups) {
    const groupEl = document.createElement("div");
    groupEl.className = "dedup-group";

    for (const bm of group) {
      const item = document.createElement("div");
      item.className = "dedup-item";

      const titleSpan = document.createElement("span");
      titleSpan.className = "dedup-item-title";
      titleSpan.textContent = bm.title;
      titleSpan.title = bm.url;

      const keepBtn = document.createElement("button");
      keepBtn.type = "button";
      keepBtn.className = "button-secondary";
      keepBtn.style.fontSize = "12px";
      keepBtn.style.padding = "2px 8px";
      keepBtn.textContent = t("保留");
      keepBtn.addEventListener("click", async () => {
        const toDelete = group.filter((b) => b.id !== bm.id);
        const next = state.bookmarks.filter((b) => !toDelete.some((d) => d.id === b.id));
        backdrop.remove();
        await persistBookmarks(next, t("已删除 {count} 条重复收藏。", { count: toDelete.length }));
      });

      item.appendChild(titleSpan);
      item.appendChild(keepBtn);
      groupEl.appendChild(item);
    }

    panel.appendChild(groupEl);
  }

  dialog.appendChild(panel);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "button-secondary";
  closeBtn.textContent = t("关闭");
  closeBtn.addEventListener("click", () => backdrop.remove());
  dialog.appendChild(closeBtn);

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
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
elements.sidebarSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
elements.allBookmarksNav.addEventListener("click", () => {
  handleSelectFolder(null).catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});
elements.searchNav.addEventListener("click", handleSearchNav);
elements.lockSession.addEventListener("click", async () => {
  await sessionLock();
  clearUnlockedState();
  await refreshView();
  setMessage(t("当前会话已锁定。"), "success");
});
elements.unlockForm.addEventListener("submit", handleUnlockSubmit);
elements.searchInput.addEventListener("input", handleSearchInput);
document.addEventListener("click", (event) => {
  if (!state.openFolderMenuPath) {
    return;
  }

  if (event.target instanceof Element && event.target.closest(".manager-folder-menu-wrap")) {
    return;
  }

  state.openFolderMenuPath = null;
  renderView();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !state.openFolderMenuPath) {
    return;
  }

  state.openFolderMenuPath = null;
  renderView();
});
elements.findDuplicates.addEventListener("click", handleFindDuplicates);
elements.selectVisible.addEventListener("click", handleSelectVisible);
elements.clearSelection.addEventListener("click", handleClearSelection);
elements.batchMove.addEventListener("click", () => {
  handleBatchMove().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});
elements.batchAddTags.addEventListener("click", () => {
  handleBatchAddTags().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});
elements.batchRemoveTags.addEventListener("click", () => {
  handleBatchRemoveTags().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});
elements.batchDelete.addEventListener("click", () => {
  handleBatchDelete().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});
window.addEventListener("focus", () => {
  refreshView().catch((error) => {
    setMessage(error instanceof Error ? error.message : String(error), "error");
  });
});

refreshView().catch((error) => {
  setMessage(error instanceof Error ? error.message : String(error), "error");
});
