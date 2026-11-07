// The folder the web version works in: chosen once with the File System
// Access API (Chrome and Edge), remembered in IndexedDB, and asked for again
// only if the browser wants permission confirmed.
import * as idb from "../public/js/idb.js";
import { el, message, modal } from "../public/js/dialogs.js";

const KEY = "folder";

async function permitted(handle, ask) {
  const mode = { mode: "readwrite" };
  if ((await handle.queryPermission(mode)) === "granted") return true;
  return ask && (await handle.requestPermission(mode)) === "granted";
}

async function hasDir(handle, name) {
  try {
    await handle.getDirectoryHandle(name);
    return true;
  } catch (e) {
    return false;
  }
}

/** Copy the examples that come with the site (examples/files.json lists
them) into the folder. */
async function setUp(handle, report) {
  const list = await (await fetch(new URL("examples/files.json", document.baseURI))).json();
  for (const name of ["designs", "subassemblies", "images", "fonts", "output"]) await handle.getDirectoryHandle(name, { create: true });
  let done = 0;
  for (const rel of list) {
    const parts = rel.split("/");
    let dir = handle;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
    const file = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const data = await (await fetch(new URL(`examples/${rel}`, document.baseURI))).arrayBuffer();
    const w = await file.createWritable();
    await w.write(data);
    await w.close();
    report(`Copying the examples... ${++done} of ${list.length}`);
  }
}

/** Ask for a folder (or confirm the one used last time). Resolves to
{handle, name}. */
export async function connect({ change = false } = {}) {
  if (!window.isSecureContext) {
    await modal("thingmaker needs a secure address", () => ({
      body: el("div", { class: "note" }, `Browsers only let a page work in a folder if it comes from https:// or from this ` +
        `computer (localhost) - this one comes from ${location.origin}. Serve it over https, or from this computer, or ` +
        `(for testing) list ${location.origin} in chrome://flags/#unsafely-treat-insecure-origin-as-secure (edge://flags in Edge).`),
      buttons: [],
    }));
  }
  if (!("showDirectoryPicker" in window)) {
    await modal("thingmaker needs Chrome or Edge", () => ({
      body: el("div", { class: "note" }, "This version of thingmaker keeps your designs in a folder on this computer, " +
        "which needs a browser that lets web pages open folders: Google Chrome or Microsoft Edge."),
      buttons: [],
    }));
  }
  let saved = null;
  try {
    saved = await idb.get("settings", KEY);
  } catch (e) {
    saved = null;
  }
  if (saved && !change && (await permitted(saved.handle, false))) return saved;
  for (;;) {
    const note = el("div", { class: "note" });
    const chosen = await modal("Your thingmaker folder", (close) => {
      const chooseNew = async () => {
        let handle;
        try {
          handle = await window.showDirectoryPicker({ id: "thingmaker", mode: "readwrite" });
        } catch (e) {
          return undefined; // cancelled
        }
        if (!(await permitted(handle, true))) return undefined;
        if (!(await hasDir(handle, "designs")) && !(await hasDir(handle, "subassemblies"))) {
          note.textContent = "Setting it up...";
          try {
            await setUp(handle, (text) => {
              note.textContent = text;
            });
          } catch (e) {
            note.textContent = `Couldn't copy the examples: ${e.message}`;
          }
        }
        return { handle, name: handle.name };
      };
      const buttons = [];
      if (saved && !change) {
        buttons.push([`Open "${saved.name}" again`, async () => ((await permitted(saved.handle, true)) ? saved : undefined),
          "primary"]);
      }
      buttons.push(["Choose a folder...", chooseNew, saved && !change ? null : "primary"]);
      if (change) buttons.unshift(["Cancel", null]);
      return {
        body: el("div", { class: "form" },
          el("div", { class: "wide note" }, "thingmaker keeps your designs, subassemblies, pictures, fonts and the STL files it " +
            "builds in a folder on this computer, laid out as the Python thingmaker's is: designs/, subassemblies/, images/, " +
            "fonts/ and output/. Choose that folder - your thingmaker repository, say - or an empty one, which is set up with " +
            "the examples. The browser asks to let this site see and change the files in it; nothing else on the computer."),
          el("div", { class: "wide note" }, "Fonts: text is engraved with the fonts in its fonts/ folder, or free stand-ins " +
            "for Arial, Times New Roman and Courier New. File > Fonts... copies in this computer's own."),
          el("div", { class: "wide" }, note)),
        buttons,
      };
    });
    if (chosen === null && change && saved) return saved;
    if (chosen) {
      try {
        await idb.put("settings", { handle: chosen.handle, name: chosen.name }, KEY);
      } catch (e) {
        await message("Can't remember the folder", `It'll be asked for again next time (${e.message}).`);
      }
      return chosen;
    }
  }
}
