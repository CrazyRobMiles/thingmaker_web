// Drafted from boxmaker.py's SmallSpeaker by tools/boxmaker/draft.mjs, then
// finished by hand.
//
// boxmaker.py defines SmallSpeaker twice; this is the second (42mm, 2mm
// pillars, the grille), which is the one boxmaker uses - the first (40mm, 4mm
// pillars, no grille) is overridden by it.
//
// By hand: the names, and the speaker's size above its frame, which boxmaker
// doesn't know - an estimate, for the preview and the collision checks only.
// It's mounted face down on the surface its grille's in, on short spacers.
export default {
  type: "SmallSpeaker",
  category: "sound",
  displayName: "Small speaker (42mm)",
  description: "A 42mm square-framed speaker, face down on four short spacers, with a grille of holes through the surface under it.",
  source: {
    boxmaker: "SmallSpeaker",
    record: "tools/boxmaker/records/SmallSpeaker.json",
  },
  board: {
    width: 42,
    depth: 42,
    thickness: 1.0,
  },
  pillars: {
    radius: 2.5,
    height: 2,
    holeRadius: 1,
    countersinkRadius: 3,
    countersinkHeight: 1,
    holeBelow: 1.5,
    at: [
      [4.75, 4.75],
      [4.75, 37.25],
      [37.25, 37.25],
      [37.25, 4.75],
    ],
  },
  openings: [
    { description: "Grille, outer ring", ring: [21, 21, 14.75, 24, 1.5], angle: 180, skin: 0 },
    { description: "Grille, second ring", ring: [21, 21, 10.75, 12, 1.5], angle: 180, skin: 0 },
    { description: "Grille, third ring", ring: [21, 21, 6.75, 8, 1.5], angle: 180, skin: 0 },
    { description: "Grille, inner ring", ring: [21, 21, 2.75, 4, 1.5], angle: 180, skin: 0 },
  ],
  parts: [
    { label: "speaker (estimate)", x: 6.0, y: 6.0, w: 30.0, d: 30.0, h: 12.0 },
  ],
  connectors: {},
};
