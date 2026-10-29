/* The picture handling engraving needs, in plain JavaScript (so it runs in
Node and in a web page alike): reading PNG, JPEG, GIF and BMP files, and the
operations the Python thingmaker gets from Pillow, OpenCV and contourpy -
resizing (Pillow's Lanczos resampler), greyscale and compositing as Pillow
does them, Pillow's median filter and median-cut colour reduction, OpenCV's
k-means and polyline simplification, Gaussian blur, contour tracing
(marching squares) and thinning (Zhang-Suen).

Images are {width, height, channels, data: Uint8Array} (rows top to bottom),
or {width, height, data: Float32Array} for single-channel float grids. */
import * as files from "#files";
import { decode as decodePng } from "fast-png";
import jpeg from "jpeg-js";
import omggif from "omggif";

// -- reading --

function decodeBmp(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u32 = (o) => view.getUint32(o, true);
  const offset = u32(10);
  const headerSize = u32(14);
  const width = view.getInt32(18, true);
  let height = view.getInt32(22, true);
  const bpp = view.getUint16(28, true);
  const compression = headerSize >= 40 ? u32(30) : 0;
  if (compression !== 0 && compression !== 3) throw new Error("compressed BMP files aren't supported");
  const topDown = height < 0;
  height = Math.abs(height);
  const palette = [];
  if (bpp <= 8) {
    const colours = (headerSize >= 40 && u32(46)) || 1 << bpp;
    const start = 14 + headerSize;
    for (let i = 0; i < colours; i++) palette.push([buf[start + 4 * i + 2], buf[start + 4 * i + 1], buf[start + 4 * i]]);
  }
  const masks = compression === 3 ? [u32(54), u32(58), u32(62)] : null;
  const stride = Math.floor((bpp * width + 31) / 32) * 4;
  const data = new Uint8Array(width * height * 4);
  const fromMask = (v, m) => {
    if (!m) return 0;
    let shift = 0;
    while (!((m >>> shift) & 1)) shift++;
    const max = m >>> shift;
    return Math.round((((v & m) >>> shift) * 255) / max);
  };
  for (let row = 0; row < height; row++) {
    const y = topDown ? row : height - 1 - row;
    const base = offset + row * stride;
    for (let x = 0; x < width; x++) {
      let r, g, b;
      if (bpp === 24) {
        b = buf[base + 3 * x];
        g = buf[base + 3 * x + 1];
        r = buf[base + 3 * x + 2];
      } else if (bpp === 32) {
        const v = u32(base + 4 * x);
        if (masks) [r, g, b] = masks.map((m) => fromMask(v, m));
        else [b, g, r] = [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff];
      } else if (bpp === 16) {
        const v = view.getUint16(base + 2 * x, true);
        [r, g, b] = (masks || [0x7c00, 0x03e0, 0x001f]).map((m) => fromMask(v, m));
      } else if (bpp <= 8) {
        const bit = x * bpp;
        const index = (buf[base + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        [r, g, b] = palette[index] || [0, 0, 0];
      } else {
        throw new Error(`${bpp}-bit BMP files aren't supported`);
      }
      data.set([r, g, b, 255], 4 * (y * width + x));
    }
  }
  return { width, height, channels: 4, data };
}

/** A decoded PNG (fast-png) as RGBA, the way Pillow reads it: 16-bit colour
cut to its high byte (16-bit grey clipped at 255), 1, 2 and 4-bit grey
stretched to 0-255, and a tRNS colour (or palette alpha) made transparent. */
function pngToRgba(png) {
  const { width, height, depth, channels, data } = png;
  const n = width * height;
  const out = new Uint8Array(n * 4);
  const lineBytes = Math.ceil((depth * channels * width) / 8);
  const sample = (x, y, c) => {
    if (depth === 16) return data[(y * width + x) * channels + c];
    if (depth === 8) return data[(y * width + x) * channels + c];
    const bit = (x * channels + c) * depth;
    return (data[y * lineBytes + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const key = png.transparency && !png.palette && png.transparency.length ? png.transparency : null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = 4 * (y * width + x);
      let r, g, b, a = 255;
      if (png.palette) {
        const p = png.palette[sample(x, y, 0)] || [0, 0, 0];
        [r, g, b] = p;
        if (p.length > 3) a = p[3];
      } else {
        const raw = [];
        for (let c = 0; c < channels; c++) raw.push(sample(x, y, c));
        const to8 = (v, grey = false) => {
          if (depth === 16) return grey ? Math.min(255, v) : v >> 8;
          if (depth === 8) return v;
          return Math.round((v * 255) / ((1 << depth) - 1));
        };
        if (channels <= 2) {
          r = g = b = to8(raw[0], channels === 1);
          if (channels === 2) a = depth === 16 ? raw[1] >> 8 : raw[1];
        } else {
          [r, g, b] = raw.slice(0, 3).map((v) => to8(v));
          if (channels === 4) a = depth === 16 ? raw[3] >> 8 : raw[3];
        }
        if (key && raw.slice(0, key.length).every((v, i) => v === key[i])) a = 0;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return { width, height, channels: 4, data: out };
}

/** The picture at `file` as RGBA. */
export function readImage(file) {
  const buf = files.readFile(file);
  const sig = (from, to) => String.fromCharCode(...buf.subarray(from, to));
  try {
    if (buf[0] === 0x89 && sig(1, 4) === "PNG") return pngToRgba(decodePng(buf));
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
      return { width: img.width, height: img.height, channels: 4, data: new Uint8Array(img.data) };
    }
    if (sig(0, 3) === "GIF") {
      const reader = new omggif.GifReader(new Uint8Array(buf));
      const data = new Uint8Array(reader.width * reader.height * 4);
      reader.decodeAndBlitFrameRGBA(0, data);
      return { width: reader.width, height: reader.height, channels: 4, data };
    }
    if (sig(0, 2) === "BM") return decodeBmp(buf);
  } catch (e) {
    throw new Error(`can't read the picture ${file}: ${e.message}`);
  }
  throw new Error(`can't read the picture ${file}: only PNG, JPEG, GIF and BMP pictures are supported`);
}

/** Transparent parts made white (Pillow's alpha_composite onto white),
as RGB. */
export function flattenOnWhite(img) {
  const n = img.width * img.height;
  const out = new Uint8Array(n * 3);
  const PB = 7;
  for (let i = 0; i < n; i++) {
    const a = img.data[4 * i + 3];
    for (let c = 0; c < 3; c++) {
      const s = img.data[4 * i + c];
      if (a === 255) {
        out[3 * i + c] = s;
        continue;
      }
      const coef1 = a << PB;
      const coef2 = (255 << PB) - coef1;
      const tmp = s * coef1 + 255 * coef2 + (0x80 << PB);
      out[3 * i + c] = (((tmp >> 8) + tmp) >> 8) >> PB;
    }
  }
  return { width: img.width, height: img.height, channels: 3, data: out };
}

/** Pillow's convert("L"). */
export function toGrey(img) {
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  const ch = img.channels;
  for (let i = 0; i < n; i++) {
    const r = img.data[ch * i], g = img.data[ch * i + 1], b = img.data[ch * i + 2];
    out[i] = (r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16;
  }
  return { width: img.width, height: img.height, channels: 1, data: out };
}

// -- resizing (Pillow's Resample.c, LANCZOS) --

function lanczos(x) {
  const sinc = (v) => {
    if (v === 0.0) return 1.0;
    v *= Math.PI;
    return Math.sin(v) / v;
  };
  return x >= -3.0 && x < 3.0 ? sinc(x) * sinc(x / 3) : 0.0;
}

const PRECISION_BITS = 32 - 8 - 2;

function coefficients(inSize, outSize) {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1.0);
  const support = 3.0 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const kk = new Float64Array(outSize * ksize);
  const bounds = new Int32Array(outSize * 2);
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    let ww = 0.0;
    const ss = 1.0 / filterscale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    for (let x = 0; x < xmax; x++) {
      const w = lanczos((x + xmin - center + 0.5) * ss);
      kk[xx * ksize + x] = w;
      ww += w;
    }
    for (let x = 0; x < xmax; x++) if (ww !== 0.0) kk[xx * ksize + x] /= ww;
    bounds[2 * xx] = xmin;
    bounds[2 * xx + 1] = xmax;
  }
  // As integers, for 8-bit images.
  const ik = new Float64Array(kk.length);
  for (let i = 0; i < kk.length; i++) {
    ik[i] = kk[i] < 0 ? Math.trunc(-0.5 + kk[i] * (1 << PRECISION_BITS)) : Math.trunc(0.5 + kk[i] * (1 << PRECISION_BITS));
  }
  return { ksize, kk: ik, bounds };
}

function clip8(v) {
  const s = Math.floor(v / (1 << PRECISION_BITS));
  return s < 0 ? 0 : s > 255 ? 255 : s;
}

/** Pillow's image.resize((width, height), Image.LANCZOS), for 8-bit images
of 1 or 3 channels. */
export function resize(img, width, height) {
  const ch = img.channels;
  let src = img;
  if (width !== img.width) {
    const { ksize, kk, bounds } = coefficients(img.width, width);
    const out = new Uint8Array(width * img.height * ch);
    for (let y = 0; y < img.height; y++) {
      for (let xx = 0; xx < width; xx++) {
        const xmin = bounds[2 * xx], xmax = bounds[2 * xx + 1];
        for (let c = 0; c < ch; c++) {
          let ss = 1 << (PRECISION_BITS - 1);
          for (let x = 0; x < xmax; x++) ss += img.data[(y * img.width + x + xmin) * ch + c] * kk[xx * ksize + x];
          out[(y * width + xx) * ch + c] = clip8(ss);
        }
      }
    }
    src = { width, height: img.height, channels: ch, data: out };
  }
  if (height !== img.height) {
    const { ksize, kk, bounds } = coefficients(img.height, height);
    const out = new Uint8Array(width * height * ch);
    for (let yy = 0; yy < height; yy++) {
      const ymin = bounds[2 * yy], ymax = bounds[2 * yy + 1];
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < ch; c++) {
          let ss = 1 << (PRECISION_BITS - 1);
          for (let y = 0; y < ymax; y++) ss += src.data[((y + ymin) * width + x) * ch + c] * kk[yy * ksize + y];
          out[(yy * width + x) * ch + c] = clip8(ss);
        }
      }
    }
    src = { width, height, channels: ch, data: out };
  }
  return src;
}

/** Pillow's ImageFilter.MedianFilter(3): each channel's median over each
pixel's 3x3 neighbourhood (edges repeated). */
export function medianFilter3(img) {
  const { width: w, height: h, channels: ch } = img;
  const out = new Uint8Array(img.data.length);
  const window = new Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < ch; c++) {
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            window[k++] = img.data[(yy * w + xx) * ch + c];
          }
        }
        window.sort((a, b) => a - b);
        out[(y * w + x) * ch + c] = window[4];
      }
    }
  }
  return { width: w, height: h, channels: ch, data: out };
}

