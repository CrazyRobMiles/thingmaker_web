/* A Bambu Studio project (.3mf) of a design's printed parts, ready to slice.

Each printed part is an object of its own, made of the part and the inlays
cut into it (its decorations' and stamps' text and pictures, each colour a
part), already in place, so they print together as one model. Each object
is on a plate of its own, in the middle of the bed and the way up it's
printed (as print/<part>.stl is).

Each part is printed in a filament (an AMS slot): the case parts in 1, and
an inlay in the one its text or picture's `filament` setting gives, or,
without that, one of its own from 2 up, shared by inlays of the same colour.

The files inside are laid out as Bambu Studio lays out its own projects: the
meshes in 3D/Objects/, the objects made of them in 3D/3dmodel.model, and
the parts' filaments and the plates in Metadata/model_settings.config, and
the printer, filament and print settings in Metadata/project_settings.config
(lib/bambu-settings.js: Bambu Studio takes a project without them for one
from an old version, and loads just its shapes, on one plate). */
import { zipSync, strToU8 } from "fflate";
import SETTINGS from "./bambu-settings.js";
import * as kernel from "./kernel.js";
import { inlayColours } from "./view.js";

// The bed (mm): a Bambu Lab X1, P1 or A1's, 256mm square; Bambu Studio puts
// the plates side by side in rows, a fifth of a plate apart.
export const BED = 256.0;
const PLATE_STEP = BED * 1.2;
// The filaments an AMS holds: more on a plate than this and it's a warning.
export const AMS_SLOTS = 4;

const CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
const PRODUCTION = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06";
const BAMBU = "http://schemas.bambulab.com/package/2021";
const MODEL_REL = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
// The project format of the Bambu Studio its layout is copied from.
const VERSION = SETTINGS.version;
const APPLICATION = `BambuStudio-${VERSION}`;
// Where the prime tower goes on each plate (mm), as Bambu Studio puts it on a P1S.
const WIPE_TOWER = ["165", "220"];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A number as written in the files: enough digits to give back the float32 (or the double) it is. */
const num = (x, digits = 9) => {
  if (x === 0 || Object.is(x, -0)) return "0";
  const s = x.toPrecision(digits);
  return String(Number(s));
};
const uuid = (kind, n) => `${n.toString(16).padStart(8, "0")}-${kind}-4c03-9d28-80fed5dfa1dc`;

/** The part an inlay is cut into (`<part>.deco.<surface>.<layer>` or
`<part>.stamp.<stamp>.<layer>`), or null if `pid` isn't an inlay. */
export function inlayParent(pid) {
  for (const mark of [".deco.", ".stamp."]) if (pid.includes(mark)) return pid.slice(0, pid.indexOf(mark));
  return null;
}

/** [[part id, [its inlay ids...]]...]: what's printed together, in the order of `pids`. */
export function printObjects(pids) {
  const objects = new Map();
  for (const pid of pids) if (inlayParent(pid) === null) objects.set(pid, []);
  for (const pid of pids) {
    const parent = inlayParent(pid);
    if (parent === null) continue;
    if (objects.has(parent)) objects.get(parent).push(pid);
    else objects.set(pid, []); // (an inlay whose part isn't built: printed on its own)
  }
  return [...objects.entries()];
}

/** The text or picture settings an inlay comes from, and which of their
filaments it is (from 0): [settings, index], or [null, 0]. */
function inlaySettings(design, pid) {
  const layer = pid.slice(pid.lastIndexOf(".") + 1);
  const kind = layer === "text" ? "text" : "image";
  const index = kind === "image" && /^image\d+$/.test(layer) ? Number(layer.slice(5)) - 1 : 0;
  try {
    if (pid.includes(".stamp.")) {
      const rest = pid.split(".stamp.")[1];
      return [design.placement(rest.slice(0, rest.lastIndexOf("."))).make().settings[kind], index];
    }
    const [parent, rest] = pid.split(".deco.");
    const surface = rest.slice(0, rest.indexOf("."));
    let kase;
    try {
      kase = design.case_of_part(parent);
    } catch (e) {
      // (A placement's part set in a case's surface, carrying on its pattern.)
      kase = design.case(design.placement(parent.slice(0, parent.lastIndexOf("."))).case);
    }
    return [kase.decorations[surface][kind], index];
  } catch (e) {
    return [null, 0];
  }
}

