import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";

const banner = `/* OpenList Attach - upload attachments to OpenList */`;

const prod = process.argv[2] === "production";

// node:module 内置列表,同时覆盖 "path" 与 "node:path" 两种引用形式
const builtins = builtinModules.flatMap((m) =>
  m.startsWith("node:") ? [m] : [m, `node:${m}`]
);

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
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
