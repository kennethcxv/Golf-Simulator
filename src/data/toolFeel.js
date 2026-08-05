// I1 — EVERY STICK TOOL GETS THE BROOM'S TREATMENT, AS CONFIG.
//
// The broom rig (broomViewmodel.js) was built "for the broom until the broom
// is approved, then for everyone". This file is the "everyone": a per-tool
// feel derived from BROOM_FEEL, because the treatment that was approved IS the
// broom's — viewmodel lens, hands at hip height, floor-anchored head with the
// plant window, real stroke arc, weighted lag, hand scale, grip stow — and a
// tool that wants different numbers overrides exactly the numbers it wants.
//
// What stays per-tool CONFIG and what needed real code (the finding I1 asked
// for): the rig gained ONE new behaviour switch, `anchor: 'floor' | 'carry'`.
// A pressure wand washes walls — planting its head on the boards, capping its
// hands at floor reach and stowing on up-look are all floor-tool ideas, so
// 'carry' turns exactly those three off. Everything else — every arc, rate,
// lag and hover below — is data.
//
// The one-handed tools (spray, cloth, sponge, trashbag) are NOT here: they are
// hand-worked surface tools, not stick tools, and the House Flipper read for
// them is the existing close-carry pose with useMotion. Forcing them through a
// two-hand shaft solve would put a phantom second hand on a spray bottle.
// That boundary is the second finding.

import { BROOM_FEEL } from './broomFeel.js';

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
      ? deepMerge(base[key], value)
      : value;
  }
  return out;
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value);
  }
  return Object.freeze(obj);
}

function derive(patch) {
  return deepFreeze(deepMerge(BROOM_FEEL, patch));
}

export const TOOL_VM_FEEL = Object.freeze({
  // the approved reference, untouched
  broom: BROOM_FEEL,

  // A wet cotton head: heavier than bristles, so the stroke is a little
  // narrower and the head lags the hands more; the yarn squashes, so it
  // kisses the boards a touch higher than bristle tips do.
  mop: derive({
    anchor: 'floor',
    sweep: { arcRad: BROOM_FEEL.sweep.arcRad * 0.8 },
    stroke: { rate: BROOM_FEEL.stroke.rate * 0.85 },
    weight: { lagHz: BROOM_FEEL.weight.lagHz * 0.85 },
    surface: { floorKiss: BROOM_FEEL.surface.floorKiss + 0.008 },
  }),

  // A vacuum head GLIDES: short tracking strokes, stiffer follow (a rigid
  // wand, not a flexible shaft), and the head hugs the boards. Its authored
  // sockets speak the vacuum's own vocabulary — the first generalized run
  // read 'fallback' geometry because the rig only knew the broom's names.
  vacuum: derive({
    anchor: 'floor',
    rig: { sockets: { contact: 'SOCKET_DirtIntake' } },
    sweep: { arcRad: BROOM_FEEL.sweep.arcRad * 0.55 },
    stroke: { rate: BROOM_FEEL.stroke.rate * 0.7 },
    weight: { lagHz: BROOM_FEEL.weight.lagHz * 1.3, lagDamping: 0.8 },
    surface: { floorKiss: BROOM_FEEL.surface.floorKiss + 0.012 },
    // Measured: GripPrimary→DirtIntake is 0.796 yd against the broom's 1.247,
    // so hands at broom height saturate the drop and the head hung 0.276 yd
    // up. A person STOOPS with a short wand — the hands ride lower.
    compose: { gripAnchor: [0.24, -0.73, -0.66] },
  }),

  // The pan: a short one-handed stick (fpHands already hides the support hand
  // for a tool with no left grip). Short brisk push into the pile.
  dustpan: derive({
    anchor: 'floor',
    rig: { sockets: { contact: 'SOCKET_PanIntake', primary: 'SOCKET_Grip' } },
    sweep: { arcRad: BROOM_FEEL.sweep.arcRad * 0.5 },
    stroke: { rate: BROOM_FEEL.stroke.rate * 1.25 },
    weight: { lagHz: BROOM_FEEL.weight.lagHz * 1.5, lagDamping: 0.75 },
    // Same stoop as the vacuum, shallower: the pan's grip→lip run measured
    // ~0.85 yd and the head hung 0.176 yd up at broom-height hands.
    compose: { gripAnchor: [0.22, -0.64, -0.62] },
  }),

  // The pressure wand: 'carry' — no floor plant, no reach cap, no stow,
  // because walls and sills are its whole job. The stroke is a fast, tiny
  // tremble: a pressurised line pushes back, it does not sweep.
  washer: derive({
    anchor: 'carry',
    rig: { sockets: { contact: 'SOCKET_SprayEmission' } },
    sweep: { arcRad: BROOM_FEEL.sweep.arcRad * 0.25 },
    stroke: { rate: BROOM_FEEL.stroke.rate * 2.2 },
    weight: { lagHz: BROOM_FEEL.weight.lagHz * 2.0, lagDamping: 0.85 },
    compose: { gripAnchor: [0.22, -0.44, -0.62] },
  }),
});

/** The stick tools the viewmodel rig owns. Everything else keeps the
 * close-carry pose + useMotion path in courseScene. */
export const VM_RIG_TOOLS = Object.freeze(Object.keys(TOOL_VM_FEEL));
