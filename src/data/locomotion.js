// THE PLAYER'S OWN MOVEMENT, OWNED IN ONE PLACE.
//
// Why this file exists (D7, 2026-08-04): these numbers were written out by hand
// in four or five modules each, and several tests then asserted against a
// SIXTH hand-written copy. A check whose expected value is a retyped literal
// cannot notice the authority moving — it can only notice the code disagreeing
// with itself — so the suite stayed green while:
//
//   * BROOM_FEEL.dirt.pushSpeed guarded "the push must beat the walk speed
//     (2.2 yd/s)" while the player actually walked at 3.4, so the invariant was
//     false in the shipping build and green in CI;
//   * BROOM_FEEL.walk.bobRate carried the comment "MUST match the characters'
//     stride rate" with nothing enforcing it and four separate copies of 8.7
//     in circulation.
//
// Anything that needs to know how fast the player moves, how often they take a
// step, or how high their eye sits imports it from here. If you are about to
// type one of these numbers into another file, import it instead.

/** Ground speed of an ordinary walk, yards per second. */
export const WALK_SPEED_YD_S = 3.4;

/** Shift-to-run multiplier on WALK_SPEED_YD_S. */
export const RUN_MULTIPLIER = 1.8;

/** Top ground speed the player can reach, yards per second. */
export const RUN_SPEED_YD_S = WALK_SPEED_YD_S * RUN_MULTIPLIER;

/**
 * The gait oscillator, radians per second, under way. Every rig that bobs with
 * the player's steps — the characters, the first-person camera, a held tool —
 * must use this one, or a held tool bobs out of phase with the body carrying it
 * and reads as detached from it.
 */
export const STRIDE_RATE_RAD_S = 8.7;

/** The same oscillator at a standstill: a slow breathe, not a stride. */
export const IDLE_SWAY_RATE_RAD_S = 1.6;

/** Eye height above the surface under the player, yards. */
export const EYE_HEIGHT_YD = 1.75;

/** Field of view of the walking camera, degrees. A held-tool viewmodel that
 * matches this is hostage to it; the broom pass deliberately runs its own. */
export const WALK_FOV_DEG = 66;
