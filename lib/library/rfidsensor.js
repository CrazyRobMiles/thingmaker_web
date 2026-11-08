// Ported from boxmaker.py's RFIDSensorLidHole by hand (from its source: there's
// no record of it).
//
// An RC522-style RFID reader board, 60 x 40mm, on four short pillars against
// the surface, so cards are read through it. No hole: the reader works through
// a thin plastic surface. The pillars aren't square: the pair at the far end
// from the connector are 24.43mm apart, the pair next to it 34mm, and the two
// pairs 37.5mm apart, 7mm in from the left (low X) end. The connector is on
// the right (high X) end.
//
// By hand: everything - the names, and the pillar positions worked out from
// boxmaker's placeComponent().
export default {
  type: "RFIDSensor",
  category: "sensor",
  displayName: "RFID reader (RC522)",
  description: "An RC522 RFID reader on four short pillars, reading cards through the surface; its connector on the right (high X) end.",
  source: {
    boxmaker: "RFIDSensorLidHole"
  },
  board: { width: 60, depth: 40, thickness: 1.6 },
  pillars: {
    radius: 2.5,
    height: 2,
    holeRadius: 1,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [7, 7.785],
      [7, 32.215],
      [44.5, 3],
      [44.5, 37]
    ]
  },
  openings: [],
  parts: [],
  connectors: {}
};
