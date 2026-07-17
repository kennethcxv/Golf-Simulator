// Pure first-person look math. Kept THREE-free and side-effect-free so the
// anti-180-spin guarantees can be pinned by node --test: a single pointer-lock
// event can never whip the view around, no matter how large the browser's
// (sometimes synthetic or reacquisition-inflated) movement delta is.

// A single real mouse move is never more than ~140px between frames; anything
// larger is a reacquisition jump or a synthetic delta and is clamped.
export const MOUSE_DELTA_MAX = 140;

const YAW_PER_PX = 0.0021;
const PITCH_PER_PX = 0.0019;
const PITCH_LIMIT = 1.35;

// Clamp the raw delta, apply sensitivity, and return the new (wrapped) yaw and
// (clamped) pitch. Callers discard the first event(s) after a lock is acquired.
export function applyMouseLook(yaw, pitch, movementX, movementY, sens = 1) {
  const mx = Math.max(-MOUSE_DELTA_MAX, Math.min(MOUSE_DELTA_MAX, movementX || 0));
  const my = Math.max(-MOUSE_DELTA_MAX, Math.min(MOUSE_DELTA_MAX, movementY || 0));
  let ny = yaw - mx * YAW_PER_PX * sens;
  if (ny > Math.PI) ny -= Math.PI * 2;
  else if (ny < -Math.PI) ny += Math.PI * 2;
  const np = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - my * PITCH_PER_PX * sens));
  return { yaw: ny, pitch: np };
}
