// Drafted from boxmaker.py's HugeButton by tools/boxmaker/draft.mjs, then
// finished by hand.
//
// A huge (60mm dome) push button, held by the nut on its thread through a
// 28mm hole in the surface, with a 65 x 65mm footprint to leave room for the
// dome on the outside. No board and no pillars.
//
// By hand: the names, and the size of the button's body under the surface
// (an estimate, for the preview and the collision checks).
export default {
  type: "HugeButton",
  category: "button",
  displayName: "Button, huge (60mm dome)",
  description: "A huge 60mm dome push button, held by its nut through a 28mm hole in the surface, with room round it for the dome.",
  source: {
    boxmaker: "HugeButton",
    record: "tools/boxmaker/records/HugeButton.json"
  },
  board: { width: 65, depth: 65, thickness: 0 },
  openings: [
    {
      description: "Hole for the button",
      circle: [32.5, 32.5, 14],
      skin: 0
    }
  ],
  parts: [
    { label: "button body and switch (estimate)", x: 19.5, y: 19.5, w: 26, d: 26, h: 35 }
  ],
  connectors: {}
};
