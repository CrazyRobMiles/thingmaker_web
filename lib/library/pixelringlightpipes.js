// Drafted from boxmaker.py's PixelRingLightPipeLid by tools/boxmaker/draft.mjs,
// then finished by hand.
//
// A 53mm ring of 12 pixels, LEDs facing down onto the surface it's mounted on
// (a lid, in boxmaker), on four pillars. Under each LED, a light pipe: a hole
// through the surface leaving a thin skin over it to diffuse the light, with
// a tube round it reaching up to just under the LED.
//
// The classes that go with it in boxmaker (not found by name, so by hand):
//   PixelRing is the same ring on the base, without pipes (shorter, thinner
//     pillars) - not ported yet
//   PixelRingLid does nothing: it only keeps a space for it in the lid's grid
// boxmaker's boxes often put a device in the middle of the ring (its grid) -
// a MediumButton, say: here, that's another placement, in the middle of it.
export default {
  type: "PixelRingLightPipes",
  category: "light",
  displayName: "Pixel ring with light pipes",
  description: "A 53mm ring of 12 pixels, face down on four pillars, with a light pipe and a thin diffuser under each LED.",
  source: {
    boxmaker: "PixelRingLightPipeLid",
    record: "tools/boxmaker/records/PixelRingLightPipeLid.json",
  },
  board: {
    width: 53,
    depth: 53,
    thickness: 1.6,
  },
  pillars: {
    radius: 3,
    height: 6.8,
    holeRadius: 1,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [3, 26.5],
      [26.5, 3],
      [26.5, 50],
      [50, 26.5],
    ],
  },
  openings: [
    {
      description: "Light pipes, one under each LED",
      ring: [26.5, 26.5, 21.5, 12, 5],
      angle: 195,
      skin: 0.5,
      pipe: { height: 6.5, wall: 0.5 },
    },
  ],
  parts: [],
  connectors: {},
};
