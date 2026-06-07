# SafeMarks Privacy Policy

Effective date: 2026-06-08

## What SafeMarks does

SafeMarks is a browser extension for saving and managing bookmarks in a local encrypted vault. The extension supports vault locking, searching, folder organization, browser-bookmark import, and encrypted backup export.

SafeMarks does not require an account and does not sync data to a remote server.

## Data SafeMarks processes

- Master password: used locally to derive the encryption key for the vault. It is not stored in plain text.
- Session key material: stored in `chrome.storage.session` while the vault is unlocked and cleared on lock, timeout, or browser-session end.
- Encrypted vault data: bookmark titles, URLs, notes, folder paths, timestamps, and vault settings stored in `chrome.storage.local`.
- Pending quick captures: if the user triggers quick capture while the vault is locked, the pending bookmark entry is stored locally in plain text until the next unlock imports it into the encrypted vault and clears the temporary record.
- Browser bookmark import data: if the user explicitly grants the optional `bookmarks` permission, SafeMarks reads browser bookmarks to import them into the local vault.
- Current page metadata: the title, URL, and favicon URL of the active tab are read only when the user saves the current page or starts quick capture.
- Selected page text: when the user explicitly chooses the right-click menu action to save selected text, that selected text is saved as a bookmark note.
- Local preferences: language preference, auto-lock settings, and folder catalog metadata are stored locally to support the extension experience.

## How SafeMarks uses data

SafeMarks uses the above data only to provide its local bookmark-vault features:

- create and unlock the encrypted vault
- save and search bookmarks
- import browser bookmarks when the user requests it
- export encrypted or plain JSON backups when the user requests it
- auto-lock the vault after a timeout

## Data sharing and remote services

- SafeMarks does not sell user data.
- SafeMarks does not transfer bookmark data to third parties for advertising or analytics.
- SafeMarks does not send bookmark data, passwords, or session keys to a remote server.
- SafeMarks does not use third-party analytics, ads, or remote code execution.

## Permissions used

- `storage`: store the encrypted vault, settings, folder catalog, and pending quick captures locally.
- `alarms`: auto-lock the vault after the configured timeout.
- `activeTab`: read the active tab's title and URL only when the user saves the current page or starts quick capture.
- `contextMenus`: add user-triggered right-click menu items for saving the current page, links, or selected text.
- `bookmarks` (optional): read browser bookmarks only after the user explicitly requests import and grants permission.

## User controls

Users can:

- lock the vault manually
- change the auto-lock timeout
- export encrypted backups
- export plain JSON backups after unlocking
- import encrypted backups
- import browser bookmarks after granting permission
- clear all local SafeMarks data

## Data retention

- Encrypted vault data remains on the device until the user deletes it or overwrites it by importing another vault.
- Session key material is temporary and is cleared when the vault locks, expires, or the browser session ends.
- Pending quick-capture records remain local until they are imported after the next unlock or cleared with local data reset.

## Security notes

SafeMarks is designed so that regular bookmark saves are written to the encrypted vault. The main exception is pending quick captures created while the vault is locked: those records are temporarily stored locally in plain text until the next unlock imports them into the encrypted vault.

## Contact

Support contact: `vaultscope@outlook.com`

---

## SafeMarks 隐私说明

生效日期：2026-06-08

### SafeMarks 会处理哪些数据

- 主密码：仅在本地用于派生保险库密钥，不会以明文形式持久化保存。
- 会话密钥材料：仅在保险库已解锁时保存在 `chrome.storage.session`，锁定、超时或浏览器会话结束后清除。
- 加密保险库数据：包括收藏标题、URL、备注、目录、时间戳和设置，保存在 `chrome.storage.local`。
- 待导入快速收藏：如果用户在锁定状态下触发快速收藏，待写入条目会先在本地以明文暂存，等下次解锁后导入加密保险库并清除。
- 浏览器收藏导入数据：只有在用户主动触发导入并授权可选 `bookmarks` 权限后，才会读取浏览器原生收藏。
- 当前页面信息：只有在用户主动“保存当前页”或触发快速收藏时，才会读取当前活动标签页的标题、URL 和 favicon URL。
- 页面选中文本：只有在用户主动选择右键菜单中的“保存选中文本”操作时，才会把选中文本保存为收藏备注。
- 本地偏好设置：语言偏好、自动锁定时间和目录目录索引等元数据会保存在本地。

### 数据用途

上述数据只用于本地收藏保险库能力，包括：

- 创建和解锁加密保险库
- 保存、搜索、编辑和管理收藏
- 在用户主动要求时导入浏览器收藏
- 在用户主动要求时导出加密或明文备份
- 根据超时设置自动锁定保险库

### 数据共享

- 不出售用户数据
- 不将收藏数据用于广告或分析，也不向第三方传输
- 不把收藏数据、主密码或会话密钥发送到远程服务器
- 不使用第三方分析、广告或远程代码执行

### 用户可控能力

用户可以随时手动锁定、修改自动锁定时间、导出备份、导入备份、授权导入浏览器收藏，以及清空本地 SafeMarks 数据。

### 联系方式

支持联系邮箱：`vaultscope@outlook.com`
