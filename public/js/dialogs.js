// Dialogs: a small modal framework, a file browser for the server's disk,
// and the editor's Add case / Add hinge / Add device and subassembly
// dialogs.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as api from "./api.js";
import { typeSelect } from "./groups.js";
import { COLORS, parseStl } from "./scene.js";

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

/** Show a modal; `build(close)` returns {body, buttons: [[text, value or fn,
cls]]}. Resolves to the value of the button pressed (null for Escape). */
export function modal(title, build) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    const backdrop = el("div", { class: "modal-backdrop" });
    const box = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title });
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(null);
      }
    };
    const { body, buttons = [], onEnter = null } = build(close);
    const footer = el("div", { class: "footer" });
    for (const [text, value, cls] of buttons) {
      footer.append(el("button", {
        type: "button", class: cls || null,
        onclick: async () => {
          if (typeof value === "function") {
            const result = await value();
            if (result !== undefined) close(result);
          } else close(value);
        },
      }, text));
    }
    box.append(el("h2", {}, title), el("div", { class: "body" }, body), footer);
    backdrop.append(box);
    root.append(backdrop);
    document.addEventListener("keydown", onKey, true);
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && onEnter && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "BUTTON") {
        e.preventDefault();
        onEnter(close);
      }
    });
    const first = box.querySelector("input, select, textarea") || footer.querySelector("button.primary") || footer.querySelector("button");
    if (first) setTimeout(() => first.focus(), 0);
  });
}

export function message(title, text) {
  return modal(title, () => ({ body: el("div", { class: "note" }, text), buttons: [["OK", true, "primary"]] }));
}

/** Yes / no: resolves true for yes. */
export async function confirm(title, text, yes = "Yes", no = "No") {
  return (await modal(title, () => ({ body: el("div", {}, text), buttons: [[no, false], [yes, true, "primary"]] }))) === true;
}

/** Save / Discard / Cancel: resolves "save", "discard" or null. */
export function confirmDiscard(name) {
  return modal("Unsaved changes", () => ({
    body: el("div", {}, `Save changes to ${name} first?`),
    buttons: [["Cancel", null], ["Discard", "discard"], ["Save", "save", "primary"]],
  }));
}

export function prompt(title, label, value = "") {
  const input = el("input", { type: "text", value });
  return modal(title, () => ({
    body: el("div", { class: "form" }, el("label", {}, label), input),
    buttons: [["Cancel", null], ["OK", () => input.value, "primary"]],
    onEnter: (close) => close(input.value),
  }));
}

export function chooseFrom(title, label, options) {
  const select = el("select", {}, options.map(([value, text]) => el("option", { value }, text)));
  return modal(title, () => ({
    body: el("div", { class: "form" }, el("label", {}, label), select),
    buttons: [["Cancel", null], ["OK", () => select.value, "primary"]],
  }));
}

// -- file browser --

