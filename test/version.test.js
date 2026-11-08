// The version the About box shows is package.json's.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { VERSION } from "../public/js/version.js";

test("the About box's version is package.json's", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.version === VERSION || pkg.version.startsWith(`${VERSION}.`), `${VERSION} isn't package.json's ${pkg.version}`);
});
