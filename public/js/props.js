// The properties panel: the settings of whatever is selected, each change
// sent to the server as an edit (ctx.change).
import { typeSelect } from "./groups.js";
import { fmtG, pyRound } from "/lib/py.js";

export const SNAP = 0.5; // mm - drag positions snap to this, and X/Y step by it

/** A setting's name as the editor shows it: "connectorClearance" ->
"Connector clearance". */
export function paramLabel(name) {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").split(/\s+/).filter(Boolean);
  return [words[0][0].toUpperCase() + words[0].slice(1).toLowerCase(), ...words.slice(1).map((w) => w.toLowerCase())].join(" ");
}

const DECORATION_SPINS = {
  angle: [-360, 360, 5, 1], across: [-1000, 1000, 1, 1], up: [-1000, 1000, 1, 1], size: [0.5, 500, 1, 1], zoom: [0.01, 100, 0.1, 2],
  depth: [0.1, 50, 0.1, 2], gap: [0, 20, 0.1, 1], threshold: [0, 255, 5, 0], columns: [1, 512, 1, 0], colours: [1, 16, 1, 0],
  spacing: [0, 0.45, 0.05, 2], line_width: [0.1, 20, 0.1, 2], detail: [0.05, 5, 0.05, 2],
};

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

class Form {
  constructor(container) {
    this.root = container;
    this.widgets = {};
  }

  heading(text) {
    this.root.append(el("h3", {}, text));
  }

  note(text) {
    this.root.append(el("div", { class: "note" }, text));
  }

  row(label, widget, tip = "") {
    this.root.append(el("div", { class: "row", title: tip || null }, el("label", {}, label), el("div", { class: "field" }, widget)));
  }

  add(widget) {
    this.root.append(widget);
  }

