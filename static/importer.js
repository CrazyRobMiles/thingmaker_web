// File > Import design... and File > Import subassembly...: bringing a
// design, or subassemblies, in from elsewhere on this computer. The web
// version can only see the folder it's been given, so what a design uses -
// its pictures, its subassemblies - is copied into that folder (images/,
// subassemblies/<name>/) and the design made to name the copies, so it finds
// them from then on (lib/imports.js does the copying, in the engine).
import { confirm, el, message, modal } from "../public/js/dialogs.js";

const DESIGN_FORMAT = "thingmaker-design";
const SPEC_FILE = "subassembly.json";

const baseName = (p) => String(p).split(/[\\/]+/).filter(Boolean).pop() || String(p);

/** Pick a file on this computer: a File, or null. */
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = el("input", { type: "file", accept, style: "display:none" });
    input.addEventListener("change", () => resolve(input.files[0] || null));
    input.addEventListener("cancel", () => resolve(null));
    document.body.append(input);
    input.click();
    setTimeout(() => input.remove(), 0);
  });
}

/** Pick a folder on this computer, to read: a handle, or null. */
async function pickFolder() {
  try {
    return await window.showDirectoryPicker({ id: "thingmaker-import", mode: "read" });
  } catch (e) {
    return null; // cancelled
  }
}

async function hasSpec(dir) {
  try {
    await dir.getFileHandle(SPEC_FILE);
    return true;
  } catch (e) {
    return false;
  }
}

/** Every file in a folder (and the folders in it): {relative path: bytes}. */
async function filesIn(dir, prefix = "", out = {}) {
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === "directory") await filesIn(entry, `${prefix}${name}/`, out);
    else out[prefix + name] = new Uint8Array(await (await entry.getFile()).arrayBuffer());
  }
  return out;
}

/** Copy the subassembly in folder `dir` in, asking before replacing a
different one of the same name. Resolves to the engine's answer ({name,
status, meta}), with status "kept" if the person kept theirs. */
async function bringInSubassembly(call, dir) {
  const contents = await filesIn(dir);
  const body = { files: contents, fallback: dir.name };
  const result = await call("POST /api/import/subassembly", body);
  if (result.status !== "different") return result;
  if (!(await confirm(`Replace ${result.name}?`, `Your folder has a subassembly called ${result.name} already, and it isn't ` +
    `the same as the one in ${dir.name}. Replace yours with it?`, "Replace", "Keep mine"))) return { ...result, status: "kept" };
  return call("POST /api/import/subassembly", { ...body, replace: true });
}

const SAID = { added: "added", replaced: "replaced", same: "already there", kept: "kept yours" };

