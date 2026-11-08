// Ported from boxmaker.py's DOITESP32 by hand: boxmaker's own placeComponent()
// fails (it uses bottomX and bottomY without setting them), so there's no
// record of it. Its pillars are where it meant them to be: 50 x 23mm apart,
// in the middle of the board, as its other devices do it.
//
// By hand: everything - the names, the ESP32 module's size and the USB socket
// (estimates: check them against your board).
export default {
  type: "DoitESP32",
  category: "cpu",
  displayName: "ESP32 DevKit (DOIT)",
  description: "A DOIT ESP32 DevKit board on four pillars; its micro-USB socket on the left (low X) end.",
  source: {
    boxmaker: "DOITESP32"
  },
  board: { width: 56, depth: 28, thickness: 1.6 },
  pillars: {
    radius: 2.5,
    height: 4,
    holeRadius: 1,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [3, 2.5],
      [3, 25.5],
      [53, 25.5],
      [53, 2.5]
    ]
  },
  parts: [
    {
      label: "ESP32 module (estimate)",
      x: 29,
      y: 5,
      w: 25.5,
      d: 18,
      h: 3.2
    }
  ],
  connectors: {
    usb: {
      description: "Micro-USB socket (estimate)",
      edge: "left",
      width: 8,
      centre: 14,
      height: 3,
      depth: 5.5,
      overhang: 1.3
    }
  },
  settings: {
    connectorClearance: 3
  }
};
