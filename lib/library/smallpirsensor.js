// Drafted from boxmaker.py's SmallPIRSensor by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// A small PIR motion sensor, face down on two short pillars, its lens through
// a hole in the surface with a recess round it for the lens's rim.
//
// By hand: the names.
export default {
  type: "SmallPIRSensor",
  category: "sensor",
  displayName: "PIR motion sensor (small)",
  description: "A small PIR motion sensor, face down on two short pillars, its lens through a hole in the surface.",
  source: {
    boxmaker: "SmallPIRSensor",
    record: "tools/boxmaker/records/SmallPIRSensor.json"
  },
  board: { width: 19, depth: 19, thickness: 1.6 },
  pillars: {
    radius: 2.5,
    height: 0.5,
    holeRadius: 1.2,
    countersinkRadius: 3,
    countersinkHeight: 1,
    holeBelow: 2,
    at: [
      [2, 9.5],
      [17, 9.5]
    ]
  },
  openings: [
    {
      description: "Hole for the lens",
      circle: [9.5, 9.5, 5],
      skin: 0
    },
    {
      description: "Recess for the lens's rim",
      circle: [9.5, 9.5, 6.3],
      depth: 1.3
    }
  ],
  parts: [],
  connectors: {}
};
