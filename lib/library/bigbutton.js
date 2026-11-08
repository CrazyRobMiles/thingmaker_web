// Ported from boxmaker.py's BigButton by hand.
//
// A big push button, held by the nut on its thread, through a 28mm hole in
// the surface. No board and no pillars.
//
// By hand: the names, the size of the button's body under the surface (an
// estimate, for the preview and the collision checks), and its footprint.
// boxmaker gives it a footprint of 11 x 11mm, smaller than its own hole, so
// two of them could be placed with their holes overlapping: here it's 29 x
// 29mm, the hole in the middle of it (so there's no record to compare it with).
export default {
  type: "BigButton",
  category: "button",
  displayName: "Button, big (28mm hole)",
  description: "A big push button, held by its nut through a 28mm hole in the surface.",
  source: {
    boxmaker: "BigButton"
  },
  board: { width: 29, depth: 29, thickness: 0 },
  openings: [
    {
      description: "Hole for the button",
      circle: [14.5, 14.5, 14],
      skin: 0
    }
  ],
  parts: [
    { label: "button body and switch (estimate)", x: 3.5, y: 3.5, w: 22, d: 22, h: 30 }
  ],
  connectors: {}
};
