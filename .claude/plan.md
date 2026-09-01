# 完成"部分完成"功能 — 实现计划

## 概览

需要完成 7 个部分完成的功能模块，按依赖关系分批实现。

---

## 1. 标签筛选与管理 (Phase 1.1)

### 1a. Manager 标签筛选
- 在 Manager 侧边栏文件夹树下方增加"标签"区域，展示所有已使用标签及数量
- 点击标签筛选书签列表（与文件夹筛选逻辑类似）
- 支持组合筛选：多标签 AND 逻辑
- state 新增 `activeTagFilters: []`，renderView 中 filter 增加标签条件

### 1b. 标签管理
- Manager 中标签右键菜单或专用面板：重命名、合并、删除
- 实现 `src/core/tags.js` 新增：`renameTagInBookmarks(bookmarks, oldTag, newTag)`、`mergeTagsInBookmarks(bookmarks, sourceTags, targetTag)`、`deleteTagFromBookmarks(bookmarks, tag)`
- 操作后重新加密保存 vault

---

## 2. 搜索增强 (Phase 2.1)

### 2a. 搜索结果高亮
- 新增 `src/shared/highlight.js`：`highlightText(text, query)` 返回 DOM fragment，匹配字符用 `<mark>` 包裹
- 修改 popup `createBookmarkItem` 和 manager `createManagerRow`：title 使用 highlight 而非 `.textContent`
- bookmark-search.js 新增 `getMatchIndices(text, query)` 返回匹配字符索引数组

### 2b. 搜索语法
- bookmark-search.js 新增 `parseSearchQuery(raw)` 解析 `tag:xxx`、`folder:xxx`、`site:xxx` 前缀
- 返回 `{ terms: string, filters: { tag?, folder?, site? } }`
- `getBookmarkSearchResults` 先解析 query，再对 filters 精确匹配，terms 走模糊搜索
- 支持语法：`tag:重要`、`folder:Work`、`site:github.com`

### 2c. 搜索历史
- `src/core/search-history.js`：最近 10 条搜索词存入 chrome.storage.local
- Popup/Manager 搜索框聚焦时显示历史下拉

---

## 3. 排序选项 (Phase 2.4)

- Manager 列表标题栏右侧增加排序下拉：按时间（新→旧/旧→新）、按标题字母
- state 新增 `sortBy: "createdAt-desc"`（默认）
- `getBookmarkSearchResults` 接受 sortBy 参数，无搜索词时按指定方式排序
- 有搜索词时默认按相关度，可手动切换

---

## 4. Onboarding 独立页面 (Phase 3.1)

- 新建 `src/onboarding/` 目录：index.html + onboarding.js + onboarding.css
- 3 步流程独立全屏页面，带进度条动画
- 简单的加密原理图示（CSS 动画，无外部依赖）
- 完成后自动跳转 Popup
- 修改 service-worker.js `onInstalled` 打开新 onboarding 页而非 options?flow=welcome
- manifest.json 注册 onboarding 页面

---

## 5. Popup 快捷键提示 (Phase 4.3)

- Popup 底部区域（lock 按钮旁）增加渐进提示条
- 存储 `shortcutHintDismissed` 和 `popupOpenCount` 到 chrome.storage.local
- 前 5 次打开时显示：「提示：可在设置中自定义快捷键」
- 用户可点击 × 永久关闭

---

## 6. Manager 键盘导航 (Phase 5.4)

- document keydown 监听：
  - `j`/`↓`：下一行聚焦
  - `k`/`↑`：上一行聚焦
  - `Enter`：打开链接
  - `e`：编辑
  - `x`：切换选中
  - `Delete`/`d`：删除（需确认）
  - `/`：聚焦搜索框
  - `Escape`：取消聚焦/关闭编辑
- state 新增 `focusedRowIndex: -1`
- 聚焦行添加 `.is-focused` class，自动 scrollIntoView
- 输入框获焦时禁用单字母快捷键

---

## 7. 拖拽移动书签到文件夹 (Phase 2.3)

- Manager 书签行添加 `draggable="true"`
- 侧边栏文件夹节点作为 drop target
- dragstart 携带 bookmark id，dragover 高亮目标文件夹，drop 执行移动
- 支持多选拖拽（拖拽时携带所有选中 id）
- 视觉反馈：拖拽时显示半透明预览、目标高亮

---

## 8. Popup 虚拟滚动 (Phase 5.3)

- 搜索结果超过 50 条时启用虚拟滚动
- 新建 `src/shared/virtual-list.js`：轻量虚拟列表组件
- 固定行高，只渲染可见区域 + 上下 buffer
- 搜索输入增加 150ms debounce
- 默认视图（最近 5 条）保持现有逻辑不变

---

## 实现顺序

按依赖关系和复用程度排序：

1. **搜索高亮 + 语法** — 新增 shared 模块，popup 和 manager 都用
2. **搜索历史** — 依赖搜索模块
3. **排序选项** — 修改 bookmark-search.js + manager UI
4. **标签筛选 + 管理** — 依赖搜索语法（tag: 前缀）
5. **Manager 键盘导航** — 独立功能
6. **拖拽移动** — 独立功能
7. **Popup 快捷键提示** — 独立小功能
8. **Popup 虚拟滚动** — 独立性能优化
9. **Onboarding 独立页面** — 独立新页面

---

## 文件变更概览

新增文件：
- `src/shared/highlight.js`
- `src/core/search-history.js`
- `src/shared/virtual-list.js`
- `src/onboarding/index.html`
- `src/onboarding/onboarding.js`
- `src/onboarding/onboarding.css`

修改文件：
- `src/core/bookmark-search.js` — 搜索语法、排序参数、高亮索引
- `src/core/tags.js` — 标签管理操作
- `src/shared/tag-chips.js` — 标签筛选组件
- `src/manager/manager.js` — 标签筛选 UI、排序 UI、键盘导航、拖拽
- `src/manager/index.html` — 排序下拉、标签侧边栏区域
- `src/manager/manager.css` — 聚焦行、拖拽、标签筛选样式
- `src/popup/popup.js` — 搜索高亮、虚拟滚动、快捷键提示、debounce
- `src/popup/popup.html` — 提示区域
- `src/popup/popup.css` — 提示样式、高亮样式
- `src/background/service-worker.js` — onInstalled 打开新 onboarding 页
- `manifest.json` — 注册 onboarding 页面
- `src/shared/i18n.js` — 新增翻译条目
