/* What the web editor needs to show a design: every case, surface, hinge
and placement with its world matrix and boxes, the problems list, and the
catalogue's settings for the properties panel. Worked out on the server
from the design model, so the browser only draws it. Matrices are sent
row-major, flattened to 16 numbers. */
import * as catalogue from "./catalogue.js";
import * as decoration from "./decoration.js";
import * as dm from "./design.js";
import * as geom from "./geom.js";
import * as subassemblies from "./subassemblies.js";
import { COVER_OPEN_LIMIT } from "./design.js";
import { sorted } from "./py.js";

const flat = (m) => geom.flatten(m);
const box = (b) => ({ x: b.x, y: b.y, z: b.z, w: b.w, d: b.d, h: b.h, label: b.label });

/** Everything about the catalogue, the case and hinge fields and the
decoration settings that the editor's forms are built from. */
export function meta() {
  const types = {};
  for (const name of Object.keys(catalogue.CATALOG)) {
    const cls = catalogue.CATALOG[name];
    types[name] = {
      name, kind: catalogue.kindOf(name), displayName: cls.DISPLAY_NAME || name, description: cls.DESCRIPTION || "",
      recessable: cls.RECESSABLE, outsideOnly: cls.OUTSIDE_ONLY,
      commonParams: cls.COMMON_PARAMS, recessParams: cls.RECESSABLE ? cls.RECESS_PARAMS : [],
      deviceParams: sorted(Object.entries(cls.device_params()), (e) => e[0]),
      mountings: cls.SPEC && cls.SPEC.mountings ? Object.keys(cls.SPEC.mountings) : [],
    };
  }
  const surfaceSides = {};
  for (const s of dm.SURFACES) for (const m of dm.MOUNTS) surfaceSides[`${s}|${m}`] = dm.surfaceSides(s, m);
  const stickSides = {};
  for (const s of dm.SURFACES) stickSides[s] = dm.stickSides(s);
  return {
    caseFields: dm.CaseSpec.FIELDS, minimums: dm.CaseSpec.MINIMUMS, caseStyles: dm.CASE_STYLES, edgeStyles: dm.EDGE_STYLES,
    hingeFields: dm.HingeSpec.FIELDS, surfaces: dm.SURFACES, mounts: dm.MOUNTS, edges: dm.EDGES, rotations: dm.ROTATIONS,
    opposite: dm.OPPOSITE_SIDE, stickSides, surfaceSides, coverOpenLimit: COVER_OPEN_LIMIT,
    types, devices: catalogue.names("device"), subassemblies: catalogue.names("subassembly"),
    loadErrors: catalogue.LOAD_ERRORS, decorationFields: decoration.FIELDS,
    subassembliesDir: subassemblies.SUBASSEMBLIES_DIR,
  };
}

/** The design as the editor shows it. */
export function view(design) {
  const cms = design.case_matrices();
  let problems;
  try {
    problems = design.problems();
  } catch (e) {
    problems = [[e.message, []]];
  }
  const cases = design.cases.map((c) => {
    const driver = design.hinges.find((h) => h.cases[1] === c.id);
    const surfaces = [];
    for (const name of dm.SURFACES) {
      for (const mount of dm.MOUNTS) {
        const s = dm.surface(c, name, mount);
        surfaces.push({ name, mount, matrix: flat(geom.mul(cms[c.id], s.case_matrix)), width: s.width, height: s.height,
          thickness: s.thickness, part: s.part_id });
      }
    }
    return {
      id: c.id, style: c.style, width: c.width, depth: c.depth, height: c.height, wall_thickness: c.wall_thickness,
      base_thickness: c.base_thickness, lid_thickness: c.lid_thickness, lid_height: c.lid_height,
      matrix: flat(cms[c.id]), parts: c.parts, drivenBy: driver ? driver.id : null, surfaces,
      label: geom.applyPoint(cms[c.id], [c.width / 2.0, -c.wall_thickness - 10, -c.base_thickness]),
    };
  });
  const hinges = design.hinges.map((h) => ({
    id: h.id, cases: h.cases, edge: h.edge, radius: h.outer_radius, length: design.hinge_length(h),
    barrels: design.hinge_barrel(h, cms).map(([m, length]) => ({ matrix: flat(m), length })),
    rails: design.hinge_rails(h, cms).map(([m, b]) => ({ matrix: flat(m), box: box(b) })),
  }));
  const placements = design.placements.map((spec) => {
    const item = spec.make();
    const [, world, surf] = design.placement_matrices(spec, item, cms);
    const enabled = new Set(design.enabled_connector_cuts(spec, item).map((cc) => cc.name));
    const bodies = item.body_boxes();
    const top = Math.max(...bodies.map((b) => b.z + b.h));
    const [rw, rd] = dm.renderedSize(spec.rotation, item.width, item.depth);
    return {
      id: spec.id, type: spec.type, kind: spec.kind, case: spec.case, surface: spec.surface, mount: spec.mount,
      x: spec.x, y: spec.y, rotation: spec.rotation, world: flat(world),
      surfaceWorld: flat(design.surface_world_matrix(spec.case, spec.surface, spec.mount, cms)),
      bodies: bodies.map(box),
      meshes: item.preview_meshes().map(([file, m]) => ({ path: file, matrix: flat(m) })),
      cuts: item.connector_cuts().map((cc) => ({
        name: cc.name, description: cc.description, enabled: enabled.has(cc.name), boxes: cc.boxes.map(box),
        mesh: cc.mesh ? { path: cc.mesh[0], matrix: flat(cc.mesh[1]) } : null,
      })),
      targets: design.connector_cut_targets(spec),
      label: geom.applyPoint(world, [item.width / 2.0, item.depth / 2.0, top + 4]),
      footprint: [rw, rd], surfaceSize: [surf.width, surf.height],
      onLid: surf.part_id === design.case(spec.case).lid_part,
    };
  });
  return {
    cases, hinges, placements, problems, partIds: design.part_ids(),
    hingeLengths: Object.fromEntries(hinges.map((h) => [h.id, h.length])),
  };
}

/** {inlay part id: [r, g, b]} - the colours the built model's decoration
inlays are shown in. */
export function inlayColours(design, partIds) {
  const out = {};
  const cache = new Map();
  for (const pid of partIds) {
    if (!pid.includes(".deco.")) continue;
    const [parent, rest] = pid.split(".deco.");
    const dot = rest.indexOf(".");
    const surfaceName = rest.slice(0, dot);
    const layer = rest.slice(dot + 1);
    let kase;
    try {
      kase = design.case_of_part(parent);
    } catch (e) {
      // A placement's part set in the surface (a battery compartment's lid)
      // carries on its case's pattern.
      try {
        kase = design.case(design.placement(parent.slice(0, parent.lastIndexOf("."))).case);
      } catch (e2) {
        continue;
      }
    }
    const layers = kase.decorations[surfaceName];
    if (!layers) continue;
    const key = `${kase.id}|${surfaceName}`;
    if (!cache.has(key)) cache.set(key, decoration.layerColours(kase, dm.surface(kase, surfaceName, "outside"), layers));
    const rgb = cache.get(key)[layer];
    if (rgb) out[pid] = rgb;
  }
  return out;
}