/** Browse the server's disk. mode: "open" (a file), "save" (a file name),
"folder" (a folder) or "file-or-folder". filter: "json", "stl", "image" or
"". upload: let a file be uploaded from this computer instead. Resolves to
a path or null. */
export function browse({ title, mode = "open", filter = "", dir = null, name = "", upload = null }) {
  let current = null;
  let selected = null;
  const where = el("input", { type: "text" });
  const entries = el("div", { class: "entries" });
  const places = el("div", { class: "places" });
  const nameInput = el("input", { type: "text", value: name });
  const error = el("div", { class: "error" });
  let closeDialog = null;

  const load = async (target) => {
    try {
      const res = await api.get("/api/browse", { dir: target || "", filter });
      current = res;
      where.value = res.dir;
      error.textContent = "";
      entries.replaceChildren();
      if (res.parent) entries.append(entry({ name: "..", path: res.parent, dir: true }));
      for (const e of res.entries) entries.append(entry(e));
      places.replaceChildren(...res.places.map(([label, p]) => el("button", { type: "button", onclick: () => load(p) }, label)),
        ...res.drives.map((d) => el("button", { type: "button", onclick: () => load(d) }, d)));
    } catch (e) {
      error.textContent = e.message;
    }
  };
  const entry = (e) => {
    const row = el("div", { class: "entry", title: e.path }, el("span", { class: "icon" }, e.dir ? "\u{1F4C1}" : "\u{1F4C4}"), e.name);
    row.addEventListener("click", () => {
      entries.querySelectorAll(".selected").forEach((x) => x.classList.remove("selected"));
      row.classList.add("selected");
      selected = e;
      if (!e.dir && mode === "save") nameInput.value = e.name;
    });
    row.addEventListener("dblclick", () => {
      if (e.dir) load(e.path);
      else if (mode !== "folder") closeDialog(e.path);
    });
    return row;
  };
  where.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      load(where.value);
    }
  });

  const choose = () => {
    if (mode === "save") {
      const n = nameInput.value.trim();
      if (!n) return undefined;
      if (/^([a-zA-Z]:)?[\\/]/.test(n)) return n;
      return current.dir + current.sep + n;
    }
    if (mode === "folder") return selected && selected.dir && selected.name !== ".." ? selected.path : current.dir;
    if (selected && !selected.dir) return selected.path;
    if (mode === "file-or-folder") return selected && selected.dir && selected.name !== ".." ? selected.path : current.dir;
    if (selected && selected.dir) {
      load(selected.path);
      return undefined;
    }
    return undefined;
  };

  const uploader = upload ? el("input", { type: "file", accept: upload.accept || null, style: "display:none" }) : null;
  if (uploader) {
    uploader.addEventListener("change", async () => {
      if (!uploader.files.length) return;
      try {
        const file = await api.upload(uploader.files[0], upload.to || "uploads");
        closeDialog(file);
      } catch (e) {
        error.textContent = e.message;
      }
    });
  }

  return modal(title, (close) => {
    closeDialog = close;
    load(dir);
    const body = el("div", { class: "browser" }, places, el("div", {},
      el("div", { class: "where" }, where, el("button", { type: "button", onclick: () => load(where.value) }, "Go")),
      entries,
      mode === "save" ? el("div", { class: "name-row" }, el("label", {}, "File name"), nameInput) : null,
      uploader, error));
    const buttons = [["Cancel", null]];
    if (uploader) buttons.unshift([upload.label || "Upload from this computer...", () => {
      uploader.click();
      return undefined;
    }]);
    const label = mode === "save" ? "Save" : mode === "folder" ? "Choose this folder" : mode === "file-or-folder" ? "Show" : "Open";
    buttons.push([label, choose, "primary"]);
    return { body, buttons, onEnter: () => {
      const v = choose();
      if (v !== undefined) close(v);
    } };
  });
}

// -- adding things --

export function addCaseDialog(meta, caseId) {
  const idInput = el("input", { type: "text", value: caseId });
  const style = el("select", {}, meta.caseStyles.map((s) => el("option", { value: s }, s)));
  const fields = {};
  const rows = [];
  for (const [name, dflt, label] of meta.caseFields.slice(1)) {
    if (name === "width" || name === "depth") continue; // worked out from what's placed in it (see the minimums)
    const input = el("input", { type: "number", step: "0.1", min: meta.minimums.includes(name) ? 0 : 0.5, max: 2000, value: dflt, title: label });
    fields[name] = input;
    rows.push(el("label", { title: label }, name === "edge" ? "Edge (Rounded, Bevelled)" : label.split(" (mm)")[0]), input);
  }
  const values = () => {
    const out = { style: style.value };
    for (const [name, input] of Object.entries(fields)) out[name] = Number(input.value);
    return [idInput.value.trim(), out];
  };
  return modal("Add case", () => ({
    body: el("div", { class: "form" }, el("label", {}, "Id"), idInput, el("label", {}, "Style"), style, rows,
      el("div", { class: "note wide" }, "Width and depth follow the devices and subassemblies you place in the case, and every case in " +
        "the design gets the same width and depth. Set a minimum to keep it from being smaller than that.")),
    buttons: [["Cancel", null], ["OK", values, "primary"]],
    onEnter: (close) => close(values()),
  }));
}

