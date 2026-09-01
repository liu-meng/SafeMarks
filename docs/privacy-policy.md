# SafeMarks Privacy Policy

Effective date: 2026-07-19

## What SafeMarks does

SafeMarks is a browser extension for saving and managing bookmarks in a local encrypted vault. The extension supports vault locking, searching, folder organization, browser-bookmark import, encrypted backup export, and optional end-to-end encrypted synchronization through a user-selected filesystem folder.

SafeMarks does not require an account or operate a SafeMarks data server. Cloud-folder synchronization is disabled by default and begins only after the user selects and authorizes a dedicated folder, such as a folder in iCloud Drive.

## Data SafeMarks processes

- Master password: used locally to derive the encryption key for the vault. It is not stored in plain text.
- Session key material: stored in `chrome.storage.session` while the vault is unlocked and cleared on lock, timeout, or browser-session end.
- Encrypted vault data: bookmark titles, URLs, notes, folder paths, timestamps, and vault settings stored in `chrome.storage.local`.
- Pending quick captures: if the user triggers quick capture while the vault is locked, the pending bookmark entry is stored locally in plain text until the next unlock imports it into the encrypted vault and clears the temporary record.
- Browser bookmark import data: if the user explicitly grants the optional `bookmarks` permission, SafeMarks reads browser bookmarks to import them into the local vault.
- Current page metadata: the title, URL, and favicon URL of the active tab are read only when the user saves the current page or starts quick capture.
- Selected page text: when the user explicitly chooses the right-click menu action to save selected text, that selected text is saved as a bookmark note.
- Local preferences: language preference, auto-lock settings, and folder catalog metadata are stored locally to support the extension experience.
- Optional sync state: random vault, device, and revision identifiers, timestamps, encrypted revision files, and the last sync result.
- Sync folder handle: after the user selects a folder, the browser stores the directory handle in the extension's IndexedDB so SafeMarks can reuse that specific authorization while it remains valid.

## How SafeMarks uses data

SafeMarks uses the above data only to provide its local bookmark-vault features:

- create and unlock the encrypted vault
- save and search bookmarks
- import browser bookmarks when the user requests it
- export encrypted or plain JSON backups when the user requests it
- auto-lock the vault after a timeout
- write and read encrypted revision files in a user-authorized sync folder
- merge independent device changes locally after the vault is unlocked

## Data sharing and remote services

- SafeMarks does not sell user data.
- SafeMarks does not transfer bookmark data to third parties for advertising or analytics.
- SafeMarks never writes plaintext bookmark content, the master password, or session keys to the sync folder.
- When optional folder sync is enabled, SafeMarks writes encrypted revisions to the selected folder. If that folder is managed by iCloud Drive, Dropbox, OneDrive, or another provider, that provider may receive the encrypted files and can observe file size, modification time, and random revision identifiers, but not decrypted bookmark content.
- SafeMarks does not use third-party analytics, ads, or remote code execution.

## Permissions used

- `storage`: store the encrypted vault, settings, folder catalog, and pending quick captures locally.
- `alarms`: auto-lock the vault after the configured timeout.
- `activeTab`: read the active tab's title and URL only when the user saves the current page or starts quick capture.
- `contextMenus`: add user-triggered right-click menu items for saving the current page, links, or selected text.
- `bookmarks` (optional): read browser bookmarks only after the user explicitly requests import and grants permission.
- Filesystem folder access: granted per directory through Chrome's system file picker. SafeMarks recommends a dedicated `SafeMarks` folder and does not request access to the entire drive.

## User controls

Users can:

- lock the vault manually
- change the auto-lock timeout
- export encrypted backups
- export plain JSON backups after unlocking
- import encrypted backups
- import browser bookmarks after granting permission
- connect, reauthorize, manually sync, or disconnect a sync folder
- remove remote encrypted revisions by deleting the selected folder's SafeMarks files
- clear all local SafeMarks data

## Data retention

- Encrypted vault data remains on the device until the user deletes it or overwrites it by importing another vault.
- Session key material is temporary and is cleared when the vault locks, expires, or the browser session ends.
- Pending quick-capture records remain local until they are imported after the next unlock or cleared with local data reset.
- Encrypted sync revisions remain in the user-selected folder until SafeMarks history cleanup runs or the user deletes those files. Disconnecting the folder does not delete local or remote data.

## Security notes

SafeMarks is designed so that regular bookmark saves are written to the encrypted vault. The main exception is pending quick captures created while the vault is locked: those records are temporarily stored locally in plain text until the next unlock imports them into the encrypted vault.

## Contact

Support contact: `vaultscope@outlook.com`

---

## SafeMarks 隐私说明

生效日期：2026-07-19

SafeMarks 的核心功能使用本地加密保险库，不需要账号，也不运营 SafeMarks 数据服务器。可选云同步默认关闭，只有用户主动选择并授权专用文件夹（例如 iCloud Drive 中的 SafeMarks 文件夹）后才会启用。

### SafeMarks 会处理哪些数据

- 主密码：仅在本地用于派生保险库密钥，不会以明文形式持久化保存。
- 会话密钥材料：仅在保险库已解锁时保存在 `chrome.storage.session`，锁定、超时或浏览器会话结束后清除。
- 加密保险库数据：包括收藏标题、URL、备注、目录、时间戳和设置，保存在 `chrome.storage.local`。
- 待导入快速收藏：如果用户在锁定状态下触发快速收藏，待写入条目会先在本地以明文暂存，等下次解锁后导入加密保险库并清除。
- 浏览器收藏导入数据：只有在用户主动触发导入并授权可选 `bookmarks` 权限后，才会读取浏览器原生收藏。
- 当前页面信息：只有在用户主动“保存当前页”或触发快速收藏时，才会读取当前活动标签页的标题、URL 和 favicon URL。
- 页面选中文本：只有在用户主动选择右键菜单中的“保存选中文本”操作时，才会把选中文本保存为收藏备注。
- 本地偏好设置：语言偏好、自动锁定时间和目录目录索引等元数据会保存在本地。
- 可选同步状态：随机的保险库、设备和修订标识，时间戳、加密修订文件以及最近同步结果。
- 同步目录句柄：用户选择目录后，浏览器把该目录句柄保存在扩展 IndexedDB 中，以便在授权仍有效时继续访问这个特定目录。

### 数据用途

上述数据只用于本地收藏保险库能力，包括：

- 创建和解锁加密保险库
- 保存、搜索、编辑和管理收藏
- 在用户主动要求时导入浏览器收藏
- 在用户主动要求时导出加密或明文备份
- 根据超时设置自动锁定保险库
- 在用户授权的目录中读写加密修订，并在解锁后于本地合并多端修改

### 数据共享

- 不出售用户数据
- 不将收藏数据用于广告或分析，也不向第三方传输
- 不把明文收藏、主密码或会话密钥写入同步目录
- 启用可选目录同步后，SafeMarks 会向所选目录写入加密修订；如果目录由 iCloud Drive、Dropbox、OneDrive 等服务管理，服务商可以看到密文文件大小、修改时间和随机修订标识，但无法读取收藏内容
- 不使用第三方分析、广告或远程代码执行

### 用户可控能力

用户可以随时手动锁定、修改自动锁定时间、导出或导入备份、授权导入浏览器收藏、连接或断开同步目录，以及清空本地 SafeMarks 数据。断开目录不会删除本地保险库或目录中的密文修订。

### 联系方式

支持联系邮箱：`vaultscope@outlook.com`
