// From the PICO wordsearch clock's FreeCAD builder
// (resources/custom/Builder.py), by hand.
//
// A DFPlayer Mini MP3 player. Its board has no mounting holes, so it doesn't
// stand on pillars: it fits into a holder - a box with 2mm walls, 15mm high,
// standing on the surface, 24.5 x 22mm inside - made of four blocks.
//
// By hand: everything. The player's height is an estimate, for the preview
// and the collision checks.
export default {
  type: "DFPlayer",
  category: "sound",
  displayName: "DFPlayer MP3 player",
  description: "A DFPlayer Mini MP3 player, fitted into a holder with 2mm walls standing 15mm high on the surface.",
  source: { freecad: "PICO-wordsearch-clock resources/custom/Builder.py" },
  board: { width: 28.5, depth: 26, thickness: 0 },
  blocks: [
    { x: 0, y: 0, w: 28.5, d: 2, h: 15 },
    { x: 0, y: 24, w: 28.5, d: 2, h: 15 },
    { x: 0, y: 2, w: 2, d: 22, h: 15 },
    { x: 26.5, y: 2, w: 2, d: 22, h: 15 },
  ],
  parts: [
    { label: "DFPlayer (estimate)", x: 2, y: 2, w: 24.5, d: 22, h: 8 },
  ],
  connectors: {},
};