export function addHingeDialog(meta, design, hingeId) {
  const ids = design.cases.map((c) => c.id);
  const driven = new Set(design.hinges.map((h) => h.cases[1]));
  const idInput = el("input", { type: "text", value: hingeId });
  const a = el("select", {}, ids.map((i) => el("option", { value: i }, i)));
  const free = ids.filter((i) => !driven.has(i));
  const b = el("select", {}, free.map((i) => el("option", { value: i }, i)));
  if (free.length > 1 && free[0] === a.value) b.value = free[1];
  const edge = el("select", {}, meta.edges.map((e) => el("option", { value: e }, e)));
  const angle = el("input", { type: "number", min: 0, max: 180, step: 5, value: 110 });
  const values = () => ({ id: idInput.value.trim(), cases: [a.value, b.value], edge: edge.value, open_angle: Number(angle.value) });
  return modal("Add hinge", () => ({
    body: el("div", { class: "form" }, el("label", {}, "Id"), idInput, el("label", {}, "Fixed case"), a,
      el("label", {}, "Hinged case"), b, el("label", {}, "Edge"), edge, el("label", {}, "Open angle (deg)"), angle,
      el("div", { class: "note wide" }, "The hinged case is placed by the hinge: it folds shut upside down on top of the fixed case at " +
        "0 degrees, and lies flat behind it at 180.")),
    buttons: [["Cancel", null], ["OK", values, "primary"]],
    onEnter: (close) => close(values()),
  }));
}

/** Place a device, or (kind "subassembly") a subassembly. */
export function addPlacementDialog(meta, design, { caseId = null, surface = null, mount = "inside", kind = "device" }) {
  const names = kind === "device" ? meta.devices : meta.subassemblies;
  const type = typeSelect(meta, names);
  const kase = el("select", {}, design.cases.map((c) => el("option", { value: c.id }, c.id)));
  if (caseId) kase.value = caseId;
  const surf = el("select", {}, meta.surfaces.map((s) => el("option", { value: s }, s)));
  if (surface) surf.value = surface;
  const mountSel = el("select", {}, meta.mounts.map((m) => el("option", { value: m }, m)));
  mountSel.value = mount;
  // Each type starts on its own side (inside, mostly); it can still be changed.
  const typeMount = () => {
    if (meta.types[type.value] && meta.types[type.value].defaultMount) mountSel.value = meta.types[type.value].defaultMount;
  };
  type.addEventListener("change", typeMount);
  typeMount();
  const stick = el("div", { class: "checks" });
  const fillStick = () => {
    stick.replaceChildren();
    for (const side of meta.stickSides[surf.value]) {
      const box = el("input", { type: "checkbox", "data-side": side });
      box.addEventListener("change", () => {
        if (box.checked) {
          const other = stick.querySelector(`[data-side="${meta.opposite[side]}"]`);
          if (other) other.checked = false;
        }
      });
      stick.append(el("label", {}, box, side));
    }
  };
  surf.addEventListener("change", fillStick);
  fillStick();
  const values = () => ({
    type: type.value, case: kase.value, surface: surf.value, mount: mountSel.value,
    stick: [...stick.querySelectorAll("input:checked")].map((b) => b.dataset.side),
  });
  return modal(`Add ${kind}`, () => ({
    body: el("div", { class: "form" }, el("label", {}, kind[0].toUpperCase() + kind.slice(1)), type, el("label", {}, "Case"), kase,
      el("label", {}, "Surface"), surf, el("label", {}, "Inside or outside"), mountSel, el("label", {}, "Stick to"), stick),
    buttons: [["Cancel", null], ["OK", values, "primary"]],
  }));
}

// -- subassemblies --

