// Drafted from boxmaker.py's Leonardo by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// An Arduino Leonardo on four pillars. Its footprint has 25mm left of the
// board for the USB plug, and 5mm below it, as boxmaker had it.
//
// By hand: the names, the height of what's on it and the USB socket
// (estimates: check them against your board).
export default {
  type: "Leonardo",
  category: "cpu",
  displayName: "Arduino Leonardo",
  description: "An Arduino Leonardo on four pillars, with room for the USB plug on its left (low X) end.",
  source: {
    boxmaker: "Leonardo",
    record: "tools/boxmaker/records/Leonardo.json"
  },
  board: { width: 100, depth: 65, thickness: 1.6 },
  pillars: {
    radius: 2.5,
    height: 3,
    holeRadius: 1,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [40.24, 7.2],
      [92.5, 13.61],
      [92.5, 40.78],
      [41.97, 55.24]
    ]
  },
  parts: [
    {
      label: "headers and sockets (estimate)",
      x: 25,
      y: 5,
      w: 68,
      d: 54,
      h: 11
    }
  ],
  connectors: {
    usb: {
      description: "Micro-USB socket (estimate)",
      edge: "left",
      width: 8,
      centre: 43,
      height: 3,
      depth: 31,
      overhang: 1.3
    }
  },
  settings: {
    connectorClearance: 3
  }
};
