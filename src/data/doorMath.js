// Door swing selection — pure math, shared by the renderer and the tests.
// A door opens AWAY from whoever operates it, unless its architecture fixes the
// direction (the entry door always swings inward). Angles are hinge rotations:
// for an 'x'-aligned door, + rotates the slab toward -z; for a 'z'-aligned door,
// + rotates it toward +x.

export const SWING = 1.92; // ~110°, resting past-perpendicular against the wall

export function chooseSwingAngle(door, openerLx, openerLz) {
  if (door.fixedSwing) return door.fixedSwing;
  if (door.along === 'x') return SWING * (openerLz >= door.lz ? 1 : -1);
  return SWING * (openerLx >= door.lx ? -1 : 1);
}

// an actor's bearing from the hinge, measured in the slab's own rotation frame:
// psi == 0 means "where the closed slab lies", psi == angle means "where it lies now"
export function hingeBearing(door, lx, lz) {
  const dx = lx - door.lx;
  const dz = lz - door.lz;
  // Most legacy doors extend from their low-coordinate hinge (`closedSign=1`).
  // A double door's opposite leaf extends from the high-coordinate hinge, so
  // measure that leaf in its mirrored closed frame without changing the shared
  // swept-volume rule.
  const closedSign = door.closedSign === -1 ? -1 : 1;
  return door.along === 'x'
    ? Math.atan2(-closedSign * dz, closedSign * dx)
    : Math.atan2(closedSign * dx, closedSign * dz);
}

// Would closing this door sweep the slab through an actor standing at (lx, lz)?
// True for anyone between the slab's current rest angle and the shut position — which includes
// the doorway itself. A door may only ever close through empty air.
export function sweptBy(door, lx, lz, actorR = 0.34) {
  if (Math.abs(door.angle) < 0.05) return false; // already shut: closing moves no slab
  const dx = lx - door.lx;
  const dz = lz - door.lz;
  const dist = Math.hypot(dx, dz);
  if (dist > door.slabW + actorR) return false; // out of the slab's reach entirely
  const t = hingeBearing(door, lx, lz) / door.angle;
  return t > -0.08 && t < 1.08; // inside the arc the slab must travel to shut
}
