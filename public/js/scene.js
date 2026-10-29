// The 3D view: three.js drawing of a design (or of printable parts), with
// picking and dragging. Colours and opacities follow the Python editor's.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import * as geom from "/lib/geom.js";
import { stlFile } from "./api.js";

const rgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
export const COLORS = {
  base: rgb(0.80, 0.82, 0.85),
  lid: rgb(0.55, 0.68, 0.86),
  surfaceSelected: rgb(1.0, 0.78, 0.15),
  placement: rgb(0.20, 0.55, 0.95),
  placementSelected: rgb(1.0, 0.50, 0.05),
  placementProblem: rgb(0.90, 0.20, 0.25),
  cut: rgb(0.95, 0.15, 0.15),
  hinge: rgb(0.85, 0.68, 0.25),
  builtBase: rgb(0.62, 0.66, 0.72),
  builtLid: rgb(0.40, 0.55, 0.78),
  inlay: rgb(0.95, 0.70, 0.15),
  edges: rgb(0.25, 0.25, 0.3),
  background: rgb(0.97, 0.97, 0.98),
};
const BUILT_OPACITY = { base: 1.0, lid: 0.45, inlay: 1.0 }; // see-through lids, so what's under them shows
const PRINT_SPACING = 35.0; // mm between parts in the Print parts view (room for the labels)
const PRINT_PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6", "#bcf60c", "#008080", "#9a6324"];

/** A row-major 16-array (as the server sends matrices) as a THREE.Matrix4. */
export function matrix4(flat) {
  return new THREE.Matrix4().set(...flat);
}

/** A row-major 16-array as geom's nested 4x4. */
export function nested(flat) {
  return [flat.slice(0, 4), flat.slice(4, 8), flat.slice(8, 12), flat.slice(12, 16)];
}

