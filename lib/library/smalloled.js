// Drafted from boxmaker.py's SmallOled by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// A small (29mm) OLED display on four pillars, face up, as boxmaker had it -
// with no window: boxmaker didn't cut one. For one face down behind a window
// in the surface it's on, use SmallOledWindow.
//
// By hand: the names.
export default {
  type: "SmallOled",
  category: "display",
  displayName: "Small OLED (29mm, no window)",
  description: "A 29mm OLED display board on four pillars, face up, with no window cut for it.",
  source: {
    boxmaker: "SmallOled",
    record: "tools/boxmaker/records/SmallOled.json"
  },
  board: { width: 29, depth: 29, thickness: 1.6 },
  pillars: {
    radius: 2.5,
    height: 4,
    holeRadius: 1,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [3.75, 3.75],
      [3.75, 26.25],
      [26.25, 26.25],
      [26.25, 3.75]
    ]
  },
  parts: [],
  connectors: {}
};
