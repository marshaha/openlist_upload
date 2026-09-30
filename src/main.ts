import {
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

const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "avi", "m4v"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac"]);

/** 本地链接可用 ! 前缀嵌入预览的类型(与 Obsidian 原生粘贴一致) */
const EMBED_EXTS = new Set([
  ...IMAGE_EXTS,
  ...VIDEO_EXTS,
  ...AUDIO_EXTS,
  "pdf",
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
        if (evt.defaultPrevented) return;
        if (!this.settings.autoUpload) return;
        if (!(view instanceof MarkdownView)) return;
        const files = evt.clipboardData?.files;
        if (!files || files.length === 0) return;
        evt.preventDefault();
        void this.handleFiles(Array.from(files), view, true);
      })
    );

    this.registerEvent(
      this.app.workspace.on("editor-drop", (evt, editor, view) => {
        if (evt.defaultPrevented) return;
        if (!this.settings.autoUpload) return;
        if (!(view instanceof MarkdownView)) return;
        const files = evt.dataTransfer?.files;
        if (!files || files.length === 0) return;
        // 只处理从操作系统拖入的文件;库内拖拽交给 Obsidian
        const types = Array.from(evt.dataTransfer?.types ?? []);
        if (!types.includes("Files")) return;
        evt.preventDefault();
        void this.handleFiles(Array.from(files), view, false);
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

    // 文件列表等资源右键:上传该文件并替换所有笔记中的引用
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile)) return; // 排除文件夹
        if (file.extension.toLowerCase() === "md") return;
        menu.addItem((item) =>
          item
            .setTitle("上传到 OpenList 并替换引用")
            .setIcon("upload-cloud")
            .onClick(() => void this.uploadFileAndReplaceRefs(file))
        );
      })
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<OpenListAttachSettings> | null
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

  /**
   * 生成插入笔记的语法。
   * 图片用 ! 嵌入直链;视频/音频插 HTML5 标签(Obsidian 对外部
   * 视频的 ![]() 会按 <img> 渲染成破图,只有 HTML 标签能内联播放);
   * 其他类型按设置选直链/预览页。
   */
  private insertSyntax(name: string, remotePath: string, alt?: string): string {
    const client = this.makeClient();
    const ext = extOf(name);
    const direct = client.directLink(remotePath);
    if (IMAGE_EXTS.has(ext)) {
      return `![${alt ?? stemOf(name)}](${direct})`;
    }
    if (VIDEO_EXTS.has(ext)) {
      return `<video controls src="${direct}" style="max-width:100%"></video>`;
    }
    if (AUDIO_EXTS.has(ext)) {
      return `<audio controls src="${direct}"></audio>`;
    }
    const link =
      this.settings.linkType === "preview"
        ? client.previewLink(remotePath)
        : direct;
    return `[${alt ?? name}](${link})`;
  }

  /**
   * 乐观插入:先存本地附件并插入本地链接(预览即时生效),
   * 后台上传成功后再把该链接替换为云端链接;失败则保留本地附件。
   */
  /** 配置预检;返回 null 表示可上传,否则返回缺少的配置项说明 */
  private validateConfig(): string | null {
    if (!this.settings.serverUrl) return "服务器地址";
    if (this.settings.authMode === "token" && !this.settings.token)
      return "API 令牌";
    if (
      this.settings.authMode === "password" &&
      (!this.settings.username || !this.settings.password)
    )
      return "用户名/密码";
    return null;
  }

  private async handleFiles(
    files: File[],
    view: MarkdownView,
    fromClipboard: boolean
  ): Promise<void> {
    const editor = view.editor;
    const sourcePath = view.file?.path ?? "";
    const client = this.makeClient();
    const configErr = this.validateConfig();
    for (const file of files) {
      let name = file.name || "";
      if (fromClipboard && (!name || GENERIC_NAME.test(name))) {
        name = `Pasted-${timestampName()}.${extOf(name) || "png"}`;
      }
      const blocked = this.blockedExt(name);
      if (blocked) {
        new Notice(`已按类型过滤设置跳过: ${name} (.${blocked})`, 5000);
        continue;
      }
      const data = await file.arrayBuffer();

      // 1. 存入库附件目录并插入本地链接,立即可预览
      let tfile: TFile;
      let localLink: string;
      try {
        const localPath =
          await this.app.fileManager.getAvailablePathForAttachment(
            name,
            sourcePath
          );
        tfile = await this.app.vault.createBinary(localPath, data);
        const raw = this.app.fileManager.generateMarkdownLink(
          tfile,
          sourcePath
        );
        // generateMarkdownLink 生成的是普通链接,可嵌入类型需补 ! 前缀
        localLink = (EMBED_EXTS.has(extOf(name)) ? "!" : "") + raw;
      } catch (e) {
        new Notice(`❌ 保存本地附件失败: ${(e as Error).message}`, 6000);
        continue;
      }
      editor.replaceSelection(localLink + "\n");

      // 2. 后台上传,成功后替换链接(不阻塞编辑)
      if (configErr) {
        new Notice(
          `已保存到本地,但未上传:缺少配置「${configErr}」,请到 OpenList Attach 设置页完善`,
          8000
        );
        continue;
      }
      const remotePath = this.remotePathFor(name);
      void this.uploadAndSwap(client, tfile, data, remotePath, view, localLink);
    }
  }

  /** 后台上传;成功后将笔记中的本地链接原位替换为云端链接 */
  private async uploadAndSwap(
    client: OpenListClient,
    tfile: TFile,
    data: ArrayBuffer,
    remotePath: string,
    view: MarkdownView,
    localLink: string
  ): Promise<void> {
    const progress = new Notice(`⏫ 后台上传中: ${tfile.name}`, 0);
    try {
      await client.upload(remotePath, data);
    } catch (e) {
      progress.hide();
      console.error("[OpenList Attach] upload failed:", e);
      new Notice(
        `❌ 后台上传失败 ${tfile.name},已保留本地附件: ${(e as Error).message}`,
        8000
      );
      return;
    }
    progress.hide();
    const cloud = this.insertSyntax(tfile.name, remotePath);
    const noteFile = view.file;
    if (!noteFile) return;

    // 笔记仍打开时在编辑器内精确替换(保留光标与撤销栈),否则改写文件
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor =
      active?.file?.path === noteFile.path ? active.editor : null;
    const text = editor ? editor.getValue() : await this.app.vault.read(noteFile);
    const idx = text.indexOf(localLink);
    if (idx < 0) {
      new Notice(
        `✅ 已上传 ${tfile.name}(原文中的本地链接已被改动,未替换)`,
        6000
      );
      return;
    }
    if (editor) {
      const from = editor.offsetToPos(idx);
      const to = editor.offsetToPos(idx + localLink.length);
      editor.replaceRange(cloud, from, to);
    } else {
      await this.app.vault.modify(
        noteFile,
        text.slice(0, idx) + cloud + text.slice(idx + localLink.length)
      );
    }
    new Notice(`✅ 已上传并替换: ${tfile.name}`);
  }

  /** 扫描当前笔记中的本地附件链接,上传后替换为云端链接 */
  private async uploadNoteAttachments(): Promise<void> {
    const configErr = this.validateConfig();
    if (configErr) {
      new Notice(
        `无法上传:缺少配置「${configErr}」,请到 OpenList Attach 设置页完善`,
        8000
      );
      return;
    }
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

  /** 右键上传:上传指定文件,并把全库笔记中对它的引用替换为云端链接 */
  private async uploadFileAndReplaceRefs(file: TFile): Promise<void> {
    const configErr = this.validateConfig();
    if (configErr) {
      new Notice(
        `无法上传:缺少配置「${configErr}」,请到 OpenList Attach 设置页完善`,
        8000
      );
      return;
    }
    const blocked = this.blockedExt(file.name);
    if (blocked) {
      new Notice(`已按类型过滤设置跳过: ${file.name} (.${blocked})`, 5000);
      return;
    }
    const remotePath = this.remotePathFor(file.name);
    const progress = new Notice(`上传中: ${file.name}`, 0);
    try {
      const data = await this.app.vault.readBinary(file);
      await this.makeClient().upload(remotePath, data);
    } catch (e) {
      progress.hide();
      new Notice(`❌ 上传失败 ${file.name}: ${(e as Error).message}`, 6000);
      return;
    }
    progress.hide();

    const makeSyntax = (alt?: string) =>
      this.insertSyntax(file.name, remotePath, alt);

    // resolvedLinks: sourcePath -> { destPath: count },用它定位引用笔记
    const resolved = this.app.metadataCache.resolvedLinks;
    let notes = 0;
    let refs = 0;
    for (const note of this.app.vault.getMarkdownFiles()) {
      if (!resolved[note.path]?.[file.path]) continue;
      const content = await this.app.vault.read(note);
      const { content: updated, count } = this.replaceRefsInContent(
        content,
        note.path,
        file,
        makeSyntax
      );
      if (count > 0 && updated !== content) {
        await this.app.vault.modify(note, updated);
        notes++;
        refs += count;
      }
    }

    if (refs > 0) {
      new Notice(
        `✅ 已上传 ${file.name},替换 ${notes} 篇笔记中的 ${refs} 处引用(本地文件已保留)`
      );
    } else {
      await navigator.clipboard.writeText(makeSyntax());
      new Notice(
        `✅ 已上传 ${file.name},未找到引用笔记,云端链接已复制到剪贴板`
      );
    }
  }

  /** 把笔记内容中所有指向 target 的本地链接替换为云端语法,返回新内容与替换次数 */
  private replaceRefsInContent(
    content: string,
    sourcePath: string,
    target: TFile,
    makeSyntax: (alt?: string) => string
  ): { content: string; count: number } {
    const re =
      /!?\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]|!?\[([^\]]*)\]\(([^)]+?)\)/g;
    const replacements = new Map<string, string | undefined>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const isWiki = m[1] !== undefined;
      const path = (isWiki ? m[1] : m[4])?.trim();
      if (!path || /^https?:\/\//i.test(path)) continue;
      let decoded = path.replace(/^<|>$/g, "");
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        /* 保留原样 */
      }
      const dest = this.app.metadataCache.getFirstLinkpathDest(
        decoded,
        sourcePath
      );
      if (dest?.path !== target.path) continue;
      if (!replacements.has(m[0])) {
        replacements.set(m[0], isWiki ? m[2] || undefined : m[3] || undefined);
      }
    }
    let result = content;
    let count = 0;
    for (const [whole, alt] of replacements) {
      const parts = result.split(whole);
      count += parts.length - 1;
      result = parts.join(makeSyntax(alt));
    }
    return { content: result, count };
  }
}
