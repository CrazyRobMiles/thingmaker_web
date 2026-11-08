// The thingmaker editor in the browser: the design is held here as the
// server's JSON (Design.to_dict()), every edit is sent to the server, which
// applies it, lays the design out again and sends back the new design and
// what to draw. The real parts are rebuilt on the server a moment after
// every change and shown in place of the layout.
import * as api from "./api.js";
import * as dialogs from "./dialogs.js";
import { el } from "./dialogs.js";
import { byCategory } from "./groups.js";
import { helpDialog } from "./help.js";
import { renderProps, SNAP } from "./props.js";
import * as recovery from "./recovery.js";
import { View, matrix4, meshGeometry, parseStl, surfaceAt } from "./scene.js";
import { fmtG, pyRound } from "/lib/py.js";

const LIVE_DELAY_MS = 250; // quiet time after a change before the model is rebuilt
const WATCH_MS = 1000; // how often built STL files are checked for changes
const CLICK_SLOP = 4; // pixels the mouse may move and still count as a click

const state = {
  meta: null,
  design: null, // the design's dict
  view: null, // what the server says to draw for it
  path: null,
  dirty: false,
  undo: [],
  redo: [],
  selection: null, // ["case"|"hinge"|"placement", id] or ["surface", case, name, mount]
  hidden: new Set(), // "kind|id" of things left out of the view
  lastClickUV: null,
  drag: null,
  built: { parts: new Map() }, // the live build: part id -> {geometry, world, colour}
  liveProblems: [],
  liveSnapshot: null, // JSON of the design the live build is of
  liveRunning: false,
  builtSnapshot: null, // the design the STL files were last written from
  manifestMtime: null,
  printView: false,
  stlSource: null, // file/folder shown in the Print parts view; null = this design's live parts
  printMeshes: new Map(), // name -> {geometry, mtime}
  options: { layout: false, lids: true, built: true },
  build: null,
  propWidgets: {},
};

const $ = (sel) => document.querySelector(sel);
const view3d = new View($("#viewport"), $("#axes"));
let liveTimer = null;
// For poking at from the browser's developer tools.
window.thingmaker = { state, view: view3d, select };

// -- status bar --

let statusTimer = null;
const DEFAULT_STATUS = "Click a surface to select it, right-click it to add a device or subassembly. Drag one to move it.";

function status(text, ms = 6000, flash = false) {
  const s = $("#status");
  s.textContent = text;
  s.classList.toggle("flash", flash);
  clearTimeout(statusTimer);
  if (ms) {
    statusTimer = setTimeout(() => {
      s.textContent = DEFAULT_STATUS;
      s.classList.remove("flash");
    }, ms);
  }
}

function updateBuiltLabel() {
  const current = JSON.stringify(state.design);
  let model = "";
  if (state.design.cases.length) model = state.liveSnapshot === current && !state.liveRunning ? "Model up to date" : "Rebuilding the model...";
  let files;
  if (state.builtSnapshot === null) files = "STL files not written yet";
  else if (JSON.stringify(state.builtSnapshot) === current) files = "STL files up to date";
  else files = "STL files out of date - press Build (F5)";
  $("#built-label").textContent = [model, files].filter(Boolean).join(" | ");
}

function updateTitle() {
  const name = state.path ? state.path.replace(/^.*[\\/]/, "") : "unsaved";
  document.title = `${state.design.name}${state.dirty ? " *" : ""} - ${name} - thingmaker`;
}

// -- edits --

let queue = Promise.resolve();

/** Run fn after everything already queued (edits go to the server one at a
time, each from the design the last one left). */
function enqueue(fn) {
  const run = queue.then(fn);
  queue = run.catch((e) => {
    console.error(e);
    status(String(e.message || e), 8000, true);
  });
  return run;
}

function setDesign(design, view) {
  state.design = design;
  state.view = view;
}

/** Apply an edit as one undoable change. If the server says it leaves the
design invalid, nothing changes and the status bar says why. */
function change(edit, rebuildProps = true, before = null) {
  return enqueue(async () => {
    const start = before || state.design;
    const res = await api.post("/api/edit", { design: start, edit });
    if (!res.ok) {
      status(res.message, 8000, true);
      setDesign(res.design, res.view);
      refresh(true);
      return false;
    }
    state.undo.push(start);
    state.redo = [];
    state.dirty = true;
    setDesign(res.design, res.view);
    if (res.select) state.selection = res.select;
    refresh(rebuildProps || Boolean(res.select));
    if (res.message) status(res.message, 8000);
    if (res.fit) view3d.resetCamera(state.printView);
    return true;
  });
}

function undo() {
  enqueue(async () => {
    if (!state.undo.length) return;
    state.redo.push(state.design);
    const res = await api.post("/api/view", { design: state.undo.pop() });
    setDesign(res.design, res.view);
    state.dirty = true;
    refresh();
  });
}

function redo() {
  enqueue(async () => {
    if (!state.redo.length) return;
    state.undo.push(state.design);
    const res = await api.post("/api/view", { design: state.redo.pop() });
    setDesign(res.design, res.view);
    state.dirty = true;
    refresh();
  });
}