// -- colour reduction --

/** An RGB image reduced to at most `colours` colours, as Pillow's
quantize(colors, MEDIANCUT) does it (libImaging/Quant.c): the distinct
colours (bucketed more coarsely if there are more than 65536) are boxed, and
the box with the most pixels is split - across its widest side, weighted for
brightness, at the median pixel - until there are enough (a box of a single
colour is set aside); each colour is
the average of its box's pixels, and each pixel then takes the nearest of
those colours. (Pillow only dithers when quantizing to a given palette, so
there's no dithering here either.) Returns the RGB image in those colours. */
export function quantizeMedianCut(img, colours) {
  const n = img.width * img.height;
  const d = img.data;
  // Distinct colours, at the finest scale that keeps them to 65536.
  let scale = 0;
  let buckets;
  for (;;) {
    buckets = new Map();
    for (let i = 0; i < n; i++) {
      const key = ((d[3 * i] >> scale) << 16) | ((d[3 * i + 1] >> scale) << 8) | (d[3 * i + 2] >> scale);
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    if (buckets.size <= 65536) break;
    scale += 1;
  }
  const entries = [...buckets].map(([key, count]) => ({ v: [(key >> 16) & 255, (key >> 8) & 255, key & 255], count, key }));
  const box = (items, pixels) => {
    // Pillow keeps each box's colours sorted on each axis, highest first.
    let volume = 0;
    if (items.length) {
      volume = 1;
      for (let c = 0; c < 3; c++) {
        let lo = 255;
        let hi = 0;
        for (const e of items) {
          if (e.v[c] < lo) lo = e.v[c];
          if (e.v[c] > hi) hi = e.v[c];
        }
        volume *= hi - lo + 1;
      }
    }
    return { items, pixels, volume, left: null, right: null };
  };
  const root = box(entries, n);
  // Pillow's heap (QuantHeap.c): 1-based, the box with the most pixels on top.
  const heap = [null];
  const push = (b) => {
    let k = heap.length;
    heap.push(b);
    while (k !== 1) {
      if (b.pixels - heap[k >> 1].pixels <= 0) break;
      heap[k] = heap[k >> 1];
      k >>= 1;
    }
    heap[k] = b;
  };
  const pop = () => {
    if (heap.length === 1) return null;
    const top = heap[1];
    const v = heap.pop();
    const count = heap.length - 1;
    if (!count) return top;
    let k = 1;
    for (let l; k * 2 <= count; k = l) {
      l = k * 2;
      if (l < count && heap[l].pixels - heap[l + 1].pixels < 0) l++;
      if (v.pixels - heap[l].pixels > 0) break;
      heap[k] = heap[l];
    }
    heap[k] = v;
    return top;
  };
  push(root);
  for (let left = colours - 1; left > 0; left--) {
    let node;
    do {
      node = pop();
    } while (node && node.volume === 1);
    if (!node) break;
    // The widest side, weighted for brightness.
    const range = [0, 1, 2].map((c) => {
      let lo = 255;
      let hi = 0;
      for (const e of node.items) {
        if (e.v[c] < lo) lo = e.v[c];
        if (e.v[c] > hi) hi = e.v[c];
      }
      return hi - lo;
    });
    const f = [range[0] * 77, range[1] * 150, range[2] * 29];
    let axis = 0;
    for (let i = 1; i < 3; i++) if (f[axis] < f[i]) axis = i;
    // Split at the median pixel, keeping colours that share its value on
    // that side together.
    const sortedItems = [...node.items].sort((a, b) => b.v[axis] - a.v[axis]);
    let total = 0;
    let cut = 0;
    while (cut < sortedItems.length) {
      total += sortedItems[cut].count;
      cut += 1;
      if (total * 2 > node.pixels) break;
    }
    if (cut < sortedItems.length) {
      const value = sortedItems[cut - 1].v[axis];
      while (cut < sortedItems.length && sortedItems[cut].v[axis] === value) cut += 1;
    }
    if (cut === sortedItems.length) {
      const value = sortedItems[sortedItems.length - 1].v[axis];
      while (cut > 0 && sortedItems[cut - 1].v[axis] === value) cut -= 1;
    }
    const a = sortedItems.slice(0, cut);
    const b = sortedItems.slice(cut);
    node.left = box(a, a.reduce((s, e) => s + e.count, 0));
    node.right = box(b, b.reduce((s, e) => s + e.count, 0));
    push(node.left);
    push(node.right);
  }
  // Number the boxes as Pillow does (left before right), and average each.
  const boxOf = new Map();
  let boxes = 0;
  const number = (b) => {
    if (b.left) {
      number(b.left);
      number(b.right);
      return;
    }
    for (const e of b.items) boxOf.set(e.key, boxes);
    boxes += 1;
  };
  number(root);
  const sums = Array.from({ length: boxes }, () => [0, 0, 0, 0]);
  const keyOf = (i) => ((d[3 * i] >> scale) << 16) | ((d[3 * i + 1] >> scale) << 8) | (d[3 * i + 2] >> scale);
  for (let i = 0; i < n; i++) {
    const s = sums[boxOf.get(keyOf(i))];
    s[0] += d[3 * i];
    s[1] += d[3 * i + 1];
    s[2] += d[3 * i + 2];
    s[3] += 1;
  }
  const palette = sums.map((s) => (s[3] ? [0, 1, 2].map((c) => Math.trunc(0.5 + s[c] / s[3])) : [0, 0, 0]));
  const dist = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  // Each pixel takes the nearest colour, its own box's on a tie; the others
  // are tried nearest to its own box's colour first.
  const order = palette.map((p, i) => palette.map((q, j) => [dist(p, q), j]).sort((x, y) => x[0] - y[0] || x[1] - y[1]));
  const out = new Uint8Array(n * 3);
  const chosen = new Map();
  for (let i = 0; i < n; i++) {
    const rgb = (d[3 * i] << 16) | (d[3 * i + 1] << 8) | d[3 * i + 2];
    let best = chosen.get(rgb);
    if (best === undefined) {
      const px = [d[3 * i], d[3 * i + 1], d[3 * i + 2]];
      const own = boxOf.get(keyOf(i));
      best = own;
      let bestDist = dist(palette[own], px);
      const reach = bestDist * 4;
      for (const [between, j] of order[own]) {
        if (between > reach) break;
        const dd = dist(palette[j], px);
        if (dd < bestDist) {
          bestDist = dd;
          best = j;
        }
      }
      chosen.set(rgb, best);
    }
    out[3 * i] = palette[best][0];
    out[3 * i + 1] = palette[best][1];
    out[3 * i + 2] = palette[best][2];
  }
  return { width: img.width, height: img.height, channels: 3, data: out };
}

/** OpenCV's random number generator (cv::RNG): multiply-with-carry. */
class CvRNG {
  constructor(seed) {
    this.state = BigInt.asUintN(64, BigInt(seed || 0xffffffff));
  }

  next() {
    this.state = BigInt.asUintN(64, (this.state & 0xffffffffn) * 4164903690n + (this.state >> 32n));
    return Number(this.state & 0xffffffffn);
  }

  /** (double)rng */
  double() {
    const t = BigInt(this.next());
    return Number((t << 32n) | BigInt(this.next())) * 5.4210108624275221700372640043497e-20;
  }
}

const f32 = Math.fround;

/** OpenCV's hal::normL2Sqr_ for floats: worked in single precision. */
function normL2Sqr(data, i, centre, dims) {
  let d = 0;
  for (let j = 0; j < dims; j++) {
    const t = f32(data[i * dims + j] - centre[j]);
    d = f32(d + f32(t * t));
  }
  return d;
}

/** OpenCV's k-means++ start (generateCentersPP), with 3 trials per centre. */
function centresPP(data, n, dims, k, rng, trials = 3) {
  const centres = [rng.next() % n];
  let dist = new Float32Array(n);
  let tdist = new Float32Array(n);
  let tdist2 = new Float32Array(n);
  let sum0 = 0;
  const first = data.subarray(centres[0] * dims, centres[0] * dims + dims);
  for (let i = 0; i < n; i++) {
    dist[i] = normL2Sqr(data, i, first, dims);
    sum0 += dist[i];
  }
  for (let c = 1; c < k; c++) {
    let bestSum = Number.MAX_VALUE;
    let bestCentre = -1;
    for (let t = 0; t < trials; t++) {
      let p = rng.double() * sum0;
      let ci = 0;
      for (; ci < n - 1; ci++) {
        p -= dist[ci];
        if (p <= 0) break;
      }
      const centre = data.subarray(ci * dims, ci * dims + dims);
      let s = 0;
      for (let i = 0; i < n; i++) {
        tdist2[i] = Math.min(normL2Sqr(data, i, centre, dims), dist[i]);
        s += tdist2[i];
      }
      if (s < bestSum) {
        bestSum = s;
        bestCentre = ci;
        [tdist, tdist2] = [tdist2, tdist];
      }
    }
    centres.push(bestCentre);
    sum0 = bestSum;
    [dist, tdist] = [tdist, dist];
  }
  return centres.map((ci) => Float32Array.from(data.subarray(ci * dims, ci * dims + dims)));
}

/** The pixels (Float32Array, RGB each) sorted into `k` groups of like colour
by k-means, as OpenCV's cv::kmeans does it with KMEANS_PP_CENTERS and the
Python thingmaker's settings: three attempts, at most 20 rounds, stopping
once no centre moves 0.5, its random numbers seeded with 1 (so the same
picture always comes out the same). Returns {labels: Int32Array, centres:
[[r, g, b]...]}. */
export function kmeans(pixels, k, { attempts = 3, maxIter = 20, eps = 0.5, seed = 1 } = {}) {
  const dims = 3;
  const n = pixels.length / dims;
  const rng = new CvRNG(seed);
  const epsilon = Math.max(eps, 0) ** 2;
  let maxCount = Math.min(Math.max(maxIter, 2), 100);
  if (k === 1) {
    attempts = 1;
    maxCount = 2;
  }
  const labels = new Int32Array(n);
  let best = null;
  for (let a = 0; a < Math.max(attempts, 1); a++) {
    let compactness = 0;
    let centres = null;
    for (let iter = 0; ;) {
      let shift = iter === 0 ? Number.MAX_VALUE : 0.0;
      const old = centres;
      if (iter === 0) {
        centres = centresPP(pixels, n, dims, k, rng);
      } else {
        centres = Array.from({ length: k }, () => new Float32Array(dims));
        const counters = new Int32Array(k);
        for (let i = 0; i < n; i++) {
          const c = centres[labels[i]];
          for (let j = 0; j < dims; j++) c[j] += pixels[i * dims + j];
          counters[labels[i]]++;
        }
        for (let c = 0; c < k; c++) {
          if (counters[c] !== 0) continue;
          // An empty cluster takes the point furthest from the middle of the
          // biggest one.
          let maxK = 0;
          for (let c1 = 1; c1 < k; c1++) if (counters[maxK] < counters[c1]) maxK = c1;
          const base = centres[maxK];
          const scale = f32(1 / counters[maxK]);
          const middle = Float32Array.from(base, (v) => f32(v * scale));
          let maxDist = 0;
          let farthest = -1;
          for (let i = 0; i < n; i++) {
            if (labels[i] !== maxK) continue;
            const d = normL2Sqr(pixels, i, middle, dims);
            if (maxDist <= d) {
              maxDist = d;
              farthest = i;
            }
          }
          counters[maxK]--;
          counters[c]++;
          labels[farthest] = c;
          for (let j = 0; j < dims; j++) {
            base[j] -= pixels[farthest * dims + j];
            centres[c][j] += pixels[farthest * dims + j];
          }
        }
        for (let c = 0; c < k; c++) {
          const scale = f32(1 / counters[c]);
          for (let j = 0; j < dims; j++) centres[c][j] = f32(centres[c][j] * scale);
          if (iter > 0) {
            let d = 0;
            for (let j = 0; j < dims; j++) {
              const t = centres[c][j] - old[c][j];
              d += t * t;
            }
            shift = Math.max(shift, d);
          }
        }
      }
      iter += 1;
      if (iter === Math.max(maxCount, 2) || shift <= epsilon) {
        // The labels aren't assigned again, so no cluster ends up empty.
        compactness = 0;
        for (let i = 0; i < n; i++) compactness += normL2Sqr(pixels, i, centres[labels[i]], dims);
        break;
      }
      for (let i = 0; i < n; i++) {
        let kBest = 0;
        let minDist = Number.MAX_VALUE;
        for (let c = 0; c < k; c++) {
          const d = normL2Sqr(pixels, i, centres[c], dims);
          if (minDist > d) {
            minDist = d;
            kBest = c;
          }
        }
        labels[i] = kBest;
      }
    }
    if (!best || compactness < best.compactness) {
      best = { compactness, labels: Int32Array.from(labels), centres: centres.map((c) => Array.from(c)) };
    }
  }
  return { labels: best.labels, centres: best.centres };
}

// -- grids --

function gaussianKernel(sigma) {
  // OpenCV's size for float images: round(sigma * 4 * 2 + 1) | 1.
  const size = Math.round(sigma * 8 + 1) | 1;
  const half = (size - 1) / 2;
  const k = [];
  let total = 0;
  for (let i = 0; i < size; i++) {
    const v = Math.exp(-((i - half) ** 2) / (2 * sigma * sigma));
    k.push(v);
    total += v;
  }
  return k.map((v) => v / total);
}

/** OpenCV's GaussianBlur(grid, (0, 0), sigma) for a float grid, edges
reflected without repeating the edge (BORDER_REFLECT_101). */
export function gaussianBlur(grid, sigma) {
  const { width: w, height: h } = grid;
  const k = gaussianKernel(sigma);
  const half = (k.length - 1) / 2;
  const reflect = (i, n) => {
    if (n === 1) return 0;
    while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - 2 - i;
    return i;
  };
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = 0; i < k.length; i++) s += k[i] * grid.data[y * w + reflect(x + i - half, w)];
      tmp[y * w + x] = s;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = 0; i < k.length; i++) s += k[i] * tmp[reflect(y + i - half, h) * w + x];
      out[y * w + x] = s;
    }
  }
  return { width: w, height: h, data: out };
}

