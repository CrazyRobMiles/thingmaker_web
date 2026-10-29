#!/usr/bin/env node
/* Build the web version: a static site (site/ unless given another folder)
that runs thingmaker entirely in the browser - for GitHub Pages or any other
static web server. It needs Chrome or Edge, which can work in a folder on
the computer they run on (see static/).

    node tools/build-static.mjs [OUTPUT_FOLDER]

The editor page is the Node version's (public/), with static/api.js in place
of public/js/api.js; the design model, builder and the rest are lib/, using
lib/files-browser.js for files. The example designs, subassemblies and
pictures go in examples/, for setting up an empty folder with, and the fonts
in fonts/ (free ones, standing in for Windows') in fonts/, for the web
version to use as well as the folder's own. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "site"));
const JS = path.join(OUT, "js");

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(JS, { recursive: true });

// The editor's own imports that differ in the web version.
const swap = {
  name: "thingmaker-web",
  setup(build) {
    build.onResolve({ filter: /^\.\/api\.js$/ }, (args) =>
      (args.importer.startsWith(path.join(ROOT, "public")) ? { path: path.join(ROOT, "static", "api.js") } : undefined));
    build.onResolve({ filter: /^\/lib\// }, (args) => ({ path: path.join(ROOT, args.path) }));
  },
};

const result = await esbuild.build({
  entryPoints: {
    app: path.join(ROOT, "public", "js", "app.js"),
    "engine-worker": path.join(ROOT, "static", "engine-worker.js"),
    "build-worker": path.join(ROOT, "static", "build-worker.js"),
  },
  outdir: JS,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: ["chrome110", "edge110"],
  // manifold-3d only reaches for these when it's running in Node.
  external: ["node:*"],
  plugins: [swap],
  minify: true,
  sourcemap: true,
  metafile: true,
  logLevel: "warning",
});

// manifold's WebAssembly, found next to the script that loads it.
fs.copyFileSync(path.join(ROOT, "node_modules", "manifold-3d", "manifold.wasm"), path.join(JS, "manifold.wasm"));

// The page: the Node version's, without the import map (it's all bundled).
const page = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8")
  .replace(/<script type="importmap">[\s\S]*?<\/script>\n/, "");
fs.writeFileSync(path.join(OUT, "index.html"), page);
for (const name of ["style.css", "favicon.svg"]) fs.copyFileSync(path.join(ROOT, "public", name), path.join(OUT, name));
// (GitHub Pages otherwise runs the site through Jekyll.)
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

// The examples, and a list of them.
const examples = path.join(OUT, "examples");
const listed = [];
function copy(from, rel) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const r = `${rel}/${entry.name}`;
    if (entry.isDirectory()) copy(src, r);
    else {
      fs.mkdirSync(path.join(examples, rel), { recursive: true });
      fs.copyFileSync(src, path.join(examples, r));
      listed.push(r);
    }
  }
}
for (const folder of ["designs", "subassemblies", "images"]) if (fs.existsSync(path.join(ROOT, folder))) copy(path.join(ROOT, folder), folder);
fs.writeFileSync(path.join(examples, "files.json"), JSON.stringify(listed, null, 1));

// The fonts (and their licences), and a list of them.
const fontsIn = path.join(ROOT, "fonts");
const inFonts = fs.existsSync(fontsIn) ? fs.readdirSync(fontsIn).sort() : [];
const fonts = inFonts.filter((n) => /\.(ttf|otf)$/i.test(n));
fs.mkdirSync(path.join(OUT, "fonts"), { recursive: true });
for (const name of inFonts.filter((n) => /\.(ttf|otf)$|^licen[cs]e/i.test(n))) fs.copyFileSync(path.join(fontsIn, name), path.join(OUT, "fonts", name));
fs.writeFileSync(path.join(OUT, "fonts", "files.json"), JSON.stringify(fonts, null, 1));

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) =>
  n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
process.stdout.write(`Built the web version in ${OUT} (${(size(OUT) / 1e6).toFixed(1)} MB, ` +
  `${listed.length} example files, ${fonts.length} fonts)\n`);
if (result.warnings.length) process.stdout.write(`${result.warnings.length} warning(s)\n`);
