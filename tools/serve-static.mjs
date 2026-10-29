#!/usr/bin/env node
/* Serve the built web version (site/) on this computer, to try it before
publishing it: a plain static file server, as GitHub Pages is.

    node tools/serve-static.mjs [FOLDER] [--port 8600]

Then open http://localhost:8600/ in Chrome or Edge. (Folders can only be
opened from a secure page: https://, or localhost.) */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const portAt = args.indexOf("--port");
const port = portAt >= 0 ? Number(args[portAt + 1]) : 8600;
const folder = path.resolve(args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port") || path.join(ROOT, "site"));
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".map": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".bmp": "image/bmp",
};

if (!fs.existsSync(path.join(folder, "index.html"))) {
  process.stderr.write(`There's no web version in ${folder} - build it with npm run build:static\n`);
  process.exit(1);
}
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(folder, p);
  if (!path.resolve(file).startsWith(folder + path.sep)) {
    res.writeHead(404);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, "127.0.0.1", () => process.stdout.write(`The web version is at http://localhost:${port}/ (Ctrl+C to stop)\n`));
