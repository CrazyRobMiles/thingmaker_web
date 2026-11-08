// Drafted from boxmaker.py's AudioAmplifier by tools/boxmaker/draft.mjs, then finished
// by hand.
//
// An audio amplifier board with a volume control, on four pillars (boxmaker's
// fourth is 3mm lower than the third: kept). boxmaker cut a round hole 9mm
// across in the front wall for the volume control's shaft, 13mm up: here it's
// a connector (square, as connectors are), its height measured from the top of
// boxmaker's 3mm board.
//
// By hand: the names, the volume control's size (an estimate, for the preview
// and the collision checks), and the connector.
export default {
  type: "AudioAmplifier",
  category: "sound",
  displayName: "Audio amplifier",
  description: "An audio amplifier board on four pillars, with an opening in the front wall for its volume control's shaft.",
  source: {
    boxmaker: "AudioAmplifier",
    record: "tools/boxmaker/records/AudioAmplifier.json"
  },
  board: { width: 41, depth: 41, thickness: 3 },
  pillars: {
    radius: 3,
    height: 4,
    holeRadius: 1,
    countersinkRadius: 3,
    countersinkHeight: 1,
    at: [
      [3, 5],
      [38, 5],
      [3, 30],
      [38, 27]
    ]
  },
  parts: [
    {
      label: "volume control (estimate)",
      x: 7.5,
      y: 0,
      w: 9,
      d: 12,
      h: 11
    }
  ],
  connectors: {
    volume: {
      description: "Volume control shaft",
      edge: "bottom",
      width: 9,
      centre: 12,
      height: 9,
      depth: 5,
      overhang: 0,
      z: 1.5
    }
  }
};
