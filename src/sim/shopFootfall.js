// HOW MANY PEOPLE ARE IN THE SHOP AT ONCE.
//
// Playtest 2026-08-03: "concurrency is pinned near one. Scale it with how the
// shop is doing — better performance brings more people, worse brings fewer."
//
// It WAS scaled, by yesterday's unit sales:
//
//     clamp(round((salesYesterday.units || 2) / 8 * 3), 1, capacity)
//
// which is where "pinned near one" comes from, and it is not a tuning problem.
// Units sold is an OUTPUT of footfall, so using it as the input closes a loop
// on itself: few customers sell few units, few units bring few customers, and
// the shop sits at one forever with no move the player can make to break out.
// The default of 2 units resolves to exactly 1 shopper, and eight units a day —
// a busy morning at the till — buys you three.
//
// WHAT IT SCALES ON NOW, and why:
//
//   REPUTATION carries three quarters of it. It is the game's existing "how is
//   this club doing" stock: reviews move it, service moves it, and it changes
//   slowly, so footfall does not yo-yo day to day. Critically it is an
//   INTEGRAL of past trade rather than a mirror of it, so it cannot lock: a
//   shop that trades well climbs, a shop that trades badly falls, and neither
//   is a function of how many people happen to be standing in the room now.
//
//   CLEANLINESS carries the other quarter. It is the thing the player can
//   change TODAY, with the broom, and the whole cleaning half of this game
//   exists to make that matter. It is a modifier rather than the base because a
//   spotless shop nobody has heard of should still be quiet — sweeping should
//   pay, but it should not conjure a queue on day one.
//
//   TIER CAPACITY remains the ceiling, unchanged. The room's fit-out decides
//   how many people it can hold; this decides how full it gets.
//
// Revenue is deliberately absent as a direct term. It is not that money does
// not matter — it is that reputation already integrates it, and adding it back
// re-closes the loop this replaces.
import { clamp } from '../core/utils.js';
import { shopCondition } from './shop.js';
import { reputationOverall } from './reputation.js';
import { clubRatings, amenityScore, fairGreenFee, demandMultiplier } from './club.js';

export const SHOP_FOOTFALL = Object.freeze({
  // Below this the club is a rumour; above it word of mouth is saturated and
  // the room's own capacity is what limits the crowd.
  reputationFloor: 20,
  reputationCeiling: 80,
  // A filthy shop is not empty — people still come, they just do not linger or
  // return. Below this the cleanliness term contributes nothing.
  cleanlinessFloor: 25,
  cleanlinessCeiling: 100,
  // ITEM 15 (2026-08-06): "scaled by rating, price and reputation. A good
  // cheap course is busy, a neglected dear one empty."
  //
  // Reputation and cleanliness alone could not express that sentence. Both are
  // about the SHOP; neither knows what the course is like or what it costs, so
  // a course rated 20 and a course rated 90 pulled identical crowds at
  // identical reputation, and the green fee — the one number the player sets
  // directly — did nothing at all.
  //
  // Rating joins the weighted base. PRICE does not: it is a MULTIPLIER, because
  // "cheap" and "dear" are only meaningful against what the round is worth.
  // The game already owns that judgement — fairGreenFee(rating, amenity) and
  // demandMultiplier(price, fair) are what the round-count economy has always
  // used — so this reuses them rather than inventing a second opinion about
  // value that could drift from the first.
  reputationShare: 0.55,
  cleanlinessShare: 0.20,
  ratingShare: 0.25,
  // A bargain fills the room but cannot conjure a crowd out of nothing, and
  // gouging empties it without quite closing the door. Tighter than the
  // round-count model's 0.1..1.8 because concurrency is a small integer: at
  // capacity 6 the full range would swing the floor by four people on price
  // alone, which reads as a bug rather than a pricing decision.
  priceFloor: 0.55,
  priceCeiling: 1.35,
  // F1 (Goal 18): "I want multiple customers in the shop at once and a queue
  // of two or more at the counter, and I want to see it happen." A floor of
  // one made the starter shop a one-at-a-time room FOREVER (drive ~0.1 at
  // reputation 30 with a filthy floor rounds to 0 and clamps to the floor),
  // so the multiplicity mechanic was unreachable no matter how long you
  // watched. Two was tried first and MEASURED (2.7 game hours): concurrency
  // reached 2 but a queue of two never formed — with exactly two in the
  // room, both must reach the counter in the same beat. Three is the
  // smallest floor where a two-queue can form while someone still shops;
  // the curve above the floor scales with standing exactly as designed.
  openFloor: 3,
});

