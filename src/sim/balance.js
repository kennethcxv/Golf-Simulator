// FAIRWAY STATE — every tunable balance number in one place.
// None of these are validated data; they are judgment calls (logged in DEV_LOG.md)
// and will be tuned after real playtesting.

export const BALANCE = {
  // --- starting conditions ------------------------------------------------
  startingCash: { relaxed: 100000, realistic: 60000 },

  // WHOLESALE SALES TAX on supplier orders, as a fraction of goods plus freight.
  //
  // ZERO ON PURPOSE. The laptop's cart screen shows a tax line because a purchase
  // review that hides one is not a purchase review (walk report §7, 2026-07-29) —
  // and the line reads THIS number rather than a hardcoded zero, so the feature is
  // wired end to end and one edit here turns it on.
  //
  // It is not turned on here because it is not a presentation change. Every order
  // in the game gets more expensive, and the opening bundle, the starting cash,
  // the reopening requirements and the economy tests were all tuned against a
  // total of goods + freight. Re-tuning the economy is a decision, not a
  // side effect of adding a row to a screen. Measured: at 0.06 the 27-line
  // reopening bundle goes from $4,486.75 to $4,755.95.
  wholesaleSalesTaxRate: 0,

  // --- course works: per-cell conversion costs (one cell = 8x8 yd) --------
  // Greens are deliberately the big-ticket item (real construction is too).
  zoneCost: {
    // keyed by ZONE numeric value at runtime; names here for readability
    green: 800,
    tee: 300,
    fairway: 120,
    bunker: 250,
    water: 400,
    rough: 40,
    path: 60,
    out: 20, // returning land to nature
    fringe: 400,
    heavy: 25,
    dirt: 15,
    bed: 90,
    semi: 60, // the first cut
  },
  elevationCostPerFoot: 50, // per cell, per foot of net height change
  holeMoveCost: 500, // moving/placing a tee or pin marker
  irrigationHeadCost: 650, // trenching, valve, pop-up head, and commissioning
  irrigationHeadRemoveCost: 80,

  // --- course editor: objects & landscaping --------------------------------
  objectCost: {
    tree: 120, // planting a tree (any species)
    shrub: 45,
    rock: 35, // rocks are hauled, not grown
    prop: 90, // benches, ball washers, signs...
    decor: 50, // planters, flowers, logs
  },
  objectRemoveCost: 40, // crew time to fell/haul any placed object
  newHoleCost: 2500, // surveying + routing a brand-new hole

  // --- renovation / construction downtime ---------------------------------
  // days = clamp(ceil(cellsEdited / cellsPerDay), minDays, maxDays)
  renovation: {
    relaxed: { cellsPerDay: 12, minDays: 1, maxDays: 10, teePinMoveDays: 2 },
    realistic: { cellsPerDay: 6, minDays: 2, maxDays: 21, teePinMoveDays: 3 },
  },
  newHoleConstructionDays: { relaxed: 3, realistic: 5 },

  // --- clock ----------------------------------------------------------------
  // Real-time seconds → game minutes at speed 1. A full day ≈ 2m24s at 1x.
  // Speed 1 is TWO game seconds per real second — a lived-in pace where a tee time
  // booked for 1:30 is actually reachable, not five wall-seconds per game hour.
  // 4× and 16× remain the skip gears.
  // THE DAY LENGTH (2026-07-29). Was 1/30 — one game minute per 30 real
  // seconds, 2x real time, a **12-real-hour day** at the default speed. A
  // one-day delivery therefore took twelve real hours to arrive unless the
  // player sat on fast-forward, and fast-forward was itself broken until
  // SIM-TIME-001 was fixed in this session.
  //
  // 4/30 makes the default day **3 real hours** (45 real minutes at 16x). The
  // justification is the delivery loop, which is the thing the length is for:
  // notice an empty shelf -> order -> wait -> carry the boxes in -> stock it.
  // For that loop to close inside one sitting the wait has to be minutes, not
  // an evening. At 16x a standard one-day lead now lands in ~45 real minutes
  // and an express order the same game day, typically 10-20.
  //
  // NPC_TIMING_BASELINE below is what keeps this honest: change this number and
  // NPC decisions follow it automatically. Without that link, shortening the day
  // would have re-created SIM-TIME-001 by the other route — the clock faster,
  // the shoppers not.
  gameMinutesPerRealSecond: 4 / 30,
  // The rate the NPC dwell/patience/arrival numbers were authored against. The
  // clubhouse scales its decision dt by (actual / baseline), so those authored
  // seconds keep meaning what they meant when they were chosen.
  npcTimingBaselineGameMinutesPerRealSecond: 1 / 30,
  // THE LADDER MOVED WITH THE DAY (2026-07-29), and it had to.
  //
  // These rungs are COMPRESSIONS of the baseline NPC clock, not abstract
  // numbers. The measured healthy ceiling is 16x compression: at that point a
  // game hour completes 10 of 11 visits. At 64x it completes **5 of 11** —
  // measured, not predicted — because NPC locomotion is capped at 4x by the
  // SIM-TIME-001 ruling (uncapped, bodies tunnel colliders) and past a certain
  // compression the walking simply does not fit in the day.
  //
  // Quartering the day multiplied every rung by 4. Left at [0,1,4,16] the top
  // rung would have become 64x — a fast-forward that empties the shop, which is
  // the exact defect SIM-TIME-001 was raised for, re-created by the other route.
  //
  // So the rungs divide by the same 4. Compressions are now 4x / 8x / 16x, days
  // of 3h / 90min / 45min. The fastest day is EXACTLY as fast as it was before
  // this change; what moved is the default, from twelve real hours to three.
  speeds: [0, 1, 2, 4],

  // --- turf simulation --------------------------------------------------------
  turf: {
    // ideal bands per zone type (moisture/nutrients as 0..100 points)
    ideal: {
      green: { height: 4, moisture: [40, 70], nutrients: [40, 75] },
      tee: { height: 10, moisture: [35, 70], nutrients: [35, 70] },
      fairway: { height: 14, moisture: [30, 68], nutrients: [30, 70] },
      rough: { height: 45, moisture: [20, 75], nutrients: [20, 70] },
    },
    growthMmPerHour: { green: 0.085, tee: 0.12, fairway: 0.15, rough: 0.13 },

    evapBasePerHour: 0.55, // moisture points/hour baseline in daylight
    rainMoisturePerInch: 55,
    // demand-based sprinklers: fill toward `target` (offset from the zone's ideal
    // band), capped at `max` points/day. Watering to need, like a real system.
    irrigation: {
      off: null,
      light: { targetOffset: -8, max: 12 }, // sits low in the band — lean & dry
      standard: { targetOffset: 0, max: 20 }, // holds mid-band
      heavy: { targetOffset: 10, max: 30 }, // pushes the top of the band
    },
    waterCostPerPoint: 0.0035, // $ per moisture point per cell actually applied

    fertAdd: { none: 0, lean: 12, standard: 20, aggressive: 32 },
    fertCostPerCell: { none: 0, lean: 0.35, standard: 0.6, aggressive: 1.0 },
    fertEveryDays: 7,

    fungicideCostPerCell: 2.2,
    fungicideProtectionDays: 12,
    aerateCostPerCell: 1.2,

    crewHoursPerDay: 8,
    wagePerCrewDay: { relaxed: 90, realistic: 130 },
    mowHoursPerCell: { green: 0.05, tee: 0.03, fairway: 0.008, rough: 0.004 },

    // negative health drift is scaled down in relaxed mode
    decayMult: { relaxed: 0.55, realistic: 1.0 },
    // daily disease onset scaling (relaxed courses get sick less)
    onsetMult: { relaxed: 0.5, realistic: 1.0 },
  },
};

