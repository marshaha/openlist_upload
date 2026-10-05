/**
 * 本地文档预览:PDF 用 pdfjs-dist 渲染,DOCX 用 docx-preview
 * 还原排版,XLS/XLSX 用 SheetJS 转 HTML。查看器代码全部随插件打包,
 * 文件字节仅在 OpenList 服务器与 Obsidian 之间流动,不经过第三方服务。
 */
import { App, Modal, requestUrl, sanitizeHTMLToDom } from "obsidian";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import viewerCss from "pdfjs-dist/web/pdf_viewer.css";
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
  // pdfjs v6 的 worker 是 ES Module,必须以 module 类型创建,
  // 经典 Worker 无法解析 export 语句,会导致渲染无声卡死(白屏)
  pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(
    URL.createObjectURL(blob),
    { type: "module" }
  );
  workerReady = true;
}

let viewerCssReady = false;
function injectViewerCss(): void {
  if (viewerCssReady) return;
  const style = document.createElement("style");
  style.textContent = viewerCss;
  document.head.appendChild(style);
  viewerCssReady = true;
}

/** PDF.js 查看器组件:连续滚动、按需渲染、文本可选,带翻页/缩放工具栏 */
async function renderPdf(el: HTMLElement, buf: ArrayBuffer): Promise<void> {
  ensurePdfWorker();
  injectViewerCss();

  const toolbar = el.createDiv("openlist-pdf-toolbar");
  // PDFViewer 要求容器绝对定位:relative 外壳定尺寸,absolute 容器填滚
  const wrapper = el.createDiv("openlist-pdf-wrapper");
  const container = wrapper.createDiv("openlist-pdf-container");
  container.createDiv("pdfViewer");

  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const viewer = new PDFViewer({
    container,
    eventBus,
    linkService,
    textLayerMode: 1,
  });
  linkService.setViewer(viewer);

  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) })
    .promise;

  const mkBtn = (text: string, tooltip: string, onClick: () => void) => {
    const b = toolbar.createEl("button", { text });
    b.setAttribute("aria-label", tooltip);
    b.addEventListener("click", onClick);
    return b;
  };
  mkBtn("‹", "上一页", () => {
    viewer.currentPageNumber = Math.max(1, viewer.currentPageNumber - 1);
  });
  const pageLabel = toolbar.createSpan("openlist-pdf-page");
  pageLabel.setText(`1 / ${doc.numPages}`);
  mkBtn("›", "下一页", () => {
    viewer.currentPageNumber = Math.min(
      doc.numPages,
      viewer.currentPageNumber + 1
    );
  });
  mkBtn("−", "缩小", () => {
    viewer.currentScaleValue = String(
      Math.max(0.25, viewer.currentScale * 0.8)
    );
  });
  mkBtn("＋", "放大", () => {
    viewer.currentScaleValue = String(viewer.currentScale * 1.25);
  });
  mkBtn("适宽", "适合宽度", () => {
    viewer.currentScaleValue = "page-width";
  });

  eventBus.on("pagechanging", (e: { pageNumber: number }) => {
    pageLabel.setText(`${e.pageNumber} / ${doc.numPages}`);
  });

  viewer.setDocument(doc);
  linkService.setDocument(doc, null);
  viewer.currentScaleValue = "page-width";
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const resp = await requestUrl({ url, throw: false });
  if (resp.status !== 200) {
    throw new Error(`下载失败 HTTP ${resp.status}`);
  }
  return resp.arrayBuffer;
}

// 阅读模式后处理器会频繁重跑,缓存文件字节避免重复下载
const byteCache = new Map<string, ArrayBuffer>();
const BYTE_CACHE_MAX = 10;

async function fetchBytesCached(url: string): Promise<ArrayBuffer> {
  const hit = byteCache.get(url);
  if (hit) return hit;
  const buf = await fetchBytes(url);
  if (byteCache.size >= BYTE_CACHE_MAX) {
    const oldest = byteCache.keys().next().value;
    if (oldest !== undefined) byteCache.delete(oldest);
  }
  byteCache.set(url, buf);
  return buf;
}

/** 供阅读模式后处理器调用:把云端文档原地渲染进容器 */
export async function renderInlineDoc(
  el: HTMLElement,
  url: string,
  kind: PreviewKind
): Promise<void> {
  try {
    const cached = await fetchBytesCached(url);
    // pdf.js 会把传入的 buffer transfer 给 worker(原 buffer 被 detach),
    // 缓存只存原件,每次渲染用拷贝
    const buf = cached.slice(0);
    // 后处理器可能已重跑并替换掉本容器,避免向已脱离 DOM 的节点渲染
    if (!el.isConnected) return;
    el.empty();
    if (kind === "pdf") await renderPdf(el, buf);
    else if (kind === "docx") await renderDocx(el, buf);
    else if (kind === "pptx") await renderPptx(el, buf);
    else await renderXlsx(el, buf);
  } catch (e) {
    el.setText(`预览失败: ${(e as Error).message}`);
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
    void renderInlineDoc(body, this.url, this.kind);
  }
}
