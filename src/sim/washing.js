// PRESSURE WASHING — the exterior comes clean under the stream, and nowhere else.
//
// The build shipped exterior grime as an [E] verb: three presses and a whole wall of siding went
// from filthy to cream. The brief forbids exactly that — no vacuum, no generic [E], no cloth, no
// instant upgrade, no menu purchase. Dirt is a *mask*, the jet erodes it where the water actually
// lands, and the clean material underneath is revealed a patch at a time.
//
// Light dirt washes straight off. Algae, mould and bird residue do not: soap has to go on and be
// given a moment to work, or the water just runs off it. That is the whole loop — aim, soap what
// needs soaping, wait, wash, watch the wall come back.

import { clamp } from '../core/utils.js';

export const SOAP_DWELL_SEC = 2.0; // how long soap needs before the jet bites
// Water strips the loose film off a heavy stain and then stops dead on what is bonded to the
// wall. You can see it happening — the wall lightens, then simply refuses to go further — which
// is the game telling you to go and get the soap without a tooltip having to say it.
export const HEAVY_FLOOR = 0.42;

// The washable faces of the building, in the building's local frame. `u` runs along `w`, `v` up
// `h`. Kind decides whether the water alone is enough.
// `size` is the face's real extent in yards; the mask grid is ~0.25 yd cells, which is fine enough
// that the stream leaves a legible stripe rather than a smeared blur, and coarse enough to save.
export const WASH_SURFACES = [
  // the band under the eave, above the south windows
  { id: 'sidingSW', label: 'South siding (west)', kind: 'light', size: { w: 8.2, h: 1.05 }, grid: { w: 33, h: 5 }, start: 0.95 },
  // the whole south face east of the door — no openings
  { id: 'sidingSE', label: 'South siding (east)', kind: 'light', size: { w: 9.0, h: 3.0 }, grid: { w: 36, h: 12 }, start: 0.95 },
  // the base of the wall, where it stays damp: algae and mould
  { id: 'foundation', label: 'Foundation skirt', kind: 'heavy', size: { w: 20.6, h: 0.82 }, grid: { w: 68, h: 4 }, start: 0.97 },
  // under the porch roof — bird residue and a film on the boards
  { id: 'porch', label: 'Porch decking', kind: 'heavy', size: { w: 12.6, h: 3.2 }, grid: { w: 46, h: 12 }, start: 0.94 },
  // the west gable: solid clapboard, and it gets all the weather
  { id: 'trim', label: 'West gable wall', kind: 'light', size: { w: 12.0, h: 3.2 }, grid: { w: 46, h: 13 }, start: 0.93 },
];

export const WASHERS = [
  // At the normal 3-4 m working distance, even the inherited fan covers about
  // a metre. The former 0.30 yd radius required hundreds of stationary aim
  // points and turned the first campaign wash into a 15+ minute bottleneck.
  // These remain meaningfully tiered while letting a player sweep the wand;
  // soap/dwell and raycast occlusion still gate heavy stains.
  { id: 'rental', name: 'Rented washer', power: 1.0, radius: 0.58, cost: 0, level: 0,
    blurb: 'Tired and borrowed, but its broad fan can still finish the job.' },
  { id: 'greenline', name: 'Greenline 1600', power: 1.3, radius: 0.72, cost: 260, level: 0,
    blurb: 'An honest domestic machine. Twice the bite of the rental.' },
  { id: 'ironwood', name: 'Ironwood Pro 2400', power: 1.7, radius: 0.88, cost: 820, level: 2,
    blurb: 'Contractor kit. Wide fan, real pressure — walls fall off it.' },
];

export const surfaceById = (id) => WASH_SURFACES.find((s) => s.id === id);

export function washState(state) {
  return state.shop.reno.wash;
}

export function ensureWash(state) {
  if (!state.shop || !state.shop.reno) return null;
  const reno = state.shop.reno;
  if (!reno.wash) reno.wash = {};
  for (const s of WASH_SURFACES) {
    const n = s.grid.w * s.grid.h;
    const cur = reno.wash[s.id];
    if (!cur || !Array.isArray(cur.grime) || cur.grime.length !== n) {
      // a neglected property: dirty everywhere, but unevenly — streaks and splashes, not a wash
      const grime = new Array(n);
      const soap = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / s.grid.w);
        const col = i % s.grid.w;
        // heavier low down (splashback, damp rising) and blotchy across, so it reads as years of
        // weather rather than a flat coat of paint
        const low = 1 - row / Math.max(1, s.grid.h - 1);
        const blotch = 0.85 + 0.15 * Math.abs(Math.sin(col * 2.3 + row * 1.7));
        grime[i] = Math.round(clamp(s.start * (0.88 + 0.24 * low) * blotch, 0, 1) * 1000) / 1000;
      }
      reno.wash[s.id] = { grime, soap };
    }
  }
  if (!reno.washer) reno.washer = WASHERS[0].id;
  return reno.wash;
}

