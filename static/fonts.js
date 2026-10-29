// File > Fonts...: copying this computer's fonts into the folder's fonts/,
// where the web version looks for them (a web page can't read the system's
// fonts folder), through the Local Font Access API (Chrome and Edge ask
// first). Without them, the site's own free fonts stand in for Arial, Times
// New Roman and Courier New.
import { el, message, modal } from "../public/js/dialogs.js";

// What Windows calls its own fonts' files - as the Python thingmaker and
// design files name fonts - by their PostScript names.
const WINDOWS_NAMES = {
  "ArialMT": "arial", "Arial-BoldMT": "arialbd", "Arial-ItalicMT": "ariali", "Arial-BoldItalicMT": "arialbi",
  "Arial-Black": "ariblk", "ArialNarrow": "arialn", "ArialNarrow-Bold": "arialnb", "ArialNarrow-Italic": "arialni",
  "ArialNarrow-BoldItalic": "arialnbi", "ArialRoundedMTBold": "arlrdbd",
  "TimesNewRomanPSMT": "times", "TimesNewRomanPS-BoldMT": "timesbd", "TimesNewRomanPS-ItalicMT": "timesi",
  "TimesNewRomanPS-BoldItalicMT": "timesbi",
  "CourierNewPSMT": "cour", "CourierNewPS-BoldMT": "courbd", "CourierNewPS-ItalicMT": "couri", "CourierNewPS-BoldItalicMT": "courbi",
  "Verdana": "verdana", "Verdana-Bold": "verdanab", "Verdana-Italic": "verdanai", "Verdana-BoldItalic": "verdanaz",
  "Georgia": "georgia", "Georgia-Bold": "georgiab", "Georgia-Italic": "georgiai", "Georgia-BoldItalic": "georgiaz",
  "Tahoma": "tahoma", "Tahoma-Bold": "tahomabd", "Impact": "impact",
  "ComicSansMS": "comic", "ComicSansMS-Bold": "comicbd", "TrebuchetMS": "trebuc", "TrebuchetMS-Bold": "trebucbd",
  "SegoeUI": "segoeui", "SegoeUI-Bold": "segoeuib", "SegoeUI-Italic": "segoeuii", "SegoeUI-BoldItalic": "segoeuiz",
  "Calibri": "calibri", "Calibri-Bold": "calibrib", "Calibri-Italic": "calibrii", "Calibri-BoldItalic": "calibriz",
  "Consolas": "consola", "Consolas-Bold": "consolab", "Consolas-Italic": "consolai", "Consolas-BoldItalic": "consolaz",
};

/** The name a font from this computer is saved under (without .ttf/.otf). */
function fileName(font) {
  return WINDOWS_NAMES[font.postscriptName] || font.postscriptName.toLowerCase().replace(/[^a-z0-9_-]+/g, "");
}

/** ".ttf" or ".otf" for a font file's bytes; null for a collection
(.ttc), which can't be engraved with, or anything else. */
function extension(bytes) {
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  if (tag === "OTTO") return ".otf";
  if (tag === "\0\x01\0\0" || tag === "true") return ".ttf";
  return null;
}

async function fontsDir(handle) {
  return handle.getDirectoryHandle("fonts", { create: true });
}

/** The fonts in the folder's fonts/: {name without extension: file name}. */
async function inFolder(handle) {
  const out = {};
  for await (const [name, entry] of (await fontsDir(handle)).entries()) {
    if (entry.kind === "file" && /\.(ttf|otf)$/i.test(name)) out[name.replace(/\.[^.]+$/, "").toLowerCase()] = name;
  }
  return out;
}

async function write(handle, name, bytes) {
  const file = await (await fontsDir(handle)).getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(bytes);
  await w.close();
}

function checkList(items) {
  // items: [{label, title, checked, disabled, value}]
  const boxes = [];
  const list = el("div", { class: "font-list" }, items.map((item) => {
    const box = el("input", { type: "checkbox", checked: item.checked, disabled: item.disabled });
    boxes.push([box, item]);
    return el("label", { class: "checkrow", title: item.title || null }, box, item.label);
  }));
  return { list, chosen: () => boxes.filter(([b]) => b.checked && !b.disabled).map(([, item]) => item.value) };
}

/** The Fonts dialog. Resolves to true if fonts were added (the folder's
fonts need reading again). */
export async function manageFonts(handle) {
  let added = false;
  for (;;) {
    const have = await inFolder(handle);
    const choice = await modal("Fonts", () => {
      const names = Object.keys(have).sort();
      const body = el("div", { class: "form" },
        el("div", { class: "wide note" }, "Text is engraved with the fonts in the folder's fonts/ - a web page can't use the " +
          "computer's own fonts folder. Design files name fonts by their file names (arial is arial.ttf). Where the folder " +
          "hasn't got them, the free Liberation Sans, Serif and Mono that come with thingmaker stand in for Arial, Times New " +
          "Roman and Courier New: the same widths, letter for letter, but not quite the same shapes."),
        el("label", {}, "In the folder"), el("div", {}, names.length ? names.join(", ") : "none"));
      const buttons = [["Close", null]];
      if ("queryLocalFonts" in window) buttons.push(["Copy from this computer...", "computer", "primary"]);
      return { body, buttons };
    });
    if (!choice) return added;
    try {
      added = (await fromComputer(handle, have)) || added;
    } catch (e) {
      await message("Couldn't copy the fonts", e.message);
    }
  }
}

async function fromComputer(handle, have) {
  let fonts;
  try {
    fonts = await window.queryLocalFonts();
  } catch (e) {
    await message("Can't see this computer's fonts", `The browser didn't allow it (${e.message}). It can be allowed in the ` +
      "site's settings (the icon to the left of the address).");
    return false;
  }
  if (!fonts.length) {
    await message("Can't see this computer's fonts", "The browser didn't list any (it may not have been allowed to).");
    return false;
  }
  const filter = el("input", { type: "text", value: "Arial", placeholder: "Search" });
  const holder = el("div", { class: "wide" });
  let current = null;
  const show = () => {
    const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
    const match = fonts.filter((f) => words.every((w) => `${f.fullName} ${f.family}`.toLowerCase().includes(w))).slice(0, 200);
    current = checkList(match.map((f) => {
      const name = fileName(f);
      return { label: `${f.fullName} (${name})`, title: f.postscriptName, checked: !have[name], disabled: !!have[name], value: f };
    }));
    holder.replaceChildren(match.length ? current.list : el("div", { class: "note" }, "No fonts match"));
  };
  filter.addEventListener("input", show);
  show();
  const picked = await modal("Copy fonts from this computer", () => ({
    body: el("div", { class: "form" }, el("label", {}, "Fonts"), filter, holder,
      el("div", { class: "wide note" }, "Ticked fonts are copied into the folder's fonts/, named as Windows names their files.")),
    buttons: [["Cancel", null], ["Copy", () => current.chosen(), "primary"]],
  }));
  if (!picked || !picked.length) return false;
  const skipped = [];
  for (const font of picked) {
    const bytes = new Uint8Array(await (await font.blob()).arrayBuffer());
    const ext = extension(bytes);
    if (!ext) skipped.push(font.fullName);
    else await write(handle, fileName(font) + ext, bytes);
  }
  if (skipped.length) {
    await message("Some fonts weren't copied", `These come in font collections, which can't be engraved with: ${skipped.join(", ")}.`);
  }
  return picked.length > skipped.length;
}