/** Apply a value still being typed into a properties field, and wait for it. */
async function commitPending() {
  const active = document.activeElement;
  if (active && $("#props").contains(active) && (active.tagName === "INPUT" || active.tagName === "SELECT")) active.blur();
  await queue;
}

// -- refreshing --

function kindOf(id) {
  if (state.design.cases.some((c) => c.id === id)) return "case";
  if (state.design.hinges.some((h) => h.id === id)) return "hinge";
  return "placement";
}

function allPlacements() {
  return [...state.design.devices, ...state.design.subassemblies];
}

function selectionStillValid() {
  const sel = state.selection;
  if (!sel) return;
  if (sel[0] === "surface") {
    if (!state.design.cases.some((c) => c.id === sel[1])) state.selection = null;
    return;
  }
  const items = sel[0] === "case" ? state.design.cases : sel[0] === "hinge" ? state.design.hinges : allPlacements();
  if (!items.some((i) => i.id === sel[1])) state.selection = null;
}

function refresh(rebuildProps = true) {
  selectionStillValid();
  clearTimeout(liveTimer);
  liveTimer = setTimeout(startLiveBuild, LIVE_DELAY_MS);
  refreshScene();
  rebuildTree();
  rebuildProblems();
  if (rebuildProps) rebuildProps_();
  else updatePropValues();
  updateTitle();
  recovery.note(state);
  const enable = (action, on) => {
    $(`[data-action="${action}"]`).disabled = !on;
  };
  enable("undo", state.undo.length > 0);
  enable("redo", state.redo.length > 0);
  enable("add-hinge", state.design.cases.length >= 2);
  enable("add-device", state.design.cases.length > 0);
  enable("add-subassembly", state.design.cases.length > 0 && state.meta.subassemblies.length > 0);
  enable("delete", Boolean(state.selection) && state.selection[0] !== "surface");
}

function hiddenKey(key) {
  return key && state.hidden.has(`${key[0]}|${key[1]}`);
}

/** Is [kind, id] shown? A placement goes with its case. */
function shown(key) {
  if (!key) return true;
  if (hiddenKey(key)) return false;
  if (key[0] === "placement") {
    const p = allPlacements().find((x) => x.id === key[1]);
    return !(p && state.hidden.has(`case|${p.case}`));
  }
  return true;
}

/** ["case", id] or ["placement", id] of whatever a built part belongs to -
inlays going with the part they're in. */
function owner(partId) {
  const parent = partId.split(".deco.")[0];
  const c = state.design.cases.find((x) => [`${x.id}.base`, `${x.id}.lid`].includes(parent));
  if (c) return ["case", c.id];
  const p = allPlacements().find((x) => parent.startsWith(x.id + "."));
  return p ? ["placement", p.id] : null;
}

function refreshScene() {
  if (state.printView) {
    if (state.stlSource) {
      view3d.showPrint([...state.printMeshes].map(([name, m]) => ({ name, geometry: m.geometry })), "No STL files there");
    } else {
      const meshes = [...state.built.parts].map(([name, p]) => ({ name, geometry: p.geometry }));
      view3d.showPrint(meshes, state.design.cases.length ? "Building..." : "Nothing to print yet - add a case");
    }
  } else {
    const problemIds = new Set(state.view.problems.flatMap(([, ids]) => ids));
    view3d.showDesign({ view: state.view, options: state.options, selection: state.selection, built: state.built, problemIds,
      shown, owner });
  }
  updateBuiltLabel();
}

function select(selection, rebuild = true) {
  state.selection = selection;
  refreshScene();
  syncTreeSelection();
  if (rebuild) rebuildProps_();
  $('[data-action="delete"]').disabled = !(selection && selection[0] !== "surface");
}

// -- live building --

async function startLiveBuild() {
  if (state.liveRunning) return;
  const design = state.design;
  const snapshot = JSON.stringify(design);
  if (snapshot === state.liveSnapshot) return;
  const wasEmpty = state.built.parts.size === 0;
  if (!design.cases.length) {
    state.liveSnapshot = snapshot;
    disposeBuilt();
    state.liveProblems = [];
    liveChanged();
    return;
  }
  state.liveRunning = true;
  updateBuiltLabel();
  let result = null;
  try {
    result = await api.liveBuild(design);
  } catch (e) {
    result = { parts: [], problems: [`The model couldn't be built: ${e.message}`] };
  }
  state.liveRunning = false;
  state.liveSnapshot = snapshot;
  disposeBuilt();
  for (const p of result.parts) {
    state.built.parts.set(p.id, { geometry: meshGeometry(p.vertices, p.triangles), world: matrix4(p.world), colour: p.colour });
  }
  state.liveProblems = result.problems;
  liveChanged();
  if (wasEmpty && state.built.parts.size && state.printView && !state.stlSource) view3d.resetCamera(true);
  if (snapshot !== JSON.stringify(state.design)) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(startLiveBuild, LIVE_DELAY_MS); // the design changed while it was building
  }
}

function disposeBuilt() {
  for (const p of state.built.parts.values()) p.geometry.dispose();
  state.built.parts = new Map();
}

