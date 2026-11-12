// The Help button (and F1): how to use the editor, as a pop-up page. Written
// for the people using it - the README has the same for the people working
// on it, with more about files and code.
import { el, modal } from "./dialogs.js";

const SECTIONS = (web) => [
  ["Getting started", [
    p("A design is one or more cases (boxes with lids), with devices and subassemblies placed on their surfaces. " +
      "A new design starts with one empty case: put something in it and it grows to fit."),
    list(
      "Right-click a surface of the case to add a device there.",
      "Click the case and change its settings in the panel on the right: its style, size, wall thickness and more.",
      "Press Build (F5) to make the STL files for printing."),
  ]],
  ["The toolbar", [
    list(
      "File: New, Open, Save, Save As, Earlier versions, Open STL files, and New, Edit" +
        (web ? " and Import subassembly. Import design brings in a design from elsewhere on this computer, " +
          "with its pictures; Fonts adds fonts for engraving; Change folder picks the folder thingmaker works in." : " subassembly."),
      "Undo and Redo (Ctrl+Z, Ctrl+Y).",
      "Add case, Add hinge (joins two cases), Add device, Add subassembly (a part made from STL files), Delete.",
      "Build (F5) writes the STL files - while it runs it becomes Stop build.",
      "Design shows the design; Print parts shows the printable parts side by side.",
      "Layout shows the cases as simple panels; Lids shows or hides the lids (hide them to reach inside a case); " +
        "Built model shows the real parts, rebuilt as you edit.",
      "Fit view (F) fits the whole design in the view."),
  ]],
  ["Adding things", [
    list(
      "Click a surface to select it. Its panel lists what's on it, inside and out - click one to select it - " +
        "and adds devices and subassemblies to it.",
      "Right-click a surface to add a device or subassembly where you clicked. A device goes on its own side of " +
        "the surface, whichever face you clicked: inside the case (a battery compartment goes outside). " +
        "A subassembly goes on the face you clicked.",
      "Devices are grouped by what they are: processors, displays, sound, lights, buttons and controls, sensors, power, ventilation.",
      "A vent (under Ventilation) cuts lines or holes through the surface it's on, with fans behind it if you want them: " +
        "its settings choose the pattern, its size, and how many fans and which size.",
      "Right-click a device to rotate it, stick it to the sides of its surface, save its template or delete it."),
  ]],
  ["Moving around", [
    table(
      ["Drag a device", "Slide it across its surface"],
      ["Drag anywhere else", "Turn the view"],
      ["Shift-drag or right-drag", "Pan"],
      ["Mouse wheel", "Zoom"],
      ["Arrow keys", "Nudge the selected device 1mm (10mm with Shift)"],
      ["R", "Rotate the selected device"],
      ["Delete", "Delete what's selected"],
      ["F", "Fit the design in the view"],
      ["F5", "Build"],
      ["Ctrl+N, Ctrl+O, Ctrl+S", "New, Open, Save (Ctrl+Shift+S: Save As)"],
      ["Ctrl+Z, Ctrl+Y", "Undo, Redo"],
      ["F1", "This help"]),
  ]],
  ["The panel on the right", [
    list(
      "The design tree: everything in the design. Untick an item to hide it in the view.",
      "The settings of whatever's selected. A case can fit its height to what's in it, and can leave out the nuts " +
        "on its lid's screws (the screws go straight into the walls, and the nuts' blocks don't take up room inside). " +
        "Bolted-together panels makes its base from a floor and four walls, each printed flat, so devices can be fitted " +
        "to them before the case is put together with M3 bolts.",
      "Problems: things that collide, or don't fit. Click one to select what it's about."),
  ]],
  ["Building and printing", [
    list(
      "The real parts are rebuilt a moment after every change, and shown in place of the layout (with see-through lids).",
      "Build writes the STL files to output/<design name>/ - print/ holds each part the way up to print it, " +
        "assembled/ each part where it sits in the design. The status bar says whether the STL files match the design.",
      "Print parts shows the printable parts side by side: this design's, or any STL file or folder chosen with " +
        "File > Open STL files."),
  ]],
  ["Getting work back", [
    list(
      "The design is saved in the browser a moment after every change: if the tab is closed or the browser crashes " +
        "with changes unsaved, they're offered back next time.",
      "Every Save also keeps a copy: File > Earlier versions goes back to one. The last 50 saves of each design are kept.",
      "This lives in this browser only - it's a safety net, not a backup. Keep your designs somewhere safe too."),
  ]],
];

function p(text) {
  return el("p", {}, text);
}

function list(...items) {
  return el("ul", {}, items.map((t) => el("li", {}, t)));
}

function table(...rows) {
  return el("table", {}, rows.map(([k, v]) => el("tr", {}, el("th", {}, k), el("td", {}, v))));
}

/** Show the help. `web`: this is the web version (with its own File menu items). */
export function helpDialog({ web = false } = {}) {
  return modal("thingmaker help", () => ({
    body: el("div", { class: "help" },
      SECTIONS(web).map(([title, content]) => el("section", {}, el("h3", {}, title), content))),
    buttons: [["Close", true, "primary"]],
  }));
}
