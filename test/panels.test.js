// Panel cases: a base made of a floor and four walls, bolted together.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildParts, check } from "../lib/builder.js";
import * as cases from "../lib/cases.js";
import { CaseSpec, Design, HingeSpec, Placement, partInCaseMatrix, PANEL_BLOCK_DEPTH, PANEL_BLOCK_WIDTH,
  PANEL_FILLET } from "../lib/design.js";
import { applyEdit } from "../lib/edits.js";
import * as kernel from "../lib/kernel.js";

const quiet = () => {};
const STYLES = [["Square", {}], ["MusicBox", {}], ["RoundBottom", {}], ["Rounded", { edge: 6 }], ["Bevelled", { edge: 4 }]];
const PANELS = ["floor", "front", "back", "left", "right"];

function panelCase(style = "Square", extra = {}) {
  return new Design({ cases: [new CaseSpec("case", { style, height: 40.0, panels: true, min_width: 80, min_depth: 60, ...extra })] });
}

test("a panel case's settings are only written when it's made of panels, and are checked", () => {
  const plain = new CaseSpec("c", {});
  assert.equal(plain.panels, false);
  assert.ok(!("panels" in plain.to_dict()) && !("panel_nuts" in plain.to_dict()));
  assert.deepEqual(plain.parts, ["c.base", "c.lid"]);
  const panels = new CaseSpec("c", { panels: true, panel_bolt_spacing: 30, panel_nuts: true });
  const d = panels.to_dict();
  assert.deepEqual([d.panels, d.panel_bolt_spacing, d.panel_nuts], [true, 30, true]);
  assert.deepEqual(CaseSpec.from_dict(d).to_dict(), d);
  assert.deepEqual(panels.parts, [...PANELS.map((p) => `c.${p}`), "c.lid"]);
  assert.throws(() => new CaseSpec("c", { panels: "yes" }), /panels must be true or false/);
  assert.throws(() => new CaseSpec("c", { panels: true, panel_bolt_spacing: 5 }), /panel_bolt_spacing must be at least 10/);
});

test("a panel case builds into five panels and a lid that fit together without overlapping", () => {
  for (const [style, extra] of STYLES) {
    for (const panel_nuts of [false, true]) {
      const design = panelCase(style, { panel_nuts, ...extra });
      design.relayout();
      const kase = design.cases[0];
      kernel.scope(() => {
        const [shapes] = buildParts(design, { log: quiet });
        const [parts, problems] = check(design, shapes);
        assert.deepEqual(problems, [], style);
        assert.deepEqual(Object.keys(parts).sort(), kase.parts.slice().sort());
        for (const p of kase.parts) assert.ok(parts[p].solids === 1 && parts[p].valid, `${style}: ${p}`);
        // (A RoundBottom's lid has always overlapped its base a little.)
        const ids = style === "RoundBottom" ? kase.base_parts : kase.parts;
        const all = ids.map((p) => shapes[p].transformed(partInCaseMatrix(kase, p)));
        for (let i = 0; i < all.length; i++) {
          for (let j = 0; j < i; j++) assert.ok(all[i].common(all[j]).Volume < 0.01, `${style}: ${ids[i]} and ${ids[j]} overlap`);
        }
        const placed = kase.base_parts.map((p) => shapes[p].transformed(partInCaseMatrix(kase, p)));
        // Together they're the plain (square-cornered) base, less only the bolts' holes.
        const plain = cases.makeBox(kase).get_base();
        const missing = plain.cut(kernel.compound(placed)).Volume;
        assert.ok(missing < 0.03 * plain.Volume, `${style}: ${missing} of ${plain.Volume} missing`);
        // Each panel lies on its outside face to print, and is no thicker
        // than its wall and its blocks (or the corners it takes) - nothing
        // left over from splitting it off reaches across the case.
        for (const p of kase.base_parts) {
          const [, , , , z0, z1] = shapes[p].bounds();
          const floor = p === kase.floor_part;
          assert.ok(Math.abs(z0 - (floor ? -kase.base_thickness : 0.0)) < 1e-6, `${style}: ${p} starts at ${z0}`);
          const most = floor ? 0.0 : kase.wall_thickness + PANEL_BLOCK_DEPTH;
          assert.ok(z1 <= most + 1e-6, `${style}: ${p} is ${z1} thick`);
        }
        // The fillets: along the bottom of each wall, and up the corners on the left and right walls.
        const W = kase.width, D = kase.depth, f = PANEL_FILLET / 3.0;
        const at = (p, [x, y, z]) => placed[kase.base_parts.indexOf(p)].common(kernel.makeBox(0.2, 0.2, 0.2, [x - 0.1, y - 0.1, z - 0.1])).Volume;
        for (const [p, point] of [["front", [W / 2, f, f]], ["back", [W / 2, D - f, f]], ["left", [f, D / 2, f]], ["right", [W - f, D / 2, f]],
          ["left", [f, f, 20]], ["left", [f, D - f, 20]], ["right", [W - f, f, 20]], ["right", [W - f, D - f, 20]]]) {
          assert.ok(at(`case.${p}`, point) > 0.007, `${style}: no fillet on the ${p} panel at ${point}`);
        }
      });
    }
  }
});