/**
 * The formula itself, with the four terms handed in. Pure, so it can be tested
 * on the numbers rather than by sculpting a state — a fixture cannot cheaply
 * build a badly-conditioned course (section health is computed from turf cells,
 * not stored), and a test that cannot move its input is a test that compares a
 * thing to itself.
 *
 * @param reputation  0..1 normalised club standing
 * @param cleanliness 0..1 normalised shop condition
 * @param rating      0..1 normalised course rating
 * @param priceFactor demand multiplier, already clamped
 */
export function footfallDriveFrom({ reputation = 0, cleanliness = 0, rating = 0, priceFactor = 1 }) {
  const base = clamp(reputation, 0, 1) * SHOP_FOOTFALL.reputationShare
    + clamp(cleanliness, 0, 1) * SHOP_FOOTFALL.cleanlinessShare
    + clamp(rating, 0, 1) * SHOP_FOOTFALL.ratingShare;
  return clamp(base * priceFactor, 0, 1);
}

// 0..1: how much of the room's capacity the club's standing justifies filling.
export function shopFootfallDrive(state) {
  const reputation = clamp(
    (reputationOverall(state) - SHOP_FOOTFALL.reputationFloor)
      / (SHOP_FOOTFALL.reputationCeiling - SHOP_FOOTFALL.reputationFloor),
    0, 1,
  );
  const cleanliness = clamp(
    (shopCondition(state) - SHOP_FOOTFALL.cleanlinessFloor)
      / (SHOP_FOOTFALL.cleanlinessCeiling - SHOP_FOOTFALL.cleanlinessFloor),
    0, 1,
  );
  let rating = 0;
  let price = 1;
  try {
    const ratings = clubRatings(state);
    rating = clamp(ratings.overall / 100, 0, 1);
    const amenity = amenityScore(state);
    const fair = fairGreenFee(ratings.overall, amenity);
    const asked = Number(state?.club?.greenFee) || fair;
    price = clamp(
      demandMultiplier(asked, fair),
      SHOP_FOOTFALL.priceFloor,
      SHOP_FOOTFALL.priceCeiling,
    );
  } catch {
    // A save without a course still has a shop. Rating and price fall out of
    // the model rather than taking the whole thing down with them.
    rating = 0;
    price = 1;
  }
  return footfallDriveFrom({ reputation, cleanliness, rating, priceFactor: price });
}

/** The terms behind the drive, so a driver can say WHY the floor is that busy. */
export function shopFootfallBreakdown(state) {
  const reputation = clamp(
    (reputationOverall(state) - SHOP_FOOTFALL.reputationFloor)
      / (SHOP_FOOTFALL.reputationCeiling - SHOP_FOOTFALL.reputationFloor),
    0, 1,
  );
  const cleanliness = clamp(
    (shopCondition(state) - SHOP_FOOTFALL.cleanlinessFloor)
      / (SHOP_FOOTFALL.cleanlinessCeiling - SHOP_FOOTFALL.cleanlinessFloor),
    0, 1,
  );
  let rating = 0;
  let fair = null;
  let asked = null;
  let price = 1;
  try {
    const ratings = clubRatings(state);
    rating = clamp(ratings.overall / 100, 0, 1);
    const amenity = amenityScore(state);
    fair = fairGreenFee(ratings.overall, amenity);
    asked = Number(state?.club?.greenFee) || fair;
    price = clamp(demandMultiplier(asked, fair),
      SHOP_FOOTFALL.priceFloor, SHOP_FOOTFALL.priceCeiling);
  } catch { /* no course: the terms drop out */ }
  return {
    reputation: +reputation.toFixed(3),
    cleanliness: +cleanliness.toFixed(3),
    rating: +rating.toFixed(3),
    fairFee: fair == null ? null : +fair.toFixed(2),
    askedFee: asked == null ? null : +asked.toFixed(2),
    priceFactor: +price.toFixed(3),
    drive: +shopFootfallDrive(state).toFixed(3),
  };
}

// How many shoppers the floor should be carrying right now. `capacity` is the
// tier's own ceiling; `open` is the door sign, which is a gate and not a scale.
export function shopFootfallTarget(state, capacity, { open = true } = {}) {
  if (!open) return 0;
  const ceiling = Math.max(0, Math.round(Number(capacity) || 0));
  if (!ceiling) return 0;
  // the floor cannot exceed the room: a two-person fit-out holds two,
  // whatever the open floor asks for
  return clamp(
    Math.round(ceiling * shopFootfallDrive(state)),
    Math.min(SHOP_FOOTFALL.openFloor, ceiling),
    ceiling,
  );
}
