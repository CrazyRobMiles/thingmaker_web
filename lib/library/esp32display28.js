// By hand, from the maker's drawings of the ESP32-2432S028R (the "Cheap
// Yellow Display"): an ESP32 with a 2.8" 320x240 touch screen on the other
// side of the same board.
//
// It's mounted like the small OLED with its window: face down, the screen
// looking out through a window in the surface, the board on four pillars
// beside the screen. So this frame is the component side seen from above:
// the micro-USB socket on the right edge, the micro-SD slot on the top edge,
// the ESP32 module's antenna at the left edge.
//
// From the drawings: the board (86 x 50), the M3 holes (4mm in from each
// edge, 3.2mm across) and where the sockets are (to within half a mm or so).
// The screen's 69.3 x 50mm glass and 57.6 x 43.2mm visible area are the
// usual 2.8" panel's, and are taken as centred on the board - check the
// window against your board. Its thickness (3.5mm, with the backlight) is an
// estimate: the pillars stand 0.5mm higher, so the glass clears the surface.
// Only the USB socket and the SD slot get openings; the 1.25mm connectors
// (extended IO, temperature and humidity, power, speaker) don't.
export default {
  type: "ESP32_2432S028R",
  category: "display",
  displayName: "ESP32 2.8\" display (2432S028R)",
  description: "The ESP32-2432S028R (\"Cheap Yellow Display\"), face down on four pillars behind a window for its 2.8\" screen; its micro-USB socket on the right edge and its micro-SD slot on the top edge.",
  source: {
    maker: "ESP32-2432S028R drawings",
  },
  board: {
    width: 86,
    depth: 50,
    thickness: 1.6,
  },
  pillars: {
    radius: 3,
    height: 4,
    holeRadius: 1.25,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [4, 4],
      [4, 46],
      [82, 46],
      [82, 4],
    ],
  },
  openings: [
    { description: "Window for the screen (its visible area)", box: [14.2, 3.4, 57.6, 43.2], skin: 0 },
  ],
  parts: [
    // Under the board, between it and the surface: z from the board's top.
    { label: "screen (glass and backlight)", x: 8.35, y: 0, z: -5.1, w: 69.3, d: 50, h: 3.5 },
    { label: "ESP32 module", x: 0, y: 16, w: 25.5, d: 18, h: 3.2 },
    { label: "micro-SD socket", x: 41, y: 35.5, w: 15, d: 14.5, h: 2 },
  ],
  connectors: {
    usb: { description: "Micro-USB socket", edge: "right", width: 7.5, centre: 34.8, height: 3.0, depth: 5.5, overhang: 0.5 },
    sd_card: { description: "Micro-SD card slot", edge: "top", width: 12.0, centre: 48.5, height: 2.0, depth: 14.5, overhang: 1.5 },
  },
  settings: {
    connectorClearance: 3.0,
  },
};