/** `grid` with `n` cells added all round: filled with `value`, or, with
value null, copies of the edge. */
export function pad(grid, n, value = null) {
  const w = grid.width + 2 * n;
  const h = grid.height + 2 * n;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x - n;
      const sy = y - n;
      if (sx >= 0 && sy >= 0 && sx < grid.width && sy < grid.height) out[y * w + x] = grid.data[sy * grid.width + sx];
      else if (value !== null) out[y * w + x] = value;
      else {
        const cx = Math.min(grid.width - 1, Math.max(0, sx));
        const cy = Math.min(grid.height - 1, Math.max(0, sy));
        out[y * w + x] = grid.data[cy * grid.width + cx];
      }
    }
  }
  return { width: w, height: h, data: out };
}

/** The lines where `grid` crosses `level` (marching squares, linear
interpolation along each cell edge): [[[x, y]...]...] in cell coordinates
(x the column, y the row). A line round a closed loop ends with its first
point again; one that runs off the grid ends there. */
export function contourLines(grid, level) {
  const { width: w, height: h, data } = grid;
  const above = (x, y) => data[y * w + x] > level;
  // Edge ids: horizontal edge (x, y)-(x+1, y) = 2 * (y * w + x); vertical
  // edge (x, y)-(x, y+1) = 2 * (y * w + x) + 1.
  const point = (edge) => {
    const cell = edge >> 1;
    const x = cell % w;
    const y = Math.floor(cell / w);
    const a = data[cell];
    if (edge & 1) {
      const b = data[cell + w];
      const t = (level - a) / (b - a);
      return [x, y + t];
    }
    const b = data[cell + 1];
    const t = (level - a) / (b - a);
    return [x + t, y];
  };
  const links = new Map(); // edge -> [other edges joined to it]
  const join = (e1, e2) => {
    if (!links.has(e1)) links.set(e1, []);
    if (!links.has(e2)) links.set(e2, []);
    links.get(e1).push(e2);
    links.get(e2).push(e1);
  };
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = above(x, y), tr = above(x + 1, y), br = above(x + 1, y + 1), bl = above(x, y + 1);
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = 2 * (y * w + x);
      const bottom = 2 * ((y + 1) * w + x);
      const left = 2 * (y * w + x) + 1;
      const right = 2 * (y * w + x + 1) + 1;
      switch (code) {
        case 1: case 14: join(left, bottom); break;
        case 2: case 13: join(bottom, right); break;
        case 3: case 12: join(left, right); break;
        case 4: case 11: join(top, right); break;
        case 6: case 9: join(top, bottom); break;
        case 7: case 8: join(left, top); break;
        case 5: case 10: {
          const centre = (data[y * w + x] + data[y * w + x + 1] + data[(y + 1) * w + x + 1] + data[(y + 1) * w + x]) / 4;
          const centreAbove = centre > level;
          // 5: tr and bl above; 10: tl and br above.
          if ((code === 5) === centreAbove) {
            join(top, right);
            join(left, bottom);
          } else {
            join(left, top);
            join(bottom, right);
          }
          break;
        }
        default: break;
      }
    }
  }
  const used = new Set();
  const lines = [];
  const walk = (start) => {
    const chain = [start];
    used.add(start);
    let prev = null;
    let cur = start;
    for (;;) {
      const next = links.get(cur).find((e) => e !== prev && !used.has(e));
      if (next === undefined) {
        // Back round to the start?
        if (chain.length > 2 && links.get(cur).includes(start)) chain.push(start);
        break;
      }
      used.add(next);
      chain.push(next);
      prev = cur;
      cur = next;
    }
    return chain;
  };
  // Open lines start at the grid's edge (an edge point with one link).
  for (const [edge, others] of links) {
    if (!used.has(edge) && others.length === 1) lines.push(walk(edge));
  }
  for (const edge of links.keys()) if (!used.has(edge)) lines.push(walk(edge));
  return lines.filter((l) => l.length > 1).map((l) => l.map(point));
}