function material(color, opacity = 1.0) {
  const transparent = opacity < 1.0;
  return new THREE.MeshPhongMaterial({
    color, opacity, transparent, depthWrite: !transparent, side: transparent ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: true, shininess: 20, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
}

function boxGeometry(b) {
  const g = new THREE.BoxGeometry(Math.max(b.w, 1e-4), Math.max(b.d, 1e-4), Math.max(b.h, 1e-4));
  g.translate(b.x + b.w / 2, b.y + b.d / 2, b.z + b.h / 2);
  return g;
}

export class View {
  constructor(container, axesContainer) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(COLORS.background);
    container.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.style.position = "absolute";
    this.labels.domElement.style.top = "0";
    this.labels.domElement.style.pointerEvents = "none";
    container.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 100000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(550, -1000, 750);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a96, 1.6));
    const light = new THREE.DirectionalLight(0xffffff, 1.6);
    light.position.set(0.3, 0.5, 1);
    this.camera.add(light);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.zoomToCursor = true;
    this.controls.addEventListener("change", () => this.render());

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.pickable = [];
    this.placementOf = new Map(); // object -> placement id
    this.placementGroups = new Map(); // placement id -> {group, world, surfaceWorld, x, y}
    this.stlCache = new Map();
    this.stlLoader = new STLLoader();

    this._axes(axesContainer);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  _axes(container) {
    this.axesRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.axesRenderer.setPixelRatio(window.devicePixelRatio);
    this.axesRenderer.setSize(110, 110);
    container.appendChild(this.axesRenderer.domElement);
    this.axesScene = new THREE.Scene();
    this.axesCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.axesCamera.up.set(0, 0, 1);
    const colours = [0xd62728, 0x2ca02c, 0x1f77b4];
    ["X", "Y", "Z"].forEach((name, i) => {
      const dir = new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);
      this.axesScene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(), 1, colours[i], 0.25, 0.12));
      const sprite = this._letter(name, colours[i]);
      sprite.position.copy(dir.clone().multiplyScalar(1.3));
      this.axesScene.add(sprite);
    });
  }

  _letter(text, colour) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = `#${colour.toString(16).padStart(6, "0")}`;
    ctx.font = "bold 44px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 32, 34);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sprite.scale.set(0.45, 0.45, 0.45);
    return sprite;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => {
      this._pending = false;
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
      const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
      this.axesCamera.position.copy(dir.multiplyScalar(4.2));
      this.axesCamera.up.copy(this.camera.up);
      this.axesCamera.lookAt(0, 0, 0);
      this.axesRenderer.render(this.axesScene, this.axesCamera);
    });
  }

  clear() {
    this.root.traverse((o) => {
      if (o.geometry && !o.userData.sharedGeometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
      if (o.isCSS2DObject && o.element.parentNode) o.element.parentNode.removeChild(o.element);
    });
    this.root.clear();
    this.pickable = [];
    this.placementOf = new Map();
    this.placementGroups = new Map();
  }

  // -- drawing --

  _box(parent, b, matrix, color, opacity = 1.0, { pickable = true, edges = false } = {}) {
    const g = boxGeometry(b);
    const mesh = new THREE.Mesh(g, material(color, opacity));
    if (matrix) {
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(matrix);
    }
    parent.add(mesh);
    if (edges) {
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: COLORS.edges }));
      lines.matrixAutoUpdate = false;
      lines.matrix.copy(mesh.matrix);
      parent.add(lines);
    }
    if (pickable) this.pickable.push(mesh);
    return mesh;
  }

  _label(parent, text, position, cls = "") {
    const div = document.createElement("div");
    div.className = `label3d ${cls}`;
    div.textContent = text;
    const label = new CSS2DObject(div);
    label.position.set(...position);
    parent.add(label);
  }

  _mesh(parent, geometry, color, opacity, matrix = null, pickable = true) {
    const mesh = new THREE.Mesh(geometry, material(color, opacity));
    mesh.userData.sharedGeometry = true;
    if (matrix) {
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(matrix);
    }
    parent.add(mesh);
    if (pickable) this.pickable.push(mesh);
    return mesh;
  }

  /** An STL file on the server as a BufferGeometry (kept). */
  async stlGeometry(path) {
    if (!this.stlCache.has(path)) {
      this.stlCache.set(path, stlFile(path).then((buf) => this.stlLoader.parse(buf)).catch(() => null));
    }
    return this.stlCache.get(path);
  }

  forgetStls() {
    this.stlCache.clear();
  }

  /** Draw a design. `built` is {parts: Map(id -> {geometry, world: Matrix4,
  colour}), ready} - the live build, shown in place of the layout panels
  once it's there. `owner(partId)` says which case or placement a built part
  belongs to, and `shown(key)` whether that's visible. */
  showDesign(args) {
    this._building = this._showDesign(args);
    return this._building;
  }

  async _showDesign({ view, options, selection, built, problemIds, shown, owner }) {
    const token = (this._token = (this._token || 0) + 1);
    // STL previews first, so the scene is swapped in one go.
    const meshPaths = new Set();
    for (const p of view.placements) {
      for (const m of p.meshes) meshPaths.add(m.path);
      for (const c of p.cuts) if (c.enabled && c.mesh) meshPaths.add(c.mesh.path);
    }
    const geometries = new Map();
    await Promise.all([...meshPaths].map(async (path) => geometries.set(path, await this.stlGeometry(path))));
    if (token !== this._token) return;

    this.clear();
    const root = this.root;
    const showBuilt = options.built && built && built.parts.size > 0;

    for (const c of view.cases) {
      if (!shown(["case", c.id])) continue;
      const cm = matrix4(c.matrix);
      if (options.layout || !showBuilt) this._caseSlabs(c, cm, options.lids);
      this._label(root, c.id, c.label, "case");
    }

    if (selection && selection[0] === "surface") {
      const [, caseId, name, mount] = selection;
      const c = view.cases.find((x) => x.id === caseId);
      const s = c && c.surfaces.find((x) => x.name === name && x.mount === mount);
      if (s) this._box(root, { x: 0, y: 0, z: 0, w: s.width, d: s.height, h: 0.4 }, matrix4(s.matrix), COLORS.surfaceSelected, 0.55, { pickable: false });
    }

    for (const h of view.hinges) {
      if (!shown(["hinge", h.id])) continue;
      for (const barrel of h.barrels) {
        const g = new THREE.CylinderGeometry(h.radius, h.radius, Math.max(barrel.length, 0.01), 32);
        g.rotateZ(-Math.PI / 2); // along X
        const mesh = new THREE.Mesh(g, material(COLORS.hinge));
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(matrix4(barrel.matrix));
        root.add(mesh);
      }
      // The rails joining the barrel to each case.
      for (const rail of h.rails) this._box(root, rail.box, matrix4(rail.matrix), COLORS.hinge, 0.6, { pickable: false });
    }

    if (showBuilt) {
      for (const [partId, part] of built.parts) {
        if (!shown(owner(partId))) continue;
        let kind = partId.endsWith(".lid") ? "lid" : "base";
        let color = null;
        if (partId.includes(".deco.")) {
          kind = "inlay";
          const parent = partId.split(".deco.")[0];
          if (parent.endsWith(".lid") && !options.lids) continue;
          if (part.colour) color = rgb(...part.colour.map((v) => v / 255));
        } else if (partId.includes(".inlay")) {
          kind = "inlay";
          const specId = partId.split(".inlay")[0];
          const p = view.placements.find((x) => x.id === specId);
          if (p && p.onLid && !options.lids) continue;
        }
        if (kind === "lid" && !options.lids) continue;
        const base = kind === "lid" ? COLORS.builtLid : kind === "inlay" ? COLORS.inlay : COLORS.builtBase;
        this._mesh(root, part.geometry, color || base, BUILT_OPACITY[kind], part.world);
      }
    }

    const selectedPlacement = selection && selection[0] === "placement" ? selection[1] : null;
    for (const p of view.placements) {
      if (!shown(["placement", p.id])) continue;
      const world = matrix4(p.world);
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      group.matrix.copy(world);
      root.add(group);
      this.placementGroups.set(p.id, { group, world, surfaceWorld: matrix4(p.surfaceWorld), x: p.x, y: p.y });
      const color = p.id === selectedPlacement ? COLORS.placementSelected : problemIds.has(p.id) ? COLORS.placementProblem : COLORS.placement;
      for (const b of p.bodies) {
        if (p.meshes.length && (b.label === "mock" || b.label === "fixings")) continue; // drawn as the meshes themselves
        const opacity = { pillar: 0.9, engraving: 0.15 }[b.label] ?? 0.75;
        const mesh = this._box(group, b, null, color, opacity, { edges: b.label !== "pillar" });
        this.placementOf.set(mesh, p.id);
      }
      for (const m of p.meshes) {
        const g = geometries.get(m.path);
        if (!g) continue;
        const mesh = this._mesh(group, g, color, 0.85, matrix4(m.matrix));
        this.placementOf.set(mesh, p.id);
      }
      // Every connector cut that is switched on is drawn, so the view always
      // shows exactly which openings will be made.
      for (const cut of p.cuts) {
        if (!cut.enabled) continue;
        if (cut.mesh) {
          const g = geometries.get(cut.mesh.path);
          if (g) this._mesh(group, g, COLORS.cut, 0.25, matrix4(cut.mesh.matrix), false);
          continue;
        }
        for (const b of cut.boxes) this._box(group, b, null, COLORS.cut, 0.18, { pickable: false });
      }
      this._label(root, p.id, p.label);
    }
    this.root.updateMatrixWorld(true);
    this.render();
  }

  _caseSlabs(c, cm, showLid) {
    const W = c.width, D = c.depth, H = c.height;
    const t = c.wall_thickness, bt = c.base_thickness, lt = c.lid_thickness, lh = c.lid_height;
    const B = (x, y, z, w, d, h) => ({ x, y, z, w, d, h });
    this._box(this.root, B(-t, -t, -bt, W + 2 * t, D + 2 * t, bt), cm, COLORS.base, 1.0, { edges: true });
    for (const slab of [B(-t, -t, 0, W + 2 * t, t, H), B(-t, D, 0, W + 2 * t, t, H), B(-t, 0, 0, t, D, H), B(W, 0, 0, t, D, H)]) {
      this._box(this.root, slab, cm, COLORS.base, 0.55, { edges: true });
    }
    if (showLid) {
      this._box(this.root, B(-t, -t, H, W + 2 * t, D + 2 * t, lt), cm, COLORS.lid, 0.35, { edges: true });
      const h2 = t / 2.0;
      for (const skirt of [B(-t, -t, H - lh, W + 2 * t, h2, lh), B(-t, D + h2, H - lh, W + 2 * t, h2, lh),
        B(-t, -t, H - lh, h2, D + 2 * t, lh), B(W + h2, -t, H - lh, h2, D + 2 * t, lh)]) {
        this._box(this.root, skirt, cm, COLORS.lid, 0.35, { pickable: false });
      }
    }
  }

  /** Every mesh ({name, geometry}) in its own grid cell on the X/Y plane,
  sitting on the bed and labelled. */
  showPrint(meshes, emptyText = "Nothing to show") {
    this._token = (this._token || 0) + 1;
    this._building = null;
    this.clear();
    if (!meshes.length) {
      this._label(this.root, emptyText, [0, 0, 0]);
      this.render();
      return;
    }
    const items = [...meshes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const m of items) if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const cellW = Math.max(...items.map((m) => m.geometry.boundingBox.max.x - m.geometry.boundingBox.min.x)) + PRINT_SPACING;
    const cellD = Math.max(...items.map((m) => m.geometry.boundingBox.max.y - m.geometry.boundingBox.min.y)) + PRINT_SPACING;
    const columns = Math.max(1, Math.ceil(Math.sqrt(items.length)));
    items.forEach((m, i) => {
      const b = m.geometry.boundingBox;
      const col = i % columns;
      const row = Math.floor(i / columns);
      const dx = col * cellW - b.min.x;
      const dy = row * cellD - b.min.y;
      const mesh = new THREE.Mesh(m.geometry, material(new THREE.Color(PRINT_PALETTE[i % PRINT_PALETTE.length])));
      mesh.userData.sharedGeometry = true;
      mesh.position.set(dx, dy, -b.min.z);
      this.root.add(mesh);
      this._label(this.root, m.name, [dx + (b.min.x + b.max.x) / 2, dy + b.min.y - 8, 0]);
    });
    this.root.updateMatrixWorld(true);
    this.render();
  }

  /** Point the camera at everything shown, from in front, above and to the
  right (from above, in the Print parts view). */
  async resetCamera(fromAbove = false) {
    // After the scene being drawn now is there.
    while (this._building) {
      const building = this._building;
      await building;
      if (this._building === building) this._building = null;
    }
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.root.traverse((o) => {
      if (o.isMesh) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      }
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(...(fromAbove ? [0.25, -0.8, 1.2] : [0.55, -1.0, 0.75])).normalize();
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    const distance = sphere.radius / Math.sin(fit / 2) / 1.15;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).add(dir.multiplyScalar(distance));
    this.camera.near = Math.max(0.1, distance / 1000);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  // -- picking and dragging --

  _ray(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    return raycaster;
  }

  /** What's under the mouse: {placement: id}, or {point, normal} (world) of
  whatever else was hit, or {}. */
  pick(clientX, clientY) {
    const hits = this._ray(clientX, clientY).intersectObjects(this.pickable, false);
    if (!hits.length) return {};
    const hit = hits[0];
    const placement = this.placementOf.get(hit.object);
    if (placement) return { placement };
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    return { point: hit.point.toArray(), normal: normal.toArray() };
  }

  /** Where the mouse ray meets the plane of the surface whose frame (world)
  is `surfaceWorld`, in the surface's [u, v]; null looking edge-on. */
  surfaceUV(clientX, clientY, surfaceWorld) {
    const ray = this._ray(clientX, clientY).ray;
    const inv = surfaceWorld.clone().invert();
    const a = ray.origin.clone().applyMatrix4(inv);
    const b = ray.origin.clone().add(ray.direction).applyMatrix4(inv);
    if (Math.abs(b.z - a.z) < 1e-9) return null;
    const t = -a.z / (b.z - a.z);
    return [a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)];
  }

  /** Slide a drawn placement to (x, y) on its surface, while it's dragged. */
  movePlacement(id, x, y) {
    const p = this.placementGroups.get(id);
    if (!p) return;
    // world = surface . T(x, y) . F, where F (the footprint's turn and any
    // recess) doesn't change as it slides.
    const at = (px, py) => p.surfaceWorld.clone().multiply(new THREE.Matrix4().makeTranslation(px, py, 0));
    const f = at(p.x, p.y).invert().multiply(p.world);
    p.group.matrix.copy(at(x, y).multiply(f));
    p.group.updateMatrixWorld(true);
    this.render();
  }
}

/** The surface a clicked world point lies on (Design.surface_at() in the
Python): [case id, surface, mount, [u, v]] or null. */
export function surfaceAt(view, point, normal, tolerance = 0.75) {
  let best = null;
  for (const c of view.cases) {
    for (const s of c.surfaces) {
      const inv = geom.inverseRigid(nested(s.matrix));
      const p = geom.applyPoint(inv, point);
      const n = geom.applyVector(inv, normal);
      if (Math.abs(p[2]) <= tolerance && n[2] > 0.5 && p[0] >= -tolerance && p[0] <= s.width + tolerance &&
        p[1] >= -tolerance && p[1] <= s.height + tolerance) {
        if (best === null || Math.abs(p[2]) < best[0]) best = [Math.abs(p[2]), [c.id, s.name, s.mount, [p[0], p[1]]]];
      }
    }
  }
  return best ? best[1] : null;
}

/** A built part's mesh (from the live build) as a BufferGeometry. */
export function meshGeometry(vertices, triangles) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  g.setIndex(new THREE.BufferAttribute(triangles, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function parseStl(buffer) {
  return new STLLoader().parse(buffer);
}
