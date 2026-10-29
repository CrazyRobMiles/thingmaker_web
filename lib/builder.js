/* Turn a Design into solids and STL files. The editor builds in the server
as the design changes (lib/worker.js); build.js does the same from the
command line.

For every part the order of operations is:
  1. the case style's own base or lid shell, then any recesses in it: their
     walls (and pillars, or pocket floors) added and their openings cut
  2. fuse: hinge knuckles (to each case's base), then every placement's
     fuser (pillars etc.)
  3. cut: every placement's cutter (bolt holes etc.); for hinges, the pin
     hole, room for the other case's knuckles, and each lid's notches round
     its own base's knuckles
  4. cut: connector cuts - each enabled connector cut of each placement,
     placed in the assembled design and then cut from every target part
All fusing happens before any cutting so a hole is never plugged by another
placement's pillar, and connector cuts come last so they clear anything in
their way.

Output (in outDir):
  print/<part>.stl      each part in its own (printing) frame
  assembled/<part>.stl  each part where it sits in the assembled design
  design.json           the design as built
  manifest.json         part list, world matrices, solid counts and the hinge
                        check; written last, so its presence means success */
import fs from "node:fs";
import path from "node:path";
import * as cases from "./cases.js";
import * as decoration from "./decoration.js";
import * as devices from "./devices.js";
import * as geom from "./geom.js";
import * as kernel from "./kernel.js";
import { meshSolid, transformed } from "./meshes.js";
import { MIN_HINGE_LENGTH, anchorSize, edgeFrame, lidMatrix, partInCaseMatrix, surface } from "./design.js";
import { EdgeHinge } from "./hinges.js";
import { REPO_ROOT } from "./subassemblies.js";
import { dumps, fmtD, fmtF, fmtG, pyRound } from "./py.js";

// Pieces smaller than this (mm3) left over by a boolean are dropped.
export const SLIVER_VOLUME = 1e-3;

/** output/<design file name>/ in the repository. */
export function defaultOutputDir(designPath) {
  const stem = path.basename(designPath).replace(/\.[^.]*$/, "");
  return path.join(REPO_ROOT, "output", stem);
}

/** The part id of a decoration's inlay: e.g. "main.lid.deco.top.text". */
export function decorationId(partId, surfaceName, layer) {
  return `${partId}.deco.${surfaceName}.${layer}`;
}

/** The part id of a part a placement makes of its own. */
export function extraPartId(spec, name) {
  return `${spec.id}.${name}`;
}

/** The part id of a recessed placement's baseplate. */
export function baseplateId(spec) {
  return `${spec.id}.baseplate`;
}

export function makeHinge(design, spec) {
  return new EdgeHinge(design.hinge_length(spec), {
    radius: spec.outer_radius, knuckles: spec.knuckles, knuckle_gap: spec.knuckle_gap, clearance: spec.clearance,
    anchor: spec.anchor, pin_grip_diameter: spec.pin_grip_diameter, pin_turn_diameter: spec.pin_turn_diameter,
    cable_gap: spec.cable_gap, cable_cover: spec.cable_cover, open_limit: spec.open_limit,
    pin_inner_diameter: spec.pin_inner_diameter, bolt_head_diameter: spec.bolt_head_diameter,
    bolt_head_height: spec.bolt_head_height,
  });
}

export function logLine(text) {
  process.stdout.write(text + "\n");
}

const emptyOps = () => ({ recess_fuse: [], recess_cut: [], fuse: [], cut: [], connector: [] });

/** Replace `shape` by `next`, freeing `shape` straight away (part shapes are
big, and every boolean makes a new one). */
function advance(shape, next) {
  if (next._m !== shape._m) kernel.release(shape);
  return next;
}

