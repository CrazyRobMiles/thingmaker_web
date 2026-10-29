// The editor's edits, as the server applies them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Design } from "../lib/design.js";
import { applyEdit } from "../lib/edits.js";
import * as kernel from "../lib/kernel.js";
import { view } from "../lib/view.js";

const CASE = { style: "MusicBox", height: 30, lid_height: 6, wall_thickness: 3, base_thickness: 3, lid_thickness: 3, edge: 3,
  min_width: 0, min_depth: 0 };

function run(dict, ...edits) {
  for (const edit of edits) {
    const result = kernel.scope(() => applyEdit(dict, edit));
    assert.ok(result.ok, `${edit.op}: ${result.message}`);
    dict = result.design.to_dict();
  }
  return dict;
}

test("a design is built up edit by edit", () => {
  let d = new Design({ name: "Edits" }).to_dict();
  d = run(d,
    { op: "add_case", id: "a", values: CASE },
    { op: "add_case", id: "b", values: CASE },
    { op: "add_hinge", id: "h", cases: ["a", "b"], edge: "back", open_angle: 100 },
    { op: "add_placement", type: "Pi3APlus", case: "a", surface: "bottom", mount: "inside", stick: ["left"] },
    { op: "set_param", id: "pi3aplus1", name: "margin_left", value: 4 },
    { op: "rotate", id: "pi3aplus1" },
    { op: "set_cut", id: "pi3aplus1", name: "audio", on: false },
    { op: "decoration_toggle", case: "a", surface: "top", kind: "text", on: true },
    { op: "decoration_set", case: "a", surface: "top", kind: "text", field: "size", value: 12 },
    { op: "rename", old: "a", name: "main" });
  assert.equal(d.cases[0].id, "main");
  assert.deepEqual(d.hinges[0].cases, ["main", "b"]);
  const pi = d.devices[0];
  assert.equal(pi.case, "main");
  assert.equal(pi.rotation, 90);
  assert.equal(pi.params.margin_left, 4);
  assert.equal(pi.connector_cuts.audio, false);
  assert.deepEqual(d.cases[0].decorations, { top: { text: { text: "Edits", size: 12 } } });
  // The second case is moved out of the first's way when it's added.
  assert.ok(d.cases[1].position[0] > 0 || d.hinges.length);
});

test("an edit that would break the design changes nothing and says why", () => {
  const d = run(new Design().to_dict(), { op: "add_case", id: "a", values: CASE });
  for (const [edit, why] of [
    [{ op: "set", kind: "case", id: "a", field: "height", value: -1 }, /must be positive/],
    [{ op: "add_case", id: "a", values: CASE }, /Duplicate id/],
    [{ op: "set", kind: "case", id: "a", field: "nonsense", value: 1 }, /Can't set/],
    [{ op: "remove", id: "nope" }, /No case, hinge/],
    [{ op: "frobnicate" }, /No such edit/],
  ]) {
    const result = kernel.scope(() => applyEdit(d, edit));
    assert.equal(result.ok, false);
    assert.match(result.message, why);
    assert.deepEqual(result.design.to_dict(), d);
  }
});

test("the view has what the browser draws", () => {
  const d = run(new Design().to_dict(), { op: "add_case", id: "a", values: CASE },
    { op: "add_placement", type: "Hole", case: "a", surface: "front", mount: "outside", centre: [20, 10] });
  const v = kernel.scope(() => view(Design.from_dict(d)));
  assert.equal(v.cases[0].surfaces.length, 12);
  assert.equal(v.cases[0].matrix.length, 16);
  assert.equal(v.placements[0].id, "hole1");
  assert.deepEqual(v.partIds, ["a.base", "a.lid"]);
});
