/* Small pieces of Python behaviour the port relies on, so the numbers it
works out and the files it writes match the Python thingmaker's exactly:
round() (round half to even, on the float's exact value), the %g / %.Nf
formats used in messages, and json.dump(..., indent=2) - floats written
with their ".0", non-ASCII characters escaped. */

// -- rounding --

function exactParts(x) {
  // x = mantissa * 2^exponent exactly (mantissa a BigInt).
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const sign = hi >>> 31 ? -1n : 1n;
  const biased = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exponent;
  if (biased === 0) {
    exponent = -1074;
  } else {
    mantissa |= 1n << 52n;
    exponent = biased - 1075;
  }
  return [sign * mantissa, exponent];
}

/** Python's round(x, ndigits): the float's exact value rounded to
ndigits decimals, halves going to the even neighbour. */
export function pyRound(x, ndigits = 0) {
  if (!Number.isFinite(x) || x === 0) return x;
  const [mantissa, exponent] = exactParts(x);
  const n = BigInt(ndigits);
  let num = ndigits >= 0 ? mantissa * 10n ** n : mantissa;
  let den = ndigits >= 0 ? 1n : 10n ** -n;
  if (exponent >= 0) num <<= BigInt(exponent);
  else den <<= BigInt(-exponent);
  const negative = num < 0n;
  if (negative) num = -num;
  let k = num / den;
  const twice = 2n * (num % den);
  if (twice > den || (twice === den && k % 2n === 1n)) k += 1n;
  if (negative) k = -k;
  if (k === 0n) return negative ? -0 : 0;
  return Number(`${k}e${-ndigits}`);
}

/** Python's int(round(x)). */
export function roundInt(x) {
  return pyRound(x, 0);
}

// -- formatting --

/** "%.Nf" % x */
export function fmtF(x, digits = 1) {
  if (!Number.isFinite(x)) return String(x);
  const r = pyRound(x, digits);
  let s = Math.abs(r).toFixed(digits);
  if (r < 0 || Object.is(r, -0)) s = "-" + s;
  return s;
}

/** "%g" % x - six significant figures, trailing zeros dropped. */
export function fmtG(x, precision = 6) {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const p = precision === 0 ? 1 : precision;
  // The exponent after rounding to p significant figures.
  let [digits, exp] = sigDigits(x, p);
  if (exp < -4 || exp >= p) {
    let mant = digits.length > 1 ? digits[0] + "." + digits.slice(1) : digits;
    mant = mant.replace(/\.?0+$/, "");
    const sign = exp < 0 ? "-" : "+";
    const e = String(Math.abs(exp)).padStart(2, "0");
    return (x < 0 ? "-" : "") + mant + "e" + sign + e;
  }
  let s;
  if (exp >= 0) {
    const whole = digits.slice(0, exp + 1).padEnd(exp + 1, "0");
    const frac = digits.slice(exp + 1);
    s = frac ? whole + "." + frac : whole;
  } else {
    s = "0." + "0".repeat(-exp - 1) + digits;
  }
  if (s.includes(".")) s = s.replace(/\.?0+$/, "");
  return (x < 0 ? "-" : "") + s;
}

function sigDigits(x, p) {
  // [p significant digits of |x|, correctly rounded half-even, decimal exponent]
  const a = Math.abs(x);
  let exp = Math.floor(Math.log10(a));
  // Correct log10's occasional off-by-one.
  if (Math.pow(10, exp) > a) exp -= 1;
  if (Math.pow(10, exp + 1) <= a) exp += 1;
  let r = pyRound(a, p - 1 - exp);
  if (r >= Math.pow(10, exp + 1)) {
    exp += 1;
    r = pyRound(a, p - 1 - exp);
  }
  const scaled = pyRound(r * Math.pow(10, p - 1 - exp), 0);
  let digits = BigInt(Math.round(scaled)).toString();
  if (digits.length > p) digits = digits.slice(0, p);
  digits = digits.padEnd(p, "0");
  return [digits, exp];
}

/** "%d" % x */
export function fmtD(x) {
  return String(Math.trunc(x));
}

/** "%r" % value, for the strings and numbers that turn up in messages. */
export function repr(value) {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") {
    if (value.includes("'") && !value.includes('"')) return '"' + value + '"';
    return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  }
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return floatRepr(value, Number.isInteger(value));
  if (Array.isArray(value)) return "[" + value.map(repr).join(", ") + "]";
  return JSON.stringify(value);
}