// THE TWO TIME MULTIPLIERS, derived in one place so the invariant can be tested
// rather than trusted.
//
// This exists because the invariant was broken silently. The clubhouse used to
// take a single multiplier and read locomotion off it as `min(mult, CAP)`. That
// is indistinguishable from correct for as long as the multiplier is 1 — which
// it was, for as long as the day was twelve real hours. Quartering the day made
// it 4, and every shopper sprinted at the cap on the DEFAULT rung.
//
//   decision   — dwell, browse duration, arrival rolls, patience. Scales with
//                the RUNG and the DAY LENGTH, so authored seconds keep meaning
//                what they meant at the baseline rate.
//   locomotion — how fast bodies move through space. Scales with the RUNG ONLY.
//                Day length must never reach it: walking is a look, and the
//                only thing entitled to change it is the player asking for
//                fast-forward.
//
// tests/sim-time-locomotion.test.js drives this with a doctored day length and
// requires locomotion to sit still while decision moves.
/**
 * D1 — GOLFERS GET THE SAME CLOCK SPLIT AS SHOPPERS. On-course bodies read
 * their position off game minutes (updateRoutePosition), so the 12h -> 3h day
 * made every golfer sprint at 4x the authored rates on the DEFAULT rung
 * (measured: 1.93 -> 7.73 yd/s on foot, 3.50 -> 14.00 in a cart). The ruled
 * split: decisions on the game clock, locomotion wall-rate capped.
 *
 * Route durations are priced in game minutes, and the clock burns
 * compression x rung game minutes per wall second — so stretching a route's
 * game-minute duration by this factor holds the BODY at the authored wall
 * rate. The rung term lets fast-forward move bodies up to the same x4 cap the
 * shoppers use (rung/min(rung,4) cancels below the cap, prices the excess in
 * above it). Same discipline as simSpeedMultipliers: the arithmetic lives here
 * so a test can drive it with a doctored day length and prove the wall rate
 * does not move.
 */
export const GOLFER_LOCOMOTION_SPEED_CAP = 4;
export function golferPaceScale(speedRung = 1, balance = BALANCE) {
  const baseline = balance.npcTimingBaselineGameMinutesPerRealSecond || balance.gameMinutesPerRealSecond;
  const compression = balance.gameMinutesPerRealSecond / baseline;
  const rung = Math.max(1, Number(speedRung) || 1);
  return compression * (rung / Math.min(rung, GOLFER_LOCOMOTION_SPEED_CAP));
}

export function simSpeedMultipliers(speedIdx, balance = BALANCE) {
  const rung = balance.speeds[speedIdx];
  // A paused world still reports the multipliers it would resume at — the
  // clubhouse loop reads these every frame regardless of pause, and 0 would
  // divide the shop's whole notion of time by nothing.
  const active = rung || 1;
  const baseline = balance.npcTimingBaselineGameMinutesPerRealSecond || (1 / 30);
  return {
    decision: active * (balance.gameMinutesPerRealSecond / baseline),
    locomotion: active,
  };
}
