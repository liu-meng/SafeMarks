# SafeMarks 商店提交流程与后台填写清单

本文整理了 SafeMarks 发布到 Chrome Web Store 和 Microsoft Edge Add-ons 时，仓库内已经准备好的内容、后台建议填写内容，以及仍需手动完成的项目。

## 1. 仓库内已补齐的内容

- 商店上传 ZIP 打包脚本：`npm run package:extension`
- 隐私政策草案：`docs/privacy-policy.md`
- 商店后台填写建议：本文档
- 更清晰的扩展短描述：见 `_locales/en/messages.json` 和 `_locales/zh_CN/messages.json`
- 现有运行时图标：`assets/icons/`

## 2. 先执行的命令

```bash
npm test
npm run package:extension
```

执行后上传这个文件：

```text
dist/safemarks-1.0.9.zip
```

如果版本号变化，ZIP 文件名会随 `manifest.json` 中的 `version` 自动变化。

## 3. 仍需手动完成的事项

- 把 `docs/privacy-policy.md` 托管到公开 HTTPS 地址
- 准备至少 1 张真实功能截图
- 准备 440x280 的 small promo tile
- 准备发布账号信息、联系邮箱、支持地址
- 在真实浏览器里走一遍发布前自测

## 4. Chrome Web Store 后台填写

官方参考：