function liveChanged() {
  refreshScene();
  rebuildProblems();
}

// -- tree and problems --

function rebuildTree() {
  const tree = $("#tree");
  const item = (text, data, tip = "") => {
    const li = el("li");
    const row = el("div", { class: data ? "row" : "row group", title: tip || null });
    if (data) {
      const box = el("input", { type: "checkbox", title: "Untick to hide it in the view" });
      box.checked = !state.hidden.has(`${data[0]}|${data[1]}`);
      box.addEventListener("click", (e) => e.stopPropagation());
      box.addEventListener("change", () => {
        const key = `${data[0]}|${data[1]}`;
        if (box.checked) state.hidden.delete(key);
        else state.hidden.add(key);
        refreshScene();
      });
      row.append(box);
      row.dataset.key = JSON.stringify(data);
      row.addEventListener("click", () => select(data));
    }
    row.append(text);
    li.append(row);
    return li;
  };
  const d = state.design;
  const root = item(`Design: ${d.name}`, null);
  const cases = item(`Cases (${d.cases.length})`, null);
  const caseList = el("ul");
  for (const c of d.cases) {
    const ci = item(`${c.id} - ${c.style} ${fmtG(c.width)} x ${fmtG(c.depth)} x ${fmtG(c.height)}`, ["case", c.id]);
    const sub = el("ul");
    for (const p of state.view.placements) {
      if (p.case === c.id) sub.append(item(`${p.id} - ${p.kind} ${p.type} on ${p.surface} (${p.mount})`, ["placement", p.id]));
    }
    if (sub.children.length) ci.append(sub);
    caseList.append(ci);
  }
  cases.append(caseList);
  const hinges = item(`Hinges (${d.hinges.length})`, null);
  const hingeList = el("ul");
  for (const h of d.hinges) hingeList.append(item(`${h.id} - ${h.cases[0]} to ${h.cases[1]}, ${h.edge} edge`, ["hinge", h.id]));
  hinges.append(hingeList);
  root.append(el("ul", {}, cases, hinges));
  tree.replaceChildren(el("ul", {}, root));
  syncTreeSelection();
}

function syncTreeSelection() {
  const want = state.selection && state.selection[0] !== "surface" ? JSON.stringify(state.selection) : null;
  for (const row of document.querySelectorAll("#tree .row[data-key]")) {
    const on = row.dataset.key === want;
    row.classList.toggle("selected", on);
    if (on) row.scrollIntoView({ block: "nearest" });
  }
}

function rebuildProblems() {
  const list = $("#problems");
  const problems = [...state.view.problems, ...state.liveProblems.map((p) => [p, []])];
  if (!problems.length) {
    list.replaceChildren(el("li", { class: "ok" }, "No problems found"));
    return;
  }
  list.replaceChildren(...problems.map(([message, ids]) => {
    const li = el("li", { title: message }, `! ${message}`);
    if (ids.length) li.addEventListener("click", () => select([kindOf(ids[0]), ids[0]]));
    return li;
  }));
}

// -- properties --

function propsContext() {
  return {
    design: state.design, view: state.view, meta: state.meta, selection: state.selection,
    change, select, addPlacementDialog, addPlacement, rotate: rotatePlacement, deleteSelected, rename, saveTemplate,
    browsePicture,
  };
}

/** Choose a picture for a decoration: the path to put in the design. */
async function browsePicture(current) {
  const start = current ? await api.pictureFolder(current) : current;
  const chosen = await dialogs.browse({ title: "Choose a picture", filter: "image",
    dir: start ? start.replace(/[\\/][^\\/]*$/, "") : null, upload: { accept: "image/*", to: "images" } });
  // (Relative to the thingmaker folder, so the design works on any computer.)
  return chosen ? api.storedPicturePath(chosen) : chosen;
}

function rebuildProps_() {
  state.propWidgets = renderProps($("#props"), propsContext());
}

/** Refresh the selected placement's position fields without rebuilding the
panel (while dragging and nudging). */
function updatePropValues(x = null, y = null) {
  if (!state.selection || state.selection[0] !== "placement") return;
  const spec = allPlacements().find((p) => p.id === state.selection[1]);
  if (!spec) return;
  if (state.propWidgets.x) state.propWidgets.x.value = String(pyRound(x ?? spec.x, 1));
  if (state.propWidgets.y) state.propWidgets.y.value = String(pyRound(y ?? spec.y, 1));
  if (state.propWidgets.rotation) state.propWidgets.rotation.value = String(spec.rotation);
}

// -- edit commands --

function rename(old, name) {
  return change({ op: "rename", old, name });
}

function rotatePlacement(id) {
  return change({ op: "rotate", id }, false);
}

async function deleteSelected() {
  const sel = state.selection;
  if (!sel || sel[0] === "surface") return;
  const id = sel[1];
  if (sel[0] === "case") {
    const n = allPlacements().filter((p) => p.case === id).length;
    const nh = state.design.hinges.filter((h) => h.cases.includes(id)).length;
    if ((n || nh) && !(await dialogs.confirm("Delete case",
      `Delete case ${id} together with the ${n} device(s)/subassembly(s) in it and ${nh} hinge(s)?`))) return;
  }
  state.selection = null;
  change({ op: "remove", id });
}

