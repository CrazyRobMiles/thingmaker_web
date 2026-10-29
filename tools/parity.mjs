#!/usr/bin/env node
/* Check this thingmaker against the Python one: for every design in a
folder, both load it, lay it out and save it again (the files must be
identical), list its problems (the same), and build it (the same parts,
each the same number of solids and the same volume to within 0.01%, and the
same hinge check).

    node tools/parity.mjs PYTHON_THINGMAKER_FOLDER [DESIGNS_FOLDER] [--no-build]

Needs Python with the Python thingmaker's requirements installed. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../lib/builder.js";
import { Design } from "../lib/design.js";
import * as kernel from "../lib/kernel.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const noBuild = process.argv.includes("--no-build");
if (!args.length) {
  process.stderr.write("usage: node tools/parity.mjs PYTHON_THINGMAKER_FOLDER [DESIGNS_FOLDER] [--no-build]\n");
  process.exit(2);
}
const pythonRepo = path.resolve(args[0]);
const designsDir = path.resolve(args[1] || path.join(ROOT, "designs"));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "thingmaker-parity-"));

const PYTHON = `
import json, os, sys
sys.path.insert(0, sys.argv[1])
from thingmaker.design import Design
from thingmaker import builder
out = {}
for name in sorted(os.listdir(sys.argv[2])):
    if not name.endswith(".json"):
        continue
    try:
        design = Design.load(os.path.join(sys.argv[2], name))
        out[name] = {"dump": json.dumps(design.to_dict(), indent=2), "problems": design.warnings()}
        if sys.argv[4] == "build":
            builder.build(design, os.path.join(sys.argv[3], name[:-5]), log=lambda text: None)
    except Exception as e:
        out[name] = {"error": "%s: %s" % (type(e).__name__, e)}
json.dump(out, open(os.path.join(sys.argv[3], "python.json"), "w"))
`;

process.stdout.write(`Python thingmaker: ${pythonRepo}\nDesigns: ${designsDir}\n`);
const py = spawnSync("python", ["-c", PYTHON, pythonRepo, designsDir, path.join(work, "py"), noBuild ? "-" : "build"],
  { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
fs.mkdirSync(path.join(work, "py"), { recursive: true });
if (py.status !== 0 || !fs.existsSync(path.join(work, "py", "python.json"))) {
  process.stderr.write("The Python thingmaker didn't run - is it there, with its requirements installed?\n");
  process.exit(1);
}
const python = JSON.parse(fs.readFileSync(path.join(work, "py", "python.json"), "utf8"));

let differences = 0;
const report = (name, text) => {
  differences += 1;
  process.stdout.write(`  ${name}: ${text}\n`);
};
for (const [name, p] of Object.entries(python)) {
  let mine;
  try {
    mine = kernel.scope(() => {
      const design = Design.load(path.join(designsDir, name));
      return { design, dump: design.dumps(), problems: design.warnings() };
    });
  } catch (e) {
    mine = { error: `${e.constructor.name}: ${e.message}` };
  }
  const before = differences;
  if (p.error || mine.error) {
    if (!(p.error && mine.error)) report(name, `Python: ${p.error || "loads"}; here: ${mine.error || "loads"}`);
  } else {
    if (p.dump !== mine.dump) report(name, "saves differently");
    if (JSON.stringify(p.problems) !== JSON.stringify(mine.problems)) report(name, "problems differ");
    if (!noBuild) {
      const manifest = build(mine.design, path.join(work, "js", name.slice(0, -5)), () => {});
      const other = JSON.parse(fs.readFileSync(path.join(work, "py", name.slice(0, -5), "manifest.json"), "utf8"));
      for (const pid of new Set([...Object.keys(other.parts), ...Object.keys(manifest.parts)])) {
        const a = other.parts[pid];
        const b = manifest.parts[pid];
        if (!a || !b) report(name, `${pid} is only built ${a ? "by Python" : "here"}`);
        else if (a.solids !== b.solids || Math.abs(a.volume_mm3 - b.volume_mm3) > Math.max(0.15, 1e-4 * a.volume_mm3)) {
          report(name, `${pid}: Python ${a.solids} solid(s), ${a.volume_mm3} mm3; here ${b.solids}, ${b.volume_mm3} mm3`);
        }
      }
      for (const key of ["problems", "hinge_sweeps"]) {
        if (JSON.stringify(other[key]) !== JSON.stringify(manifest[key])) report(name, `build ${key.replace("_", " ")} differ`);
      }
    }
  }
  process.stdout.write(`${differences === before ? "same" : "DIFFERENT"}  ${name}\n`);
}
fs.rmSync(work, { recursive: true, force: true });
process.stdout.write(`${Object.keys(python).length} designs, ${differences} difference(s)\n`);
process.exit(differences ? 1 : 0);
