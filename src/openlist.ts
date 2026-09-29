/**
 * OpenList API 客户端。
 * 不依赖 obsidian 模块:HTTP 请求通过注入的 request 函数发出,
 * 便于在 Node 环境下做冒烟测试。
 */

export interface HttpRequest {
  (req: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
  }): Promise<{ status: number; text: string }>;
}

export type AuthMode = "token" | "password";

export interface OpenListConfig {
  serverUrl: string;
  authMode: AuthMode;
  token: string;
  username: string;
  password: string;
}

interface ApiResult {
  code: number;
  message: string;
  data?: unknown;
}

/** 逐段 encodeURIComponent,保留路径中的斜杠 */
export function encodePath(remotePath: string): string {
  return remotePath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export class OpenListClient {
  private token: string;

  constructor(
    private config: OpenListConfig,
    private request: HttpRequest
  ) {
    this.token = config.authMode === "token" ? config.token.trim() : "";
  }

  get base(): string {
    return this.config.serverUrl.replace(/\/+$/, "");
  }

  /** 密码模式下登录换取令牌;令牌模式直接返回 */
  async ensureToken(): Promise<void> {
    if (this.token) return;
    if (!this.config.username || !this.config.password) {
      throw new Error("未配置账号密码,无法登录");
    }
    const resp = await this.request({
      url: `${this.base}/api/auth/login`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
      }),
    });
    const data = this.parse(resp.text);
    if (resp.status === 200 && data.code === 200) {
      const token = (data.data as { token?: string } | undefined)?.token;
      if (token) {
        this.token = token;
        return;
      }
    }
    throw new Error(`登录失败: ${data.message || `HTTP ${resp.status}`}`);
  }

  /** 上传文件到远程路径(如 /189Cloud/test/a.png)。密码模式遇 401 自动重登重试一次 */
  async upload(remotePath: string, data: ArrayBuffer): Promise<void> {
    await this.uploadOnce(remotePath, data, true);
  }

  private async uploadOnce(
    remotePath: string,
    data: ArrayBuffer,
    canRetry: boolean
  ): Promise<void> {
    await this.ensureToken();
    const resp = await this.request({
      url: `${this.base}/api/fs/put`,
      method: "PUT",
      headers: {
        Authorization: this.token,
        // File-Path 需要整段 URL 编码(含斜杠)
        "File-Path": encodeURIComponent(remotePath),
        "Content-Type": "application/octet-stream",
        "As-Task": "false",
      },
      body: data,
    });
    if (
      resp.status === 401 &&
      canRetry &&
      this.config.authMode === "password"
    ) {
      this.token = "";
      return this.uploadOnce(remotePath, data, false);
    }
    const parsed = this.parse(resp.text);
    if (resp.status !== 200 || parsed.code !== 200) {
      throw new Error(parsed.message || `HTTP ${resp.status}`);
    }
  }

  /** 连接测试:列出目录,返回条目数 */
  async testConnection(remoteDir: string): Promise<number> {
    await this.ensureToken();
    const resp = await this.request({
      url: `${this.base}/api/fs/list`,
      method: "POST",
      headers: {
        Authorization: this.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: remoteDir, page: 1, per_page: 1 }),
    });
    const parsed = this.parse(resp.text);
    if (resp.status !== 200 || parsed.code !== 200) {
      throw new Error(parsed.message || `HTTP ${resp.status}`);
    }
    const data = parsed.data as { total?: number } | undefined;
    return data?.total ?? 0;
  }

  /** 稳定直链(/d/ 路径,每次访问 302 到新鲜签名地址,永久有效) */
  directLink(remotePath: string): string {
    return `${this.base}/d${encodePath(remotePath)}`;
  }

  /** OpenList 预览页链接(站点自带 PDF.js 等预览,适合给人在线查看) */
  previewLink(remotePath: string): string {
    return `${this.base}${encodePath(remotePath)}`;
  }

  private parse(text: string): ApiResult {
    try {
      return JSON.parse(text) as ApiResult;
    } catch {
      return { code: -1, message: text.slice(0, 200) || "响应不是 JSON" };
    }
  }
}
