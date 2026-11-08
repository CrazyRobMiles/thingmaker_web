// Drafted from boxmaker.py's CCS811 by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// A small sensor board on two pillars, with a hole through the surface under
// the sensor so it can reach the air outside.
//
// The classes that go with it in boxmaker:
//   CCS811Lid cuts the same hole in the lid, above the sensor - left out: here
//     the hole is in whatever surface it's mounted on
//
// By hand: the names.
export default {
  type: "CCS811",
  category: "sensor",
  displayName: "CCS811 sensor",
  description: "A CCS811 air quality sensor on two pillars, with a hole through the surface for it.",
  source: {
    boxmaker: "CCS811",
    record: "tools/boxmaker/records/CCS811.json"
  },
  board: { width: 21, depth: 15.5, thickness: 1.6 },
  pillars: {
    radius: 2.5,
    height: 4,
    holeRadius: 1,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [3, 12],
      [18, 12]
    ]
  },
  openings: [
    {
      description: "Air hole under the sensor",
      circle: [10.5, 12, 3],
      skin: 0
    }
  ],
  parts: [],
  connectors: {}
};
