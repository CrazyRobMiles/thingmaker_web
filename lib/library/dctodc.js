// Drafted from boxmaker.py's DCtoDC by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// A DC to DC converter module on four pillars.
//
// By hand: the names, and the height of what's on it (an estimate, for the
// preview and the collision checks).
export default {
  type: "DCtoDC",
  category: "power",
  displayName: "DC to DC converter",
  description: "A 45 x 23mm DC to DC converter module on four pillars.",
  source: {
    boxmaker: "DCtoDC",
    record: "tools/boxmaker/records/DCtoDC.json"
  },
  board: { width: 45, depth: 23, thickness: 1.6 },
  pillars: {
    radius: 2.5,
    height: 4,
    holeRadius: 1,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [7.5, 3.5],
      [7.5, 19.5],
      [37.5, 19.5],
      [37.5, 3.5]
    ]
  },
  parts: [
    {
      label: "components (estimate)",
      x: 4,
      y: 4,
      w: 37,
      d: 15,
      h: 7
    }
  ],
  connectors: {}
};
