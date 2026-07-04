/**
 * Search history dropdown component.
 * Shows recent search queries when search input is focused.
 */

import { loadSearchHistory, addSearchHistoryEntry, clearSearchHistory } from "../core/search-history.js";
import { t } from "./i18n.js";

export function createSearchHistoryDropdown({ input, onSelect }) {
  let history = [];
  let visible = false;

  const dropdown = document.createElement("div");
  dropdown.className = "search-history-dropdown";
  dropdown.hidden = true;

  function render() {
    dropdown.replaceChildren();

    if (history.length === 0) {
      hide();
      return;
    }

    const header = document.createElement("div");
    header.className = "search-history-header";

    const title = document.createElement("span");
    title.className = "search-history-title";
    title.textContent = t("最近搜索");

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "search-history-clear";
    clearButton.textContent = t("清除");
    clearButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await clearSearchHistory();
      history = [];
      hide();
    });

    header.append(title, clearButton);
    dropdown.appendChild(header);

    for (const query of history) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "search-history-item";
      item.textContent = query;
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelect(query);
        hide();
      });
      dropdown.appendChild(item);
    }
  }

  function show() {
    if (history.length === 0 || input.value.trim()) {
      return;
    }
    visible = true;
    dropdown.hidden = false;
    render();
  }

  function hide() {
    visible = false;
    dropdown.hidden = true;
  }

  async function refresh() {
    history = await loadSearchHistory();
  }

  async function recordQuery(query) {
    await addSearchHistoryEntry(query);
    await refresh();
  }

  // Position dropdown after input
  input.parentElement?.style.setProperty("position", "relative");
  input.after(dropdown);

  input.addEventListener("focus", async () => {
    await refresh();
    show();
  });

  input.addEventListener("input", () => {
    if (input.value.trim()) {
      hide();
    } else {
      show();
    }
  });

  document.addEventListener("click", (event) => {
    if (visible && !dropdown.contains(event.target) && event.target !== input) {
      hide();
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && visible) {
      hide();
      event.stopPropagation();
    }
  });

  return { dropdown, recordQuery, refresh, hide };
}
