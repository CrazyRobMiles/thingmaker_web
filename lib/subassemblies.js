/* Subassemblies: things made from STL files rather than code - a keyboard,
say, or a board that has no built-in device class.

Each one is a folder in subassemblies/ holding a subassembly.json and its
STL files, all drawn in one frame (the mock's):

- the mock: its shape.
- cutouts: openings it needs in the case, each cut exactly as drawn.
- two mountings, each optional - the fixings fused to the surface it's
  fixed to, plus, if wanted, holes cut through that surface:
    "top":        for sitting on top of a surface. The surface is where
                  the fixings end at the bottom (their lowest point).
    "underneath": for hanging underneath a surface, its top side towards
                  it - turned over when placed. The surface is where the
                  fixings end at the top (their highest point).

The folders (and their subassembly.json files) are the same as the Python
thingmaker's, so the two can share a library of them. */
import * as fsys from "#files";
import * as geom from "./geom.js";
import { Box3 } from "./geom.js";
import * as meshes from "./meshes.js";
import * as stl from "./stl.js";
import { classAttrs, Connector, Device, BUILT_IN } from "./devices.js";
import { dumps, repr } from "./py.js";

// The thingmaker folder (in a web page, the folder it's been given).
export const REPO_ROOT = fsys.root;
// The repository's subassemblies/ folder, unless THINGMAKER_SUBASSEMBLIES
// points somewhere else (a library kept outside the repository, say).
export const SUBASSEMBLIES_DIR = fsys.env("THINGMAKER_SUBASSEMBLIES") || fsys.join(REPO_ROOT, "subassemblies");
export const SPEC_FILE = "subassembly.json";
export const SPEC_FORMAT = "thingmaker-subassembly";
export const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
export const MOUNTINGS = ["top", "underneath"];

function unionBounds(bounds) {
  const list = bounds.filter((b) => b);
  const fs_ = [Math.min, Math.max, Math.min, Math.max, Math.min, Math.max];
  return fs_.map((f, i) => f(...list.map((b) => b[i])));
}

function boxArgs(b) {
  return [b[0], b[2], b[4], b[1] - b[0], b[3] - b[2], b[5] - b[4]];
}

/** A subassembly made from a folder in subassemblies/. loadSubassemblyFolder()
makes a subclass of this for each folder; once placed in a design it's
handled exactly like a device. */
export class Subassembly extends Device {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, mounting = "top" } = {}) {
    const cls = new.target;
    if (!MOUNTINGS.includes(mounting)) throw new Error(`mounting must be one of ${MOUNTINGS.join(", ")} (got '${mounting}')`);
    const mount = cls.SPEC.mountings[mounting] || {};
    const fixings = mount.fixings_path || null;
    const holes = mount.holes_path || null;
    const mock = stl.bounds(cls.MOCK);
    const fixingBounds = fixings ? stl.bounds(fixings) : null;
    const meshBounds = unionBounds([mock, fixingBounds]);
    const surfaceZ = mounting === "top" ? (fixingBounds || mock)[4] : (fixingBounds || mock)[5];
    const b = meshBounds;
    super(cls.TYPE_NAME, partName, b[1] - b[0], b[3] - b[2], { xMargin, yMargin, cutHeight: b[5] - b[4] });
    this.mounting = mounting;
    this.fixings = fixings;
    this.holes = holes;
    this.mesh_bounds = meshBounds;
    this.surface_z = surfaceZ;
  }

  mesh_matrix() {
    const b = this.mesh_bounds;
    if (this.mounting === "top") return geom.translate(this.xMargin - b[0], this.yMargin - b[2], -this.surface_z);
    // Turned over about X: y -> -y, z -> -z, then the surface back to z=0.
    return geom.mul(geom.translate(this.xMargin - b[0], this.yMargin + b[3], this.surface_z), geom.rotX(180));
  }

  _mesh_shape(file, x, y) {
    return meshes.transformed(meshes.meshSolid(file), geom.mul(geom.translate(x, y, 0), this.mesh_matrix()));
  }

  get_fuser(x, y, baseHeight) {
    if (!this.fixings) return null;
    // Rooted down through the surface's material, the way pillars are.
    return meshes.rooted(this._mesh_shape(this.fixings, x, y), baseHeight);
  }

  get_cutter(x, y, baseHeight) {
    return this.holes ? this._mesh_shape(this.holes, x, y) : null;
  }

  _box(file, label) {
    const b = new Box3(...boxArgs(stl.bounds(file))).transformedBounds(this.mesh_matrix());
    return new Box3(b[0], b[2], b[4], b[1] - b[0], b[3] - b[2], b[5] - b[4], label);
  }

  body_boxes() {
    // The mock (and its fixings) are the body; cutouts and holes are
    // openings, not parts of it.
    const boxes = [this._box(this.MOCK, "mock")];
    if (this.fixings) boxes.push(this._box(this.fixings, "fixings"));
    return boxes;
  }

  preview_meshes() {
    const m = this.mesh_matrix();
    return [[this.MOCK, m], ...(this.fixings ? [[this.fixings, m]] : [])];
  }
}
classAttrs(Subassembly, {
  DEFAULT_MOUNT: null, // (on top of the surface clicked, or underneath it - see mounting)
  TYPE_NAME: null,
  FOLDER: null,
  MOCK: null,
  SPEC: {},
  PARAMS: {
    mounting: ["top", "How it's fixed to the surface: top = sitting on it, underneath = hanging below it, top side " +
      "towards it", MOUNTINGS],
  },
});

