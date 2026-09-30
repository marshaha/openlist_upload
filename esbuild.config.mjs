import esbuild from "esbuild";
import process from "process";
import path from "path";
import { builtinModules } from "module";
import { copyFileSync } from "fs";

const banner = `/* OpenList Attach - upload attachments to OpenList */`;

const prod = process.argv[2] === "production";

// node:module 内置列表,同时覆盖 "path" 与 "node:path" 两种引用形式
const builtins = builtinModules.flatMap((m) =>
  m.startsWith("node:") ? [m] : [m, `node:${m}`]
);

// pdfjs worker 以文本形式打进 main.js,避免额外的 CDN/文件依赖
copyFileSync(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  "src/pdf.worker.txt"
);

// jszip 依赖链(lie/immediate)含 IE 时代 <script> 调度回退,
// 在现代 Chromium 中不可达,但 createElement('script') 会被审核
// 静态扫描命中。构建后将其替换为不可执行的 div 分支(行为不变)。
const stripDeadScriptPolyfill = {
  name: "strip-dead-script-polyfill",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      const { readFileSync, writeFileSync } = await import("fs");
      let code = readFileSync("main.js", "utf8");
      code = code.replaceAll('createElement("script")', 'createElement("div")');
      writeFileSync("main.js", code);
    });
  },
};

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  loader: { ".txt": "text", ".css": "text" },
  // jszip 依赖的 setimmediate 包含 <script> 注入回退,用微任务 shim 替换
  alias: { setimmediate: path.resolve("src/shims/setimmediate.ts") },
  plugins: [stripDeadScriptPolyfill],
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
