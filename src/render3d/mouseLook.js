// Pure first-person look math. Kept THREE-free so the anti-180-spin and
// no-roll guarantees can be pinned by node --test: a single pointer-lock event
// can never whip the view around, no matter how large the browser's (sometimes
// synthetic or reacquisition-inflated) movement delta is, and the horizon can
// never end up slanted.

// A single real mouse move is never more than ~140px between frames; anything
// larger is a reacquisition jump or a synthetic delta and is clamped.
export const MOUSE_DELTA_MAX = 140;

const YAW_PER_PX = 0.0021;
const PITCH_PER_PX = 0.0019;
// EXPORTED because it is the range a viewmodel has to survive, and two separate
// instruments have now been written against broomFeel's `maxPitch` (0.30) in the
// belief that it was the look limit. It is a curve clamp. This is the limit.
export const PITCH_LIMIT = 1.35;

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

// Point a camera the way a person looks: yaw, then pitch, and NO ROLL.
//
// Write all three angles and the order together, every time. Assigning only .x
// and .y is what tilted the whole view: the management camera poses itself with
// lookAt(), three.js re-derives that quaternion into the camera's CURRENT Euler
// order, and in the default XYZ a roll-free orbit pose still lands a non-zero
// .z — XYZ's third angle simply isn't roll about the view axis. Switching the
// order to YXZ for walking reinterprets that leftover as literal roll, and the
// horizon came up 4.85 degrees off with no input that could straighten it.
//
// Takes anything with a THREE.Euler-shaped rotation, so this stays node-testable.
export function setFirstPersonOrientation(camera, yaw, pitch) {
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}