- [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish/)
- [Complete your listing information](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Fill out the privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/)
- [Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [2-Step Verification requirement](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification/)

### 4.1 账号前置条件

- 注册 Chrome Web Store developer account
- 开启 Google 账号 2-Step Verification
- 验证 contact email

### 4.2 Package

- 上传文件：`dist/safemarks-1.0.9.zip`
- ZIP 内已有 `manifest.json`、`src/`、`assets/`、`_locales/`

### 4.3 Store Listing

建议填写如下。

| 字段 | 建议值 |
| --- | --- |
| Name | `SafeMarks` |
| Category | `Productivity` |
| Language | 至少补 `en`，如要上中文展示页再补 `zh-CN` |
| Short description | 直接使用 manifest 当前短描述 |
| Privacy policy URL | 指向公开 HTTPS 的 `docs/privacy-policy.md` 托管地址 |
| Support / website | 填真实官网或支持页，没有就至少填支持邮箱对应页面 |

建议英文长描述：

```text
SafeMarks helps users save and manage personal browser bookmarks in a local encrypted vault. It lets the user lock the vault with a master password, save the current page, search bookmarks, organize them by folder, add notes, import browser bookmarks on demand, and export encrypted or plain JSON backups. Vault data stays on the user's device and no account, sync service, analytics service, or remote server is required for the core experience.
```

建议中文长描述：

```text
SafeMarks 用于把浏览器收藏保存在本地加密保险库中。用户可以使用主密码锁定和解锁保险库，保存当前页面，按目录管理收藏，添加备注，按需导入浏览器原生收藏，并导出加密或明文 JSON 备份。核心能力完全在本地运行，不依赖账号体系、云同步、分析服务或远程服务器。
```

### 4.4 Listing 素材

根据 Chrome 官方文档，至少准备：

- 128x128 extension icon：已在包内
- 440x280 small promo tile：必须手动上传
- 至少 1 张截图：必须手动上传

建议补齐但非强制：

- 1400x560 marquee / large promo
- 3 到 5 张功能截图，覆盖：
  - 首次创建保险库
  - 已解锁 popup
  - 收藏管理页
  - 设置页与导入导出

### 4.5 Privacy Practices

Single purpose 建议填写：

```text
Store and manage personal browser bookmarks in a local encrypted vault.
```

权限用途建议填写：

| 权限 | 建议说明 |
| --- | --- |
| `storage` | Stores the encrypted vault, folder catalog, local settings, and pending quick-capture records on the device. |
| `alarms` | Auto-locks the vault after the configured timeout. |
| `activeTab` | Reads the current tab's title and URL only when the user explicitly saves the current page or starts quick capture. |
| `contextMenus` | Adds user-triggered right-click menu items for saving pages, links, or selected text into SafeMarks. |
| `bookmarks` | Optional permission used only when the user explicitly requests browser-bookmark import. |

数据披露建议按下面原则填写：

- 如果后台出现 `Web history`、`Browsing activity` 或相近字段，建议选择 `Yes`
  - 理由：扩展会保存或导入用户明确选择的页面 URL / 标题，这些数据可能反映浏览偏好
- 不要声称读取 `Website content`
  - 当前实现只读取活动标签页的标题、URL、favicon URL，不抓取页面正文或 DOM
- 不要声称使用远程服务处理用户数据
  - 当前实现没有远程同步、广告、分析或后端接口
- `Sold to third parties`：`No`
- `Used for creditworthiness or lending purposes`：`No`
- `Transferred to third parties`：`No`，除非以后新增远程服务

必须和隐私政策保持一致的点：

- 常规收藏写入加密保险库
- 锁定状态下的快速收藏会先本地明文暂存，待下次解锁后导入并清除
- 主密码不以明文持久化
- 书签导入只发生在用户主动授权后

### 4.6 Distribution

建议首发时：

- Visibility：`Public` 或先 `Private / trusted testers` 预检
- Regions：默认全区域即可；如果只支持中文运营，再按需要收缩

### 4.7 Test Instructions

该项不是必填，但建议写，内容可直接复制：

```text
No account or paid service is required.

1. Install the extension and open the toolbar popup.
2. Create a vault with any test password.
3. Open a normal http or https page and save the current page.
4. Reopen the popup and verify the saved bookmark appears.
5. Open the options page to test encrypted export, plain export, and browser-bookmark import.
6. Lock the vault and unlock it again with the same password.
```

## 5. Microsoft Edge Add-ons 后台填写

官方参考：

- [Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/publish-extension?form=MT00N5)
- [Overview of Microsoft Edge extensions](https://learn.microsoft.com/en-us/microsoft-edge/extensions/)
- [Microsoft Edge Add-ons developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)

### 5.1 Package

- 上传文件：`dist/safemarks-1.0.9.zip`
- Edge 会把上传的 ZIP 转成商店分发格式

### 5.2 Properties / Listing

建议填写如下。

| 字段 | 建议值 |
| --- | --- |
| Name | `SafeMarks` |
| Short description | 使用 manifest 当前短描述 |
| Category | `Productivity` |
| Privacy policy URL | 指向公开 HTTPS 的 `docs/privacy-policy.md` 托管地址 |
| Search terms | `encrypted bookmarks`, `bookmark manager`, `local vault`, `privacy bookmarks` |

英文描述可复用 Chrome 的英文长描述；如果 Edge 后台要求不少于 250 字符，上一节提供的英文描述已经满足。

### 5.3 语言要求

当前包内已有三套 locale：

- `en`
- `zh_CN`
- `ja`

按 Edge 文档，至少要确保：

- 每种语言都有 description
- 每种语言都有 extension logo
- 至少一种语言有 extension name
- 至少一种语言有 short description

### 5.4 素材

建议准备：

| 素材 | 建议尺寸 | 说明 |
| --- | --- | --- |
| Extension logo | 300x300，最小 128x128 | 每种语言至少一份，可复用同一图 |
| Small promotional tile | 440x280 | 建议准备并上传 |
| Large promotional tile | 1400x560 | 可选 |
| Screenshots | 640x480 或 1280x800，最多 6 张 | 可选但强烈建议上传 |

注：Edge 总览文档把 logo 和 small promotional tile 列为提交流程中的必备视觉资产；当前 publish 页面文档对 small promotional tile 标记更宽松。为避免来回返工，建议直接准备并上传。

### 5.5 Certification 备注

可在备注或描述里强调：

- No account required
- No remote server dependency
- All core bookmark-vault features work locally
- Browser-bookmark import requires explicit user action and permission grant

## 6. 建议先做的真实截图

优先级从高到低：

1. popup 已解锁状态，展示“保存当前页”和收藏列表
2. 收藏管理页，展示搜索、编辑、删除
3. 设置页，展示自动锁定、导入导出、快捷键
4. 首次创建保险库页面

截图原则：

- 用真实功能界面，不要用概念图代替功能截图
- 截图里的示例网址和备注尽量用中性测试数据
- 如果同时发英文 listing，至少准备一套英文界面截图

## 7. 发布前最终核对

- `npm test` 通过
- `npm run package:extension` 成功生成 ZIP
- 隐私政策 URL 可公网访问
- 后台权限说明与真实行为一致
- small promo tile 与截图已上传
- 用 Chrome 和 Edge 各做一次手工安装验证
