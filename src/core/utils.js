// FAIRWAY STATE — shared pure helpers. No DOM, no canvas: everything here runs
// headless under node --test.

// mulberry32 — small, fast, seedable PRNG with serializable state so saved games
// resume the exact same random stream.
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  const rng = {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(n) {
      return Math.floor(rng.next() * n);
    },
    range(min, max) {
      return min + rng.next() * (max - min);
    },
    pick(arr) {
      return arr[rng.int(arr.length)];
    },
    chance(p) {
      return rng.next() < p;
    },
    getState() {
      return s;
    },
    setState(state) {
      s = state >>> 0;
    },
  };
  return rng;
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function dist(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

// Distance from point P to segment AB, all in cell coordinates.
export function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return dist(px, py, ax, ay);
  let t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
  t = clamp(t, 0, 1);
  return dist(px, py, ax + abx * t, ay + aby * t);
}

export function formatMoney(v) {
  const n = Math.round(Math.abs(v));
  const body = n.toLocaleString('en-US');
  return (v < -0.5 ? '-$' : '$') + body;
}
