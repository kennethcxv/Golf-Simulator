// WHERE THE OPEN/CLOSED SIGN HANGS.
//
// Pulled out of clubhouse.js on 2026-08-03 because the placement was wrong and
// nothing in the repository could see it. The renderer computed a WORLD point
// with L2W() and then assigned it as the group's INTERIOR-LOCAL position, so
// the building offset was applied twice: the painted card ended up 360 yards
// from the clubhouse and three quarters of a yard below where it belonged,
// while its E hotspot — which correctly took the world point — stayed on the
// jamb by the door. The player pressed E on an invisible hotspot, got the toast
// and the trading gate, and never saw the card turn, because the card was not
// there. The shipped test read the animation source and passed.
//
// A named point is a thing a test can check. A line buried in a three-thousand
// line closure is not.
//
// All distances are in yards, in the interior's own local frame: x across the
// room from its centre, y above the interior floor, z toward the south wall.

// eye height for someone standing in front of it
export const SIGN_EYE_HEIGHT = 1.55;
// clear of the door reveal, so the card is beside the doorway and not over it
export const SIGN_DOOR_GAP = 0.42;
// off the wall face, enough for the board's thickness and a shadow
export const SIGN_WALL_GAP = 0.10;

// `door` is DOOR_MAIN (x = hinge-side datum, w = aperture width);
// `interiorDepth` is the south wall's local z distance × 2.
export function shopSignLocalPoint(door, interiorDepth) {
  return {
    x: door.x + door.w / 2 + SIGN_DOOR_GAP,
    y: SIGN_EYE_HEIGHT,
    z: interiorDepth / 2 - SIGN_WALL_GAP,
  };
}
