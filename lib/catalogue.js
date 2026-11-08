/* The catalogue: every type a design can place, by name - the built-in
devices (lib/devices.js) and the subassemblies made from STL files
(lib/subassemblies.js, loaded from subassemblies/).

Both kinds are made with make() and placed in a design the same way (as
design.Placement); kindOf() tells them apart where it matters, which is
only in how they're listed and labelled. */
import { BUILT_IN } from "./devices.js";
import "./library.js"; // (adds the devices described as data to BUILT_IN)
import * as subassemblies from "./subassemblies.js";
import { repr, sorted } from "./py.js";

export const KINDS = ["device", "subassembly"];

// The sorts of thing there are, as the editor groups them: [category, what
// it's called in the editor]. A device's CATEGORY is one of these (a
// subassembly's is its subassembly.json's "category", if it has one).
export const CATEGORIES = [["cpu", "Processors"], ["display", "Displays"], ["sound", "Sound"], ["light", "Lights"],
  ["button", "Buttons and controls"], ["sensor", "Sensors"], ["power", "Power"], ["other", "Other"]];

// type name -> class, for both kinds.
export const CATALOG = {};
// Subassembly folders that couldn't be loaded: folder -> reason.
export const LOAD_ERRORS = {};

/** Rebuild CATALOG: the built-in devices plus one subassembly per folder
under `root` (default subassemblies/). */
export function reload(root = null) {
  const [loaded, errors] = subassemblies.loadAll(root);
  for (const k of Object.keys(CATALOG)) delete CATALOG[k];
  Object.assign(CATALOG, BUILT_IN, loaded);
  for (const k of Object.keys(LOAD_ERRORS)) delete LOAD_ERRORS[k];
  Object.assign(LOAD_ERRORS, errors);
  return CATALOG;
}

/** "device" or "subassembly". */
export function kindOf(typeName) {
  const cls = CATALOG[typeName];
  if (!cls) throw new Error(`No device or subassembly called ${repr(typeName)}`);
  return cls.prototype instanceof subassemblies.Subassembly ? "subassembly" : "device";
}

/** Every type name of one kind, sorted. */
export function names(kind) {
  return sorted(Object.keys(CATALOG).filter((n) => kindOf(n) === kind));
}

/** An instance of a catalogue type, with a design's parameter overrides for
it. `margins` (left, right, front, back in its own frame: x low, x high,
y low, y high), `well` (the recess opening's width and depth in its own
frame) and `holeOffset` (the recess's cable hole, from the device's middle,
in its own frame) come from design.Placement, which knows which way round it
is on which surface; without them, the margin and recess size parameters are
read as if it were on the floor, unturned. */
export function make(typeName, partName, params = null, { margins = null, well = null, holeOffset = null } = {}) {
  const cls = CATALOG[typeName];
  if (!cls) {
    throw new Error(`Unknown device or subassembly type ${repr(typeName)} (known: ${sorted(Object.keys(CATALOG)).join(", ")})`);
  }
  const p = { ...(params || {}) };
  const allowed = cls.all_params();
  const unknown = Object.keys(p).filter((k) => !(k in allowed));
  if (unknown.length) {
    throw new Error(`${typeName} has no parameter(s) ${unknown.join(", ")} (allowed: ${sorted(Object.keys(allowed)).join(", ")})`);
  }
  const pop = (k, dflt) => {
    if (k in p) {
      const v = p[k];
      delete p[k];
      return v;
    }
    return dflt;
  };
  const connectorSettings = {};
  for (const k of Object.keys(p)) if (k in cls.CONNECTOR_PARAMS) connectorSettings[k] = pop(k);
  const side = {};
  for (const k of cls.MARGIN_PARAMS) side[k] = pop(k, cls.COMMON_PARAMS[k][0]);
  const recess = {};
  for (const k of cls.RECESS_PARAMS) recess[k] = pop(k, cls.COMMON_PARAMS[k][0]);
  if (margins === null) margins = [side.margin_left, side.margin_right, side.margin_front, side.margin_back];
  if (well === null) well = [recess.recess_width, recess.recess_height];
  if (holeOffset === null) holeOffset = [recess.recess_hole_across, recess.recess_hole_up];
  const item = new cls(partName, { xMargin: 0.0, yMargin: 0.0, ...p });
  for (const [name, value] of Object.entries(connectorSettings)) item[name] = value;
  item.apply_margins(...margins);
  item.apply_recess(recess.recess_depth, recess.recess_radius, well[0], well[1], recess.recess_style,
    recess.recess_hole, holeOffset);
  return item;
}

/** subassemblies.createSubassembly(), then the catalogue reloaded so it can
be used straight away (when it was made in the catalogue's own folder). */
export function createSubassembly(name, mock, options = {}) {
  const folder = subassemblies.createSubassembly(name, mock, options);
  if (!options.root || options.root === subassemblies.SUBASSEMBLIES_DIR) reload();
  return folder;
}

reload();
