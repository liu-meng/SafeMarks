import { normalizeBookmarkTags } from "../core/tags.js";
import { t } from "./i18n.js";

function createChip(tag, onRemove) {
  const chip = document.createElement("span");
  chip.className = "tag-chip";

  const text = document.createElement("span");
  text.textContent = tag;

  chip.append(text);

  if (onRemove) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-chip-remove";
    button.setAttribute("aria-label", t("移除标签 {tag}", { tag }));
    button.textContent = "x";
    button.addEventListener("click", () => onRemove(tag));
    chip.append(button);
  }

  return chip;
}

export function createTagList(tags = []) {
  const normalizedTags = normalizeBookmarkTags(tags);
  const list = document.createElement("div");
  list.className = "tag-list";

  for (const tag of normalizedTags) {
    list.append(createChip(tag));
  }

  return list;
}

export function createTagChipsInput({
  label = t("标签"),
  placeholder = t("输入标签后按 Enter"),
  initialTags = []
} = {}) {
  let tags = normalizeBookmarkTags(initialTags);

  const wrapper = document.createElement("label");
  wrapper.className = "label tag-editor-label";

  const labelText = document.createElement("span");
  labelText.textContent = label;

  const editor = document.createElement("div");
  editor.className = "tag-editor";

  const chipList = document.createElement("div");
  chipList.className = "tag-editor-chips";

  const input = document.createElement("input");
  input.className = "tag-editor-input";
  input.type = "text";
  input.placeholder = placeholder;

  function render() {
    chipList.replaceChildren();
    for (const tag of tags) {
      chipList.append(createChip(tag, (tagToRemove) => {
        tags = tags.filter(
          (currentTag) => currentTag.toLowerCase() !== tagToRemove.toLowerCase()
        );
        render();
      }));
    }
  }

  function commitInput() {
    const nextTags = input.value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (nextTags.length === 0) {
      input.value = "";
      return;
    }

    tags = normalizeBookmarkTags([...tags, ...nextTags]);
    input.value = "";
    render();
  }

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== ",") {
      return;
    }

    event.preventDefault();
    commitInput();
  });

  input.addEventListener("blur", commitInput);

  editor.addEventListener("click", () => {
    input.focus();
  });

  render();
  editor.append(chipList, input);
  wrapper.append(labelText, editor);

  return {
    element: wrapper,
    input,
    getTags() {
      commitInput();
      return [...tags];
    },
    setTags(nextTags) {
      tags = normalizeBookmarkTags(nextTags);
      input.value = "";
      render();
    },
    clear() {
      tags = [];
      input.value = "";
      render();
    }
  };
}
