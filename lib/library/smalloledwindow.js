// Drafted from boxmaker.py's SmallOledHole by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// A small (27mm) OLED display face down on four short pillars, behind a window
// through the surface it's mounted on (a lid, in boxmaker).
//
// By hand: the names.
export default {
  type: "SmallOledWindow",
  category: "display",
  displayName: "Small OLED with window (27mm)",
  description: "A 27mm OLED display, face down on four short pillars, behind a window through the surface.",
  source: {
    boxmaker: "SmallOledHole",
    record: "tools/boxmaker/records/SmallOledHole.json"
  },
  board: { width: 27.3, depth: 27.8, thickness: 1.6 },
  pillars: {
    radius: 1.5,
    height: 2,
    holeRadius: 0.5,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [2, 2],
      [2, 25.8],
      [25.3, 25.8],
      [25.3, 2]
    ]
  },
  openings: [
    {
      description: "Window for the display",
      box: [2.478, 5.2, 22.344, 10.864],
      skin: 0
    }
  ],
  parts: [],
  connectors: {}
};
