import {
  Editor,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  requestUrl,
} from "obsidian";
import { HttpRequest, OpenListClient } from "./openlist";
import {
  DEFAULT_SETTINGS,
  OpenListAttachSettings,
  OpenListSettingTab,
  normalizeDir,
  parseAllowedExts,
} from "./settings";

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico",
]);

/** 剪贴板截图常见的无意义文件名 */
const GENERIC_NAME = /^(image|pasted image|截图|图片)[ .]/i;

function timestampName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function stemOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export default class OpenListAttachPlugin extends Plugin {
  settings: OpenListAttachSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new OpenListSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("editor-paste", (evt, editor, view) => {
        if (!(view instanceof MarkdownView)) return;
        const files = evt.clipboardData?.files;
        if (!files || files.length === 0) return;
        evt.preventDefault();
        void this.handleFiles(Array.from(files), editor, true);
      })
    );

    this.registerEvent(
      this.app.workspace.on("editor-drop", (evt, editor, view) => {
        if (!(view instanceof MarkdownView)) return;
        const files = evt.dataTransfer?.files;
        if (!files || files.length === 0) return;
        // 只处理从操作系统拖入的文件;库内拖拽交给 Obsidian
        const types = Array.from(evt.dataTransfer?.types ?? []);
        if (!types.includes("Files")) return;
        evt.preventDefault();
        void this.handleFiles(Array.from(files), editor, false);
      })
    );

    this.addCommand({
      id: "upload-note-attachments",
      name: "上传当前笔记中的本地附件到 OpenList",
      callback: () => void this.uploadNoteAttachments(),
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        if (!(view instanceof MarkdownView)) return;
        menu.addItem((item) =>
          item
            .setTitle("上传本地附件到 OpenList")
            .setIcon("upload-cloud")
            .onClick(() => void this.uploadNoteAttachments())
        );
      })
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
    this.settings.remoteDir = normalizeDir(this.settings.remoteDir);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private makeClient(): OpenListClient {
    const request: HttpRequest = async (req) => {
      const resp = await requestUrl({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: req.body,
        throw: false,
      });
      return { status: resp.status, text: resp.text };
    };
    return new OpenListClient(this.settings, request);
  }

  async testConnection(): Promise<number> {
    return this.makeClient().testConnection(this.settings.remoteDir);
  }

  /** 类型过滤;返回 null 表示通过,否则返回被拦截的扩展名 */
  private blockedExt(name: string): string | null {
    const allowed = parseAllowedExts(this.settings.allowedExts);
    if (!allowed) return null;
    const ext = extOf(name);
    return allowed.has(ext) ? null : ext || "(无扩展名)";
  }

  private remotePathFor(name: string): string {
    let finalName = name;
    if (this.settings.conflictStrategy === "timestamp") {
      const ext = extOf(name);
      finalName = ext
        ? `${stemOf(name)}-${timestampName()}.${ext}`
        : `${name}-${timestampName()}`;
    }
    const dir = normalizeDir(this.settings.remoteDir);
    return dir === "/" ? `/${finalName}` : `${dir}/${finalName}`;
  }

  /** 生成插入笔记的语法。图片始终用直链以保内联渲染;其他类型按设置选直链/预览页 */
  private insertSyntax(name: string, remotePath: string, alt?: string): string {
    const client = this.makeClient();
    if (IMAGE_EXTS.has(extOf(name))) {
      return `![${alt ?? stemOf(name)}](${client.directLink(remotePath)})`;
    }
    const link =
      this.settings.linkType === "preview"
        ? client.previewLink(remotePath)
        : client.directLink(remotePath);
    return `[${alt ?? name}](${link})`;
  }

  private async handleFiles(
    files: File[],
    editor: Editor,
    fromClipboard: boolean
  ): Promise<void> {
    const client = this.makeClient();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let name = file.name || "";
      if (fromClipboard && (!name || GENERIC_NAME.test(name))) {
        name = `Pasted-${timestampName()}.${extOf(name) || "png"}`;
      }
      const blocked = this.blockedExt(name);
      if (blocked) {
        new Notice(`已按类型过滤设置跳过: ${name} (.${blocked})`, 5000);
        continue;
      }
      const remotePath = this.remotePathFor(name);
      const progress = new Notice(
        `上传中 ${i + 1}/${files.length}: ${name}`,
        0
      );
      try {
        const data = await file.arrayBuffer();
        await client.upload(remotePath, data);
        progress.hide();
        editor.replaceSelection(this.insertSyntax(name, remotePath) + "\n");
        new Notice(`✅ 已上传: ${name}`);
      } catch (e) {
        progress.hide();
        new Notice(`❌ 上传失败 ${name}: ${(e as Error).message}`, 6000);
      }
    }
  }

  /** 扫描当前笔记中的本地附件链接,上传后替换为云端链接 */
  private async uploadNoteAttachments(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice("没有打开的 Markdown 笔记");
      return;
    }
    const file = view.file;
    const content = await this.app.vault.read(file);

    // 单一正则按从左到右消费,wiki/md、嵌入/链接四种写法互不重叠
    const re =
      /!?\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]|!?\[([^\]]*)\]\(([^)]+?)\)/g;
    interface Found {
      whole: string;
      linkpath: string;
      alt?: string;
    }
    const found: Found[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const isWiki = m[1] !== undefined;
      const path = (isWiki ? m[1] : m[4])?.trim();
      if (!path || /^https?:\/\//i.test(path)) continue;
      found.push({
        whole: m[0],
        linkpath: path,
        alt: isWiki ? m[2] || undefined : m[3] || undefined,
      });
    }
    if (found.length === 0) {
      new Notice("当前笔记没有本地附件链接");
      return;
    }

    const client = this.makeClient();
    let newContent = content;
    let ok = 0;
    for (let i = 0; i < found.length; i++) {
      const item = found[i];
      // markdown 链接中空格会被编码为 %20,也可能包在 <> 中
      let decoded = item.linkpath.replace(/^<|>$/g, "");
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        /* 保留原样 */
      }
      const tfile = this.app.metadataCache.getFirstLinkpathDest(
        decoded,
        file.path
      );
      if (!(tfile instanceof TFile)) {
        new Notice(`找不到附件文件: ${decoded}`, 5000);
        continue;
      }
      if (tfile.extension.toLowerCase() === "md") continue; // 笔记链接不上传
      const blocked = this.blockedExt(tfile.name);
      if (blocked) {
        new Notice(`已按类型过滤设置跳过: ${tfile.name}`, 5000);
        continue;
      }
      const remotePath = this.remotePathFor(tfile.name);
      const progress = new Notice(
        `上传中 ${i + 1}/${found.length}: ${tfile.name}`,
        0
      );
      try {
        const data = await this.app.vault.readBinary(tfile);
        await client.upload(remotePath, data);
        progress.hide();
        const syntax = this.insertSyntax(tfile.name, remotePath, item.alt);
        newContent = newContent.split(item.whole).join(syntax);
        ok++;
      } catch (e) {
        progress.hide();
        new Notice(
          `❌ 上传失败 ${tfile.name}: ${(e as Error).message}`,
          6000
        );
      }
    }
    if (newContent !== content) {
      await this.app.vault.modify(file, newContent);
    }
    new Notice(`完成:成功上传 ${ok}/${found.length} 个附件`);
  }
}
