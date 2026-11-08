// Drafted from boxmaker.py's RotaryPot by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// A rotary potentiometer (or encoder) on a small board, held by the nut on its
// shaft, which goes through a hole in the surface. No pillars: boxmaker's
// RotaryPot works out screw holes and a recess for it too, but doesn't cut
// them, so neither does this.
//
// By hand: the names, and the size of the pot (an estimate, for the preview
// and the collision checks).
export default {
  type: "RotaryPot",
  category: "button",
  displayName: "Rotary pot",
  description: "A rotary potentiometer or encoder, held by the nut on its shaft through a hole in the surface.",
  source: {
    boxmaker: "RotaryPot",
    record: "tools/boxmaker/records/RotaryPot.json"
  },
  board: { width: 19, depth: 19, thickness: 1.6 },
  openings: [
    {
      description: "Hole for the shaft",
      circle: [9.5, 9.5, 3.7],
      skin: 0
    }
  ],
  parts: [
    {
      label: "pot body (estimate)",
      x: 2,
      y: 2,
      w: 15,
      d: 15,
      h: 8
    }
  ],
  connectors: {}
};
