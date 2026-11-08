// Drafted from boxmaker.py's Joystick by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// A joystick, fixed with four screws through the surface it's mounted on, its
// stick through a hole in the middle. No pillars or board: it's screwed
// straight to the surface.
//
// By hand: the names, and the size of the joystick under the surface (an
// estimate, for the preview and the collision checks).
export default {
  type: "Joystick",
  category: "button",
  displayName: "Joystick",
  description: "A joystick, screwed to the surface, its stick through a 22mm hole.",
  source: {
    boxmaker: "Joystick",
    record: "tools/boxmaker/records/Joystick.json"
  },
  board: { width: 76, depth: 76, thickness: 1.6 },
  openings: [
    {
      description: "Hole for the stick",
      circle: [38, 38, 11],
      skin: 0
    },
    {
      description: "Screw holes",
      grid: [15.5, 15.5, 45, 45, 2, 2, 2.5],
      skin: 0
    }
  ],
  parts: [
    {
      label: "joystick (estimate)",
      x: 18,
      y: 18,
      w: 40,
      d: 40,
      h: 30
    }
  ],
  connectors: {}
};