export function ownedWasher(state) {
  const id = state.shop && state.shop.reno && state.shop.reno.washer;
  return WASHERS.find((w) => w.id === id) || WASHERS[0];
}

export function buyWasher(state, id) {
  const w = WASHERS.find((x) => x.id === id);
  if (!w) return { ok: false, reason: 'No such machine.' };
  const have = ownedWasher(state);
  if (WASHERS.indexOf(w) <= WASHERS.indexOf(have)) return { ok: false, reason: 'You already have better.' };
  if (state.cash < w.cost) return { ok: false, reason: `${w.name} costs $${w.cost}.` };
  state.cash -= w.cost;
  state.shop.reno.washer = w.id;
  return { ok: true, washer: w };
}

// Which cells the fan actually covers. The radius is in YARDS — a real 30-60cm spray pattern —
// so it lands the same size on a narrow foundation strip as on a wide gable, instead of scaling
// with the surface and covering half a wall in one squeeze.
function* footprint(surf, u, v, radiusYd) {
  const { w, h } = surf.grid;
  const sw = (surf.size && surf.size.w) || 1;
  const sh = (surf.size && surf.size.h) || 1;
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const du = ((cx + 0.5) / w - u) * sw; // yards across the face
      const dv = ((cy + 0.5) / h - v) * sh; // yards up it
      const d = Math.hypot(du, dv);
      if (d > radiusYd) continue;
      const strength = 1 - (d / radiusYd) * 0.7; // hardest at the centre of the fan
      yield { idx: cy * w + cx, strength };
    }
  }
}

// lay soap on. It sits on the cells and remembers when it went on.
export function soapAt(state, id, u, v, radius, nowSec = 0) {
  const surf = surfaceById(id);
  const w = washState(state)[id];
  if (!surf || !w) return { soaped: 0 };
  let soaped = 0;
  for (const { idx } of footprint(surf, u, v, radius)) {
    w.soap[idx] = nowSec + SOAP_DWELL_SEC; // the moment this cell becomes washable
    soaped++;
  }
  return { soaped };
}

// the jet. Erodes grime where it lands — and only there.
export function washAt(state, id, u, v, radius, power, dtSec, nowSec = 0) {
  const surf = surfaceById(id);
  const w = washState(state)[id];
  if (!surf || !w) return { cleaned: 0, blocked: false };
  const heavy = surf.kind === 'heavy';
  let cleaned = 0;
  let blocked = false;

  for (const { idx, strength } of footprint(surf, u, v, radius)) {
    if (w.grime[idx] <= 0) continue;
    // heavy staining shrugs plain water off: it needs soap, and the soap needs a moment
    const soapReady = (w.soap[idx] || 0) > 0 && nowSec >= w.soap[idx];
    let floor = 0;
    if (heavy && !soapReady) {
      floor = HEAVY_FLOOR;
      if (w.grime[idx] <= floor + 1e-9) {
        blocked = true; // the water is running straight off it — tell the player why
        continue;
      }
    }
    const take = Math.min(w.grime[idx] - floor, power * strength * dtSec * 3.6);
    if (take <= 0) continue;
    w.grime[idx] = Math.round((w.grime[idx] - take) * 1000) / 1000;
    cleaned += take;
  }
  return { cleaned, blocked };
}

export function surfaceClean(state, id) {
  const w = washState(state) && washState(state)[id];
  if (!w) return 0;
  const avg = w.grime.reduce((a, v) => a + v, 0) / w.grime.length;
  return clamp(1 - avg, 0, 1);
}

// does this cell need soap before it will shift? (drives the "apply soap" prompt)
export function needsSoap(state, id) {
  const surf = surfaceById(id);
  const w = washState(state) && washState(state)[id];
  if (!surf || !w || surf.kind !== 'heavy') return false;
  return w.grime.some((g, i) => g > HEAVY_FLOOR && !(w.soap[i] > 0));
}

export function exteriorWashScore(state) {
  const w = washState(state);
  if (!w) return 0;
  const per = WASH_SURFACES.map((s) => surfaceClean(state, s.id));
  return per.reduce((a, v) => a + v, 0) / per.length;
}
