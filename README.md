# OpenList Attach

An Obsidian plugin that uploads attachments to [OpenList](https://github.com/OpenListTeam/OpenList) (AList) and inserts **permanent, stable direct links** into your notes.

[中文说明见下文](#中文说明)

## Features

- **Paste to upload (optimistic insert)**: when you paste a screenshot or file, it is first saved locally and previewed instantly; once the background upload finishes, the local link is automatically replaced with the cloud link. If the upload fails, the local attachment is kept untouched. Auto-upload can be toggled off in settings.
- **Drag & drop upload**: drop files from your system file manager into the editor to upload them.
- **Right-click upload**: right-click any non-Markdown file in the file explorer → "Upload to OpenList and replace references". All notes referencing the file are found via the link index and rewritten to the cloud link; if nothing references it, the cloud link is copied to the clipboard.
- **Batch upload**: command "Upload local attachments in current note" scans `![[...]]`, `![](...)` and other local links, uploads each file, and replaces the links in place (also available in the editor context menu).
- **Two auth modes**: API token, or username/password (automatic login, re-login and retry on 401).
- **File-type filter**: optional comma-separated extension whitelist (e.g. `png,jpg,pdf,mp4`); empty means no restriction.
- **Naming conflict strategy**: append a timestamp (default) or keep the original name and overwrite (stable link unchanged).
- **Link format**: images use the `/d/` direct link with `![]()` embed syntax; videos/audio are inserted as HTML5 `<video>`/`<audio>` tags (Obsidian does not support remote media embeds via `![]()`); other file types can use the direct link, the OpenList preview page, an inline iframe preview (PDF via PDF.js, Office docs via Microsoft Office Online viewer), or **local inline embed** — `![]()` embeds of PDF/DOCX/XLSX/PPTX links are rendered in place in reading view by the local engines, no third party involved.
- **Local document preview**: clicking a PDF/DOCX/XLSX/PPTX link pointing to your server opens a local in-Obsidian preview — PDF rendered by pdf.js, DOCX by docx-preview (layout-preserving), XLSX by SheetJS, PPTX by pptx-preview. Viewer code ships with the plugin; file bytes travel only between your server and Obsidian, never through third-party viewer services. Can be toggled off in settings.
- Built-in **connection test** button in settings.

## Stable direct links

Inserted links use the `/d/<path>` form, e.g.:

```
https://alist.example.com/d/189Cloud/test/photo.png
```

These links are permanent: on each visit OpenList replies with a 302 redirect to a freshly signed backend URL. Do **not** use the `raw_url` returned by the OpenList API — it expires after about 5 minutes.

## Installation

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest Release (or clone this repo and run `npm run build`).
2. Create `.obsidian/plugins/openlist-attach/` inside your vault and copy the three files there.
3. Restart Obsidian and enable **OpenList Attach** under Settings → Community plugins.

### BRAT

Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin and add this repository.

## Configuration

| Setting | Description |
| --- | --- |
| Server URL | Your OpenList site address, e.g. `https://alist.example.com` |
| Auth mode | API token (generated in OpenList profile settings) or username/password |
| Remote directory | Upload target directory, default `/189Cloud/test` |
| Auto upload on paste/drop | When off, pasting/dropping keeps Obsidian's default behavior (local only) |
| Allowed file types | Comma-separated extension whitelist; empty means no restriction |
| Name conflicts | Append timestamp / keep original name (overwrite, link unchanged) |
| Non-image link format | Direct link (download) or preview page (online preview) |

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # type check + bundle to main.js
```

`src/openlist.ts` has no Obsidian runtime dependency (HTTP is injected), so it can be unit-tested under plain Node.

## CLI helper

The `upload.py` at the repository root is a standalone command-line uploader (zero dependencies):

```bash
export OPENLIST_TOKEN=openlist-xxxx
python3 upload.py --server https://alist.example.com photo.jpg /189Cloud/test
```

It prints the stable direct link plus Markdown/HTML embed snippets chosen by file type (`<img>` / `<video>` / `<audio>` / plain link).

---

## 中文说明

Obsidian 插件:粘贴/拖拽附件自动上传到 [OpenList](https://github.com/OpenListTeam/OpenList)(AList),并在笔记中插入**永久有效的稳定直链**。

## 功能

- **粘贴即传(乐观插入)**:剪贴板截图、复制的文件,粘贴后**先存本地并立即显示预览**,后台上传成功后自动把本地链接替换为云端链接;上传失败保留本地附件不受影响。可在设置中关闭自动上传,关闭后走 Obsidian 默认行为
- **拖拽上传**:从系统文件管理器拖文件进编辑器即传
- **资源右键上传**:文件列表中右键任意非 md 文件 →「上传到 OpenList 并替换引用」,自动找到全库引用它的笔记并替换为云端链接;无引用时云端链接复制到剪贴板
- **批量上传**:命令「上传当前笔记中的本地附件到 OpenList」,扫描 `![[...]]`、`![](...)` 等本地链接,上传后原地替换为云端链接(编辑器右键菜单也有入口)
- **双认证**:支持 API 令牌,也支持账号密码(自动登录换取令牌,401 自动重登重试)
- **类型过滤**:可配置允许的扩展名白名单(如 `png,jpg,pdf,mp4`),留空不限制
- **重名策略**:自动加时间戳防覆盖,或保留原名覆盖(直链不变)
- **链接格式**:图片用 `![]()` 嵌入直链;视频/音频插入 HTML5 `<video>`/`<audio>` 标签(Obsidian 不支持 `![]()` 嵌入远程音视频);其他文件可选直链、OpenList 预览页链接、iframe 在线查看器,或**本地内联**——PDF/DOCX/XLSX/PPTX 的 `![]()` 嵌入链接在阅读模式正文里由本地引擎原地渲染,不经过第三方
- **本地文档预览**:点击指向本服务器的 PDF/DOCX/XLSX/PPTX 链接,直接在 Obsidian 内本地渲染(PDF 用 pdf.js、DOCX 用 docx-preview(还原排版)、XLSX 用 SheetJS、PPTX 用 pptx-preview),查看器代码随插件打包,文件字节只在你的服务器与 Obsidian 之间流动,不经过任何第三方查看器。可在设置中关闭
- 设置页内置**连接测试**按钮

## 直链说明

插件插入的是 `/d/<路径>` 形式的链接,例如:

```
https://alist.example.com/d/189Cloud/test/photo.png
```

该链接永久有效:每次访问由 OpenList 302 跳转到存储后端(如天翼云)新生成的签名地址。不要使用 OpenList API 返回的 `raw_url`,它约 5 分钟后过期。

## 安装

### 手动安装

1. 下载本仓库 Release 中的 `main.js`、`manifest.json`、`styles.css`(或直接克隆本仓库后 `npm run build`)
2. 在库的 `.obsidian/plugins/` 下新建 `openlist-attach/` 目录,放入这三个文件
3. 重启 Obsidian,在 设置 → 第三方插件 中启用 **OpenList Attach**

### BRAT 安装

安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件,添加本仓库地址即可。

## 配置

| 设置项 | 说明 |
| --- | --- |
| 服务器地址 | OpenList 站点地址,如 `https://alist.example.com` |
| 认证方式 | API 令牌(后台「个人资料」生成)或账号密码 |
| 远程目录 | 附件上传目标目录,默认 `/189Cloud/test` |
| 粘贴/拖拽自动上传 | 关闭后粘贴/拖拽存本地,可右键或命令手动上传 |
| 允许的文件类型 | 逗号分隔扩展名白名单,留空不限制 |
| 重名文件 | 自动加时间戳 / 保留原名覆盖 |
| 非图片链接格式 | 直链(点击下载)/ 预览页(在线查看) |

## 开发

```bash
npm install
npm run dev      # watch 模式
npm run build    # 类型检查 + 产物构建(main.js)
```

`src/openlist.ts` 不依赖 Obsidian 运行时(HTTP 请求注入),可在 Node 下独立测试。

## 附:命令行上传脚本

仓库根目录的 `upload.py` 是独立的命令行上传工具(零依赖):

```bash
export OPENLIST_TOKEN=openlist-xxxx
python3 upload.py --server https://alist.example.com photo.jpg /189Cloud/test
```

站点地址用 `--server` 传入(或环境变量 `OPENLIST_BASE`),令牌只走环境变量 `OPENLIST_TOKEN`(避免留在 shell 历史)。输出稳定直链及 Markdown / HTML 嵌入片段(按文件类型自动选择 `<img>` / `<video>` / `<audio>` / 普通链接)。

## Third-party licenses / 第三方许可

- [pdfjs-dist](https://github.com/mozilla/pdf.js) — Apache-2.0
- [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) — Apache-2.0
- [SheetJS (xlsx)](https://sheetjs.com) — Apache-2.0
- [pptx-preview](https://www.npmjs.com/package/pptx-preview) — npm 包作者声明免费使用(自用商用均可),源码闭源;仅以其 npm 发布包形式作为依赖打包,未修改其代码
