// Drafted from boxmaker.py's SmallNeoPixel8x8LidLightPipe by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// An 8x8 NeoPixel matrix (65mm) face down on six pillars, on the surface its
// light shows through (a lid, in boxmaker). Under each LED, a light pipe: a
// hole through the surface leaving a 0.8mm skin over it to diffuse the light,
// with a tube round it reaching up to the LED. The pillars are outside the
// LEDs, in a 75mm footprint.
//
// By hand: the names.
export default {
  type: "SmallNeoPixel8x8LightPipes",
  category: "light",
  displayName: "8x8 NeoPixel matrix with light pipes (65mm)",
  description: "A 65mm 8x8 NeoPixel matrix, face down on six pillars, with a light pipe and a thin diffuser under each LED.",
  source: {
    boxmaker: "SmallNeoPixel8x8LidLightPipe",
    record: "tools/boxmaker/records/SmallNeoPixel8x8LidLightPipe.json"
  },
  board: { width: 75, depth: 75, thickness: 1.6 },
  pillars: {
    radius: 2.5,
    height: 6,
    holeRadius: 1,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [19.92, 2.5],
      [37.5, 2.5],
      [55.08, 2.5],
      [19.92, 72.5],
      [37.5, 72.5],
      [55.08, 72.5]
    ]
  },
  openings: [
    {
      description: "Light pipes, one under each LED",
      grid: [9.0625, 9.0625, 8.125, 8.125, 8, 8, 4.0625],
      skin: 0.8,
      pipe: { height: 6, wall: 0.5 }
    }
  ],
  parts: [],
  connectors: {}
};