/** A subassembly folder's subassembly.json, checked, with its file names
turned into full paths. */
export function readSpec(folder) {
  const file = fsys.join(folder, SPEC_FILE);
  const spec = JSON.parse(fsys.readText(file));
  if (spec.format !== SPEC_FORMAT) throw new Error(`${file} is not a thingmaker subassembly file`);
  const name = spec.name || fsys.basename(folder);
  if (!NAME_PATTERN.test(name)) throw new Error(`subassembly name ${repr(name)} must be a letter followed by letters, digits or _`);
  spec.name = name;
  if (spec.display_name === undefined) spec.display_name = name;
  if (spec.description === undefined) spec.description = "";
  if (spec.cutouts === undefined) spec.cutouts = [];
  if (spec.mountings === undefined) spec.mountings = {};
  if (!("mock" in spec)) throw new Error(`${file} doesn't name a mock STL`);
  spec.mock_path = fsys.join(folder, spec.mock);
  const seen = new Set();
  for (const cutout of spec.cutouts) {
    if (!NAME_PATTERN.test(cutout.name || "")) {
      throw new Error(`cutout name ${repr(cutout.name ?? null)} must be a letter followed by letters, digits or _`);
    }
    if (seen.has(cutout.name)) throw new Error(`two cutouts are called ${repr(cutout.name)}`);
    seen.add(cutout.name);
    if (cutout.description === undefined) cutout.description = cutout.name;
    cutout.path = fsys.join(folder, cutout.file);
  }
  for (const [mounting, files] of Object.entries(spec.mountings)) {
    if (!MOUNTINGS.includes(mounting)) throw new Error(`unknown mounting ${repr(mounting)} (must be ${MOUNTINGS.join(" or ")})`);
    for (const key of ["fixings", "holes"]) {
      if (files[key]) files[key + "_path"] = fsys.join(folder, files[key]);
    }
  }
  return spec;
}

/** A Subassembly subclass for one subassembly folder. */
export function loadSubassemblyFolder(folder) {
  const spec = readSpec(folder);
  stl.bounds(spec.mock_path); // check it reads
  for (const files of Object.values(spec.mountings)) {
    for (const key of ["fixings_path", "holes_path"]) if (files[key]) stl.bounds(files[key]);
  }
  const table = {};
  for (const c of spec.cutouts) table[c.name] = Connector.fromMesh(c.description, c.path);
  const cls = class extends Subassembly {};
  Object.defineProperty(cls, "name", { value: spec.name });
  classAttrs(cls, {
    TYPE_NAME: spec.name, FOLDER: folder, SPEC: spec, MOCK: spec.mock_path,
    DISPLAY_NAME: spec.display_name, DESCRIPTION: spec.description, CONNECTORS_TABLE: table,
    CATEGORY: spec.category || "other",
  });
  return cls;
}

/** [{name: Subassembly subclass}, {folder: reason}] for every folder under
`root` (default subassemblies/) holding a subassembly.json - the second for
folders that couldn't be loaded. */
export function loadAll(root = null) {
  root = root || SUBASSEMBLIES_DIR;
  const loaded = {};
  const errors = {};
  if (!fsys.isDir(root)) return [loaded, errors];
  for (const entry of fsys.readdir(root).map((e) => e.name).sort()) {
    const folder = fsys.join(root, entry);
    if (!fsys.exists(fsys.join(folder, SPEC_FILE))) continue;
    try {
      const cls = loadSubassemblyFolder(folder);
      if (cls.TYPE_NAME in BUILT_IN) throw new Error(`${cls.TYPE_NAME} is already the name of a built-in device`);
      loaded[cls.TYPE_NAME] = cls;
    } catch (e) {
      errors[folder] = e.message;
      console.warn(`thingmaker: skipping subassembly folder ${folder}: ${e.message}`);
    }
  }
  return [loaded, errors];
}

