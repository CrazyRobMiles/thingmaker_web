#!/usr/bin/env node
/* Build a thingmaker design into printable STL files.

    node build.js designs/cyberdeck.json [OUTPUT_DIR]

Output goes to output/<design name>/ by default - see lib/builder.js for
what's written there. */
import { build, defaultOutputDir } from "./lib/builder.js";
import { Design } from "./lib/design.js";

const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2 || args.includes("-h") || args.includes("--help")) {
  process.stdout.write("usage: node build.js DESIGN.json [OUTPUT_DIR]\n\nBuild a thingmaker design into STL files.\n");
  process.exit(args.includes("-h") || args.includes("--help") ? 0 : 2);
}
const [designPath, output] = args;
const outDir = output || defaultOutputDir(designPath);
let manifest;
try {
  manifest = build(Design.load(designPath), outDir);
} catch (e) {
  process.stdout.write("ERROR: build failed:\n" + (e.stack || e) + "\n");
  process.exit(1);
}
process.exit(manifest.problems.length ? 1 : 0);
