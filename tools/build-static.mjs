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
import crypto from "node:crypto";
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

/* Every file the page's code asks for by name gets a name that changes with
its contents, as esbuild's chunks already have: a browser that has cached
some of the last version's files can then never mix them with this
version's (a page and workers from different versions can wait on each
other for ever). Only index.html keeps its name, and it names all the rest. */
const hashOf = (data) => crypto.createHash("sha256").update(data).digest("hex").slice(0, 8).toUpperCase();
const jsFiles = () => fs.readdirSync(JS).filter((n) => n.endsWith(".js"));

/** Replace `from` with `to` in the named .js files in js/, saying if it
wasn't in exactly `count` of them. */
function renameIn(names, from, to, count) {
  let found = 0;
  for (const n of names) {
    const file = path.join(JS, n);
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes(from)) continue;
    fs.writeFileSync(file, text.split(from).join(to));
    found++;
  }
  if (found !== count) throw new Error(`expected ${from} in ${count} of the bundle's files, found it in ${found}`);
}

/** Give js/NAME.js (and its source map) a name with its contents' hash in
it; returns the new name. */
function hashName(name) {
  const file = path.join(JS, `${name}.js`);
  const hashed = `${name}-${hashOf(fs.readFileSync(file))}`;
  fs.writeFileSync(path.join(JS, `${hashed}.js`),
    fs.readFileSync(file, "utf8").replace(`sourceMappingURL=${name}.js.map`, `sourceMappingURL=${hashed}.js.map`));
  fs.renameSync(path.join(JS, `${name}.js.map`), path.join(JS, `${hashed}.js.map`));
  fs.rmSync(file);
  return `${hashed}.js`;
}

// manifold's WebAssembly, found next to the script that loads it (whose own
// name already changes with manifold's version).
const wasm = fs.readFileSync(path.join(ROOT, "node_modules", "manifold-3d", "manifold.wasm"));
const wasmName = `manifold-${hashOf(wasm)}.wasm`;
fs.writeFileSync(path.join(JS, wasmName), wasm);
renameIn(jsFiles(), `"manifold.wasm"`, `"${wasmName}"`, 1);

// The workers (named in app.js), then app.js itself (named in the page).
for (const worker of ["engine-worker", "build-worker"]) {
  renameIn(["app.js"], `"./${worker}.js"`, `"./${hashName(worker)}"`, 1);
}
const appName = hashName("app");
const css = fs.readFileSync(path.join(ROOT, "public", "style.css"));
const cssName = `style-${hashOf(css)}.css`;
fs.writeFileSync(path.join(OUT, cssName), css);

// The page: the Node version's, without the import map (it's all bundled).
let page = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8")
  .replace(/<script type="importmap">[\s\S]*?<\/script>\n/, "");
for (const [from, to] of [[`src="js/app.js"`, `src="js/${appName}"`], [`href="style.css"`, `href="${cssName}"`]]) {
  if (!page.includes(from)) throw new Error(`index.html has no ${from}`);
  page = page.replace(from, to);
}
fs.writeFileSync(path.join(OUT, "index.html"), page);
fs.copyFileSync(path.join(ROOT, "public", "favicon.svg"), path.join(OUT, "favicon.svg"));
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
