/* The editor's edits: each thing the web editor can do to a design, as an
operation the server applies. Like the Python editor's change(), an edit is
applied, the design checked and laid out again, and if that leaves it
invalid the edit is rolled back and the reason given.

An operation is {op: name, ...arguments}; applyEdit() returns {ok, design,
message, select} - the design (new, or as it was if the edit failed), a
message for the status bar, and what to select afterwards (if anything). */
import * as catalogue from "./catalogue.js";
import * as decoration from "./decoration.js";
import * as dm from "./design.js";
import * as geom from "./geom.js";
import { deepCopy, fmtG } from "./py.js";

function validate(design) {
  for (const item of [...design.cases, ...design.hinges, ...design.placements]) item.normalise();
  design.check_references();
}

const SETTABLE = {
  case: ["style", ...dm.CaseSpec.FIELDS.slice(1).map((f) => f[0]).filter((n) => n !== "width" && n !== "depth"), "rotation",
    "fit_height", "screw_nuts"],
  hinge: dm.HingeSpec.FIELDS.map((f) => f[0]),
  placement: ["case", "mount", "rotation"],
};

const OPS = {
  rename_design(d, { name }) {
    d.name = String(name ?? "").trim() || "Untitled";
  },

  add_case(d, { id, values }) {
    const cms = d.case_matrices();
    let right = 0.0;
    for (const c of d.cases) {
      const b = new geom.Box3(-c.wall_thickness, -c.wall_thickness, 0, c.width + 2 * c.wall_thickness,
        c.depth + 2 * c.wall_thickness, 1).transformedBounds(cms[c.id]);
      right = Math.max(right, b[1] + 40.0);
    }
    const caseId = String(id ?? "").trim();
    d.cases.push(new dm.CaseSpec(caseId, { ...values, position: [right, 0.0, 0.0] }));
    return { select: ["case", caseId], fit: true };
  },

  add_hinge(d, { id, cases, edge, open_angle }) {
    const hinge = new dm.HingeSpec(String(id ?? "").trim(), cases, { edge, open_angle });
    d.hinges.push(hinge);
    return { select: ["hinge", hinge.id], fit: true };
  },

  /** centre_mount: the side of the surface `centre` was clicked on, if it
  isn't `mount` (a device that goes inside, added from a click outside). */
  add_placement(d, { type, case: caseId, surface, mount, centre = null, centre_mount = null, stick = [] }) {
    if (centre && centre_mount && centre_mount !== mount) {
      const kase = d.case(caseId);
      const at = geom.applyPoint(dm.surface(kase, surface, centre_mount).case_matrix, [centre[0], centre[1], 0.0]);
      const [u, v] = geom.applyPoint(geom.inverseRigid(dm.surface(kase, surface, mount).case_matrix), at);
      centre = [u, v];
    }
    const spec = dm.newPlacement(d, type, caseId, surface, mount, centre);
    spec.stick = [...(stick || [])];
    d.placements.push(spec);
    return { select: ["placement", spec.id], message: `Added ${spec.id} - drag it to position it, R rotates it` };
  },

  remove(d, { id }) {
    d.remove(id);
  },

  rename(d, { old, name }) {
    const kind = d.kind_of(old);
    d.rename(old, name);
    return { select: [kind, String(name).trim() || old] };
  },

  set(d, { kind, id, field, value }) {
    if (!(SETTABLE[kind] || []).includes(field)) throw new dm.DesignError(`Can't set ${kind} ${field}`);
    const item = kind === "case" ? d.case(id) : kind === "hinge" ? d.hinge(id) : d.placement(id);
    item[field] = field === "rotation" && kind === "placement" ? Math.trunc(Number(value)) : value;
  },

  set_case_position(d, { id, axis, value }) {
    d.case(id).position[axis] = value;
  },

  set_hinge_case(d, { id, index, value }) {
    d.hinge(id).cases[index] = value;
  },

  set_surface(d, { id, surface }) {
    const s = d.placement(id);
    s.surface = surface;
    s.stick = s.stick.filter((side) => dm.stickSides(surface).includes(side));
  },

  /** Typed into X or Y: moved along a stuck side, that margin changes. */
  set_position(d, { id, axis, value }) {
    d.placement(id)[axis] = value;
    d.take_up_stuck_gaps(id);
  },

  /** Dropped after a drag. */
  move(d, { id, x, y }) {
    const spec = d.placement(id);
    spec.x = x;
    spec.y = y;
    d.take_up_stuck_gaps(id);
  },

  nudge(d, { id, dx, dy }) {
    const spec = d.placement(id);
    spec.x += dx;
    spec.y += dy;
    d.take_up_stuck_gaps(id);
  },

  /** Turn about the footprint's centre rather than its corner. */
  rotate(d, { id }) {
    const spec = d.placement(id);
    const old = spec.make();
    const [ow, od] = dm.renderedSize(spec.rotation, old.width, old.depth);
    spec.rotation = (spec.rotation + 90) % 360;
    spec.x += (ow - od) / 2.0;
    spec.y += (od - ow) / 2.0;
  },

  set_param(d, { id, name, value }) {
    const caseId = d.placement(id).case;
    const size = () => {
      const c = d.case(caseId);
      return [c.width, c.depth, c.height];
    };
    const before = size();
    // Keeps the board where it is and grows the case if it no longer fits.
    d.set_placement_params(id, { [name]: value });
    const after = size();
    if (after.some((v, i) => v !== before[i])) {
      return { message: `Case ${caseId} grew to ${after.map((v) => fmtG(v)).join(" x ")} mm to fit ${id}` };
    }
    return {};
  },

  /** Sticking to a side unsticks it from the opposite one, and a third side
  replaces the oldest. */
  set_stick(d, { id, side, on }) {
    const s = d.placement(id);
    const stick = s.stick.filter((x) => x !== side && x !== dm.OPPOSITE_SIDE[side]);
    if (on) stick.push(side);
    s.stick = stick.slice(-2);
  },

  set_cut(d, { id, name, on }) {
    d.placement(id).connector_cuts[name] = Boolean(on);
  },

  set_cut_default(d, { id, on }) {
    const s = d.placement(id);
    s.connector_cut_targets = on ? null : [...d.case(s.case).parts];
  },

  set_cut_target(d, { id, part, on }) {
    const s = d.placement(id);
    const current = new Set(d.connector_cut_targets(s));
    if (on) current.add(part);
    else current.delete(part);
    s.connector_cut_targets = d.part_ids().filter((p) => current.has(p));
  },

  decoration_toggle(d, { case: caseId, surface, kind, on }) {
    const decorations = d.case(caseId).decorations;
    if (on) {
      const settings = decoration.defaults(kind);
      if (kind === "text") settings.text = d.name || "Text";
      if (!decorations[surface]) decorations[surface] = {};
      decorations[surface][kind] = settings;
    } else {
      if (decorations[surface]) delete decorations[surface][kind];
      if (decorations[surface] && !Object.keys(decorations[surface]).length) delete decorations[surface];
    }
  },

  decoration_set(d, { case: caseId, surface, kind, field, value }) {
    d.case(caseId).decorations[surface][kind][field] = value;
  },
};