/** [{part id: solid in its own frame}, {part id: world matrix}].
placements=false builds just the case shells and their hinges - all the
hinge check needs. Must be called in a kernel.scope(). */
export function buildParts(design, { log = logLine, placements = true } = {}) {
  const cms = design.case_matrices();
  const world = {};
  for (const pid of design.part_ids()) world[pid] = design.part_matrix(pid, cms);
  const shapes = {};
  for (const kase of design.cases) {
    const box = cases.makeBox(kase);
    shapes[kase.base_part] = box.get_base();
    shapes[kase.lid_part] = box.get_lid();
  }
  const ops = {};
  for (const pid of Object.keys(shapes)) ops[pid] = emptyOps();

  for (const spec of design.hinges) {
    if (design.hinge_length(spec) < MIN_HINGE_LENGTH) {
      log(`  hinge ${spec.id}: no room for it between its margins - left out`);
      continue;
    }
    const hinge = makeHinge(design, spec);
    log(`  hinge ${spec.id}: ${hinge.knuckles} knuckles over ${fmtF(hinge.length, 1)} mm`);
    spec.cases.forEach((caseId, side) => {
      const kase = design.case(caseId);
      const inCase = edgeFrame(kase, spec.edge, spec.gap);
      const inLid = geom.mul(geom.inverseRigid(lidMatrix(kase)), inCase);
      const t = kase.wall_thickness;
      // The anchor block's size: its bottom is fixed in the case, and a gap
      // only raises its top.
      const [depth, drop] = anchorSize(kase, spec);
      // Keep the anchor block within the case's own outline (so rounded
      // corners stay rounded); the knuckles stand proud of it.
      const box = cases.makeBox(kase);
      const top = kase.height + kase.lid_thickness + spec.gap / 2.0;
      const outline = box._shaped_box(kase.width + 2 * t, kase.depth + 2 * t, top + kase.base_thickness, [-t, -t, -kase.base_thickness]);
      const anchor = transformed(hinge.anchor_shape(depth, drop), inCase).common(outline);
      let material = anchor.fuse(transformed(hinge.knuckles_shape(side), inCase));
      const cover = hinge.cable_cover_shape(side);
      if (cover) material = material.fuse(transformed(cover, inCase));
      const stop = hinge.stop_shape(top + kase.base_thickness);
      if (stop) material = material.fuse(transformed(stop, inCase));
      const baseOps = ops[kase.base_part];
      const lidOps = ops[kase.lid_part];
      baseOps.fuse.push([`hinge ${spec.id} knuckles`, material]);
      baseOps.cut.push([`hinge ${spec.id} pin hole`, transformed(hinge.pin_hole(side), inCase)]);
      baseOps.cut.push([`hinge ${spec.id} knuckle clearance`, transformed(hinge.other_clearance(side), inCase)]);
      const cable = hinge.cable_cut(side, depth, drop);
      if (cable) baseOps.cut.push([`hinge ${spec.id} cable gap`, transformed(cable, inCase)]);
      lidOps.cut.push([`hinge ${spec.id} strip`, transformed(hinge.lid_clearance(depth, drop), inLid)]);
      // Room for the heads of the bolts in the ends of the hinge: a slot open
      // at the lid's edge, so the lid fits down over them.
      const below = kase.lid_thickness + spec.gap / 2.0 + kase.lid_height + 1.0;
      const slot = hinge.bolt_head_slot(below);
      const pocket = hinge.bolt_head_pocket();
      if (slot) {
        lidOps.cut.push([`hinge ${spec.id} bolt heads`, transformed(slot, inLid)]);
        baseOps.cut.push([`hinge ${spec.id} bolt heads`, transformed(pocket, inCase)]);
      }
    });
  }

  for (const kase of design.cases) {
    const lidFromCase = geom.inverseRigid(lidMatrix(kase));
    for (const frame of design.case_screw_frames(kase)) {
      const [block, baseCut, lidCut] = cases.screwParts(kase, frame);
      ops[kase.base_part].fuse.push(["retaining screw nut block", block]);
      ops[kase.base_part].cut.push(["retaining screw", baseCut]);
      ops[kase.lid_part].cut.push(["retaining screw", transformed(lidCut, lidFromCase)]);
    }
  }

  // Parts a device puts in the outside face of its surface (a battery
  // compartment's lid): [part id, the surface's part] - they take its
  // decorations, so the pattern carries on across them.
  const decorated = [];
  for (const spec of placements ? design.placements : []) {
    const item = spec.make();
    const [inPart, itemWorld, surf] = design.placement_matrices(spec, item, cms);
    let target = surf.part_id;
    let toTarget = inPart;
    const thickness = surf.thickness;
    if (design.recessed(spec, item)) {
      // The well (and its pillars) or the pocket go into the surface's part.
      // Plate style, the device itself goes onto its own baseplate, a
      // separate part; cut style, onto the pocket's floor.
      const atSurface = geom.mul(inPart, geom.inverseRigid(design._recess_drop(spec, item)), design.recess_frame(spec, item));
      ops[surf.part_id].recess_fuse.push([`${spec.id} recess`, transformed(item.recess_material(surf.thickness), atSurface)]);
      ops[surf.part_id].recess_cut.push([`${spec.id} recess`,
        transformed(item.recess_cut(Math.min(0.8, surf.thickness / 2.0)), atSurface)]);
      if (item.recess_style === "plate") {
        target = baseplateId(spec);
        shapes[target] = item.recess_baseplate(surf.thickness);
        world[target] = itemWorld;
        ops[target] = emptyOps();
        toTarget = geom.identity(); // the baseplate is as thick as the surface it stands in for
      }
      const cable = item.recess_cable_hole(surf.thickness);
      if (cable) ops[target].cut.push([`${spec.id} cable hole`, transformed(cable, toTarget)]);
    }
    const [fuser, cutter] = devices.buildGeometry(item, 0, 0, thickness);
    if (fuser) ops[target].fuse.push([spec.id, transformed(fuser, toTarget)]);
    if (cutter) ops[target].cut.push([spec.id, transformed(cutter, toTarget)]);
    // Parts a device makes of its own, in the same frame as the part it's
    // on, so their STLs line up with it.
    for (const [name, shape] of Object.entries(item.extra_parts(thickness))) {
      const pid = extraPartId(spec, name);
      shapes[pid] = transformed(shape, toTarget);
      world[pid] = world[target];
      ops[pid] = emptyOps();
      if (item.DECORATED_PARTS.includes(name)) decorated.push([pid, target]);
    }
    for (const cc of design.enabled_connector_cuts(spec, item)) {
      let shape;
      if (cc.mesh) {
        const [file, matrix] = cc.mesh;
        const started = Date.now();
        shape = transformed(meshSolid(file), matrix);
        log(`  ${spec.id} ${cc.name}: loaded its mesh (${shape.triangles} triangles) in ${fmtF((Date.now() - started) / 1000, 2)}s`);
      } else {
        shape = devices.union(cc.boxes.map((b) => devices.boxToShape(b)));
      }
      // A cut is the opening the connector needs out to the case - it
      // mustn't take away the device's own fixings.
      if (fuser) shape = shape.cut(fuser);
      const targets = design.connector_cut_targets(spec);
      if (design.recessed(spec, item) && item.recess_style === "plate") targets.push(baseplateId(spec));
      for (const t of targets) {
        const m = geom.mul(geom.inverseRigid(world[t]), itemWorld);
        ops[t].connector.push([`${spec.id} ${cc.name}`, transformed(shape, m)]);
      }
    }
  }

  // Decorations: each layer of text or picture on a case's outside face, as
  // [inlay part id, what to cut, what the inlay is cut from] for every part
  // of the case - a side's decoration reaches the lid's skirt too.
  const decorate = {};
  for (const pid of Object.keys(shapes)) decorate[pid] = [];
  for (const kase of placements ? design.cases : []) {
    for (const [name, layers] of Object.entries(kase.decorations).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      const surf = surface(kase, name, "outside");
      for (const [layer, , section, depth, inlay] of decoration.faceLayers(kase, surf, layers)[0]) {
        const cut = kernel.extrudeSection(section, depth + 1.0, -depth);
        const fill = inlay ? kernel.extrudeSection(section, depth, -depth) : null;
        for (const part of kase.parts) {
          const toPart = geom.mul(geom.inverseRigid(partInCaseMatrix(kase, part)), surf.case_matrix);
          decorate[part].push([decorationId(part, name, layer), cut.transformed(toPart), fill ? fill.transformed(toPart) : null]);
        }
      }
    }
  }
  // A part in a surface carries the pattern on across it; the opening it
  // sits in takes that piece out of the surface and its inlays.
  for (const [pid, target] of decorated) {
    decorate[pid] = (decorate[target] || []).map(([inlayId, cut, fill]) => [pid + inlayId.slice(target.length), cut, fill]);
  }

  const run = (shape, pid, stages) => {
    for (const [stage, verb] of stages) {
      for (const [label, tool] of ops[pid][stage]) {
        log(`  ${pid}: ${verb} ${label}...`);
        const started = Date.now();
        shape = advance(shape, verb === "fuse" ? shape.fuse(tool) : shape.cut(tool));
        const taken = (Date.now() - started) / 1000;
        if (taken >= 1.0) log(`    took ${fmtF(taken, 1)}s`);
      }
    }
    return shape;
  };

  for (const pid of Object.keys(shapes)) {
    let shape = run(shapes[pid], pid, [["recess_fuse", "fuse"], ["recess_cut", "cut"], ["fuse", "fuse"]]);
    // Decorations go in once everything's been added, the text first; their
    // inlays are what the cuts take out of the part.
    const inlays = {};
    for (const [inlayId, cut, fill] of decorate[pid] || []) {
      log(`  ${pid}: engrave ${inlayId}...`);
      if (fill) {
        const piece = shape.common(fill);
        if (piece.Volume > SLIVER_VOLUME) inlays[inlayId] = piece;
      }
      shape = advance(shape, shape.cut(cut));
    }
    // Then the holes, which go through the inlays as well.
    shape = run(shape, pid, [["cut", "cut"], ["connector", "cut"]]);
    for (let [inlayId, piece] of Object.entries(inlays)) {
      piece = run(piece, pid, [["cut", "cut"], ["connector", "cut"]]);
      if (piece.Volume > SLIVER_VOLUME) {
        shapes[inlayId] = piece;
        world[inlayId] = world[pid];
      }
    }
    // Booleans meeting exactly at a face can leave flat, zero-volume slivers
    // behind as separate pieces - nothing to print, so drop them.
    const pieces = shape.Solids;
    if (pieces.length > 1 && pieces.some((p) => p.Volume < SLIVER_VOLUME)) {
      shape = advance(shape, kernel.compound(pieces.filter((p) => p.Volume >= SLIVER_VOLUME)));
    }
    shapes[pid] = shape;
  }
  return [shapes, world];
}