/** {part id: filament number (from 1)} for the parts `pids`: case parts in
1; inlays in what their `filament` setting says, or else one per colour,
from 2 up, skipping those asked for. Throws on a setting that isn't
filament numbers. */
export function filaments(design, pids) {
  const out = {};
  const asked = {};
  for (const pid of pids) {
    if (inlayParent(pid) === null) {
      out[pid] = 1;
      continue;
    }
    const [settings, index] = inlaySettings(design, pid);
    const text = settings ? String(settings.filament || "").trim() : "";
    if (!text) continue;
    const numbers = text.split(/[\s,]+/).map((t) => {
      if (!/^\d+$/.test(t) || Number(t) < 1) throw new Error(`${pid}: filament ${JSON.stringify(text)} should be filament numbers, from 1 (e.g. 3, or 2 3 4)`);
      return Number(t);
    });
    if (index < numbers.length) asked[pid] = numbers[index];
  }
  const taken = new Set([1, ...Object.values(asked)]);
  const colours = inlayColours(design, pids.filter((pid) => inlayParent(pid) !== null && !(pid in asked)));
  const byColour = new Map();
  let next = 2;
  for (const pid of pids) {
    if (pid in out) continue;
    if (pid in asked) {
      out[pid] = asked[pid];
      continue;
    }
    const key = colours[pid] ? colours[pid].join(",") : pid;
    if (!byColour.has(key)) {
      while (taken.has(next)) next += 1;
      byColour.set(key, next);
      taken.add(next);
    }
    out[pid] = byColour.get(key);
  }
  return out;
}

/** A mesh as 3MF XML (<mesh>...</mesh>), its corners joined where they're
the same float32 point (as a slicer reading the STL would), and its bounds. */
function meshXml(shape) {
  const { vertices: v, triangles: t } = kernel.printMesh(shape);
  const index = new Map();
  const ids = new Int32Array(v.length / 3).fill(-1);
  const lines = ["<mesh>", "<vertices>"];
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const id = (i) => {
    if (ids[i] >= 0) return ids[i];
    const key = `${v[3 * i]},${v[3 * i + 1]},${v[3 * i + 2]}`;
    let n = index.get(key);
    if (n === undefined) {
      n = index.size;
      index.set(key, n);
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], v[3 * i + k]);
        hi[k] = Math.max(hi[k], v[3 * i + k]);
      }
      lines.push(`<vertex x="${num(v[3 * i])}" y="${num(v[3 * i + 1])}" z="${num(v[3 * i + 2])}"/>`);
    }
    ids[i] = n;
    return n;
  };
  const tris = [];
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [id(t[i]), id(t[i + 1]), id(t[i + 2])];
    if (a !== b && b !== c && a !== c) tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  lines.push("</vertices>", "<triangles>", ...tris, "</triangles>", "</mesh>");
  return { xml: lines.join("\n"), bounds: [lo, hi], triangles: tris.length };
}

const modelHead = (extra = "") => `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${CORE}" xmlns:BambuStudio="${BAMBU}" xmlns:p="${PRODUCTION}" requiredextensions="p">
${extra} <metadata name="BambuStudio:3mfVersion">1</metadata>
`;