/** File > Import subassembly...: a subassembly's folder, or a folder of
them (someone's subassemblies/). Resolves to the new meta if anything was
added, or null. */
export async function importSubassemblies(call) {
  const dir = await pickFolder();
  if (!dir) return null;
  let folders = [];
  if (await hasSpec(dir)) folders = [dir];
  else {
    for await (const [, entry] of dir.entries()) if (entry.kind === "directory" && (await hasSpec(entry))) folders.push(entry);
    folders.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (!folders.length) {
    await message("No subassemblies there", `${dir.name} isn't a subassembly's folder (it has no ${SPEC_FILE} in it), ` +
      "and hasn't any in it either.");
    return null;
  }
  if (folders.length > 1) {
    const boxes = folders.map((f) => [el("input", { type: "checkbox", checked: true }), f]);
    const ok = await modal("Import subassemblies", () => ({
      body: el("div", { class: "form" },
        el("div", { class: "wide note" }, `${dir.name} has these subassemblies in it. The ticked ones are copied into your ` +
          "folder's subassemblies/."),
        el("div", { class: "wide font-list" }, boxes.map(([box, f]) => el("label", { class: "checkrow" }, box, f.name)))),
      buttons: [["Cancel", null], ["Import", true, "primary"]],
    }));
    if (!ok) return null;
    folders = boxes.filter(([box]) => box.checked).map(([, f]) => f);
  }
  const lines = [];
  let meta = null;
  for (const folder of folders) {
    try {
      const result = await bringInSubassembly(call, folder);
      if (result.status === "added" || result.status === "replaced") meta = result.meta;
      lines.push(`${result.name}: ${SAID[result.status] || result.status}`);
    } catch (e) {
      lines.push(`${folder.name}: not imported - ${e.message}`);
    }
  }
  await message("Import subassemblies", lines.join("\n"));
  return meta;
}

/** File > Import design...: a design file from anywhere on this computer,
with the pictures and subassemblies it uses that aren't in the folder.
Resolves to {path, meta} (meta if subassemblies were added), or null. */
export async function importDesign(call) {
  const file = await pickFile(".json,application/json");
  if (!file) return null;
  let design;
  try {
    design = JSON.parse(await file.text());
    if (!design || design.format !== DESIGN_FORMAT) throw new Error("it isn't a thingmaker design file");
  } catch (e) {
    await message(`Can't import ${file.name}`, e.message.startsWith("it isn't") ? e.message : `it isn't a design file (${e.message})`);
    return null;
  }
  const chosen = {}; // picture the design names -> {name, bytes}
  let meta = null;
  let need = await call("POST /api/import/check", { design });
  const nameInput = el("input", { type: "text", value: file.name.replace(/\.json$/i, "") });
  const rows = el("div", { class: "wide import-list" });
  const note = el("div", { class: "wide note" });

  const render = () => {
    const items = [];
    if (need.pictures.length) items.push(el("h4", {}, "Pictures"));
    for (const p of need.pictures) {
      const given = chosen[p.file];
      const said = given ? `copying in ${given.name}` : p.found ? `in your folder: ${p.found}` : "not in your folder";
      const choose = el("button", { type: "button", onclick: async () => {
        const picked = await pickFile("image/*");
        if (!picked) return;
        chosen[p.file] = { name: picked.name, bytes: new Uint8Array(await picked.arrayBuffer()) };
        render();
      } }, given || !p.found ? "Choose..." : "Choose another...");
      items.push(el("div", { class: `import-row${given || p.found ? "" : " missing"}`, title: p.file },
        el("span", { class: "what" }, baseName(p.file)), el("span", { class: "said" }, said), choose));
    }
    if (need.types.length) items.push(el("h4", {}, "Subassemblies"));
    for (const type of need.types) {
      const choose = el("button", { type: "button", onclick: async () => {
        const dir = await pickFolder();
        if (!dir) return;
        try {
          const result = await bringInSubassembly(call, dir);
          if (result.status === "added" || result.status === "replaced") meta = result.meta;
          if (result.name !== type) note.textContent = `${dir.name} holds ${result.name}, not ${type}.`;
          else note.textContent = "";
        } catch (e) {
          note.textContent = `${dir.name}: ${e.message}`;
        }
        need = await call("POST /api/import/check", { design });
        render();
      } }, "Choose its folder...");
      items.push(el("div", { class: "import-row missing" }, el("span", { class: "what" }, type),
        el("span", { class: "said" }, "not in your folder"), choose));
    }
    if (!items.length) items.push(el("div", { class: "note" }, "It uses no pictures or subassemblies from outside your folder."));
    rows.replaceChildren(...items);
  };
  render();

  const path = await modal(`Import ${file.name}`, () => ({
    body: el("div", { class: "form" },
      el("div", { class: "wide note" }, "The design is copied into your folder's designs/. Pictures and subassemblies it " +
        "uses that aren't in your folder are copied in too - choose them below, from wherever they are on this computer - " +
        "and the design is made to use the copies, so it finds them from now on."),
      el("label", {}, "Save it as"), nameInput,
      rows, note),
    buttons: [["Cancel", null], ["Import", async () => {
      if (need.types.length) {
        note.textContent = `Choose the folders of ${need.types.join(", ")} first: the design can't be opened without them.`;
        return undefined;
      }
      try {
        const pictures = Object.entries(chosen).map(([from, { name, bytes }]) => ({ file: from, name, bytes }));
        return (await call("POST /api/import/design", { design, name: nameInput.value.trim() || "design", pictures })).path;
      } catch (e) {
        note.textContent = `Can't import it: ${e.message}`;
        return undefined;
      }
    }, "primary"]],
  }));
  return path ? { path, meta } : null;
}
