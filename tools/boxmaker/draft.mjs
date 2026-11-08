#!/usr/bin/env node
/* Draft a thingmaker device definition (lib/library/) from a boxmaker device's
record (tools/boxmaker/extract.py's output).

    node tools/boxmaker/draft.mjs RECORDS.json CLASS [--type NAME] [--force]

writes lib/library/<name>.js - its board, pillars and the openings it cuts
through the surface it's on, with notes on what's left to do by hand (its
connectors, the height of what's on it, the other classes that go with it) -
and keeps the class's record in tools/boxmaker/records/, which the tests
check the finished definition against. The definition still has to be added
to DEFINITIONS in lib/library.js. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { companions, grids, recognise, rings } from "./recognise.mjs";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const [, value] = args.splice(i, 2);
  return value;
};
const force = args.includes("--force") && args.splice(args.indexOf("--force"), 1);
const typeName = flag("--type");
if (args.length < 2) {
  process.stderr.write("usage: node tools/boxmaker/draft.mjs RECORDS.json CLASS [--type NAME] [--force]\n");
  process.exit(2);
}
const [recordsFile, className] = args;
const all = JSON.parse(fs.readFileSync(recordsFile, "utf8"));
const record = all.devices[className];
if (!record) {
  process.stderr.write(`There's no ${className} in ${recordsFile}` +
    `${all.failed && all.failed[className] ? ` (it couldn't be recorded: ${all.failed[className]})` : ""}\n`);
  process.exit(1);
}
const type = typeName || className;
const file = path.join(ROOT, "lib", "library", `${type.toLowerCase()}.js`);
if (fs.existsSync(file) && !force) {
  process.stderr.write(`${path.relative(ROOT, file)} is there already (--force replaces it)\n`);
  process.exit(1);
}

const round = (n) => Math.round(n * 1e4) / 1e4;
const found = recognise(record);
const pillars = found.pillars.at.length ? {
  radius: found.pillars.radius, height: found.pillars.height, holeRadius: found.pillars.holeRadius ?? record.settings.holeRadius,
  countersinkRadius: found.pillars.countersinkRadius ?? record.settings.holeCounterSinkRadius,
  countersinkHeight: found.pillars.countersinkHeight ?? record.settings.holeCounterSinkDepth,
  holeBelow: found.pillars.holeBelow,
  at: found.pillars.at.map(([x, y]) => [round(x), round(y)]),
} : undefined;
const definition = {
  type,
  displayName: type,
  description: "TODO: a sentence for the editor",
  source: { boxmaker: className, record: `tools/boxmaker/records/${className}.json` },
  board: { width: record.size[0], depth: record.size[1], thickness: 1.6 },
  pillars,
  openings: found.openings.length
    ? rings(grids(found.openings), [record.size[0] / 2.0, record.size[1] / 2.0]).map((o) => ({ description: "TODO: what it's for", ...o }))
    : undefined,
  blocks: found.blocks.length ? found.blocks : undefined,
  parts: [],
  connectors: {},
};

// As a JS object literal, numbers in arrays on one line.
const literal = JSON.stringify(definition, null, 2)
  .replace(/"([A-Za-z_][A-Za-z0-9_]*)":/g, "$1:")
  .replace(/\[\s+([-\d.e,\s]+?)\s+\]/g, (_, inner) => `[${inner.trim().split(/\s*,\s*/).join(", ")}]`);

const notes = [`Drafted from boxmaker.py's ${className} by tools/boxmaker/draft.mjs.`, ""];
const others = companions(all.devices, className);
if (others.length) {
  notes.push("The classes that go with it in boxmaker:");
  for (const o of others) {
    notes.push(`  ${o.name} ${o.says}`);
    if (!/left out/.test(o.says)) {
      const theirs = recognise(o.record);
      for (const op of theirs.openings) notes.push(`    opening ${JSON.stringify(op)}`);
      if (theirs.pillars.at.length) notes.push(`    pillars at ${JSON.stringify(theirs.pillars.at)}`);
      if (theirs.unrecognised.length) notes.push(`    and ${theirs.unrecognised.length} other things (see its record)`);
    }
  }
  notes.push("");
}
const users = (all.usedIn && all.usedIn[className]) || [];
notes.push("TODO, by hand:",
  "- displayName and description; board.thickness (1.6 is a guess); parts: what stands on the board, for the preview",
  "- connectors: the openings it needs in the case's walls - boxmaker cut these by hand in its box functions" +
  (users.length ? `, which for ${className} are: ${users.join(", ")}` : ""));
for (const op of found.unrecognised) notes.push(`- not understood, so not drafted: ${JSON.stringify(op)}`);
notes.push(`- add it to DEFINITIONS in lib/library.js, and check it: npm test`);

const text = `${notes.map((l) => `// ${l}`.trimEnd()).join("\n")}\nexport default ${literal};\n`;
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, text);
const recordFile = path.join(ROOT, "tools", "boxmaker", "records", `${className}.json`);
fs.mkdirSync(path.dirname(recordFile), { recursive: true });
fs.writeFileSync(recordFile, `${JSON.stringify(record, null, 1)}\n`);
process.stdout.write(`Drafted ${path.relative(ROOT, file)} (${found.pillars.at.length} pillars, ${found.openings.length} openings, ${found.blocks.length} blocks, ` +
  `${found.unrecognised.length} things not understood) and kept its record in ${path.relative(ROOT, recordFile)}\n`);
