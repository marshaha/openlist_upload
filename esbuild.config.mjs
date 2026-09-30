import esbuild from "esbuild";
import process from "process";
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

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  loader: { ".txt": "text" },
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
