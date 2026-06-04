import { normalizeFolderPath } from "../core/validation.js";
import { getLocaleTag, t } from "./i18n.js";

function createFolderButton(folderPath, selectedPath, onSelect, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `folder-picker-option${extraClass ? ` ${extraClass}` : ""}`;
  button.title = folderPath;
  button.textContent = folderPath;
  if (folderPath === selectedPath) {
    button.classList.add("is-selected");
  }
  button.addEventListener("click", () => onSelect(folderPath));
  return button;
}

function filterPaths(paths, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return paths;
  }

  return paths.filter((path) => path.toLowerCase().includes(normalizedQuery));
}

function uniquePaths(paths) {
  const seen = new Set();
  const unique = [];

  for (const path of paths) {
    const normalized = normalizeFolderPath(path);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}

function uniqueSortedPaths(paths) {
  return uniquePaths(paths).sort((left, right) => left.localeCompare(right, getLocaleTag()));
}

export function createFolderPicker({
  label = t("分类目录"),
  emptyText = t("还没有现有目录，可直接输入新目录。")
} = {}) {
  let catalog = [];
  let recent = [];
  let disabled = false;

  const wrapper = document.createElement("div");
  wrapper.className = "label folder-picker";

  const labelElement = document.createElement("span");
  labelElement.textContent = label;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "folder-picker-trigger";
  trigger.setAttribute("aria-expanded", "false");

  const triggerTop = document.createElement("span");
  triggerTop.className = "folder-picker-trigger-top";

  const triggerLabel = document.createElement("span");
  triggerLabel.className = "folder-picker-trigger-label";
  triggerLabel.textContent = t("未分类");

  const triggerCaret = document.createElement("span");
  triggerCaret.className = "folder-picker-trigger-caret";
  triggerCaret.setAttribute("aria-hidden", "true");
  triggerCaret.textContent = "v";

  const triggerCopy = document.createElement("span");
  triggerCopy.className = "folder-picker-trigger-copy";
  triggerCopy.textContent = t("搜索已有目录或输入新目录");

  triggerTop.append(triggerLabel, triggerCaret);
  trigger.append(triggerTop, triggerCopy);

  const panel = document.createElement("div");
  panel.className = "folder-picker-panel";
  panel.hidden = true;

  const inputLabel = document.createElement("label");
  inputLabel.className = "label";

  const inputText = document.createElement("span");
  inputText.textContent = t("目录");

  const input = document.createElement("input");
  input.className = "input";
  input.type = "text";
  input.placeholder = t("可新增，例如 工作/项目A");

  inputLabel.append(inputText, input);

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "folder-picker-clear";
  clearButton.textContent = t("未分类");

  const recentSection = document.createElement("div");
  recentSection.className = "folder-picker-section";

  const recentTitle = document.createElement("span");
  recentTitle.className = "folder-picker-section-title";
  recentTitle.textContent = t("最近使用");

  const recentList = document.createElement("div");
  recentList.className = "folder-picker-list";

  recentSection.append(recentTitle, recentList);

  const catalogSection = document.createElement("div");
  catalogSection.className = "folder-picker-section";

  const catalogTitle = document.createElement("span");
  catalogTitle.className = "folder-picker-section-title";
  catalogTitle.textContent = t("已有目录");

  const catalogList = document.createElement("div");
  catalogList.className = "folder-picker-list";

  const empty = document.createElement("p");
  empty.className = "helper-text";
  empty.textContent = emptyText;

  catalogSection.append(catalogTitle, catalogList, empty);
  panel.append(inputLabel, clearButton, recentSection, catalogSection);
  wrapper.append(labelElement, trigger, panel);

  function getValue() {
    return normalizeFolderPath(input.value);
  }

  function setOpen(open) {
    const nextOpen = Boolean(open) && !disabled;
    panel.hidden = !nextOpen;
    trigger.setAttribute("aria-expanded", String(nextOpen));
    triggerCaret.textContent = nextOpen ? "^" : "v";
    if (nextOpen) {
      input.focus();
      input.select();
    }
  }

  function selectPath(path) {
    input.value = normalizeFolderPath(path);
    render();
    setOpen(false);
    trigger.focus();
  }

  function render() {
    const selectedPath = getValue();
    const query = input.value.trim();
    const recentPaths = filterPaths(recent, query);
    const recentKeys = new Set(recent.map((path) => path.toLowerCase()));
    const catalogPaths = filterPaths(
      catalog.filter((path) => !recentKeys.has(path.toLowerCase())),
      query
    );

    triggerLabel.textContent = selectedPath || t("未分类");
    clearButton.classList.toggle("is-selected", !selectedPath);
    clearButton.disabled = disabled;
    trigger.disabled = disabled;
    input.disabled = disabled;

    recentList.replaceChildren();
    for (const path of recentPaths) {
      recentList.append(createFolderButton(path, selectedPath, selectPath, "is-recent"));
    }
    recentSection.hidden = recentPaths.length === 0;

    catalogList.replaceChildren();
    for (const path of catalogPaths) {
      catalogList.append(createFolderButton(path, selectedPath, selectPath));
    }
    empty.hidden = recentPaths.length > 0 || catalogPaths.length > 0;
  }

  trigger.addEventListener("click", () => setOpen(panel.hidden));
  clearButton.addEventListener("click", () => selectPath(""));
  input.addEventListener("input", render);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.focus();
    }
  });

  render();

  return {
    element: wrapper,
    input,
    render,
    getValue,
    setValue(path) {
      input.value = normalizeFolderPath(path);
      render();
    },
    setCatalog(paths) {
      catalog = uniqueSortedPaths(paths);
      render();
    },
    setRecent(paths) {
      recent = uniquePaths(paths);
      render();
    },
    setDisabled(nextDisabled) {
      disabled = Boolean(nextDisabled);
      if (disabled) {
        setOpen(false);
      }
      render();
    },
    close() {
      setOpen(false);
    }
  };
}
