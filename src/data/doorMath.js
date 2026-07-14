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