/** Make a subassembly from STL files, or edit one (`existing`: its spec).
Resolves to the server's answer once it's saved, or null. */
export function subassemblyDialog({ existing = null, design = null }) {
  const name = el("input", { type: "text", placeholder: "e.g. MyBoard (letters, digits, _)", value: existing ? existing.name : "" });
  if (existing) name.disabled = true; // renaming would orphan designs that use it
  const display = el("input", { type: "text", value: existing ? existing.display_name : "" });
  const description = el("input", { type: "text", value: existing ? existing.description : "" });
  const mock = el("input", { type: "text", value: existing ? existing.mock_path : "" });
  const size = el("div", { class: "note" }, "Choose a mock STL to see the subassembly's size.");
  const cutoutRows = el("tbody");
  const mountEdits = {};
  const previewMounting = el("select", {}, ["top", "underneath"].map((m) => el("option", { value: m }, m)));
  const error = el("div", { class: "error" });
  const view = el("div", { class: "preview" });

  const stlBrowse = (input, title) => async () => {
    const start = input.value ? input.value.replace(/[\\/][^\\/]*$/, "") : null;
    const chosen = await browse({ title, filter: "stl", dir: start || null, upload: { accept: ".stl" } });
    if (chosen) {
      input.value = chosen;
      update(true);
    }
  };
  const pathRow = (input, title) => el("div", { class: "pathrow" }, input, el("button", { type: "button", onclick: stlBrowse(input, title) }, "Browse..."));
  mock.addEventListener("change", () => update(true));

  const addCutoutRow = (cname, cdesc, cpath) => {
    const cells = [cname, cdesc, cpath].map((v) => {
      const input = el("input", { type: "text", value: v });
      input.addEventListener("change", () => update());
      return input;
    });
    const row = el("tr", {}, cells.map((c) => el("td", {}, c)));
    row.addEventListener("click", () => {
      cutoutRows.querySelectorAll(".selected").forEach((r) => r.classList.remove("selected"));
      row.classList.add("selected");
    });
    cutoutRows.append(row);
  };
  if (existing) for (const c of existing.cutouts) addCutoutRow(c.name, c.description, c.path);
  const addCutouts = async () => {
    const chosen = await browse({ title: "Cutout STL", filter: "stl", dir: mock.value ? mock.value.replace(/[\\/][^\\/]*$/, "") : null,
      upload: { accept: ".stl" } });
    if (!chosen) return;
    let stem = chosen.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_]/g, "_");
    if (!stem || !/^[A-Za-z]/.test(stem)) stem = "cutout_" + stem;
    addCutoutRow(stem, stem, chosen);
    update();
  };
  const removeCutout = () => {
    cutoutRows.querySelectorAll(".selected").forEach((r) => r.remove());
    update();
  };

  const mountRows = [];
  for (const mounting of ["top", "underneath"]) {
    for (const key of ["fixings", "holes"]) {
      const input = el("input", { type: "text" });
      const files = existing && existing.mountings[mounting];
      if (files && files[`${key}_path`]) input.value = files[`${key}_path`];
      input.addEventListener("change", () => update());
      mountEdits[`${mounting}|${key}`] = input;
      mountRows.push(el("label", {}, `${mounting[0].toUpperCase()}${mounting.slice(1)} ${key}`),
        pathRow(input, `${mounting[0].toUpperCase()}${mounting.slice(1)} ${key} STL`));
    }
  }
  previewMounting.addEventListener("change", () => update());

  const cutoutList = () => [...cutoutRows.querySelectorAll("tr")].map((r) => {
    const [n, d, f] = [...r.querySelectorAll("input")].map((i) => i.value.trim());
    return { name: n, description: d || n, file: f };
  });
  const mountings = () => {
    const out = {};
    for (const [k, input] of Object.entries(mountEdits)) {
      const [mounting, key] = k.split("|");
      if (input.value.trim()) (out[mounting] = out[mounting] || {})[key] = input.value.trim();
    }
    return out;
  };

  // The preview: the mock in grey, the cutouts and the chosen mounting's
  // holes in red and its fixings in blue, with the frame's origin marked.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(COLORS.background);
  view.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100000);
  camera.up.set(0, 0, 1);
  scene.add(camera, new THREE.HemisphereLight(0xffffff, 0x8a8a96, 1.6));
  const light = new THREE.DirectionalLight(0xffffff, 1.5);
  light.position.set(0.3, 0.5, 1);
  camera.add(light);
  const controls = new OrbitControls(camera, renderer.domElement);
  const draw = () => renderer.render(scene, camera);
  controls.addEventListener("change", draw);
  const content = new THREE.Group();
  scene.add(content);
  const resize = () => {
    const w = view.clientWidth || 400;
    const h = view.clientHeight || 400;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
  };
  new ResizeObserver(resize).observe(view);
  const meshCache = new Map();
  const geometry = (p) => {
    if (!meshCache.has(p)) meshCache.set(p, api.stlFile(p).then(parseStl).catch(() => null));
    return meshCache.get(p);
  };
  let token = 0;
  async function update(resetCamera = false) {
    const mine = ++token;
    const items = [];
    let bounds = null;
    if (mock.value.trim()) {
      try {
        bounds = (await api.get("/api/stlbounds", { path: mock.value.trim() })).bounds;
        const b = bounds;
        size.textContent = `Size (from the mock): ${(b[1] - b[0]).toFixed(1)} x ${(b[3] - b[2]).toFixed(1)} x ${(b[5] - b[4]).toFixed(1)} mm ` +
          `(X ${b[0].toFixed(1)}..${b[1].toFixed(1)}, Y ${b[2].toFixed(1)}..${b[3].toFixed(1)}, Z ${b[4].toFixed(1)}..${b[5].toFixed(1)})`;
        items.push([mock.value.trim(), new THREE.Color().setRGB(0.75, 0.77, 0.8, THREE.SRGBColorSpace), 0.9]);
      } catch (e) {
        size.textContent = `Can't read the mock: ${e.message}`;
      }
    }
    for (const c of cutoutList()) if (c.file) items.push([c.file, COLORS.cut, 0.35]);
    const files = mountings()[previewMounting.value] || {};
    if (files.fixings) items.push([files.fixings, COLORS.placement, 0.9]);
    if (files.holes) items.push([files.holes, COLORS.cut, 0.45]);
    const loaded = await Promise.all(items.map(async ([p, c, o]) => [await geometry(p), c, o]));
    if (mine !== token) return;
    content.clear();
    for (const [g, color, opacity] of loaded) {
      if (!g) continue;
      content.add(new THREE.Mesh(g, new THREE.MeshPhongMaterial({ color, opacity, transparent: opacity < 1, depthWrite: opacity >= 1,
        side: THREE.DoubleSide, flatShading: true })));
    }
    const axisSize = bounds ? Math.max(bounds[1] - bounds[0], bounds[3] - bounds[2]) / 4 : 10;
    content.add(new THREE.AxesHelper(axisSize));
    if (resetCamera) {
      const box = new THREE.Box3().setFromObject(content);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      controls.target.copy(sphere.center);
      camera.position.copy(sphere.center).add(new THREE.Vector3(0.6, -1.0, 0.9).normalize().multiplyScalar(sphere.radius / Math.sin(Math.PI / 12) / 1.1));
      camera.near = Math.max(0.01, sphere.radius / 500);
      camera.far = sphere.radius * 200;
      camera.updateProjectionMatrix();
      controls.update();
    }
    draw();
  }

  const save = async () => {
    error.textContent = "";
    try {
      return await api.post("/api/subassembly/save", {
        name: name.value.trim(), displayName: display.value.trim(), description: description.value.trim(), mock: mock.value.trim(),
        cutouts: cutoutList(), mountings: mountings(), overwrite: Boolean(existing), design,
      });
    } catch (e) {
      error.textContent = `Can't save the subassembly: ${e.message}`;
      return undefined;
    }
  };

  const result = modal(existing ? "Edit subassembly" : "New subassembly", () => ({
    body: el("div", { class: "sub-dialog" },
      el("div", {},
        el("div", { class: "form" },
          el("label", {}, "Subassembly name"), name, el("label", {}, "Display name"), display, el("label", {}, "Description"), description,
          el("label", {}, "Mock STL"), pathRow(mock, "Mock STL"), el("div", { class: "wide" }, size),
          el("div", { class: "wide note" }, el("b", {}, "Cutouts"), " - closed STL meshes lined up with the mock, each cut out of the case exactly as drawn."),
          el("div", { class: "wide" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Name"), el("th", {}, "Description"), el("th", {}, "STL file"))), cutoutRows)),
          el("div", { class: "wide" }, el("button", { type: "button", onclick: addCutouts }, "Add cutout..."), " ",
            el("button", { type: "button", onclick: removeCutout }, "Remove")),
          el("div", { class: "wide note" }, el("b", {}, "Mountings"), " - STL files lined up with the mock. Fixings (standoffs, brackets...) are " +
            "fused to the surface it's fixed to; holes (screw holes...) are cut through it. ", el("b", {}, "Top"), " is for sitting on top " +
            "of a surface, which is where the fixings end at the bottom; ", el("b", {}, "underneath"), " is for hanging below one, top side " +
            "towards it, which is where the fixings end at the top. Both are optional."),
          mountRows, el("label", {}, "Preview"), previewMounting),
        error),
      view),
    buttons: [["Cancel", null], ["Save", save, "primary"]],
  }));
  setTimeout(() => {
    resize();
    update(true);
  }, 0);
  return result.finally(() => {
    controls.dispose();
    renderer.dispose();
  });
}
