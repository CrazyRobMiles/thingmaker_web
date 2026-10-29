/* File access for Node: the files and folders on this computer, through
node:fs and node:path. lib/files-browser.js offers the same functions in a
web page, on the folder it's been given. The rest of thingmaker imports
"#files" and gets whichever suits where it's running (see package.json's
"imports"). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const sep = path.sep;
export const join = path.join;
export const dirname = path.dirname;
export const basename = path.basename;
export const extname = path.extname;
export const resolve = path.resolve;
export const relative = path.relative;
export const isAbsolute = path.isAbsolute;

/** The thingmaker folder: designs/, output/, subassemblies/ ... */
export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function env(name) {
  return process.env[name];
}

export function homedir() {
  return os.homedir();
}

/** {mtimeMs, size, file, dir} of a path, or null if there's nothing there. */
export function stat(p) {
  try {
    const s = fs.statSync(p);
    return { mtimeMs: s.mtimeMs, size: s.size, file: s.isFile(), dir: s.isDirectory() };
  } catch (e) {
    return null;
  }
}

export function exists(p) {
  return stat(p) !== null;
}

export function isFile(p) {
  return Boolean(stat(p)?.file);
}

export function isDir(p) {
  return Boolean(stat(p)?.dir);
}

/** A file's bytes (a Uint8Array). */
export function readFile(p) {
  return fs.readFileSync(p);
}

export function readText(p) {
  return fs.readFileSync(p, "utf8");
}

/** [{name, dir}] of what's in a folder. */
export function readdir(p) {
  return fs.readdirSync(p, { withFileTypes: true }).map((e) => {
    let dir = e.isDirectory();
    if (e.isSymbolicLink()) dir = isDir(path.join(p, e.name));
    return { name: e.name, dir };
  });
}

/** Write bytes or text (as UTF-8). */
export function writeFile(p, data) {
  fs.writeFileSync(p, data);
}

export function mkdir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function unlink(p) {
  fs.unlinkSync(p);
}

/** Folders to look for fonts in: the system's, then the thingmaker folder's fonts/. */
export function fontDirs() {
  return [
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Windows", "Fonts"),
    "/usr/share/fonts", "/usr/local/share/fonts", path.join(os.homedir(), ".fonts"),
    path.join(os.homedir(), ".local/share/fonts"), "/System/Library/Fonts", "/Library/Fonts",
    path.join(os.homedir(), "Library/Fonts"),
    path.join(root, "fonts"),
  ];
}

/** Where a design's picture is. Here, exactly where the design says, as
the Python thingmaker looks for it. */
export function locate(p) {
  return p;
}
