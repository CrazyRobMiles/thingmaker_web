#!/usr/bin/env node
/* Write a printable template of each device in a design.

    node template.js designs/cyberdeck.json [PLACEMENT ...] [-o OUTPUT_DIR]

Writes <placement>.template.stl for each device, or for the named ones, to
output/<design name>/ - see lib/template.js. */
import fs from "node:fs";
import { defaultOutputDir } from "./lib/builder.js";
import { Design } from "./lib/design.js";
import * as kernel from "./lib/kernel.js";
import { placementTemplate, templatePath } from "./lib/template.js";

const args = process.argv.slice(2);
let output = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-o" || args[i] === "--output") output = args[++i];
  else if (args[i] === "-h" || args[i] === "--help") {
    process.stdout.write("usage: node template.js DESIGN.json [PLACEMENT ...] [-o OUTPUT_DIR]\n\n" +
      "Write a printable template of each device in a design.\n");
    process.exit(0);
  } else positional.push(args[i]);
}
if (!positional.length) {
  process.stderr.write("usage: node template.js DESIGN.json [PLACEMENT ...] [-o OUTPUT_DIR]\n");
  process.exit(2);
}
const [designPath, ...wanted] = positional;
const design = Design.load(designPath);
const outDir = output || defaultOutputDir(designPath);
fs.mkdirSync(outDir, { recursive: true });
const known = design.placements.map((s) => s.id);
const unknown = wanted.filter((p) => !known.includes(p));
if (unknown.length) {
  process.stderr.write(`template.js: error: no placement ${unknown.join(", ")} (the design has: ${known.join(", ")})\n`);
  process.exit(2);
}
for (const spec of design.placements) {
  if (wanted.length && !wanted.includes(spec.id)) continue;
  const file = templatePath(outDir, spec);
  kernel.scope(() => kernel.writeStl(placementTemplate(design, spec), file));
  process.stdout.write(`wrote ${file}\n`);
}
