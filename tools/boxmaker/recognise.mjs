// Reading a boxmaker device's record (tools/boxmaker/extract.py): which of
// what it does to the tray are its pillars, and which are openings through
// the surface it's mounted on - the two things a device definition holds
// (lib/library.js). Anything else is handed back as "unrecognised", for a
// person to deal with.

/** A recorded number as {c, t} (c + t * thickness). */
function lin(n) {
  return typeof n === "number" ? { c: n, t: 0 } : n;
}

const near = (a, b) => Math.abs(a - b) < 1e-6;
const is = (n, c, t) => near(lin(n).c, c) && near(lin(n).t, t);
const up = (s) => near(s.dir[0], 0) && near(s.dir[1], 0) && near(s.dir[2], 1);
const down = (s) => near(s.dir[0], 0) && near(s.dir[1], 0) && near(s.dir[2], -1);

/** {pillars: {radius, height, holeRadius, countersinkRadius,
countersinkHeight, at}, openings: [...], unrecognised: [op, ...]} for a
device's record. */
export function recognise(record) {
  const ops = record.ops;
  const used = new Set();
  const pillars = { at: [] };
  ops.forEach((op, i) => {
    const s = op.shape;
    // A pillar: a cylinder up from the tray's outside face, the pillar's height above its inside one.
    if (op.op === "fuse" && s.kind === "cylinder" && up(s) && is(s.at[2], 0, -1) && near(lin(s.h).t, 1)) {
      pillars.radius = s.r;
      pillars.height = lin(s.h).c;
      pillars.at.push([lin(s.at[0]).c, lin(s.at[1]).c]);
      used.add(i);
    }
  });
  const at = (s) => pillars.at.some(([x, y]) => near(x, lin(s.at[0]).c) && near(y, lin(s.at[1]).c));
  ops.forEach((op, i) => {
    const s = op.shape;
    if (used.has(i) || op.op !== "cut" || s.kind !== "cylinder" || !up(s) || !at(s)) return;
    // Its screw hole: down from the top (bolt only), or right through (nut and bolt) with a countersink.
    if (is(s.at[2], 0, 0) || (is(s.at[2], 0, -1) && near(lin(s.h).t, 1) && near(lin(s.h).c, pillars.height))) {
      pillars.holeRadius = s.r;
      used.add(i);
    } else if (is(s.at[2], 0, -1) && near(lin(s.h).t, 0)) {
      pillars.countersinkRadius = s.r;
      pillars.countersinkHeight = lin(s.h).c;
      used.add(i);
    } else if (near(lin(s.at[2]).t, 0) && lin(s.at[2]).c < 0 && near(lin(s.h).t, 0) && near(lin(s.at[2]).c + lin(s.h).c, 0)) {
      // The screw hole going on into the surface below the pillar.
      pillars.holeBelow = lin(s.h).c;
      used.add(i);
    }
  });
  const openings = [];
  ops.forEach((op, i) => {
    const s = op.shape;
    if (used.has(i) || op.op !== "cut") return;
    const h = lin(s.h ?? 0);
    // Up from (a skin above) the outside face, at least as far as the inside one ...
    if ((s.kind === "box" || (s.kind === "cylinder" && up(s))) && near(lin(s.at[2]).t, -1) && lin(s.at[2]).c >= -1e-9) {
      const skin = lin(s.at[2]).c;
      const reach = s.kind === "box" ? lin(s.size[2]) : h;
      if (near(reach.t, 1) && reach.c >= -skin - 1e-9) {
        openings.push(s.kind === "box"
          ? { box: [lin(s.at[0]).c, lin(s.at[1]).c, lin(s.size[0]).c, lin(s.size[1]).c], skin }
          : { circle: [lin(s.at[0]).c, lin(s.at[1]).c, s.r], skin });
        used.add(i);
      }
    // ... or down from the inside face, right through.
    } else if (s.kind === "cylinder" && down(s) && is(s.at[2], 0, 0) && near(h.t, 1) && h.c >= 0) {
      openings.push({ circle: [lin(s.at[0]).c, lin(s.at[1]).c, s.r], skin: 0 });
      used.add(i);
    }
  });
  // A light pipe: a tube fused round an opening, from the same place up.
  ops.forEach((op, i) => {
    const s = op.shape;
    if (used.has(i) || op.op !== "fuse" || s.kind !== "cut" || s.parts.length !== 2) return;
    const [outer, inner] = s.parts;
    if (outer.kind !== "cylinder" || inner.kind !== "cylinder" || !up(outer) || !up(inner)) return;
    const same = (k) => JSON.stringify(outer[k]) === JSON.stringify(inner[k]);
    if (!same("at") || !same("h") || inner.r >= outer.r) return;
    const opening = openings.find((o) => o.circle && !o.pipe && near(o.circle[0], lin(outer.at[0]).c) &&
      near(o.circle[1], lin(outer.at[1]).c) && near(o.circle[2], outer.r) && near(o.skin, lin(outer.at[2]).c));
    if (!opening || !near(lin(outer.h).t, 1)) return;
    opening.pipe = { height: round(lin(outer.at[2]).c + lin(outer.h).c), wall: round(outer.r - inner.r) };
    used.add(i);
  });
  return { pillars, openings, unrecognised: ops.filter((_, i) => !used.has(i)) };
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/** Openings as rings where they make them: circles of the same size (and
skin and pipe) evenly spaced round `centre` become one {ring: [cx, cy,
radius, count, r], angle: of the first, in degrees}. */
export function rings(openings, centre) {
  const out = [];
  const groups = new Map();
  for (const o of openings) {
    if (!o.circle) {
      out.push(o);
      continue;
    }
    const [x, y, r] = o.circle;
    const radius = Math.hypot(x - centre[0], y - centre[1]);
    const key = JSON.stringify([round(radius), r, o.skin, o.pipe || null]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  for (const group of groups.values()) {
    const [x0, y0, r] = group[0].circle;
    const radius = Math.hypot(x0 - centre[0], y0 - centre[1]);
    const angles = group.map((o) => (Math.atan2(o.circle[1] - centre[1], o.circle[0] - centre[0]) * 180) / Math.PI);
    const n = group.length;
    const steps = angles.map((a) => (((a - angles[0]) % 360) + 360) % 360).sort((a, b) => a - b);
    const even = n >= 3 && radius > 1e-6 && steps.every((step, i) => Math.abs(step - (i * 360) / n) < 1e-4);
    if (!even) {
      out.push(...group);
      continue;
    }
    const ring = { ring: [round(centre[0]), round(centre[1]), round(radius), n, r], angle: round(((angles[0] % 360) + 360) % 360),
      skin: group[0].skin };
    if (group[0].pipe) ring.pipe = group[0].pipe;
    out.push(ring);
  }
  return out;
}

/** The other classes that go with one - its lid placeholder, its cutout in
the lid, its landscape copy - by name: [{name, record, says}]. */
export function companions(records, name) {
  const base = name.toLowerCase().replace(/^landscape_?/, "").replace(/(landscape|lid|hole|base|flat)+$/g, "");
  return Object.entries(records).filter(([other]) => other !== name).flatMap(([other, record]) => {
    const key = other.toLowerCase().replace(/^landscape_?/, "").replace(/(landscape|lid|hole|base|flat)+$/g, "");
    if (key !== base) return [];
    const [w, d] = records[name].size;
    let says;
    if (!record.ops.length) says = "does nothing: it only keeps a space for it in the lid's grid - left out";
    else if (near(record.size[0], d) && near(record.size[1], w) && /landscape/i.test(other)) {
      says = "is the same turned round - left out: turn a placement instead (its Rotation)";
    } else says = "has its own pillars or openings - see below, and add what's needed (a connector \"up\" for a hole above it)";
    return [{ name: other, record, says }];
  });
}