/** Make (or, with overwrite, replace) the subassembly folder
subassemblies/<name>/: the STLs are copied in and a subassembly.json
written listing them. Returns the folder. All the STLs are drawn in the same
frame.

mock: path of the mock STL. cutouts: [{name, file, description}] (or
[name, path] pairs). mountings: {top: {fixings, holes}, underneath: {...}}.

(lib/catalogue.js's createSubassembly() also reloads the catalogue, so it
can be used straight away.) */
export function createSubassembly(name, mock, { cutouts = [], mountings = null, displayName = null, description = "",
  root = null, overwrite = false } = {}) {
  root = root || SUBASSEMBLIES_DIR;
  const mounts = {};
  for (const [k, v] of Object.entries(mountings || {})) {
    mounts[k] = {};
    for (const [f, p] of Object.entries(v)) if (p) mounts[k][f] = p;
  }
  if (!NAME_PATTERN.test(name || "")) throw new Error(`subassembly name ${repr(name)} must be a letter followed by letters, digits or _`);
  if (name in BUILT_IN) throw new Error(`${name} is already the name of a built-in device`);
  for (const [mounting, files] of Object.entries(mounts)) {
    if (!MOUNTINGS.includes(mounting)) throw new Error(`unknown mounting ${repr(mounting)} (must be ${MOUNTINGS.join(" or ")})`);
    const unknown = Object.keys(files).filter((k) => k !== "fixings" && k !== "holes");
    if (unknown.length) throw new Error(`a mounting has fixings and holes files, not ${unknown.sort().join(", ")}`);
  }
  const folder = fsys.join(root, name);
  if (fsys.exists(fsys.join(folder, SPEC_FILE)) && !overwrite) {
    throw new Error(`there is already a subassembly called ${name} (${folder})`);
  }
  const normalised = [];
  for (let cutout of cutouts) {
    if (Array.isArray(cutout)) cutout = { name: cutout[0], file: cutout[1] };
    if (!NAME_PATTERN.test(cutout.name || "")) {
      throw new Error(`cutout name ${repr(cutout.name ?? null)} must be a letter followed by letters, digits or _`);
    }
    normalised.push(cutout);
  }
  const names = normalised.map((c) => c.name);
  if (new Set(names).size !== names.length) throw new Error("cutout names must be different");
  // Check every mesh before touching the folder.
  stl.bounds(mock);
  for (const cutout of normalised) stl.bounds(cutout.file);
  for (const files of Object.values(mounts)) for (const p of Object.values(files)) stl.bounds(p);

  fsys.mkdir(folder);
  // Read everything first, so a file being replaced by one of its own name
  // still copies.
  const copies = [];
  const copyIn = (source, fileName) => {
    const target = fsys.join(folder, fileName);
    if (fsys.resolve(source) !== fsys.resolve(target)) copies.push([fsys.readFile(source), target]);
    return fileName;
  };
  const sortedEntries = (obj) => Object.entries(obj).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const spec = {
    format: SPEC_FORMAT, version: 1, name, display_name: displayName || name, description,
    mock: copyIn(mock, "mock.stl"),
    cutouts: normalised.map((c) => ({ name: c.name, description: c.description || c.name,
      file: copyIn(c.file, `cutout_${c.name}.stl`) })),
    mountings: {},
  };
  for (const [m, files] of sortedEntries(mounts)) {
    if (!Object.keys(files).length) continue;
    spec.mountings[m] = {};
    for (const [key, p] of sortedEntries(files)) spec.mountings[m][key] = copyIn(p, `${m}_${key}.stl`);
  }
  for (const [data, target] of copies) fsys.writeFile(target, data);
  // Files left over from cutouts or mountings that have been removed.
  const keep = new Set([...spec.cutouts.map((c) => c.file),
    ...Object.values(spec.mountings).flatMap((files) => Object.values(files))]);
  for (const entry of fsys.readdir(folder).map((e) => e.name)) {
    if (entry.endsWith(".stl") && entry !== "mock.stl" && !keep.has(entry)) fsys.unlink(fsys.join(folder, entry));
  }
  fsys.writeFile(fsys.join(folder, SPEC_FILE), dumps(spec, (p) => p.length === 1 && p[0] === "version") + "\n");
  return folder;
}
