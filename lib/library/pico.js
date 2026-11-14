// Drafted from boxmaker.py's PICO by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// The classes that go with it in boxmaker:
//   LANDSCAPE_PICO is the same turned round - left out: turn a placement instead
//   PICOLid does nothing: it only keeps a space for it in the lid's grid - left out
//   PICOBase is a variant that cuts the pillars back out of the base (for
//     makeComponent()'s mounting plates) - left out
//
// By hand: the USB socket, which boxmaker's PICOBox cut in the front wall
// itself (15mm wide, from below the floor up 12mm) - here it's a connector,
// with clearance enough for the plug; the board's thickness and what's on
// it, from the Pico's datasheet. boxmaker's board is 52mm long, the Pico's
// is 51mm: its pillars are at 47mm centres either way, so they're kept as
// boxmaker had them.
export default {
  type: "Pico",
  category: "cpu",
  displayName: "Raspberry Pi Pico",
  description: "Raspberry Pi Pico (or Pico W) on four pillars; its micro-USB socket on the front (low Y) edge.",
  source: {
    boxmaker: "PICO",
    record: "tools/boxmaker/records/PICO.json",
  },
  board: {
    width: 21,
    depth: 52,
    thickness: 1.0,
  },
  pillars: {
    radius: 2,
    height: 4,
    holeRadius: 0.9,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [4.8, 2.5],
      [4.8, 49.5],
      [16.2, 49.5],
      [16.2, 2.5],
    ],
  },
  // The front pillars are 7.4mm apart, less than the USB socket's 8mm: with
  // the Pico fitted upside down, the socket goes between them. Their inner
  // faces are shaved 0.5mm each (the holes stay at the Pico's 11.4mm).
  keepClear: [
    { description: "Room for the USB socket between the front pillars", box: [6.3, -1.0, 8.4, 7.0] },
  ],
  parts: [
    { label: "components", x: 1.0, y: 6.0, w: 19.0, d: 44.0, h: 2.5 },
  ],
  connectors: {
    usb: { description: "Micro-USB socket", edge: "bottom", width: 8.0, centre: 10.5, height: 2.8, depth: 5.5, overhang: 1.3 },
  },
  settings: {
    connectorClearance: 3.0,
  },
};
