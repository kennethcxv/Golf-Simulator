// GOLF EMPIRE — playtest: hit real shots on the hole you just built.
//
// A deliberately compact stroke-play loop: aim + power → ball flight with
// gravity, bounce and roll that answer the surface under the ball, water
// penalties, out-of-bounds re-drops, and the cup. It exists so the editor's
// Playtest button validates the actual course — tee spawn, terrain collision,
// surface behavior, hazards, green, pin — with the player's own hands.
//
// World units are YARDS. Terrain height and surface type come in as injected
// functions so the renderer supplies its true visual ground in-game while the
// tests inject analytic terrain. No rendering, no DOM.

import { ZONE, CELL_YD } from './constants.js';
import { clamp } from '../core/utils.js';

const G = 10.7; // gravity, yd/s² (= 32.2 ft/s²)

// Club ladder: pick by remaining distance; each club has a carry at full power
// and a launch angle. Numbers are game-feel, not ballistics.
export const CLUBS = [
  { key: 'driver', name: 'Driver', carry: 240, loftDeg: 13 },
  { key: 'wood3', name: '3 Wood', carry: 205, loftDeg: 16 },
  { key: 'iron5', name: '5 Iron', carry: 175, loftDeg: 21 },
  { key: 'iron7', name: '7 Iron', carry: 150, loftDeg: 26 },
  { key: 'iron9', name: '9 Iron', carry: 125, loftDeg: 32 },
  { key: 'wedge', name: 'Wedge', carry: 90, loftDeg: 42 },
  { key: 'putter', name: 'Putter', carry: 22, loftDeg: 0 },
];

export function suggestClub(remainingYd, onGreen) {
  if (onGreen) return CLUBS[CLUBS.length - 1];
  for (let i = CLUBS.length - 2; i >= 0; i--) {
    if (CLUBS[i].carry >= remainingYd * 0.98) {
      // the shortest club that still reaches
      let pick = i;
      while (pick + 1 < CLUBS.length - 1 && CLUBS[pick + 1].carry >= remainingYd * 0.98) pick++;
      return CLUBS[pick];
    }
  }
  return CLUBS[0];
}

// Per-surface ball behavior: restitution (bounce keep), rollFriction (per-second
// horizontal decay while rolling), flyFriction (extra first-bounce kill).
const SURFACE = {
  [ZONE.GREEN]: { rest: 0.32, roll: 0.55, label: 'Green' },
  [ZONE.FRINGE]: { rest: 0.3, roll: 0.9, label: 'Fringe' },
  [ZONE.TEE]: { rest: 0.32, roll: 0.8, label: 'Tee' },
  [ZONE.FAIRWAY]: { rest: 0.34, roll: 0.85, label: 'Fairway' },
  [ZONE.SEMI]: { rest: 0.3, roll: 1.3, label: 'First cut' },
  [ZONE.ROUGH]: { rest: 0.22, roll: 2.4, label: 'Rough' },
  [ZONE.HEAVY]: { rest: 0.12, roll: 4.5, label: 'Heavy rough' },
  [ZONE.OUT]: { rest: 0.16, roll: 3.4, label: 'Scrub' },
  [ZONE.BUNKER]: { rest: 0.05, roll: 6.0, label: 'Bunker' },
  [ZONE.PATH]: { rest: 0.55, roll: 0.7, label: 'Cart path' },
  [ZONE.DIRT]: { rest: 0.3, roll: 1.4, label: 'Dirt' },
  [ZONE.BED]: { rest: 0.1, roll: 4.0, label: 'Landscaping' },
  [ZONE.WATER]: { rest: 0, roll: 0, label: 'Water' },
};

export function surfaceInfo(zone) {
  return SURFACE[zone] || SURFACE[ZONE.ROUGH];
}

// --- session ------------------------------------------------------------------------

// hooks: { heightAt(x, z) -> yd, zoneAt(x, z) -> ZONE.*, cellToWorld({x,y}) -> {x,z} }
export function startPlaytest(state, holeId, hooks) {
  const course = state.course;
  const hole = course.holes.find((h) => h.id === holeId) || course.holes[0];
  if (!hole || !hole.tee || !hole.pin) return null;
  const tee = hooks.cellToWorld(hole.tee);
  const pin = hooks.cellToWorld(hole.pin);
  const pt = {
    holeId: hole.id,
    hole,
    hooks,
    strokes: 0,
    penalties: 0,
    phase: 'aim', // aim | flying | rolling | holed
    ball: { x: tee.x, z: tee.z, y: hooks.heightAt(tee.x, tee.z) + 0.03, vx: 0, vy: 0, vz: 0 },
    lastRest: { x: tee.x, z: tee.z },
    pin,
    tee,
    aimYaw: Math.atan2(pin.x - tee.x, pin.z - tee.z),
    surface: ZONE.TEE,
    events: [], // strings the UI can toast
    holedOut: false,
  };
  return pt;
}

export function remainingYd(pt) {
  return Math.hypot(pt.pin.x - pt.ball.x, pt.pin.z - pt.ball.z);
}

export function ballOnGreen(pt) {
  return pt.hooks.zoneAt(pt.ball.x, pt.ball.z) === ZONE.GREEN;
}

