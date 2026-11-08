// Drafted from boxmaker.py's BME280 by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// A small sensor board on two pillars, with a hole through the surface under
// the sensor so it can reach the air outside.
//
// The classes that go with it in boxmaker:
//   BME280Lid cuts the same hole in the lid, above the sensor - left out: here
//     the hole is in whatever surface it's mounted on
//
// By hand: the names.
export default {
  type: "BME280",
  category: "sensor",
  displayName: "BME280 sensor",
  description: "A BME280 temperature, humidity and pressure sensor on two pillars, with a hole through the surface for it.",
  source: {
    boxmaker: "BME280",
    record: "tools/boxmaker/records/BME280.json"
  },
  board: { width: 17, depth: 13, thickness: 1.6 },
  pillars: {
    radius: 2.5,
    height: 4,
    holeRadius: 1,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [3.5, 8],
      [13.5, 8]
    ]
  },
  openings: [
    {
      description: "Air hole under the sensor",
      circle: [8.5, 8, 3],
      skin: 0
    }
  ],
  parts: [],
  connectors: {}
};