/** Python's repr() of a float (asFloat) or an int. */
export function floatRepr(x, asInt = false) {
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "Infinity" : "-Infinity";
  if (asInt && Number.isInteger(x)) return BigInt(x).toString();
  // The shortest round-tripping digits, as JS finds them.
  let s = Math.abs(x).toExponential();
  let [mant, e] = s.split("e");
  const digits = mant.replace(".", "");
  const exp = parseInt(e, 10);
  let out;
  if (exp < -4 || exp >= 16) {
    const m = digits.length > 1 ? digits[0] + "." + digits.slice(1) : digits;
    out = m + "e" + (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
  } else if (exp >= 0) {
    const whole = digits.slice(0, exp + 1).padEnd(exp + 1, "0");
    const frac = digits.slice(exp + 1);
    out = whole + "." + (frac || "0");
  } else {
    out = "0." + "0".repeat(-exp - 1) + digits;
  }
  return (x < 0 || Object.is(x, -0) ? "-" : "") + out;
}

// -- JSON --

function quote(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 0x20 || c > 0x7e) {
      if (c > 0xffff) {
        const v = c - 0x10000;
        out += "\\u" + (0xd800 + (v >> 10)).toString(16).padStart(4, "0") +
          "\\u" + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0");
      } else {
        out += "\\u" + c.toString(16).padStart(4, "0");
      }
    } else out += ch;
  }
  return out + '"';
}

/** A Python-float-or-int marker for dumps(): wrap a number that Python
would hold as an int. */
export class PyInt {
  constructor(value) {
    this.value = value;
  }
}

/** json.dumps(value, indent=2). Numbers are written as Python floats
("3.0") unless isInt(path) says that one is an int, or it's wrapped in
PyInt. `path` is the list of keys/indices leading to the number. */
export function dumps(value, isInt = () => false, indent = 2) {
  const pad = (n) => " ".repeat(n * indent);
  function walk(v, path, depth) {
    if (v instanceof PyInt) return floatRepr(v.value, true);
    if (v === null || v === undefined) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") {
      const asInt = Number.isInteger(v) && isInt(path);
      return floatRepr(v, asInt);
    }
    if (typeof v === "string") return quote(v);
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      const items = v.map((x, i) => pad(depth + 1) + walk(x, path.concat([i]), depth + 1));
      return "[\n" + items.join(",\n") + "\n" + pad(depth) + "]";
    }
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (!keys.length) return "{}";
    const items = keys.map((k) => pad(depth + 1) + quote(k) + ": " + walk(v[k], path.concat([k]), depth + 1));
    return "{\n" + items.join(",\n") + "\n" + pad(depth) + "}";
  }
  return walk(value, [], 0);
}

// -- comparing and sorting --

/** Python's comparison of two values: numbers, strings, or arrays of
them (tuples). */
export function pyCompare(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = pyCompare(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  }
  if (typeof a === "boolean") a = a ? 1 : 0;
  if (typeof b === "boolean") b = b ? 1 : 0;
  if (typeof a === "string" && typeof b === "string") {
    // Code point order, as Python compares strings.
    const ca = Array.from(a);
    const cb = Array.from(b);
    for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
      const d = ca[i].codePointAt(0) - cb[i].codePointAt(0);
      if (d) return d;
    }
    return ca.length - cb.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** sorted(items, key=key) */
export function sorted(items, key = (x) => x) {
  return Array.from(items).map((x, i) => [key(x), i, x])
    .sort((p, q) => pyCompare(p[0], q[0]) || p[1] - q[1])
    .map((p) => p[2]);
}

/** Python's == on plain JSON-like values. */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/** copy.deepcopy for JSON-like values. */
export function deepCopy(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/** Python's x % y (the result takes the sign of y). */
export function mod(x, y) {
  const r = x % y;
  return r !== 0 && (r < 0) !== (y < 0) ? r + y : r;
}

/** Python's float(value): a number, a bool, or a string holding a number;
anything else throws. */
export function pyFloat(value) {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1.0 : 0.0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase().replace(/_/g, "");
    if (/^[-+]?(inf|infinity)$/.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
    if (/^[-+]?nan$/.test(s)) return NaN;
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(s)) return Number(s);
  }
  throw new TypeError(`could not convert ${repr(value)} to float`);
}

/** Python's str(value) for the values a design file holds. */
export function pyStr(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return floatRepr(value, Number.isInteger(value));
  if (typeof value === "boolean") return value ? "True" : "False";
  if (value === null || value === undefined) return "None";
  return JSON.stringify(value);
}

// As CPython's math.radians()/math.degrees() compute them.
const DEG_TO_RAD = Math.PI / 180.0;
const RAD_TO_DEG = 180.0 / Math.PI;

export function radians(d) {
  return d * DEG_TO_RAD;
}

export function degrees(r) {
  return r * RAD_TO_DEG;
}

export function sum(values) {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
