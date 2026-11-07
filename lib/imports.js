/* Bringing designs, pictures and subassemblies into the thingmaker folder
from elsewhere on the computer. The web version can only see the folder it's
been given, so anything else a design uses has to be copied in - and the
design made to name the copies, relative to the folder, so it finds them from
then on (and on any other computer, in any version).

The files come in as bytes (the web page reads them from wherever the person
picks them); these put them in the folder, without replacing anything that's
there unless asked to. */
import * as files from "#files";
import * as catalogue from "./catalogue.js";
import { Design, FORMAT } from "./design.js";
import * as subassemblies from "./subassemblies.js";

function same(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A file name with nothing in it that can't be in one (no folders). */
export function cleanName(name, fallback = "file") {
  return files.basename(String(name || "").replace(/\\/g, "/")).replace(/[^A-Za-z0-9_. -]/g, "_") || fallback;
}

/** Keep `bytes` in folder `dir` as `name`, without replacing a different
file: if one's there already, the same file is used as it is, and a
different one keeps its name and this goes in as name_2 (_3 ...). Returns
its path. */
export function keepFile(dir, name, bytes) {
  const clean = cleanName(name);
  const ext = files.extname(clean);
  files.mkdir(dir);
  let file = files.join(dir, clean);
  for (let n = 2; files.exists(file); n++) {
    if (files.isFile(file) && same(files.readFile(file), bytes)) return file;
    file = files.join(dir, `${files.basename(clean, ext)}_${n}${ext}`);
  }
  files.writeFile(file, bytes);
  return file;
}

/** A design file's text, read: its dict. Throws if it isn't a design. */
export function readDesign(text) {
  let dict;
  try {
    dict = JSON.parse(text);
  } catch (e) {
    throw new Error(`it isn't a design file (${e.message})`);
  }
  if (!dict || dict.format !== FORMAT) throw new Error("it isn't a thingmaker design file");
  return dict;
}

/** Every picture a design (a dict) names, once each. */
export function picturesOf(dict) {
  const out = [];
  for (const kase of dict.cases || []) {
    for (const layers of Object.values(kase.decorations || {})) {
      const file = layers && layers.image && layers.image.file;
      if (file && !out.includes(file)) out.push(file);
    }
  }
  return out;
}

/** The devices and subassemblies a design (a dict) places that aren't in
the catalogue - subassemblies that haven't been brought in. */
export function missingTypes(dict) {
  const out = [];
  for (const p of [...(dict.devices || []), ...(dict.subassemblies || [])]) {
    if (p && p.type && !(p.type in catalogue.CATALOG) && !out.includes(p.type)) out.push(p.type);
  }
  return out;
}

/** What a design needs from outside the folder: {pictures: [{file, found}]
- found being where it is in the folder, or null - and types: the
subassemblies it uses that aren't there}. */
export function needs(dict) {
  return {
    pictures: picturesOf(dict).map((file) => {
      const at = files.locate(file);
      return { file, found: files.isFile(at) ? files.storedPath(at) : null };
    }),
    types: missingTypes(dict),
  };
}

/** The name a subassembly's files ({relative path: bytes}) give it. */
export function subassemblyName(contents, fallback = "") {
  const specBytes = contents[subassemblies.SPEC_FILE];
  if (!specBytes) throw new Error(`there's no ${subassemblies.SPEC_FILE} in it - it isn't a subassembly folder`);
  let spec;
  try {
    spec = JSON.parse(new TextDecoder().decode(specBytes));
  } catch (e) {
    throw new Error(`its ${subassemblies.SPEC_FILE} can't be read (${e.message})`);
  }
  if (spec.format !== subassemblies.SPEC_FORMAT) throw new Error(`its ${subassemblies.SPEC_FILE} isn't a thingmaker subassembly file`);
  const name = spec.name || fallback;
  if (!subassemblies.NAME_PATTERN.test(name)) {
    throw new Error(`its name, ${JSON.stringify(name)}, must be a letter followed by letters, digits or _`);
  }
  return name;
}

/** Copy a subassembly - its folder's files, {relative path: bytes} - into
subassemblies/<its name>/. `fallback` names it if its subassembly.json
doesn't. Returns {name, status}: "added"; "same" (it's there already, file
for file); "different" (one of that name is there, and isn't the same - it's
left as it was, unless `replace`, when it's "replaced"). The catalogue is
reloaded if it's changed. */
export function importSubassembly(where, contents, { fallback = "", replace = false } = {}) {
  const name = subassemblyName(contents, fallback);
  for (const rel of Object.keys(contents)) {
    if (!rel || /^[\\/]|^[A-Za-z]:|(^|[\\/])\.\.([\\/]|$)/.test(rel)) throw new Error(`${rel} isn't a file in its folder`);
  }
  if (name in catalogue.CATALOG && !(catalogue.CATALOG[name].prototype instanceof subassemblies.Subassembly)) {
    throw new Error(`${name} is the name of a built-in device`);
  }
  const folder = files.join(where.subassemblies, name);
  const there = files.isFile(files.join(folder, subassemblies.SPEC_FILE));
  if (there) {
    const unchanged = Object.entries(contents).every(([rel, bytes]) => {
      const file = files.join(folder, rel);
      return files.isFile(file) && same(files.readFile(file), bytes);
    });
    if (unchanged) return { name, status: "same" };
    if (!replace) return { name, status: "different" };
  }
  const old = {};
  for (const rel of Object.keys(contents)) {
    const file = files.join(folder, rel);
    if (files.isFile(file)) old[rel] = files.readFile(file);
  }
  for (const [rel, bytes] of Object.entries(contents)) {
    files.mkdir(files.dirname(files.join(folder, rel)));
    files.writeFile(files.join(folder, rel), bytes);
  }
  try {
    subassemblies.loadSubassemblyFolder(folder);
  } catch (e) {
    // Put things back as they were.
    for (const rel of Object.keys(contents)) {
      const file = files.join(folder, rel);
      if (rel in old) files.writeFile(file, old[rel]);
      else files.unlink(file);
    }
    throw new Error(`${name} can't be used: ${e.message}`);
  }
  catalogue.reload(where.subassemblies);
  return { name, status: there ? "replaced" : "added" };
}

/** Bring a design (a dict) into designs/, as `name` (a file name; not
replacing another design - it's name_2 if there is one). `pictures`:
{file the design names: {name, bytes}} for pictures from elsewhere, which
go in images/. Every picture the design names is then named relative to the
folder - those found in it already too. Returns the design file's path. */
export function importDesign(where, dict, { name = "", pictures = {} } = {}) {
  dict = JSON.parse(JSON.stringify(dict));
  for (const kase of dict.cases || []) {
    for (const layers of Object.values(kase.decorations || {})) {
      const image = layers && layers.image;
      if (!image || !image.file) continue;
      const given = pictures[image.file];
      if (given) image.file = files.storedPath(keepFile(where.images, given.name, given.bytes));
      else {
        const at = files.locate(image.file);
        if (files.isFile(at)) image.file = files.storedPath(at);
      }
    }
  }
  const design = Design.from_dict(dict);
  let base = cleanName(name, "design").replace(/\.json$/i, "");
  if (!base || base === ".") base = "design";
  files.mkdir(where.designs);
  let file = files.join(where.designs, `${base}.json`);
  for (let n = 2; files.exists(file); n++) file = files.join(where.designs, `${base}_${n}.json`);
  design.save(file);
  return file;
}
