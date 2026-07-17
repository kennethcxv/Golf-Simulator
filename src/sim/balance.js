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
    fringe: 400,
    heavy: 25,
    dirt: 15,
    bed: 90,
    semi: 60, // the first cut
  },
  elevationCostPerFoot: 50, // per cell, per foot of net height change
  holeMoveCost: 500, // moving/placing a tee or pin marker

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
  gameMinutesPerRealSecond: 10,
  speeds: [0, 1, 4, 16],

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