test("a panel case's bolts are no further apart than its spacing, each through one panel into a block on another", () => {
  for (const spacing of [20, 40, 100]) {
    const design = panelCase("MusicBox", { panel_bolt_spacing: spacing, min_width: 120, min_depth: 90, height: 70.0 });
    design.relayout();
    const kase = design.cases[0];
    const bolts = design.panel_bolts(kase);
    const groups = new Map();
    for (const b of bolts) {
      assert.notEqual(b.through, b.block);
      const key = `${b.kind}|${b.side}|${b.end}`;
      groups.set(key, [...(groups.get(key) || []), b]);
    }
    assert.equal([...groups.keys()].filter((k) => k.startsWith("floor")).length, 4);
    assert.equal([...groups.keys()].filter((k) => k.startsWith("corner")).length, 4);
    for (const [key, list] of groups) {
      const axis = key.startsWith("corner") ? 2 : list[0].dir[2] && (list[0].side === "left" || list[0].side === "right") ? 1 : 0;
      const at = list.map((b) => b.head[axis]).sort((a, b) => a - b);
      for (let i = 1; i < at.length; i++) {
        assert.ok(at[i] - at[i - 1] <= spacing + 1e-6, `${key}: ${at}`);
        assert.ok(at[i] - at[i - 1] >= PANEL_BLOCK_WIDTH, `${key}: blocks overlap at ${at}`);
      }
    }
    kernel.scope(() => {
      const [shapes] = buildParts(design, { log: quiet });
      const placed = Object.fromEntries(kase.parts.map((p) => [p, shapes[p].transformed(partInCaseMatrix(kase, p))]));
      for (const b of bolts) {
        // A bolt's line is clear through both panels; round it, there's its block.
        const length = Math.hypot(...[0, 1, 2].map((i) => b.end_at[i] - b.head[i]));
        const line = kernel.makeCylinder(0.5, length - 1.0, b.head.map((v, i) => v + b.dir[i] * 0.5), b.dir);
        for (const p of [b.through, b.block]) assert.ok(placed[p].common(line).Volume < 1e-3, `${b.kind} bolt into ${b.side}: ${p}`);
        const round = kernel.makeCylinder(2.2, 2.0, b.end_at.map((v, i) => v - b.dir[i] * 4.0), b.dir).cut(
          kernel.makeCylinder(1.8, 2.0, b.end_at.map((v, i) => v - b.dir[i] * 4.0), b.dir));
        assert.ok(placed[b.block].common(round).Volume > 0.5 * round.Volume, `${b.kind} bolt into ${b.side}: no block round it`);
      }
    });
  }
});

test("what's in a panel case keeps clear of its bolts' blocks", () => {
  for (const [style, extra] of STYLES) {
    const design = panelCase(style, { min_width: 0, min_depth: 0, ...extra });
    for (const surface of ["bottom", "front", "back", "left", "right", "top"]) {
      design.placements.push(new Placement(`pico_${surface}`, "Pico", "case", { surface, mount: "inside" }));
    }
    design.placements.push(new Placement("corner", "Pico", "case", { surface: "bottom", mount: "inside", stick: ["left", "front"] }));
    design.relayout();
    assert.deepEqual(design.problems().map((p) => p[0]), [], style);
    const kase = design.cases[0];
    assert.ok(design.panel_bolts(kase).length >= 12);
  }
});

test("a panel case's hinge stays on one panel, and switching to panels keeps connector cuts on the base", () => {
  const hinged = (edge, margin) => {
    const design = new Design({ cases: [new CaseSpec("a", { style: "RoundBottom", height: 40.0, panels: true, min_width: 80, min_depth: 70 }),
      new CaseSpec("b", { style: "RoundBottom", height: 40.0, panels: true })], hinges: [new HingeSpec("h", ["a", "b"], { edge, margin })] });
    design.relayout();
    return design.problems().map((p) => p[0]).filter((m) => m.startsWith("Hinge h"));
  };
  assert.deepEqual(hinged("back", 10), []);
  assert.deepEqual(hinged("left", 2), []); // (the left and right panels run the whole depth)
  const [message] = hinged("back", 2);
  assert.match(message, /runs across the joints .* left and right panels; make its margin at least 3\.0/);
  assert.deepEqual(hinged("back", 3), []);
  // Turning panels on and off moves connector cuts aimed at the base to all of it.
  const design = new Design({ cases: [new CaseSpec("case", { style: "Square", height: 40.0 })] });
  design.placements.push(new Placement("p", "Pico", "case", { surface: "bottom", connector_cut_targets: ["case.base"] }));
  design.relayout();
  const on = applyEdit(design.to_dict(), { op: "set", kind: "case", id: "case", field: "panels", value: true });
  assert.ok(on.ok, on.message);
  assert.deepEqual(on.design.placements[0].connector_cut_targets, PANELS.map((p) => `case.${p}`));
  const off = applyEdit(on.design.to_dict(), { op: "set", kind: "case", id: "case", field: "panels", value: false });
  assert.deepEqual(off.design.placements[0].connector_cut_targets, ["case.base"]);
});