/** Swing hinge `spec` through `angles` and measure how much the parts of its
two cases overlap at each one (mm3). `shapes` need only be the case shells
and hinges. Returns [[angle, overlap]...]. */
export function hingeSweep(design, shapes, spec, angles = null, log = null) {
  angles = angles || Array.from({ length: 13 }, (_, i) => i * 15);
  const original = spec.open_angle;
  const fixed = design.case(spec.cases[0]).parts;
  const moving = design.case(spec.cases[1]).parts;
  const results = [];
  try {
    for (const angle of angles) {
      spec.open_angle = angle;
      const overlap = kernel.scope(() => {
        const cms = design.case_matrices();
        const placed = {};
        for (const p of [...fixed, ...moving]) placed[p] = transformed(shapes[p], design.part_matrix(p, cms));
        let total = 0;
        for (const a of fixed) for (const b of moving) total += placed[a].common(placed[b]).Volume;
        return total;
      });
      results.push([angle, pyRound(overlap, 2)]);
      if (log) log(`  hinge ${spec.id} at ${fmtD(angle)} degrees: ${overlap <= 0.01 ? "clear" : `overlap ${fmtF(overlap, 1)} mm3`}`);
    }
  } finally {
    spec.open_angle = original;
  }
  return results;
}

/** Check built parts: each should be one valid solid, and each hinge should
open 0-180 degrees without its cases touching. Returns [{part id: {solids,
valid, volume_mm3}}, problems, hinge sweeps]. */
export function check(design, shapes, log = null) {
  log = log || (() => {});
  const parts = {};
  const problems = [];
  for (const [pid, shape] of Object.entries(shapes)) {
    const solids = kernel.scope(() => shape.Solids.length);
    const valid = shape.isValid();
    if (solids !== 1 && !pid.includes(".inlay") && !pid.includes(".deco.")) problems.push(`${pid} is ${solids} separate solids`);
    if (!valid) problems.push(`${pid} isn't a valid closed solid`);
    parts[pid] = { solids, valid, volume_mm3: pyRound(shape.Volume, 1) };
  }
  const sweeps = {};
  if (design.hinges.length) {
    // The check is about the cases and their hinge, so it uses just those.
    log("Checking the hinges open 0-180 degrees (case shells and hinges only)");
    kernel.scope(() => {
      const [shells] = buildParts(design, { log: () => {}, placements: false });
      for (const spec of design.hinges) {
        // A hinge with a stop is only checked up to it (it's meant to collide beyond).
        let angles = Array.from({ length: 13 }, (_, i) => i * 15);
        if (spec.open_limit) angles = [...angles.filter((a) => a < spec.open_limit), spec.open_limit];
        const sweep = hingeSweep(design, shells, spec, angles, log);
        sweeps[spec.id] = sweep;
        const clashes = sweep.filter(([, v]) => v > 0.01);
        if (clashes.length) {
          problems.push(`hinge ${spec.id}: the cases overlap when opened to ${clashes.map(([a, v]) => `${fmtD(a)} deg (${fmtF(v, 1)} mm3)`).join(", ")}`);
        } else {
          log(`Hinge ${spec.id} opens 0-${fmtG(angles[angles.length - 1])} degrees without the cases touching`);
        }
      }
    });
  }
  return [parts, problems, sweeps];
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** Build `design` into `outDir`: the print and assembled STLs, design.json and
manifest.json. Returns the manifest. */
export function build(design, outDir, log = logLine) {
  const started = Date.now();
  const manifestPath = path.join(outDir, "manifest.json");
  if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
  for (const sub of ["print", "assembled"]) {
    const folder = path.join(outDir, sub);
    fs.mkdirSync(folder, { recursive: true });
    for (const name of fs.readdirSync(folder)) if (name.toLowerCase().endsWith(".stl")) fs.unlinkSync(path.join(folder, name));
  }
  // The design as built, so the editor can tell whether the STLs are out of date.
  design.save(path.join(outDir, "design.json"));
  log(`Building ${design.name} (${design.cases.length} cases, ${design.hinges.length} hinges, ${design.placements.length} devices and subassemblies)`);
  return kernel.scope(() => {
    const [shapes, world] = buildParts(design, { log });
    const [parts, problems, sweeps] = check(design, shapes, log);
    for (const [pid, shape] of Object.entries(shapes)) {
      const printPath = path.join(outDir, "print", pid + ".stl");
      const assembledPath = path.join(outDir, "assembled", pid + ".stl");
      kernel.writeStl(shape, printPath);
      kernel.scope(() => kernel.writeStl(transformed(shape, world[pid]), assembledPath));
      const info = parts[pid];
      Object.assign(info, {
        print: path.relative(outDir, printPath).split(path.sep).join("/"),
        assembled: path.relative(outDir, assembledPath).split(path.sep).join("/"),
        world_matrix: world[pid],
      });
      log(`Wrote ${pid} (${info.solids} solid${info.solids === 1 ? "" : "s"}, ${fmtF(info.volume_mm3, 0)} mm3)`);
    }
    const manifest = {
      design: design.name, hinge_sweeps: sweeps, built: stamp(new Date()),
      seconds: pyRound((Date.now() - started) / 1000, 1), parts, problems, warnings: design.warnings(),
    };
    fs.writeFileSync(manifestPath, dumpManifest(manifest));
    for (const p of [...problems, ...manifest.warnings]) log("WARNING: " + p);
    log(`Build finished in ${fmtF(manifest.seconds, 1)}s -> ${outDir}`);
    return manifest;
  });
}

/** manifest.json's text, as the Python thingmaker writes it. */
export function dumpManifest(manifest) {
  return dumps(manifest, (p) => p[p.length - 1] === "solids" || (p[0] === "hinge_sweeps" && p.length === 4 && p[3] === 0 &&
    Number.isInteger(manifest.hinge_sweeps[p[1]][p[2]][0])));
}

/** {print: {part: {vertices, triangles}}, world: {part: matrix}, problems} -
the parts built in memory and checked, for the editor's live view. */
export function liveBuild(design) {
  return kernel.scope(() => {
    const [shapes, world] = buildParts(design, { log: () => {} });
    const [, problems] = check(design, shapes);
    const meshes = {};
    for (const [pid, shape] of Object.entries(shapes)) meshes[pid] = shape.arrays();
    return { print: meshes, world, problems };
  });
}
