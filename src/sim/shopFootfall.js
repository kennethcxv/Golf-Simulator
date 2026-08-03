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

export const SHOP_FOOTFALL = Object.freeze({
  // Below this the club is a rumour; above it word of mouth is saturated and
  // the room's own capacity is what limits the crowd.
  reputationFloor: 20,
  reputationCeiling: 80,
  // A filthy shop is not empty — people still come, they just do not linger or
  // return. Below this the cleanliness term contributes nothing.
  cleanlinessFloor: 25,
  cleanlinessCeiling: 100,
  reputationShare: 0.75,
  cleanlinessShare: 0.25,
  // An open shop always has room for one person. A shop that is open and
  // completely empty of prospects is a bug the player cannot diagnose.
  openFloor: 1,
});

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
  return clamp(
    reputation * SHOP_FOOTFALL.reputationShare
      + cleanliness * SHOP_FOOTFALL.cleanlinessShare,
    0, 1,
  );
}

// How many shoppers the floor should be carrying right now. `capacity` is the
// tier's own ceiling; `open` is the door sign, which is a gate and not a scale.
export function shopFootfallTarget(state, capacity, { open = true } = {}) {
  if (!open) return 0;
  const ceiling = Math.max(0, Math.round(Number(capacity) || 0));
  if (!ceiling) return 0;
  return clamp(
    Math.round(ceiling * shopFootfallDrive(state)),
    SHOP_FOOTFALL.openFloor,
    ceiling,
  );
}
