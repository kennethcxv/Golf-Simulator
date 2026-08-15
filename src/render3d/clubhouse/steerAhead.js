// G (Goal 20) — CUSTOMERS CHANGE COURSE BEFORE CONTACT, NOT AFTER IT.
//
// What existed was `resolveMotion`: the actor takes its step, and if the new
// position is inside a collider it gets pushed back out through the nearest
// face. That is penetration resolution. It cannot avoid anything, because by
// the time it runs the actor is already in the box — and a shopper walking a
// straight line at a shelf end will grind along it for as long as its waypoint
// stays on the far side. Underneath that sat the one-second blocked timer,
// which reacts later still.
//
// This is the missing half: before the step is taken, probe along the line the
// actor intends to walk. If that line ends in a box, a fixture, the counter or
// another person, turn until it does not. The probe fan is tried nearest-first
// and alternates sides, so an actor takes the SMALLEST turn that clears — which
// is what reads as walking around something rather than deciding to go
// somewhere else.
//
// Kept pure and free of THREE so it can be tested against a hand-drawn room.
// The one-second recovery stays exactly where it was, underneath.

// Nearest-first, alternating sides. 0 is the intended heading and is probed
// before any turn is considered.
export const STEER_FAN_DEG = Object.freeze([18, -18, 36, -36, 56, -56, 78, -78, 100, -100]);

export const STEER_DEFAULTS = Object.freeze({
  // how far down the intended line to look. Roughly one and a half strides:
  // far enough to turn smoothly, near enough that it does not swerve around
  // furniture it was never going to reach.
  distance: 0.95,
  // samples along the probe. Two is enough to catch a wall the actor would
  // reach mid-step; one at the far end alone steps straight through thin
  // colliders standing between here and there.
  samples: 2,
  // below this the actor is arriving somewhere, and the thing in front of it is
  // usually the thing it came to stand at. Steering here is how a shopper ends
  // up circling the shelf it wanted to browse.
  minTravel: 0.62,
});

/**
 * @param x,z        where the actor is
 * @param dirX,dirZ  the direction it intends to walk (any length)
 * @param travel     distance remaining to the waypoint
 * @param isBlockedAt (px, pz) => boolean, in world coordinates
 * @returns {{x, z, steered, turnedDeg, trapped}} a unit heading
 */
export function steerAround(x, z, dirX, dirZ, travel, isBlockedAt, options = {}) {
  const opts = { ...STEER_DEFAULTS, ...options };
  const len = Math.hypot(dirX, dirZ);
  if (!(len > 1e-6)) return { x: 0, z: 0, steered: false, turnedDeg: 0, trapped: false };
  const ux = dirX / len;
  const uz = dirZ / len;
  const base = { x: ux, z: uz, steered: false, turnedDeg: 0, trapped: false };
  if (!(travel > opts.minTravel)) return base;

  // never probe past the destination: the counter you are walking TO is not an
  // obstacle, and probing through it is how an actor refuses to arrive
  const reach = Math.min(opts.distance, travel);
  const clear = (hx, hz) => {
    for (let s = 1; s <= opts.samples; s += 1) {
      const d = (reach * s) / opts.samples;
      if (isBlockedAt(x + hx * d, z + hz * d)) return false;
    }
    return true;
  };

  if (clear(ux, uz)) return base;
  for (const deg of opts.fan || STEER_FAN_DEG) {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const hx = ux * cos - uz * sin;
    const hz = ux * sin + uz * cos;
    if (clear(hx, hz)) return { x: hx, z: hz, steered: true, turnedDeg: deg, trapped: false };
  }
  // Nothing clears. Hold the intended line and let the existing recovery take
  // it: inventing a heading here would walk the actor somewhere it has no
  // reason to be, and the one-second rule exists for exactly this case.
  return { x: ux, z: uz, steered: false, turnedDeg: 0, trapped: true };
}
