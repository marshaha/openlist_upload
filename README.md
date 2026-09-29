# OpenList Attach

Obsidian 插件:粘贴/拖拽附件自动上传到 [OpenList](https://github.com/OpenListTeam/OpenList)(AList),并在笔记中插入**永久有效的稳定直链**。

## 功能

- **粘贴即传**:剪贴板截图、复制的文件,粘贴进笔记时自动上传并插入链接
- **拖拽上传**:从系统文件管理器拖文件进编辑器即传
- **批量上传**:命令「上传当前笔记中的本地附件到 OpenList」,扫描 `![[...]]`、`![](...)` 等本地链接,上传后原地替换为云端链接(编辑器右键菜单也有入口)
- **双认证**:支持 API 令牌,也支持账号密码(自动登录换取令牌,401 自动重登重试)
- **类型过滤**:可配置允许的扩展名白名单(如 `png,jpg,pdf,mp4`),留空不限制
- **重名策略**:自动加时间戳防覆盖,或保留原名覆盖(直链不变)
- **链接格式**:图片始终插入 `/d/` 直链(阅读模式内联渲染);非图片可选直链或 OpenList 预览页链接(PDF 在线预览推荐预览页)
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