/** A boolean mask (Uint8Array, width x height) thinned to lines one pixel
wide (Zhang-Suen). */
export function thin(mask, width, height) {
  const w = width + 2;
  const h = height + 2;
  const img = new Uint8Array(w * h);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) img[(y + 1) * w + x + 1] = mask[y * width + x] ? 1 : 0;
  const offsets = [[-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1]];
  for (;;) {
    let changed = false;
    for (const step of [0, 1]) {
      const remove = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!img[y * w + x]) continue;
          const p = offsets.map(([dr, dc]) => img[(y + dr) * w + x + dc]);
          const [p2, p3, p4, p5, p6, p7, p8, p9] = p;
          const count = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          const ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let turns = 0;
          for (let i = 0; i < 8; i++) if (ring[i] === 0 && ring[i + 1] === 1) turns++;
          const side = step === 0 ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0 : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0;
          if (count >= 2 && count <= 6 && turns === 1 && side) remove.push(y * w + x);
        }
      }
      for (const i of remove) img[i] = 0;
      if (remove.length) changed = true;
    }
    if (!changed) break;
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = img[(y + 1) * w + x + 1];
  return out;
}

/** OpenCV's approxPolyDP for float points: the fewest points (Ramer-Douglas-
Peucker, then a clean-up of points on nearly straight lines) that stay within
`epsilon` of the polyline; a closed one is given without its first point
repeated. Worked in single precision where OpenCV is. */
export function approxPolyDP(points, epsilon, closed) {
  const src = points.map(([x, y]) => [f32(x), f32(y)]);
  let count = src.length;
  if (count === 0) return [];
  const dst = [];
  let initIters = 3;
  let slice = [0, 0];
  const right = [0, 0];
  let startPt = [-1000000, -1000000];
  let endPt = [0, 0];
  let pt = [0, 0];
  let pos = 0;
  let isClosed = closed;
  let leEps = false;
  const stack = [];
  const eps = epsilon * epsilon;
  const read = () => {
    const p = src[pos];
    if (++pos >= count) pos = 0;
    return p;
  };
  if (!isClosed) {
    right[0] = count;
    endPt = src[0];
    startPt = src[count - 1];
    if (startPt[0] !== endPt[0] || startPt[1] !== endPt[1]) {
      slice = [0, count - 1];
      stack.push([...slice]);
    } else {
      isClosed = true;
      initIters = 1;
    }
  }
  if (isClosed) {
    // 1. Find approximately the two furthest points of the contour.
    right[0] = 0;
    for (let i = 0; i < initIters; i++) {
      let maxDist = 0;
      pos = (pos + right[0]) % count;
      startPt = read();
      for (let j = 1; j < count; j++) {
        pt = read();
        const dx = f32(pt[0] - startPt[0]);
        const dy = f32(pt[1] - startPt[1]);
        const dist = dx * dx + dy * dy;
        if (dist > maxDist) {
          maxDist = dist;
          right[0] = j;
        }
      }
      leEps = maxDist <= eps;
    }
    // 2. Start the stack.
    if (!leEps) {
      right[1] = slice[0] = pos % count;
      slice[1] = right[0] = (right[0] + slice[0]) % count;
      stack.push([...right]);
      stack.push([...slice]);
    } else dst.push(startPt);
  }
  // 3. Split until every stretch is close enough to its chord.
  while (stack.length) {
    slice = stack.pop();
    endPt = src[slice[1]];
    pos = slice[0];
    startPt = read();
    if (pos !== slice[1]) {
      let maxDist = 0;
      const dx = f32(endPt[0] - startPt[0]);
      const dy = f32(endPt[1] - startPt[1]);
      while (pos !== slice[1]) {
        pt = read();
        const dist = Math.abs(f32(pt[1] - startPt[1]) * dx - f32(pt[0] - startPt[0]) * dy);
        if (dist > maxDist) {
          maxDist = dist;
          right[0] = (pos + count - 1) % count;
        }
      }
      leEps = maxDist * maxDist <= eps * (dx * dx + dy * dy);
    } else {
      leEps = true;
      startPt = src[slice[0]];
    }
    if (leEps) dst.push(startPt);
    else {
      right[1] = slice[1];
      slice[1] = right[0];
      stack.push([...right]);
      stack.push([...slice]);
    }
  }
  if (!isClosed) dst.push(src[count - 1]);
  // 4. Take out points on (nearly) straight lines.
  isClosed = closed;
  count = dst.length;
  let newCount = count;
  pos = isClosed ? count - 1 : 0;
  const readDst = () => {
    const p = dst[pos];
    if (++pos >= count) pos = 0;
    return p;
  };
  startPt = readDst();
  let wpos = pos;
  pt = readDst();
  for (let i = isClosed ? 0 : 1; i < count - (isClosed ? 0 : 1) && newCount > 2; i++) {
    endPt = readDst();
    const dx = f32(endPt[0] - startPt[0]);
    const dy = f32(endPt[1] - startPt[1]);
    const dist = Math.abs(f32(pt[0] - startPt[0]) * dy - f32(pt[1] - startPt[1]) * dx);
    const inner = f32(pt[0] - startPt[0]) * f32(endPt[0] - pt[0]) + f32(pt[1] - startPt[1]) * f32(endPt[1] - pt[1]);
    if (dist * dist <= 0.5 * eps * (dx * dx + dy * dy) && dx !== 0 && dy !== 0 && inner >= 0) {
      newCount--;
      dst[wpos] = startPt = endPt;
      if (++wpos >= count) wpos = 0;
      pt = readDst();
      i++;
      continue;
    }
    dst[wpos] = startPt = pt;
    if (++wpos >= count) wpos = 0;
    pt = endPt;
  }
  if (!isClosed) dst[wpos] = pt;
  return dst.slice(0, newCount);
}
