// Drafted from boxmaker.py's MediumButton by tools/boxmaker/draft.mjs, then
// finished by hand.
//
// A 30mm arcade-style push button, held by the nut on its thread, through a
// 30.6mm hole in the surface. No board and no pillars.
//
// By hand: the names, and the size of the button's body under the surface
// (an estimate, for the preview and the collision checks).
export default {
  type: "MediumButton",
  category: "button",
  displayName: "Button, medium (30mm)",
  description: "A 30mm arcade-style push button, held by its nut through a 30.6mm hole in the surface.",
  source: {
    boxmaker: "MediumButton",
    record: "tools/boxmaker/records/MediumButton.json"
  },
  board: { width: 41, depth: 37, thickness: 0 },
  openings: [
    {
      description: "Hole for the button",
      circle: [20.5, 18.5, 15.3],
      skin: 0
    }
  ],
  parts: [
    { label: "button body and switch (estimate)", x: 8.5, y: 6.5, w: 24, d: 24, h: 32 }
  ],
  connectors: {}
};
