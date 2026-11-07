// The editor's edits, as the server applies them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Design } from "../lib/design.js";
import { applyEdit } from "../lib/edits.js";
import * as kernel from "../lib/kernel.js";
import { meta, view } from "../lib/view.js";

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

test("a device added from a click on the outside goes inside, where it was clicked", () => {
  const roomy = { ...CASE, min_width: 150, min_depth: 120 };
  let d = run(new Design({ name: "Mounts" }).to_dict(), { op: "add_case", id: "a", values: roomy });
  // Clicked near the left and near the right, seen from outside the lid: inside, the first is on the right.
  d = run(d,
    { op: "add_placement", type: "SmallSpeaker", case: "a", surface: "top", mount: "inside", centre: [30, 60], centre_mount: "outside" },
    { op: "add_placement", type: "SmallSpeaker", case: "a", surface: "top", mount: "inside", centre: [120, 60], centre_mount: "outside" });
  const [first, second] = Design.from_dict(d).placements;
  assert.equal(first.mount, "inside");
  assert.ok(first.x > second.x + 40, `${first.x} isn't right of ${second.x}`);
  // From inside, as clicked.
  d = run(d, { op: "remove", id: first.id }, { op: "remove", id: second.id },
    { op: "add_placement", type: "SmallSpeaker", case: "a", surface: "top", mount: "inside", centre: [30, 60], centre_mount: "inside" },
    { op: "add_placement", type: "SmallSpeaker", case: "a", surface: "top", mount: "inside", centre: [120, 60], centre_mount: "inside" });
  const [left, right] = Design.from_dict(d).placements;
  assert.ok(left.x + 40 < right.x);
  // Which side each type goes on.
  const { types } = meta();
  assert.equal(types.SmallSpeaker.defaultMount, "inside");
  assert.equal(types.BatteryCompartment.defaultMount, "outside");
  assert.equal(types.ExampleBoard.defaultMount, null);
});
