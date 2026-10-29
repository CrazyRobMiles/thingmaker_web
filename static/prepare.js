// Getting a web page's copy of the folder ready (see lib/files-browser.js):
// what every worker loads before it starts, and what each request needs
// read first.
import * as files from "#files";

/** Mount the folder and read what thingmaker reads as it starts: the top of
the folder, its fonts and its subassemblies. */
export async function mountFolder(handle) {
  files.mount(handle);
  await files.loadDir("/");
  await loadLibraries();
}

let siteFonts = null;

/** The fonts that come with the site (fonts/files.json lists them), fetched
once: {name: bytes}. */
async function fetchSiteFonts() {
  if (!siteFonts) {
    siteFonts = {};
    const base = new URL("../fonts/", self.location.href);
    try {
      for (const name of await (await fetch(new URL("files.json", base))).json()) {
        const r = await fetch(new URL(name, base));
        if (r.ok) siteFonts[name] = new Uint8Array(await r.arrayBuffer());
      }
    } catch (e) {
      // (none, then)
    }
  }
  return siteFonts;
}

/** (Re-)read fonts/ and subassemblies/, whole; and the site's fonts. */
export async function loadLibraries() {
  files.provide(files.SITE_FONTS, await fetchSiteFonts());
  await files.loadDir("/fonts", { recursive: true, contents: true });
  await files.loadDir("/subassemblies", { recursive: true, contents: true });
}

/** Read every picture a design's decorations use. */
export async function loadPictures(design) {
  for (const c of (design && design.cases) || []) {
    for (const layers of Object.values(c.decorations || {})) {
      if (layers.image && layers.image.file) await files.loadPicture(layers.image.file);
    }
  }
}

/** Read a design file, and the pictures it uses. */
export async function loadDesign(path) {
  if (!(await files.loadFile(path))) return;
  try {
    await loadPictures(JSON.parse(files.readText(path)));
  } catch (e) {
    // opening it will say what's wrong with it
  }
}
