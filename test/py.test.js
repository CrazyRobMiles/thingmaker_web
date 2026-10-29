// The Python-compatibility helpers: rounding, number formats and JSON.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dumps, floatRepr, fmtF, fmtG, mod, pyCompare, pyFloat, pyRound, sorted } from "../lib/py.js";

test("round() rounds halves to even, on the float's exact value", () => {
  assert.equal(pyRound(0.5), 0);
  assert.equal(pyRound(1.5), 2);
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(-2.5), -2);
  assert.equal(pyRound(0.125, 2), 0.12);
  assert.equal(pyRound(0.375, 2), 0.38);
  // 2.675 is really 2.67499999..., so it rounds down, as in Python.
  assert.equal(pyRound(2.675, 2), 2.67);
  assert.equal(pyRound(54.4999999999, 6), 54.5);
  assert.equal(pyRound(1e-7, 6), 0);
});

test("%g and %.Nf format as Python does", () => {
  assert.equal(fmtG(185), "185");
  assert.equal(fmtG(185.5), "185.5");
  assert.equal(fmtG(0.1 + 0.2), "0.3");
  assert.equal(fmtG(1234567), "1.23457e+06");
  assert.equal(fmtG(0.00001), "1e-05");
  assert.equal(fmtG(-3), "-3");
  assert.equal(fmtF(2.25, 1), "2.2");
  assert.equal(fmtF(2.35, 1), "2.4");
  assert.equal(fmtF(-0.04, 1), "-0.0");
});

test("floats are written as Python's repr() writes them", () => {
  assert.equal(floatRepr(3), "3.0");
  assert.equal(floatRepr(0.1 + 0.2), "0.30000000000000004");
  assert.equal(floatRepr(1e-5), "1e-05");
  assert.equal(floatRepr(1e16), "1e+16");
  assert.equal(floatRepr(123456789012345.6), "123456789012345.6");
  assert.equal(floatRepr(-0), "-0.0");
  assert.equal(floatRepr(7, true), "7");
});

test("json.dump(indent=2) layout, ints and non-ASCII text", () => {
  const text = dumps({ a: 1, b: [1.5, 2], c: {}, d: [], e: "café \"x\"", f: null, g: true }, (p) => p[0] === "a");
  assert.equal(text, '{\n  "a": 1,\n  "b": [\n    1.5,\n    2.0\n  ],\n  "c": {},\n  "d": [],\n  "e": "caf\\u00e9 \\"x\\"",\n' +
    '  "f": null,\n  "g": true\n}');
});

test("float(), %, and sorting behave like Python's", () => {
  assert.equal(pyFloat("2.5"), 2.5);
  assert.equal(pyFloat(true), 1);
  assert.throws(() => pyFloat("abc"));
  assert.throws(() => pyFloat(null));
  assert.equal(mod(-90, 360), 270);
  assert.ok(pyCompare(["a", 2], ["a", 10]) < 0);
  assert.deepEqual(sorted(["b", "a", "C"]), ["C", "a", "b"]);
});
