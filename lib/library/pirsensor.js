// Drafted from boxmaker.py's PIRSensor by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// A PIR motion sensor (the 23mm dome kind), face down on two pillars, its dome
// through a hole in the surface it's mounted on.
//
// The classes that go with it in boxmaker:
//   PIRSensorLid does nothing: it only keeps a space for it in the lid's grid - left out
//   PIRSensorLidHole and PIRSensorLidFlat are the sensor mounted on the lid, a
//     23mm square hole through it (or under a 0.8mm visor) - left out: this
//     one goes on any surface, and makes its own hole
//
// By hand: the names, and the hole for the dome. boxmaker makes it (11.5mm
// radius) but never cuts it: its PIRSensor sat on the base looking up.
export default {
  type: "PIRSensor",
  category: "sensor",
  displayName: "PIR motion sensor",
  description: "A PIR motion sensor, face down on two pillars, its 23mm dome through a hole in the surface.",
  source: {
    boxmaker: "PIRSensor",
    record: "tools/boxmaker/records/PIRSensor.json"
  },
  board: { width: 35, depth: 25, thickness: 1.6 },
  pillars: {
    radius: 2.5,
    height: 4,
    holeRadius: 0.75,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [2.5, 12.5],
      [32.5, 12.5]
    ]
  },
  openings: [
    {
      description: "Hole for the sensor's dome",
      circle: [17.5, 12.5, 11.5],
      skin: 0,
      byHand: "boxmaker makes this hole but never cuts it"
    }
  ],
  parts: [],
  connectors: {}
};