/** A Bambu Studio project of the built parts `shapes` ({part id: shape, in
its printing frame}), with `design`'s settings for the filaments: {bytes:
the .3mf file, plates: [[part ids...] per plate], filaments: {part id:
filament}, warnings: [...]}. The meshes are made in the current kernel scope. */
export function project(design, shapes, { date = new Date() } = {}) {
  const pids = Object.keys(shapes);
  const objects = printObjects(pids);
  const filament = filaments(design, pids);
  const warnings = [];
  const files = {};
  const resources = [];
  const items = [];
  const settings = [];
  const plates = [];
  const rels = [];
  const columns = Math.ceil(Math.sqrt(objects.length) - 1e-9) || 1;
  let nextId = 1;
  objects.forEach(([pid, inlays], o) => {
    const parts = [pid, ...inlays];
    // The object's own file, its parts' meshes in it.
    const meshes = parts.map((p) => ({ pid: p, id: nextId++, ...meshXml(shapes[p]) }));
    const objectId = nextId++;
    const path = `/3D/Objects/object_${o + 1}.model`;
    files[path.slice(1)] = strToU8(modelHead() + " <resources>\n" + meshes.map((m, k) =>
      `  <object id="${m.id}" p:UUID="${uuid("81cb", ((o + 1) << 16) + k)}" type="model">\n${m.xml}\n  </object>`).join("\n") +
      "\n </resources>\n <build/>\n</model>\n");
    rels.push(path);
    // Its middle at the object's origin; the object on its plate, in the middle, on the bed.
    const lo = [0, 1, 2].map((k) => Math.min(...meshes.map((m) => m.bounds[0][k])));
    const hi = [0, 1, 2].map((k) => Math.max(...meshes.map((m) => m.bounds[1][k])));
    const mid = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
    const size = [0, 1, 2].map((k) => hi[k] - lo[k]);
    if (size[0] > BED || size[1] > BED) warnings.push(`${pid} is ${num(size[0], 4)} x ${num(size[1], 4)}mm: too big for a ${BED}mm bed`);
    const offset = `1 0 0 0 1 0 0 0 1 ${num(-mid[0], 12)} ${num(-mid[1], 12)} ${num(-mid[2], 12)}`;
    const offset4 = `1 0 0 ${num(-mid[0], 12)} 0 1 0 ${num(-mid[1], 12)} 0 0 1 ${num(-mid[2], 12)} 0 0 0 1`;
    resources.push(`  <object id="${objectId}" p:UUID="${uuid("61cb", o + 1)}" type="model">\n   <components>\n` +
      meshes.map((m, k) => `    <component p:path="${path}" objectid="${m.id}" p:UUID="${uuid("b206", ((o + 1) << 16) + k)}" transform="${offset}"/>`).join("\n") +
      "\n   </components>\n  </object>");
    const [col, row] = [o % columns, Math.floor(o / columns)];
    const at = [col * PLATE_STEP + BED / 2, -row * PLATE_STEP + BED / 2, size[2] / 2];
    items.push(`  <item objectid="${objectId}" p:UUID="${uuid("b1ec", objectId)}" transform="1 0 0 0 1 0 0 0 1 ${at.map((x) => num(x, 12)).join(" ")}" printable="1"/>`);
    // Its parts' names and filaments, and its plate.
    settings.push(`  <object id="${objectId}">\n    <metadata key="name" value="${esc(pid)}"/>\n    <metadata key="extruder" value="1"/>\n` +
      meshes.map((m) => `    <part id="${m.id}" subtype="normal_part">
      <metadata key="name" value="${esc(m.pid)}"/>
      <metadata key="matrix" value="${offset4}"/>
      <metadata key="source_file" value="${esc(m.pid)}.stl"/>
      <metadata key="extruder" value="${filament[m.pid]}"/>
      <mesh_stat face_count="${m.triangles}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
    </part>`).join("\n") + "\n  </object>");
    plates.push([o + 1, objectId, parts]);
    const used = new Set(parts.map((p) => filament[p]));
    if (used.size > AMS_SLOTS) warnings.push(`${pid}'s plate uses ${used.size} filaments (${[...used].sort((a, b) => a - b).join(", ")}): more than an AMS's ${AMS_SLOTS}`);
    const highest = Math.max(...used);
    if (highest > AMS_SLOTS && used.size <= AMS_SLOTS) warnings.push(`${pid}'s plate uses filament ${highest}: an AMS has ${AMS_SLOTS}`);
  });
  const day = date.toISOString().slice(0, 10);
  files["3D/3dmodel.model"] = strToU8(modelHead(` <metadata name="Application">${APPLICATION}</metadata>\n`) +
    ` <metadata name="Title">${esc(design.name)}</metadata>\n <metadata name="CreationDate">${day}</metadata>\n <metadata name="ModificationDate">${day}</metadata>\n` +
    ` <resources>\n${resources.join("\n")}\n </resources>\n <build p:UUID="${uuid("22b5", 0)}">\n${items.join("\n")}\n </build>\n</model>\n`);
  files["3D/_rels/3dmodel.model.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels.map((p, k) => ` <Relationship Target="${p}" Id="rel-${k + 1}" Type="${MODEL_REL}"/>`).join("\n")}
</Relationships>
`);
  files["Metadata/model_settings.config"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<config>
${settings.join("\n")}
${plates.map(([n, objectId]) => `  <plate>
    <metadata key="plater_id" value="${n}"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="${objectId}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${1000 + n}"/>
    </model_instance>
  </plate>`).join("\n")}
</config>
`);
  files["Metadata/project_settings.config"] = strToU8(JSON.stringify({ ...SETTINGS,
    wipe_tower_x: plates.map(() => WIPE_TOWER[0]), wipe_tower_y: plates.map(() => WIPE_TOWER[1]) }, null, 4) + "\n");
  files["Metadata/slice_info.config"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="${VERSION}"/>
  </header>
</config>
`);
  files["Metadata/filament_sequence.json"] = strToU8(JSON.stringify(Object.fromEntries(plates.map(([n]) =>
    [`plate_${n}`, { nozzle_sequence: [], optimal_assignment: [], sequence: [] }]))));
  files["[Content_Types].xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>
`);
  files["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="${MODEL_REL}"/>
</Relationships>
`);
  // (In the order Bambu Studio writes them; deflated, as it does.)
  const ordered = {};
  for (const name of ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model", "3D/_rels/3dmodel.model.rels"]) ordered[name] = files[name];
  for (const [name, data] of Object.entries(files)) if (!(name in ordered)) ordered[name] = data;
  const bytes = zipSync(ordered, { level: 6, mtime: date });
  return { bytes, plates: plates.map(([, , parts]) => parts), filaments: filament, warnings };
}
