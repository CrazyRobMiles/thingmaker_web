// Drafted from boxmaker.py's NeoPixel8x8LidLightPipe by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// An 8x8 NeoPixel matrix (72mm) face down on six pillars, on the surface its
// light shows through (a lid, in boxmaker). Under each LED, a light pipe: a
// hole through the surface leaving a 0.8mm skin over it to diffuse the light,
// with a tube round it reaching up to the LED. The pillars are outside the
// LEDs, in a 80mm footprint.
//
// By hand: the names.
export default {
  type: "NeoPixel8x8LightPipes",
  category: "light",
  displayName: "8x8 NeoPixel matrix with light pipes (72mm)",
  description: "A 72mm 8x8 NeoPixel matrix, face down on six pillars, with a light pipe and a thin diffuser under each LED.",
  source: {
    boxmaker: "NeoPixel8x8LidLightPipe",
    record: "tools/boxmaker/records/NeoPixel8x8LidLightPipe.json"
  },
  board: { width: 80, depth: 80, thickness: 1.6 },
  pillars: {
    radius: 2.5,
    height: 6,
    holeRadius: 1,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [22.42, 1.5],
      [40, 1.5],
      [57.58, 1.5],
      [22.42, 78.5],
      [40, 78.5],
      [57.58, 78.5]
    ]
  },
  openings: [
    {
      description: "Light pipes, one under each LED",
      grid: [8.5, 8.5, 9, 9, 8, 8, 4.5],
      skin: 0.8,
      pipe: { height: 6, wall: 0.5 }
    }
  ],
  parts: [],
  connectors: {}
};
