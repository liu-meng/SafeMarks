/**
 * Lightweight virtual list for rendering large bookmark lists.
 * Only renders items visible in the scroll viewport plus a buffer.
 */

const DEFAULT_ITEM_HEIGHT = 52;
const BUFFER_COUNT = 5;

export function createVirtualList({ container, itemHeight = DEFAULT_ITEM_HEIGHT, renderItem }) {
  let items = [];
  let scrollTop = 0;

  const wrapper = document.createElement("div");
  wrapper.className = "virtual-list-wrapper";
  wrapper.style.overflow = "auto";

  const spacer = document.createElement("div");
  spacer.className = "virtual-list-spacer";

  const content = document.createElement("div");
  content.className = "virtual-list-content";
  content.style.position = "relative";

  wrapper.append(spacer, content);
  container.replaceChildren(wrapper);

  function getVisibleRange() {
    const viewportHeight = wrapper.clientHeight;
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - BUFFER_COUNT);
    const visibleCount = Math.ceil(viewportHeight / itemHeight) + BUFFER_COUNT * 2;
    const endIndex = Math.min(items.length, startIndex + visibleCount);
    return { startIndex, endIndex };
  }

  function render() {
    const totalHeight = items.length * itemHeight;
    spacer.style.height = `${totalHeight}px`;

    const { startIndex, endIndex } = getVisibleRange();
    content.replaceChildren();
    content.style.top = `${startIndex * itemHeight}px`;

    for (let i = startIndex; i < endIndex; i += 1) {
      const el = renderItem(items[i], i);
      el.style.height = `${itemHeight}px`;
      el.style.boxSizing = "border-box";
      content.appendChild(el);
    }
  }

  wrapper.addEventListener("scroll", () => {
    scrollTop = wrapper.scrollTop;
    render();
  });

  function setItems(newItems) {
    items = newItems;
    scrollTop = wrapper.scrollTop;
    render();
  }

  function setHeight(height) {
    wrapper.style.height = height;
  }

  function destroy() {
    container.replaceChildren();
  }

  return { element: wrapper, setItems, setHeight, render, destroy };
}