function uniqueId(prefix) {
  const taken = new Set([...state.design.cases, ...state.design.hinges, ...allPlacements()].map((x) => x.id));
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

async function addCaseDialog() {
  const result = await dialogs.addCaseDialog(state.meta, uniqueId("case"));
  if (!result) return;
  const [id, values] = result;
  change({ op: "add_case", id, values });
}

async function addHingeDialog() {
  const result = await dialogs.addHingeDialog(state.meta, state.design, uniqueId("hinge"));
  if (result) change({ op: "add_hinge", ...result });
}

async function addPlacementDialog(kind = "device") {
  let caseId = null;
  let surface = null;
  let mount = "inside";
  if (state.selection && state.selection[0] === "surface") [, caseId, surface, mount] = state.selection;
  else if (state.selection && state.selection[0] === "case") caseId = state.selection[1];
  const result = await dialogs.addPlacementDialog(state.meta, state.design, { caseId, surface, mount, kind });
  if (result) addPlacement(result.type, result.case, result.surface, result.mount, null, result.stick);
}

/** Add a `type` on the `mount` side of a surface, at `centre` - or failing
that where the surface was last clicked - measured on the side it was
clicked on (`clickedMount`). */
function addPlacement(type, caseId, surface, mount, centre = null, stick = null, clickedMount = mount) {
  const last = state.lastClickUV;
  if (centre === null && last && last[0] === caseId && last[1] === surface) [centre, clickedMount] = [last[3], last[2]];
  return change({ op: "add_placement", type, case: caseId, surface, mount, centre, centre_mount: clickedMount, stick: stick || [] });
}

function setStick(id, side, on) {
  return change({ op: "set_stick", id, side, on });
}

async function saveTemplate(id) {
  const paths = await api.get("/api/paths", state.path ? { path: state.path } : {});
  const file = await dialogs.browse({ title: "Save template", mode: "save", filter: "stl", dir: paths.outputDir, name: `${id}.template.stl` });
  if (!file) return;
  try {
    const res = await api.post("/api/template", { design: state.design, placement: id, path: file });
    status(`Saved the template for ${id} to ${res.path}`);
  } catch (e) {
    dialogs.message("Can't save the template", e.message);
  }
}

// -- the 3D view: clicking, dragging, the context menu, keys --

const canvas = view3d.renderer.domElement;
let pressed = null; // {button, x, y}

function pickAt(x, y) {
  if (state.printView) return {}; // the Print parts view is for looking only
  const hit = view3d.pick(x, y);
  if (hit.placement) return hit;
  if (hit.point) {
    const found = surfaceAt(state.view, hit.point, hit.normal);
    return found ? { surface: found } : {};
  }
  return {};
}

canvas.addEventListener("pointerdown", (e) => {
  pressed = { button: e.button, x: e.clientX, y: e.clientY };
  $("#viewport").focus({ preventScroll: true });
  hideContextMenu();
  if (e.button !== 0 || e.shiftKey || state.printView) return;
  const hit = pickAt(e.clientX, e.clientY);
  if (hit.placement) beginDrag(hit.placement, e);
}, { capture: true });

canvas.addEventListener("pointermove", (e) => {
  if (state.drag) dragTo(e);
});

canvas.addEventListener("pointerup", (e) => {
  if (state.drag) {
    endDrag();
    pressed = null;
    return;
  }
  const isClick = pressed && pressed.button === e.button && Math.abs(e.clientX - pressed.x) <= CLICK_SLOP &&
    Math.abs(e.clientY - pressed.y) <= CLICK_SLOP;
  pressed = null;
  if (!isClick) return;
  if (e.button === 0) click(e.clientX, e.clientY);
  else if (e.button === 2) contextMenu(e.clientX, e.clientY);
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function click(x, y) {
  const hit = pickAt(x, y);
  if (hit.placement) select(["placement", hit.placement]);
  else if (hit.surface) {
    const [caseId, name, mount, uv] = hit.surface;
    state.lastClickUV = [caseId, name, mount, uv];
    select(["surface", caseId, name, mount]);
    status(`${caseId}: ${name} surface (${mount}) - right-click it or use the panel to add a device or subassembly`);
  } else select(null);
}

function beginDrag(id, e) {
  const pv = state.view.placements.find((p) => p.id === id);
  const surfaceWorld = matrix4(pv.surfaceWorld);
  const uv = view3d.surfaceUV(e.clientX, e.clientY, surfaceWorld);
  if (!uv) return; // looking exactly edge-on at the surface
  view3d.controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
  state.drag = { id, matrix: surfaceWorld, offset: [pv.x - uv[0], pv.y - uv[1]], before: state.design, moved: false, x: pv.x, y: pv.y };
  if (!(state.selection && state.selection[0] === "placement" && state.selection[1] === id)) select(["placement", id]);
}

function dragTo(e) {
  const d = state.drag;
  const uv = view3d.surfaceUV(e.clientX, e.clientY, d.matrix);
  if (!uv) return;
  const x = pyRound((uv[0] + d.offset[0]) / SNAP) * SNAP;
  const y = pyRound((uv[1] + d.offset[1]) / SNAP) * SNAP;
  if (x !== d.x || y !== d.y) {
    d.x = x;
    d.y = y;
    d.moved = true;
    view3d.movePlacement(d.id, x, y);
    updatePropValues(x, y);
  }
}

function endDrag() {
  const d = state.drag;
  state.drag = null;
  view3d.controls.enabled = true;
  // Moved along a side it's stuck to, its margin on that side takes up the
  // move; dropping it can resize the cases and move others.
  if (d && d.moved) change({ op: "move", id: d.id, x: d.x, y: d.y }, true, d.before);
}

// Context menu

const menuEl = $("#context-menu");

function hideContextMenu() {
  menuEl.hidden = true;
  menuEl.replaceChildren();
}

function menuItem(text, fn, { checked = null, disabled = false } = {}) {
  return el("button", { type: "button", class: checked ? "checked" : null, disabled, onclick: () => {
    hideContextMenu();
    fn();
  } }, text);
}

function subMenu(text, items) {
  return el("div", { class: "sub" }, el("button", { type: "button" }, text), el("div", { class: "popup" }, items));
}

function contextMenu(x, y) {
  const hit = pickAt(x, y);
  const items = [];
  if (hit.placement) {
    const id = hit.placement;
    select(["placement", id]);
    const spec = allPlacements().find((p) => p.id === id);
    items.push(menuItem("Rotate 90 degrees", () => rotatePlacement(id)));
    items.push(subMenu("Stick to", state.meta.stickSides[spec.surface].map((side) =>
      menuItem(side, () => setStick(id, side, !spec.stick.includes(side)), { checked: spec.stick.includes(side) }))));
    items.push(menuItem("Save template...", () => saveTemplate(id)));
    items.push(menuItem(`Delete ${id}`, () => change({ op: "remove", id })));
  } else if (hit.surface) {
    const [caseId, name, mount, uv] = hit.surface;
    state.lastClickUV = [caseId, name, mount, uv];
    select(["surface", caseId, name, mount]);
    for (const kind of ["device", "subassembly"]) {
      const names = kind === "device" ? state.meta.devices : state.meta.subassemblies;
      // (Each device goes on its own side of the surface - inside, mostly - whichever was clicked.)
      const entry = (n) => menuItem(state.meta.types[n].displayName,
        () => addPlacement(n, caseId, name, state.meta.types[n].defaultMount || mount, uv, null, mount));
      const groups = byCategory(state.meta, names);
      const entries = groups.length < 2 ? names.map(entry) : groups.map(([label, members]) => subMenu(label, members.map(entry)));
      if (!entries.length) entries.push(menuItem("(none yet - File > New subassembly...)", () => {}, { disabled: true }));
      items.push(subMenu(kind === "device" ? `Add device to ${caseId} ${name}` : `Add ${kind} to ${caseId} ${name} (${mount})`, entries));
    }
  } else if (state.printView) {
    items.push(menuItem("Open STL files...", openStlDialog));
    if (state.stlSource) items.push(menuItem("Show this design's parts", () => showStlSource(null)));
    items.push(menuItem("Fit view", fit));
  } else {
    items.push(menuItem("Add case...", addCaseDialog));
    items.push(menuItem("Fit view", fit));
  }
  menuEl.replaceChildren(...items);
  menuEl.hidden = false;
  const w = menuEl.offsetWidth;
  const h = menuEl.offsetHeight;
  menuEl.style.left = `${Math.min(x, window.innerWidth - w - 4)}px`;
  menuEl.style.top = `${Math.min(y, window.innerHeight - h - 4)}px`;
}

document.addEventListener("pointerdown", (e) => {
  if (!menuEl.hidden && !menuEl.contains(e.target)) hideContextMenu();
  for (const menu of document.querySelectorAll(".menu")) if (!menu.contains(e.target)) menu.classList.remove("open");
});

function fit() {
  view3d.resetCamera(state.printView);
}

// Keys

function typing() {
  const a = document.activeElement;
  return a && (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA");
}

document.addEventListener("keydown", (e) => {
  if (document.querySelector(".modal-backdrop")) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (e.key === "Escape") hideContextMenu();
  if (e.key === "F1") {
    e.preventDefault();
    ACTIONS.help();
    return;
  }
  if (e.key === "F5") {
    e.preventDefault();
    build();
    return;
  }
  if (ctrl) {
    const actions = { n: newDesign, o: openDialog, s: e.shiftKey ? saveAs : save, z: e.shiftKey ? redo : undo, y: redo };
    if (actions[key]) {
      if ((key === "z" || key === "y") && typing()) return; // undo in the field being typed in
      e.preventDefault();
      actions[key]();
    }
    return;
  }
  if (typing() || e.altKey) return;
  if (key === "f") {
    fit();
    return;
  }
  const sel = state.selection;
  if (!sel || sel[0] !== "placement") {
    if (e.key === "Delete" && sel) deleteSelected();
    return;
  }
  const id = sel[1];
  const step = e.shiftKey ? 10.0 : 1.0;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  if (moves[e.key]) {
    e.preventDefault();
    const spec = allPlacements().find((p) => p.id === id);
    change({ op: "nudge", id, dx: moves[e.key][0], dy: moves[e.key][1] }, Boolean(spec && spec.stick.length));
  } else if (key === "r") rotatePlacement(id);
  else if (e.key === "Delete") deleteSelected();
});

// -- files --

async function confirmDiscard() {
  await commitPending();
  if (!state.dirty) return true;
  const answer = await dialogs.confirmDiscard(state.design.name);
  if (answer === "save") return save();
  return answer === "discard";
}

async function resetState(res, path) {
  setDesign(res.design, res.view);
  Object.assign(state, {
    path, hidden: new Set(), dirty: false, undo: [], redo: [], selection: null, builtSnapshot: null, manifestMtime: null,
    liveSnapshot: null, liveProblems: [], stlSource: null, lastClickUV: null,
  });
  disposeBuilt();
  clearPrintMeshes();
  refresh();
  await pollFiles();
  view3d.resetCamera(state.printView);
}

async function newDesign() {
  if (!(await confirmDiscard())) return;
  const name = await dialogs.prompt("New design", "Name", "Untitled");
  if (name === null) return;
  await resetState(await api.post("/api/new", { name, withCase: true }), null);
}

async function designsDir() {
  if (state.path) return state.path.replace(/[\\/][^\\/]*$/, "");
  return (await api.get("/api/paths")).designsDir;
}

async function openDialog() {
  if (!(await confirmDiscard())) return;
  const file = await dialogs.browse({ title: "Open design", filter: "json", dir: await designsDir() });
  if (file) await openPath(file);
}

async function openPath(file) {
  try {
    const res = await api.post("/api/open", { path: file });
    await resetState(res, res.path);
  } catch (e) {
    await dialogs.message("Can't open design", `${file}\n\n${e.message}`);
    refresh();
  }
}

async function save() {
  await commitPending();
  if (!state.path) return saveAs();
  try {
    const res = await api.post("/api/save", { path: state.path, design: state.design });
    state.path = res.path;
  } catch (e) {
    await dialogs.message("Can't save", e.message);
    return false;
  }
  state.dirty = false;
  updateTitle();
  recovery.note(state);
  recovery.keepVersion(state.path, state.design);
  status(`Saved ${state.path}`, 4000);
  return true;
}

/** Offer to bring back changes that weren't saved when the editor was last
closed (or crashed). Resolves true if they were. */
async function offerUnsaved(saved) {
  if (!saved) return false;
  const where = saved.path ? saved.path.replace(/^.*[\\/]/, "") : "a design that hasn't been saved yet";
  const when = new Date(saved.time).toLocaleString();
  if (!(await dialogs.confirm("Unsaved changes", `When thingmaker was last closed, ${where} ("${saved.design.name}") had ` +
    `changes that weren't saved (${when}). Bring them back?`, "Bring them back", "Discard them"))) {
    return false;
  }
  try {
    const res = await api.post("/api/view", { design: saved.design });
    await resetState(res, saved.path || null);
    state.undo = saved.undo || [];
    state.dirty = true;
    refresh();
    status("Brought back the unsaved changes - save them to keep them", 8000);
    return true;
  } catch (e) {
    await dialogs.message("Can't bring the changes back", e.message);
    return false;
  }
}

/** Go back to a version of this design kept when it was saved; it opens as
unsaved changes (undo goes back to what was there). */
async function earlierVersions() {
  await commitPending();
  const list = await recovery.versions(state.path);
  if (!list.length) {
    dialogs.message("Earlier versions", state.path ? "No earlier versions of this design have been kept yet - one is kept " +
      "each time it's saved." : "Earlier versions are kept each time a design is saved; this one hasn't been saved yet.");
    return;
  }
  const options = list.map((v, i) => [String(i), `${new Date(v.time).toLocaleString()} - ${v.name}`]);
  const chosen = await dialogs.chooseFrom("Earlier versions", "Saved at", options);
  if (chosen === null) return;
  const version = list[Number(chosen)];
  enqueue(async () => {
    const res = await api.post("/api/view", { design: version.design });
    state.undo.push(state.design);
    state.redo = [];
    setDesign(res.design, res.view);
    state.dirty = true;
    refresh();
    status(`Back to the version saved ${new Date(version.time).toLocaleString()} - save it to keep it`, 8000);
  });
}

async function saveAs() {
  await commitPending();
  const suggested = `${(state.design.name || "design").toLowerCase().replaceAll(" ", "_")}.json`;
  const file = await dialogs.browse({ title: "Save design", mode: "save", filter: "json", dir: await designsDir(), name: suggested });
  if (!file) return false;
  state.path = file;
  const ok = await save();
  if (ok) {
    state.manifestMtime = null;
    state.builtSnapshot = null;
    await pollFiles();
  }
  return ok;
}

window.addEventListener("beforeunload", (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// -- building --

function showBuildRunning(running) {
  const b = $("#build-button");
  b.textContent = running ? "Stop build" : "Build";
  b.title = running ? "Stop the build that's running (F5)" : "Write the parts out as STL files for printing (F5)";
  b.classList.toggle("running", running);
}

function logLine(text) {
  const log = $("#log");
  log.textContent += text + "\n";
  log.scrollTop = log.scrollHeight;
}

/** Start a build - or, while one is running, stop it. */
async function build() {
  if (state.build) {
    logLine("Stopping the build...");
    await api.post("/api/build/stop", { id: state.build.id });
    return;
  }
  await commitPending();
  if (!state.design.cases.length) {
    status("Nothing to build - add a case first", 5000);
    return;
  }
  const snapshot = state.design;
  const res = await api.post("/api/build", { design: snapshot, path: state.path });
  if (!res.ok) {
    status(res.message, 5000);
    return;
  }
  $("#log").textContent = "";
  $("#log-panel").hidden = false;
  view3d.resize();
  state.build = { id: res.id, snapshot };
  showBuildRunning(true);
  status("Writing the STL files... (Stop build to cancel)", 0);
  api.buildEvents(res.id, {
    line: logLine,
    end: (result) => {
      state.build = null;
      showBuildRunning(false);
      if (result.result === "stopped") {
        logLine("Build stopped.");
        status("Build stopped", 10000);
      } else if (result.result !== "built") {
        status("Build FAILED - see the build log", 10000, true);
      } else {
        for (const p of result.problems || []) logLine("WARNING: " + p);
        state.builtSnapshot = snapshot;
        updateBuiltLabel();
        status(`Built: STL files in ${result.outDir}`, 10000);
        pollFiles();
      }
    },
  });
}

// -- the Print parts view and watched files --

function clearPrintMeshes() {
  for (const m of state.printMeshes.values()) m.geometry.dispose();
  state.printMeshes = new Map();
}

/** Load every STL in the shown file or folder that is new or has changed,
and drop any that have gone. Resolves true if anything changed. */
async function reloadPrintMeshes() {
  if (!state.stlSource) return false;
  const source = state.stlSource;
  let files;
  try {
    files = (await api.get("/api/stls", { path: source })).files;
  } catch (e) {
    return false;
  }
  if (source !== state.stlSource) return false;
  let changed = false;
  const names = new Set(files.map((f) => f.name));
  for (const [name, m] of state.printMeshes) {
    if (!names.has(name)) {
      m.geometry.dispose();
      state.printMeshes.delete(name);
      changed = true;
    }
  }
  for (const f of files) {
    const had = state.printMeshes.get(f.name);
    if (had && had.mtime === f.mtime) continue;
    try {
      const geometry = parseStl(await api.stlFile(f.path));
      if (had) had.geometry.dispose();
      state.printMeshes.set(f.name, { geometry, mtime: f.mtime });
      changed = true;
    } catch (e) {
      // probably caught mid-write - try again next time
    }
  }
  return changed;
}

let polling = false;

/** Notice builds run outside the editor (node build.js), and pick up changes
to the STL files shown with File > Open STL files. */
async function pollFiles() {
  if (polling) return;
  polling = true;
  try {
    if (state.path && !state.build) {
      const res = await api.get("/api/buildstate", { path: state.path, known: state.manifestMtime ?? "" });
      if (res.manifestMtime !== state.manifestMtime) {
        state.manifestMtime = res.manifestMtime;
        state.builtSnapshot = res.manifestMtime === null ? null : res.snapshot ?? state.builtSnapshot ?? {};
        updateBuiltLabel();
      }
    }
    const wasEmpty = state.printMeshes.size === 0;
    if ((await reloadPrintMeshes()) && state.printView) {
      refreshScene();
      if (wasEmpty) view3d.resetCamera(true);
    }
  } catch (e) {
    // the server may be restarting; try again next time
  } finally {
    polling = false;
  }
}

async function openStlDialog() {
  const file = await dialogs.browse({ title: "Open STL files (a file, or a folder of them)", mode: "file-or-folder", filter: "stl" });
  if (file) showStlSource(file);
}

/** Show `source` (an STL file or a folder of them) in the Print parts view
- or this design's own parts if null. */
async function showStlSource(source) {
  state.stlSource = source;
  clearPrintMeshes();
  await reloadPrintMeshes();
  status(`Showing ${source || "this design's parts"}`);
  if (state.printView) {
    refreshScene();
    view3d.resetCamera(true);
  } else setPrintView(true);
}

function setPrintView(on) {
  state.printView = on;
  for (const b of document.querySelectorAll("[data-view]")) b.classList.toggle("on", (b.dataset.view === "print") === on);
  for (const box of document.querySelectorAll("[data-option]")) box.disabled = on;
  if (on) {
    reloadPrintMeshes().then((changed) => changed && refreshScene());
    state.selection = null;
    rebuildProps_();
    syncTreeSelection();
  }
  refreshScene();
  view3d.resetCamera(on);
}

// -- subassemblies --

async function subassemblySaved(result) {
  if (!result) return;
  state.meta = result.meta;
  view3d.forgetStls();
  if (result.design && JSON.stringify(result.design) !== JSON.stringify(state.design)) {
    state.undo.push(state.design);
    state.redo = [];
    state.dirty = true;
  }
  if (result.design) setDesign(result.design, result.view);
  refresh();
  status(`Saved subassembly in ${result.folder}`, 8000);
}

async function newSubassembly() {
  await commitPending();
  subassemblySaved(await dialogs.subassemblyDialog({ design: state.design }));
}

async function editSubassembly() {
  await commitPending();
  const names = state.meta.subassemblies;
  if (!names.length) {
    dialogs.message("Edit subassembly", "There are no subassemblies yet - use New subassembly... to make one.");
    return;
  }
  const name = await dialogs.chooseFrom("Edit subassembly", "Subassembly", names.map((n) => [n, n]));
  if (!name) return;
  const { spec } = await api.get("/api/subassembly", { name });
  subassemblySaved(await dialogs.subassemblyDialog({ existing: spec, design: state.design }));
}

// -- toolbar --

const ACTIONS = {
  new: newDesign, open: openDialog, save, "save-as": saveAs, "open-stl": openStlDialog,
  "new-subassembly": newSubassembly, "edit-subassembly": editSubassembly,
  undo, redo, "add-case": addCaseDialog, "add-hinge": addHingeDialog,
  "add-device": () => addPlacementDialog("device"), "add-subassembly": () => addPlacementDialog("subassembly"),
  delete: deleteSelected, build, fit, "earlier-versions": earlierVersions, about: () => dialogs.aboutDialog(),
  help: () => helpDialog({ web: Boolean(api.changeFolder) }),
};
// The web version's own commands (choosing the folder it works in, and
// putting fonts in it).
if (api.changeFolder) {
  ACTIONS["change-folder"] = async () => {
    if (await confirmDiscard()) api.changeFolder();
  };
  ACTIONS.fonts = async () => {
    if (!(await api.manageFonts())) return;
    if (await dialogs.confirm("Fonts added", "thingmaker starts again to use them. Start again now?", "Start again", "Later")
      && (await confirmDiscard())) {
      state.dirty = false; // (saved, or to be discarded)
      location.reload();
    }
  };
  // Bringing designs and subassemblies in from elsewhere on the computer.
  ACTIONS["import-design"] = async () => {
    if (!(await confirmDiscard())) return;
    const result = await api.importDesign();
    if (!result) return;
    if (result.meta) {
      state.meta = result.meta;
      view3d.forgetStls();
    }
    await openPath(result.path);
    status(`Imported into ${result.path}`, 8000);
  };
  ACTIONS["import-subassembly"] = async () => {
    const meta = await api.importSubassemblies();
    if (!meta) return;
    state.meta = meta;
    view3d.forgetStls();
    refresh();
  };
  for (const b of document.querySelectorAll('[data-action="change-folder"], [data-action="fonts"], [data-action="import-design"], ' +
    '[data-action="import-subassembly"], [data-action-group="folder"]')) b.hidden = false;
}

for (const b of document.querySelectorAll("[data-action]")) {
  b.addEventListener("click", () => {
    for (const menu of document.querySelectorAll(".menu")) menu.classList.remove("open");
    ACTIONS[b.dataset.action]();
  });
}
for (const menu of document.querySelectorAll(".menu")) {
  menu.querySelector(".menu-button").addEventListener("click", () => menu.classList.toggle("open"));
}
for (const b of document.querySelectorAll("[data-view]")) {
  b.addEventListener("click", () => {
    const on = b.dataset.view === "print";
    if (on !== state.printView) setPrintView(on);
  });
}
for (const box of document.querySelectorAll("[data-option]")) {
  box.addEventListener("change", () => {
    state.options[box.dataset.option] = box.checked;
    refreshScene();
  });
}
$("#log-close").addEventListener("click", () => {
  $("#log-panel").hidden = true;
  view3d.resize();
});

// The splitter between the view and the side panel.
{
  const splitter = $("#splitter");
  const sidebar = $("#sidebar");
  splitter.addEventListener("pointerdown", (e) => {
    splitter.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = sidebar.offsetWidth;
    const move = (ev) => {
      sidebar.style.width = `${Math.max(260, Math.min(window.innerWidth - 300, startW - (ev.clientX - startX)))}px`;
    };
    const up = () => {
      splitter.removeEventListener("pointermove", move);
      splitter.removeEventListener("pointerup", up);
    };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", up);
  });
}

// -- start --

async function start() {
  // (The web version first needs its folder.)
  if (api.ready) await api.ready();
  const unsaved = await recovery.unsaved();
  state.meta = await api.get("/api/meta");
  const startup = await api.get("/api/startup");
  await resetState(await api.post("/api/new", { name: "Untitled", withCase: true }), null);
  if (!(await offerUnsaved(unsaved))) {
    if (startup.designPath) await openPath(startup.designPath);
    else if (startup.stlSource) await showStlSource(startup.stlSource);
  }
  recovery.begin(state);
  setInterval(pollFiles, WATCH_MS);
}

start().catch((e) => {
  console.error(e);
  status(`Can't start: ${e.message}`, 0, true);
});
