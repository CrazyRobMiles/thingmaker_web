// Drafted from boxmaker.py's Alpha14Seg by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// A four-character 14-segment alphanumeric display on its backpack, face down
// on four pillars, behind a window through the surface it's mounted on. The
// window is cut on up to the pillars' tops, as boxmaker's is, trimming the
// pillars it overlaps.
//
// By hand: the names.
export default {
  type: "Alpha14Seg",
  category: "display",
  displayName: "14-segment display (4 characters)",
  description: "A four-character 14-segment display, face down on four pillars, behind a window through the surface.",
  source: {
    boxmaker: "Alpha14Seg",
    record: "tools/boxmaker/records/Alpha14Seg.json"
  },
  board: { width: 52, depth: 28, thickness: 1.6 },
  pillars: {
    radius: 2.5,
    height: 4,
    holeRadius: 0.6,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [2.032, 2.032],
      [2.032, 26.032],
      [49.032, 26.032],
      [49.032, 2.032]
    ]
  },
  openings: [
    {
      description: "Window for the display",
      box: [0, 3, 52, 22],
      skin: 0,
      throughPillars: true
    }
  ],
  parts: [],
  connectors: {}
};