  /** A number field that applies its value on Enter or when it loses focus,
  rounded to `decimals` places as a spin box would. */
  spin(value, onChange, { lo = -5000, hi = 5000, step = 1, decimals = 1, unit = "mm", zero = null, key = null } = {}) {
    const input = el("input", { type: "number", min: lo, max: hi, step });
    input.value = String(pyRound(value, decimals));
    input.addEventListener("change", () => {
      let v = Number(input.value);
      if (input.value === "" || Number.isNaN(v)) {
        input.value = String(pyRound(value, decimals));
        return;
      }
      v = Math.min(hi, Math.max(lo, pyRound(v, decimals)));
      input.value = String(v);
      if (v !== pyRound(value, decimals)) onChange(v);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
    if (key) this.widgets[key] = input;
    const parts = [input];
    if (unit) parts.push(el("span", { class: "unit" }, unit));
    if (zero) parts.push(el("span", { class: "unit", title: `0 = ${zero}` }, `(0 = ${zero})`));
    return parts;
  }

  combo(options, current, onChange) {
    const select = el("select");
    for (const o of options) {
      const [value, text] = Array.isArray(o) ? o : [o, o];
      const option = el("option", { value: String(value) }, String(text));
      if (String(value) === String(current)) option.selected = true;
      select.append(option);
    }
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  line(text, onChange) {
    const input = el("input", { type: "text" });
    input.value = text;
    const commit = () => {
      if (input.value !== text) onChange(input.value);
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
    return input;
  }

  check(label, checked, onChange, { disabled = false, tip = "" } = {}) {
    const box = el("input", { type: "checkbox", disabled });
    box.checked = checked;
    box.addEventListener("change", () => onChange(box.checked));
    return el("label", { class: "checkrow", title: tip || null }, box, label);
  }

  buttons(...buttons) {
    this.root.append(el("div", { class: "buttons" }, ...buttons));
  }
}

function button(text, onClick, { disabled = false, cls = "" } = {}) {
  return el("button", { type: "button", onclick: onClick, disabled, class: cls || null }, text);
}

/** Fill `container` with the properties of `ctx.selection`. ctx: {design,
view, meta, selection, change(edit, rebuild), select(selection),
addPlacementDialog(kind), addPlacement(type, case, surface, mount),
rotate(id), deleteSelected(), browsePicture(current) -> path, rename(old,
new)}. Returns {x, y} inputs for the selected placement, to update while
it's dragged. */
export function renderProps(container, ctx) {
  const scroll = container.parentElement.scrollTop;
  const same = container.dataset.shown === JSON.stringify(ctx.selection);
  const focusIndex = same ? [...container.querySelectorAll("input, select, button")].indexOf(document.activeElement) : -1;
  container.replaceChildren();
  container.dataset.shown = JSON.stringify(ctx.selection);
  const form = new Form(container);
  const sel = ctx.selection;
  try {
    if (!sel) designProps(form, ctx);
    else if (sel[0] === "case") caseProps(form, ctx, ctx.design.cases.find((c) => c.id === sel[1]));
    else if (sel[0] === "hinge") hingeProps(form, ctx, ctx.design.hinges.find((h) => h.id === sel[1]));
    else if (sel[0] === "placement") placementProps(form, ctx, sel[1]);
    else if (sel[0] === "surface") surfaceProps(form, ctx, sel[1], sel[2], sel[3]);
  } catch (e) {
    console.error(e);
    container.replaceChildren();
    designProps(new Form(container), ctx);
  }
  if (same) {
    container.parentElement.scrollTop = scroll;
    const fields = [...container.querySelectorAll("input, select, button")];
    if (focusIndex >= 0 && fields[focusIndex]) fields[focusIndex].focus();
  }
  return form.widgets;
}

function designProps(form, ctx) {
  form.heading("Design");
  form.row("Name", form.line(ctx.design.name, (t) => ctx.change({ op: "rename_design", name: t })));
  form.note("Start with Add case. Click a case surface to select it (hide Lids to reach the inside), then right-click it to " +
    "add a device or a subassembly. Drag them to move them; arrow keys nudge, R rotates. Join cases with Add hinge. Build " +
    "(F5) makes the STL files. Devices are built into thingmaker; subassemblies are made from STL files with File > New " +
    "subassembly.");
}

function caseProps(form, ctx, c) {
  const { meta } = ctx;
  const id = c.id;
  const set = (field, value, rebuild = true) => ctx.change({ op: "set", kind: "case", id, field, value }, rebuild);
  form.heading(`Case ${id}`);
  form.row("Id", form.line(id, (t) => ctx.rename(id, t)));
  form.row("Style", form.combo(meta.caseStyles, c.style, (v) => set("style", v)));
  if ((meta.screwStyles || []).includes(c.style)) {
    form.add(form.check("Nuts on the lid's screws", c.screw_nuts !== false, (v) => set("screw_nuts", v), {
      tip: "The lid's M3 retaining screws go into nuts held in blocks inside the base's walls. Untick it to leave the " +
        "nuts and their blocks out (they take up room inside the case): the screws go straight into the walls.",
    }));
  }
  form.row("Inside width x depth", `${fmtG(c.width)} x ${fmtG(c.depth)} mm`,
    "Worked out from what's placed in it: every case gets the width and depth the largest one needs, or the largest minimum.");
  for (const [name, , label] of meta.caseFields.slice(1)) {
    if (name === "width" || name === "depth") continue;
    if (name === "edge" && !meta.edgeStyles.includes(c.style)) continue; // only Rounded and Bevelled cases have shaped edges
    if (name === "height") {
      const tip = "Worked out from what's in it: room for what's on its walls, and for what stands on its floor and hangs " +
        "from its lid, with a little to spare";
      form.add(form.check("Fit height to what's in it", c.fit_height, (v) => set("fit_height", v), { tip }));
      if (c.fit_height) {
        form.row("Inside height", `${fmtG(c.height)} mm`, tip);
        continue;
      }
    }
    const minimum = meta.minimums.includes(name);
    form.row(name === "edge" ? "Edge" : label.split(" (mm)")[0], form.spin(c[name], (v) => set(name, v),
      { lo: minimum ? 0 : 0.5, hi: 2000 }), label);
  }
  form.note("Width and depth follow what's placed in the cases (all cases share them); a minimum of 0 means just fit it.");
  const driver = ctx.design.hinges.find((h) => h.cases[1] === id);
  if (driver) form.note(`Placed by hinge ${driver.id} (see its open angle).`);
  else {
    ["X", "Y", "Z"].forEach((axis, i) => {
      form.row(`Position ${axis}`, form.spin(c.position[i], (v) => ctx.change({ op: "set_case_position", id, axis: i, value: v }, false)));
    });
    form.row("Rotation", form.spin(c.rotation, (v) => set("rotation", v, false), { lo: -360, hi: 360, step: 90, unit: "deg" }));
  }
  form.note(`Parts: ${id}.base, ${id}.lid`);
  form.buttons(button("Add device to this case...", () => ctx.addPlacementDialog("device")),
    button("Add subassembly to this case...", () => ctx.addPlacementDialog("subassembly"), { disabled: !meta.subassemblies.length }));
}

function hingeProps(form, ctx, h) {
  const { meta } = ctx;
  const id = h.id;
  const set = (field, value) => ctx.change({ op: "set", kind: "hinge", id, field, value }, false);
  form.heading(`Hinge ${id}`);
  form.row("Id", form.line(id, (t) => ctx.rename(id, t)));
  const ids = ctx.design.cases.map((c) => c.id);
  ["Fixed case", "Hinged case"].forEach((label, i) => {
    form.row(label, form.combo(ids, h.cases[i], (v) => ctx.change({ op: "set_hinge_case", id, index: i, value: v })));
  });
  form.row("Edge", form.combo(meta.edges, h.edge, (v) => set("edge", v)));
  form.row("Open angle", form.spin(h.open_angle, (v) => set("open_angle", v), { lo: 0, hi: 180, step: 5, unit: "deg" }));
  form.row("Hinge margin", form.spin(h.margin, (v) => set("margin", v), { lo: 0, hi: 1000 }),
    "Distance from each end of the case's outside edge to the hinge - keeps the hinge clear of rounded corners");
  form.row("Length", `${(ctx.view.hingeLengths[id] ?? 0).toFixed(1)} mm`);
  for (const [name, , label] of meta.hingeFields.slice(3)) {
    if (name === "knuckles") {
      form.row("Knuckles", form.spin(h.knuckles, (v) => set("knuckles", Math.trunc(v)), { lo: 0, hi: 51, step: 2, decimals: 0, unit: "", zero: "auto" }), label);
    } else if (name === "cable_gap") {
      form.row("Cable gap", form.spin(h.cable_gap, (v) => set("cable_gap", v), { lo: 0, hi: 500, zero: "none" }),
        "Leave this much of the middle of the hinge free for a ribbon cable between the two cases");
    } else if (name === "bolt_head_diameter") {
      form.row("Bolt head diameter", form.spin(h.bolt_head_diameter, (v) => set("bolt_head_diameter", v), { lo: 0, hi: 50, step: 0.5, zero: "none" }),
        "The heads of the bolts in the ends of the hinge; the lids get slots, round over the head and open at the edge, so they fit down over them");
    } else if (name === "pin_inner_diameter") {
      form.row("Pin hole in the innermost knuckle", form.spin(h.pin_inner_diameter, (v) => set("pin_inner_diameter", v), { lo: 0, hi: 50, step: 0.1, zero: "off" }),
        "Bolts from each end screw into the innermost knuckle (beside the cable gap, or the middle one), which gets this hole; every other knuckle gets the turning hole, so the hinge pivots on the bolts");
    } else if (name === "open_limit") {
      form.row("Stops opening at", form.spin(h.open_limit, (v) => set("open_limit", v), { lo: 0, hi: 179, step: 5, unit: "deg", zero: "none" }),
        "Wedges on the back of both cases meet at this angle, so the hinge can't open further");
    } else if (name === "cable_cover") {
      form.row("Cable cover", form.check("", h.cable_cover, (v) => set("cable_cover", v), {
        disabled: !(h.cable_gap > 0),
        tip: `Hide the back of the cable gap with a two-part cover (the hinge can then open to ${fmtG(meta.coverOpenLimit)} degrees)`,
      }));
    } else {
      form.row(label.replace(" (mm)", ""), form.spin(h[name], (v) => set(name, v), { lo: name === "gap" ? 0 : 0.1, hi: 500, step: 0.1 }), label);
    }
  }
}

function placementProps(form, ctx, id) {
  const { meta, view } = ctx;
  const all = [...ctx.design.devices, ...ctx.design.subassemblies];
  const spec = all.find((d) => d.id === id);
  const pv = view.placements.find((p) => p.id === id);
  const type = meta.types[spec.type];
  const set = (field, value, rebuild = true) => ctx.change({ op: "set", kind: "placement", id, field, value }, rebuild);
  form.heading(`${id} - ${type.kind}: ${type.displayName}`);
  if (type.description) form.note(type.description);
  form.row("Id", form.line(id, (t) => ctx.rename(id, t)));
  form.row("Case", form.combo(ctx.design.cases.map((c) => c.id), spec.case, (v) => set("case", v)));
  form.row("Surface", form.combo(meta.surfaces, spec.surface, (v) => ctx.change({ op: "set_surface", id, surface: v })));
  form.row("Inside or outside", form.combo(meta.mounts, spec.mount, (v) => set("mount", v)));
  form.row("X (u)", form.spin(spec.x, (v) => ctx.change({ op: "set_position", id, axis: "x", value: v }), { step: SNAP, key: "x" }));
  form.row("Y (v)", form.spin(spec.y, (v) => ctx.change({ op: "set_position", id, axis: "y", value: v }), { step: SNAP, key: "y" }));
  const rotation = form.combo(meta.rotations, spec.rotation, (v) => set("rotation", Number(v), false));
  form.widgets.rotation = rotation;
  form.row("Rotation", rotation);
  const sticks = el("div", { class: "checks" });
  for (const side of meta.stickSides[spec.surface]) {
    sticks.append(form.check(side, spec.stick.includes(side), (on) => ctx.change({ op: "set_stick", id, side, on }),
      { tip: `Keep its distance from the ${side} side when the case is resized` }));
  }
  form.row("Stick to", sticks);
  const [rw, rd] = pv.footprint.map((v) => pyRound(v, 1));
  form.note(`Footprint ${fmtG(rw)} x ${fmtG(rd)} mm on a ${fmtG(pv.surfaceSize[0])} x ${fmtG(pv.surfaceSize[1])} mm surface. X/Y is ` +
    "the footprint's corner, measured across the surface as seen from the side it is on.");

  // The margins for the four sides next to its surface, in the same order
  // and with the same names as Stick to; the recess's size across and up the
  // surface, named after the sides it runs between.
  const sides = meta.surfaceSides[`${spec.surface}|${spec.mount}`];
  const pairs = [["left", "right"], ["front", "back"], ["bottom", "top"]];
  const between = {};
  for (const d of ["u", "v"]) between[d] = pairs.find((p) => p[0] in sides && sides[p[0]][0] === d).join("-");
  const labels = {};
  for (const side of Object.keys(sides)) labels[`margin_${side}`] = `${side[0].toUpperCase()}${side.slice(1)} margin`;
  Object.assign(labels, {
    recess_width: `Recess width (${between.u})`, recess_height: `Recess height (${between.v})`, recess_hole: "Cable hole diameter",
    recess_hole_across: `Cable hole offset (${between.u})`, recess_hole_up: `Cable hole offset (${between.v})`,
  });
  const sections = [
    ["Margins", meta.stickSides[spec.surface].map((side) => [`margin_${side}`, type.commonParams[`margin_${side}`]]), true],
    ["Recess", type.recessParams.map((k) => [k, type.commonParams[k]]), true],
    ["Settings", type.deviceParams, false],
  ];
  for (const [heading, params, changesFootprint] of sections) {
    if (!params.length) continue;
    form.heading(heading);
    if (heading === "Margins") form.note("Space between it and each side of the case. Stuck to a side, it sits that far from it.");
    for (const [name, param] of params) {
      const [dflt, label, choices] = param;
      // A margin or a choice (a subassembly's mounting, say) can change the
      // footprint, so the panel's footprint note needs redoing too.
      const rebuild = changesFootprint || Boolean(choices);
      const current = name in spec.params ? spec.params[name] : dflt;
      const setParam = (v) => ctx.change({ op: "set_param", id, name, value: v }, rebuild);
      let widget;
      if (choices) widget = form.combo(choices, current, setParam);
      else if (typeof dflt === "string") widget = form.line(current, setParam);
      else {
        // The recess depth goes down into the case: negative.
        const [lo, hi] = { recess_depth: [-1000, 0], recess_hole_across: [-1000, 1000], recess_hole_up: [-1000, 1000], angle: [-360, 360] }[name] || [0, 1000];
        widget = form.spin(current, setParam, { lo, hi, step: 0.5 });
      }
      form.row(labels[name] || paramLabel(name), widget, label);
      if (!name.startsWith("margin_")) form.note(label);
    }
  }

  if (pv.cuts.length) {
    form.heading(spec.kind === "subassembly" || type.kind === "subassembly" ? "Cutouts" : "Connector cuts");
    form.note(`Each opening this ${type.kind} needs. Untick any you don't want cut.`);
    for (const cut of pv.cuts) {
      form.add(form.check(`${cut.name} - ${cut.description}`, spec.connector_cuts[cut.name] ?? true,
        (on) => ctx.change({ op: "set_cut", id, name: cut.name, on })));
    }
    form.note("Connector cuts are cut from these parts once the design is assembled:");
    form.add(form.check(`Both parts of ${spec.case} (default)`, spec.connector_cut_targets === null,
      (on) => ctx.change({ op: "set_cut_default", id, on })));
    const targets = pv.targets;
    const box = el("div", { class: "indent" });
    for (const part of view.partIds) {
      box.append(form.check(part, targets.includes(part), (on) => ctx.change({ op: "set_cut_target", id, part, on }),
        { disabled: spec.connector_cut_targets === null }));
    }
    form.add(box);
  }
  form.buttons(button("Rotate 90", () => ctx.rotate(id)), button("Delete", () => ctx.deleteSelected()),
    button("Save template...", () => ctx.saveTemplate(id)));
}

function surfaceProps(form, ctx, caseId, name, mount) {
  const { meta, view } = ctx;
  const c = view.cases.find((x) => x.id === caseId);
  const s = c.surfaces.find((x) => x.name === name && x.mount === mount);
  form.heading(`${caseId}: ${name} surface, ${mount}`);
  form.note(`${fmtG(s.width)} x ${fmtG(s.height)} mm, ${fmtG(s.thickness)} mm thick, on part ${s.part}.`);
  // What's on it, either side - devices go inside whichever side was clicked.
  const here = view.placements.filter((p) => p.case === caseId && p.surface === name)
    .sort((p, q) => (p.mount === mount ? 0 : 1) - (q.mount === mount ? 0 : 1) || p.id.localeCompare(q.id));
  form.heading("On this surface");
  if (!here.length) form.note("Nothing yet.");
  else {
    form.add(el("div", { class: "placed" }, here.map((p) => {
      const type = meta.types[p.type];
      return el("button", { type: "button", class: "placed-item", title: `Select ${p.id}`, onclick: () => ctx.select(["placement", p.id]) },
        el("span", { class: "placed-id" }, p.id),
        el("span", { class: "placed-type" }, `${type ? type.displayName : p.type}, ${p.mount}`));
    })));
  }
  form.heading("Add");
  for (const kind of ["device", "subassembly"]) {
    const names = kind === "device" ? meta.devices : meta.subassemblies;
    if (!names.length) continue;
    const choice = typeSelect(meta, names);
    form.row(kind[0].toUpperCase() + kind.slice(1), choice);
    // (A device goes on its own side of the surface - inside, mostly; a subassembly on this one.)
    form.buttons(button(`Add ${kind} here`, () => ctx.addPlacement(choice.value, caseId, name,
      (kind === "device" && meta.types[choice.value].defaultMount) || mount, null, null, mount)));
  }
  form.note("Tip: right-clicking the surface adds a device or subassembly where you clicked.");
  decorationProps(form, ctx, caseId, name, mount);
}

/** Text and a picture engraved into this surface's outside face. */
function decorationProps(form, ctx, caseId, name, mount) {
  const c = ctx.design.cases.find((x) => x.id === caseId);
  form.heading("Decoration");
  form.note(`Text and a picture engraved into the ${name}'s outside face${mount === "outside" ? "" : " (whichever side you clicked)"}, ` +
    "each optionally inlaid in other colours. The text is cut first; the picture fills the rest of the face.");
  const layers = (c.decorations || {})[name] || {};
  const defaults = (kind) => Object.fromEntries(ctx.meta.decorationFields[kind].map((f) => [f[0], f[1]]));
  for (const [kind, title] of [["text", "Text"], ["image", "Picture"]]) {
    form.add(form.check(title, kind in layers, (on) => ctx.change({ op: "decoration_toggle", case: caseId, surface: name, kind, on })));
    if (!(kind in layers)) continue;
    // The file holds only what differs from the defaults.
    const settings = { ...defaults(kind), ...layers[kind] };
    for (const field of ctx.meta.decorationFields[kind]) {
      const [fieldName, dflt, label, choices] = field;
      const value = settings[fieldName];
      const setValue = (v) => ctx.change({ op: "decoration_set", case: caseId, surface: name, kind, field: fieldName, value: v });
      let widget;
      if (choices) widget = form.combo(choices, value, setValue);
      else if (typeof dflt === "string") {
        widget = form.line(value, setValue);
        if (fieldName === "file") {
          const line = widget;
          widget = [line, button("Browse...", async () => {
            const chosen = await ctx.browsePicture(line.value);
            if (chosen) setValue(chosen);
          })];
        }
      } else {
        const [lo, hi, step, decimals] = DECORATION_SPINS[fieldName] || [0, 1000, 0.5, 1];
        const unit = fieldName === "angle" ? "deg" : ["across", "up", "size", "depth", "gap", "line_width", "detail"].includes(fieldName) ? "mm" : "";
        widget = form.spin(value, setValue, { lo, hi, step, decimals, unit });
      }
      form.row(`  ${paramLabel(fieldName)}`, widget, label);
    }
  }
}
