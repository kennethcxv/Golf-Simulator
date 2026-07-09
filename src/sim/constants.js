// FAIRWAY STATE — simulation enums and structural constants.
// Tunable *numbers* live in balance.js; things here define the shape of the world.

// --- course grid ---------------------------------------------------------
export const GRID_W = 120;
export const GRID_H = 80;
export const CELL_YD = 8; // each cell is 8x8 yards → course footprint 960x640 yd

// --- zones ---------------------------------------------------------------
export const ZONE = {
  OUT: 0, // unmaintained land — scrub, trees, out of play
  ROUGH: 1,
  FAIRWAY: 2,
  GREEN: 3,
  TEE: 4,
  BUNKER: 5,
  WATER: 6,
  PATH: 7,
};

export const ZONE_NAMES = ['Out of play', 'Rough', 'Fairway', 'Green', 'Tee', 'Bunker', 'Water', 'Path'];

// Zones that grow grass and therefore participate in the turf simulation.
export const TURF_ZONES = new Set([ZONE.ROUGH, ZONE.FAIRWAY, ZONE.GREEN, ZONE.TEE]);

// Zones that get labeled into named sections for the UI / golfer opinions.
export const SECTION_ZONES = new Set([ZONE.ROUGH, ZONE.FAIRWAY, ZONE.GREEN, ZONE.TEE, ZONE.BUNKER, ZONE.WATER]);

// --- calendar ------------------------------------------------------------
export const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
export const DAYS_PER_SEASON = 24;
export const DAYS_PER_YEAR = SEASONS.length * DAYS_PER_SEASON; // 96
export const MINUTES_PER_DAY = 1440;
export const DAY_START_MIN = 6 * 60; // course opens 6:00 AM (weather permitting)
export const DAY_END_MIN = 20 * 60; // last light 8:00 PM

// --- holes ---------------------------------------------------------------
// Par bands from real-world guidance (yards, tee → pin straight line).
export const PAR3_MAX_YD = 250;
export const PAR4_MAX_YD = 470;
export const HOLE_MIN_YD = 60;
export const HOLE_MAX_YD = 650;

// How close (in cells) an edit must be to a hole's tee→pin corridor to count as
// renovating that hole.
export const HOLE_CORRIDOR_CELLS = 4;

export const HOLE_STATUS = {
  UNBUILT: 'unbuilt',
  CONSTRUCTION: 'construction',
  OPEN: 'open',
  RENOVATION: 'renovation',
};
