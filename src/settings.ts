import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type OpenListAttachPlugin from "./main";

export type LinkType = "direct" | "preview";
export type ConflictStrategy = "keep" | "timestamp";

export interface OpenListAttachSettings {
  serverUrl: string;
  authMode: "token" | "password";
  token: string;
  username: string;
  password: string;
  remoteDir: string;
  /** 粘贴/拖拽时自动上传;关闭则走 Obsidian 默认(存入本地库) */
  autoUpload: boolean;
  /** 逗号分隔的扩展名(不带点),留空表示不限制 */
  allowedExts: string;
  conflictStrategy: ConflictStrategy;
  linkType: LinkType;
}

export const DEFAULT_SETTINGS: OpenListAttachSettings = {
  serverUrl: "",
  authMode: "token",
  token: "",
  username: "",
  password: "",
  remoteDir: "/189Cloud/test",
  autoUpload: true,
  allowedExts: "",
  conflictStrategy: "timestamp",
  linkType: "direct",
};

export function normalizeDir(dir: string): string {
  let d = dir.trim().replace(/\/+$/, "");
  if (!d) d = "/";
  if (!d.startsWith("/")) d = "/" + d;
  return d;
}

/** 解析类型过滤设置;返回 null 表示不限制 */
export function parseAllowedExts(raw: string): Set<string> | null {
  const exts = raw
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^\./, "").toLowerCase())
    .filter((s) => s.length > 0);
  return exts.length > 0 ? new Set(exts) : null;
}

export class OpenListSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: OpenListAttachPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName("服务器地址")
      .setDesc("OpenList 站点地址,不带末尾斜杠")
      .addText((text) =>
        text
          .setPlaceholder("https://alist.example.com")
          .setValue(s.serverUrl)
          .onChange(async (value) => {
            s.serverUrl = value.trim().replace(/\/+$/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("认证方式")
      .setDesc("API 令牌在 OpenList 后台「个人资料」中生成;账号密码会自动登录换取令牌")
      .addDropdown((drop) =>
        drop
          .addOption("token", "API 令牌")
          .addOption("password", "账号密码")
          .setValue(s.authMode)
          .onChange(async (value) => {
            s.authMode = value as "token" | "password";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (s.authMode === "token") {
      new Setting(containerEl)
        .setName("API 令牌")
        .setDesc("形如 openlist-xxxxxxxx-xxxx-…")
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setPlaceholder("openlist-…")
            .setValue(s.token)
            .onChange(async (value) => {
              s.token = value.trim();
              await this.plugin.saveSettings();
            });
        });
    } else {
      new Setting(containerEl).setName("用户名").addText((text) =>
        text
          .setPlaceholder("admin")
          .setValue(s.username)
          .onChange(async (value) => {
            s.username = value.trim();
            await this.plugin.saveSettings();
          })
      );
      new Setting(containerEl).setName("密码").addText((text) => {
        text.inputEl.type = "password";
        text.setValue(s.password).onChange(async (value) => {
          s.password = value;
          await this.plugin.saveSettings();
        });
      });
    }

    new Setting(containerEl)
      .setName("远程目录")
      .setDesc("附件上传到该目录,如 /189Cloud/test")
      .addText((text) =>
        text
          .setPlaceholder("/189Cloud/test")
          .setValue(s.remoteDir)
          .onChange(async (value) => {
            s.remoteDir = normalizeDir(value);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("粘贴/拖拽自动上传")
      .setDesc("开启:先插入本地链接即时预览,后台上传成功后自动替换为云端链接;关闭:走 Obsidian 默认行为(仅存本地,可用右键或命令手动上传)")
      .addToggle((toggle) =>
        toggle.setValue(s.autoUpload).onChange(async (value) => {
          s.autoUpload = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("允许的文件类型")
      .setDesc("逗号分隔的扩展名,如 png,jpg,pdf,mp4。留空不限制")
      .addText((text) =>
        text
          .setPlaceholder("留空不限制")
          .setValue(s.allowedExts)
          .onChange(async (value) => {
            s.allowedExts = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("重名文件")
      .setDesc("加时间戳可避免覆盖云端同名文件")
      .addDropdown((drop) =>
        drop
          .addOption("timestamp", "自动加时间戳(推荐)")
          .addOption("keep", "保留原名(覆盖同名文件,直链不变)")
          .setValue(s.conflictStrategy)
          .onChange(async (value) => {
            s.conflictStrategy = value as ConflictStrategy;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("非图片链接格式")
      .setDesc(
        "直链:点击即下载;预览页:在 OpenList 站点内在线预览(PDF/视频推荐)。图片始终使用直链以保证笔记内联显示"
      )
      .addDropdown((drop) =>
        drop
          .addOption("direct", "直链 (/d/ 路径)")
          .addOption("preview", "预览页 (OpenList 站点)")
          .setValue(s.linkType)
          .onChange(async (value) => {
            s.linkType = value as LinkType;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("验证服务器、认证与远程目录是否可用")
      .addButton((btn) =>
        btn
          .setButtonText("测试")
          .setCta()
          .onClick(async () => {
            btn.setButtonText("测试中…").setDisabled(true);
            try {
              const total = await this.plugin.testConnection();
              new Notice(`✅ 连接成功,远程目录共 ${total} 个条目`);
            } catch (e) {
              new Notice(`❌ 连接失败: ${(e as Error).message}`, 6000);
            } finally {
              btn.setButtonText("测试").setDisabled(false);
            }
          })
      );
  }
}