// Strike the ball: power 0..1, aimYaw radians (world), club from CLUBS.
export function strike(pt, club, power, aimYaw) {
  if (pt.phase !== 'aim' || pt.holedOut) return { ok: false };
  const p = clamp(power, 0.08, 1);
  pt.strokes += 1;
  pt.lastRest = { x: pt.ball.x, z: pt.ball.z };
  const zone = pt.hooks.zoneAt(pt.ball.x, pt.ball.z);
  // lies matter: heavy stuff robs distance
  const lieMul = zone === ZONE.HEAVY ? 0.62 : zone === ZONE.ROUGH ? 0.78 : zone === ZONE.BUNKER ? 0.68 : zone === ZONE.OUT ? 0.7 : 1;
  if (club.key === 'putter') {
    const speed = 24 * p * lieMul; // pure roll
    pt.ball.vx = Math.sin(aimYaw) * speed;
    pt.ball.vz = Math.cos(aimYaw) * speed;
    pt.ball.vy = 0;
    pt.phase = 'rolling';
    return { ok: true };
  }
  // solve launch speed from desired carry on flat ground: R = v²·sin(2θ)/g
  const carry = club.carry * p * lieMul;
  const theta = (club.loftDeg * Math.PI) / 180;
  const v = Math.sqrt(Math.max(1, (carry * G) / Math.max(0.15, Math.sin(2 * theta))));
  pt.ball.vx = Math.sin(aimYaw) * v * Math.cos(theta);
  pt.ball.vz = Math.cos(aimYaw) * v * Math.cos(theta);
  pt.ball.vy = v * Math.sin(theta);
  pt.ball.y = pt.hooks.heightAt(pt.ball.x, pt.ball.z) + 0.03;
  pt.phase = 'flying';
  return { ok: true };
}

// advance the ball; returns true while it is still moving
export function stepBall(pt, dt) {
  if (pt.phase !== 'flying' && pt.phase !== 'rolling') return false;
  const b = pt.ball;
  const hooks = pt.hooks;
  const sub = Math.max(1, Math.ceil(dt / 0.016));
  const h = dt / sub;
  for (let k = 0; k < sub; k++) {
    if (pt.phase === 'flying') {
      b.vy -= G * h;
      b.x += b.vx * h;
      b.z += b.vz * h;
      b.y += b.vy * h;
      const ground = hooks.heightAt(b.x, b.z);
      if (b.y <= ground) {
        b.y = ground;
        const zone = hooks.zoneAt(b.x, b.z);
        if (handleHazards(pt, zone)) return pt.phase !== 'aim';
        const s = surfaceInfo(zone);
        if (Math.abs(b.vy) > 3.5 && s.rest > 0.08) {
          b.vy = -b.vy * s.rest;
          b.vx *= 0.62;
          b.vz *= 0.62;
        } else {
          b.vy = 0;
          pt.phase = 'rolling';
        }
      }
    } else {
      // rolling: friction + slope pull from the terrain gradient
      const ground = hooks.heightAt(b.x, b.z);
      const gx = (hooks.heightAt(b.x + 0.5, b.z) - hooks.heightAt(b.x - 0.5, b.z));
      const gz = (hooks.heightAt(b.x, b.z + 0.5) - hooks.heightAt(b.x, b.z - 0.5));
      const zone = hooks.zoneAt(b.x, b.z);
      if (handleHazards(pt, zone)) return pt.phase !== 'aim';
      const s = surfaceInfo(zone);
      b.vx -= gx * 6.5 * h; // downhill pull
      b.vz -= gz * 6.5 * h;
      const decay = Math.max(0, 1 - s.roll * h);
      b.vx *= decay;
      b.vz *= decay;
      b.x += b.vx * h;
      b.z += b.vz * h;
      b.y = ground;
      // the cup: close and slow = in
      const toPin = Math.hypot(pt.pin.x - b.x, pt.pin.z - b.z);
      const speed = Math.hypot(b.vx, b.vz);
      if (toPin < 0.16 && speed < 3.2) {
        pt.phase = 'holed';
        pt.holedOut = true;
        pt.events.push(`In the hole! ${pt.strokes} stroke${pt.strokes === 1 ? '' : 's'}.`);
        return false;
      }
      if (speed < 0.22) {
        b.vx = 0;
        b.vz = 0;
        pt.phase = 'aim';
        pt.surface = zone;
        return false;
      }
    }
  }
  return true;
}

// water / OOB handling; returns true if the ball was reset
function handleHazards(pt, zone) {
  const b = pt.ball;
  if (zone === ZONE.WATER) {
    pt.penalties += 1;
    pt.strokes += 1; // penalty stroke
    pt.events.push('Splash — penalty drop.');
    b.x = pt.lastRest.x;
    b.z = pt.lastRest.z;
    b.y = pt.hooks.heightAt(b.x, b.z) + 0.03;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    pt.phase = 'aim';
    return true;
  }
  if (pt.hooks.inBoundsWorld && !pt.hooks.inBoundsWorld(b.x, b.z)) {
    pt.penalties += 1;
    pt.strokes += 1;
    pt.events.push('Out of bounds — replay from the drop.');
    b.x = pt.lastRest.x;
    b.z = pt.lastRest.z;
    b.y = pt.hooks.heightAt(b.x, b.z) + 0.03;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    pt.phase = 'aim';
    return true;
  }
  return false;
}

// A quick descriptor for the HUD: lie, remaining, suggested club.
export function playtestHud(pt) {
  const rem = remainingYd(pt);
  const zone = pt.hooks.zoneAt(pt.ball.x, pt.ball.z);
  return {
    strokes: pt.strokes,
    penalties: pt.penalties,
    remainingYd: Math.round(rem),
    lie: surfaceInfo(zone).label,
    club: suggestClub(rem, zone === ZONE.GREEN),
    holed: pt.holedOut,
    phase: pt.phase,
  };
}

// world → cell helper the editor shares with the renderer (yards → cells)
export function worldToCell(worldW, worldH, x, z) {
  return { x: (x + worldW / 2) / CELL_YD, y: (z + worldH / 2) / CELL_YD };
}
