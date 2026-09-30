/**
 * 本地文档预览:PDF 用 pdfjs-dist 渲染,DOCX 用 docx-preview
 * 还原排版,XLS/XLSX 用 SheetJS 转 HTML。查看器代码全部随插件打包,
 * 文件字节仅在 OpenList 服务器与 Obsidian 之间流动,不经过第三方服务。
 */
import { App, Modal, requestUrl, sanitizeHTMLToDom } from "obsidian";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderAsync as renderDocxAsync } from "docx-preview";
import { init as initPptxPreview } from "pptx-preview";
import * as XLSX from "xlsx";
import workerRaw from "./pdf.worker.txt";

export type PreviewKind = "pdf" | "docx" | "xlsx" | "pptx";

/** 判断 URL 是否为可本地预览的文档类型 */
export function previewKindOf(url: string): PreviewKind | null {
  let path = url.split("?")[0].split("#")[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    /* 保留原样 */
  }
  const i = path.lastIndexOf(".");
  if (i < 0) return null;
  const ext = path.slice(i + 1).toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "xls" || ext === "xlsx") return "xlsx";
  if (ext === "pptx") return "pptx";
  return null;
}

let workerReady = false;
function ensurePdfWorker(): void {
  if (workerReady) return;
  const blob = new Blob([workerRaw], { type: "text/javascript" });
  pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(
    URL.createObjectURL(blob)
  );
  workerReady = true;
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const resp = await requestUrl({ url, throw: false });
  if (resp.status !== 200) {
    throw new Error(`下载失败 HTTP ${resp.status}`);
  }
  return resp.arrayBuffer;
}

async function renderPdf(el: HTMLElement, buf: ArrayBuffer): Promise<void> {
  ensurePdfWorker();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) })
    .promise;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = el.createEl("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  }
}

async function renderDocx(el: HTMLElement, buf: ArrayBuffer): Promise<void> {
  // docx-preview 直接向容器内渲染,保留原文档排版/表格/图片
  await renderDocxAsync(buf, el, undefined, {
    className: "openlist-docx",
    inWrapper: true,
  });
}

async function renderXlsx(el: HTMLElement, buf: ArrayBuffer): Promise<void> {
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  for (const name of wb.SheetNames) {
    el.createEl("h4", { text: name });
    const holder = el.createDiv();
    holder.appendChild(
      sanitizeHTMLToDom(XLSX.utils.sheet_to_html(wb.Sheets[name]))
    );
  }
}

async function renderPptx(el: HTMLElement, buf: ArrayBuffer): Promise<void> {
  const holder = el.createDiv("openlist-pptx");
  const previewer = initPptxPreview(holder, {
    width: 960,
    height: 540,
    mode: "list",
  });
  await previewer.preview(buf);
}

export class DocPreviewModal extends Modal {
  constructor(
    app: App,
    private url: string,
    private kind: PreviewKind
  ) {
    super(app);
  }

  onOpen(): void {
    let name = this.url;
    try {
      name = decodeURIComponent(this.url.split("/").pop() ?? this.url);
    } catch {
      /* 保留原样 */
    }
    this.titleEl.setText(name);
    this.modalEl.addClass("openlist-doc-preview");
    const body = this.contentEl.createDiv("openlist-doc-preview-body");
    body.setText("加载中…");
    void (async () => {
      try {
        const buf = await fetchBytes(this.url);
        body.empty();
        if (this.kind === "pdf") await renderPdf(body, buf);
        else if (this.kind === "docx") await renderDocx(body, buf);
        else if (this.kind === "pptx") await renderPptx(body, buf);
        else await renderXlsx(body, buf);
      } catch (e) {
        body.setText(`预览失败: ${(e as Error).message}`);
      }
    })();
  }
}
