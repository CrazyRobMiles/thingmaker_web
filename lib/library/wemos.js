// Drafted from boxmaker.py's WEMOS by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// A Wemos (ESP8266) board on a 38 x 50mm footprint: two pillars for its
// mounting holes and two plain posts it rests on.
//
// The classes that go with it in boxmaker:
//   WEMOSLid does nothing: it only keeps a space for it in the lid's grid - left out
//
// By hand: the names, and the USB connector: boxmaker's box functions
// (SmallSensorPixelRingBox, say) cut a slot 12mm wide and 8mm high through
// the back wall for it, the Wemos pushed against that wall at the left: from
// the bottom of the 3mm floor to 5mm above it, centred 27.5mm along the
// board. Here it's measured from the board's top (its pillars are 4mm, the
// board 1.6mm), with no extra clearance - the slot is already roomy.
export default {
  type: "Wemos",
  category: "cpu",
  displayName: "Wemos",
  description: "A Wemos (ESP8266) board on two pillars and two posts; its USB socket on the back (high Y) edge.",
  source: {
    boxmaker: "WEMOS",
    record: "tools/boxmaker/records/WEMOS.json"
  },
  board: { width: 38, depth: 50, thickness: 1.6 },
  pillars: {
    radius: 3.5,
    height: 4,
    holeRadius: 1.4,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [11.5, 38.2],
      [26.5, 38.2]
    ]
  },
  blocks: [
    { x: 9, y: 30.75, w: 5, d: 5, h: 2.5 },
    { x: 24, y: 30.75, w: 5, d: 5, h: 2.5 }
  ],
  parts: [],
  connectors: {
    usb: { description: "USB socket", edge: "top", width: 12, centre: 27.5, height: 8, depth: 0, overhang: 0.5, z: -8.6 }
  },
  settings: { connectorClearance: 0 }
};
