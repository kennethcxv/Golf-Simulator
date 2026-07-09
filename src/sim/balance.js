// FAIRWAY STATE — every tunable balance number in one place.
// None of these are validated data; they are judgment calls (logged in DEV_LOG.md)
// and will be tuned after real playtesting.

export const BALANCE = {
  // --- starting conditions ------------------------------------------------
  startingCash: { relaxed: 100000, realistic: 60000 },

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
  },
  elevationCostPerFoot: 50, // per cell, per foot of net height change
  holeMoveCost: 500, // moving/placing a tee or pin marker

  // --- renovation / construction downtime ---------------------------------
  // days = clamp(ceil(cellsEdited / cellsPerDay), minDays, maxDays)
  renovation: {
    relaxed: { cellsPerDay: 12, minDays: 1, maxDays: 10, teePinMoveDays: 2 },
    realistic: { cellsPerDay: 6, minDays: 2, maxDays: 21, teePinMoveDays: 3 },
  },
  newHoleConstructionDays: { relaxed: 3, realistic: 5 },

  // --- clock ----------------------------------------------------------------
  // Real-time seconds → game minutes at speed 1. A full day ≈ 2m24s at 1x.
  gameMinutesPerRealSecond: 10,
  speeds: [0, 1, 4, 16],
};