export const OP_NAMES = Object.keys(OPS);

/** Apply one edit to the design held as `dict` (Design.to_dict()). */
export function applyEdit(dict, edit) {
  const fn = OPS[edit && edit.op];
  if (!fn) return { ok: false, design: dm.Design.from_dict(deepCopy(dict)), message: `No such edit: ${edit && edit.op}` };
  const design = dm.Design.from_dict(deepCopy(dict));
  try {
    const extra = fn(design, edit) || {};
    validate(design);
    design.relayout();
    return { ok: true, design, ...extra };
  } catch (e) {
    if (!(e instanceof dm.DesignError)) console.error(`edit ${edit.op} failed: ${e.stack || e}`);
    return { ok: false, design: dm.Design.from_dict(deepCopy(dict)), message: `Not changed: ${e.message}` };
  }
}

/** After a subassembly is saved: bring copies of it in the design up to date
(dropping switches for cutouts that have gone) and lay the design out
again, since the mock's size may have changed. */
export function subassemblyChanged(dict, name) {
  const design = dm.Design.from_dict(deepCopy(dict));
  const known = catalogue.make(name, "probe").connector_cuts().map((cc) => cc.name);
  for (const spec of design.placements) {
    if (spec.type === name) {
      const kept = {};
      for (const [k, v] of Object.entries(spec.connector_cuts)) if (known.includes(k)) kept[k] = v;
      spec.connector_cuts = kept;
      spec.normalise();
    }
  }
  design.relayout();
  return design;
}
