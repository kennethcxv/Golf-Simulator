// FAIRWAY STATE — the turf simulation: the living-grass heart of the game.
//
// Per-cell state (typed arrays, serialized with the save):
//   health 0..100    — master condition
//   moisture 0..100  — % of field capacity; both drought AND waterlogging hurt
//   nutrients 0..100 — fertility; hungry turf invites dollar spot, overfed + wet
//                      invites brown patch
//   heightMm         — grass height; mowing resets it toward the policy target
//   wear 0..100      — traffic damage (golfers add it in Phase 5; aeration relieves)
//   disType/disSev   — disease per cell so course edits can never orphan it
//   treated          — fungicide protection days remaining
//
// Physics ticks hourly; maintenance executes at the 5 AM pass within crew-hours
// capacity (greens first, rough last — an understaffed muni visibly shags out).
// Sections stay the legibility layer: one status word each, detail on demand.

import { ZONE, TURF_ZONES } from './constants.js';
import { BALANCE } from './balance.js';
import { clamp, rngOf } from '../core/utils.js';
import { tempAtHour, isFrostMorning } from './weather.js';
import { spend } from './economy.js';
import { groundsCrewHours } from './staff.js';
import {
  mowHoursFactor, waterCostFactor, fungicideCostFactor, aerateCostFactor, wearRecoveryBonus,
} from './progression.js';

const T = () => BALANCE.turf;

export const DISEASE = { NONE: 0, DOLLAR_SPOT: 1, BROWN_PATCH: 2 };
export const DISEASE_NAMES = ['—', 'Dollar spot', 'Brown patch'];

const ZONE_KEY = {
  [ZONE.GREEN]: 'green',
  [ZONE.TEE]: 'tee',
  [ZONE.FAIRWAY]: 'fairway',
  [ZONE.ROUGH]: 'rough',
  // editor-era surfaces ride the nearest policy class — fringe is mown like a
  // tee collar, the first cut like fairway, heavy rough like rough
  [ZONE.FRINGE]: 'tee',
  [ZONE.SEMI]: 'fairway',
  [ZONE.HEAVY]: 'rough',
};

export function zonePolicyKey(zone) {
  return ZONE_KEY[zone] || null;
}

// --- init -----------------------------------------------------------------------

export function defaultPolicies() {
  return {
    green: { mowHeightMm: 4, mowEveryDays: 1, pattern: 'stripes', irrigation: 'standard', schedule: 'dawn', fertilizer: 'lean' },
    tee: { mowHeightMm: 10, mowEveryDays: 3, pattern: 'plain', irrigation: 'light', schedule: 'dawn', fertilizer: 'lean' },
    fairway: { mowHeightMm: 14, mowEveryDays: 4, pattern: 'stripes', irrigation: 'light', schedule: 'dawn', fertilizer: 'none' },
    rough: { mowHeightMm: 45, mowEveryDays: 8, pattern: 'plain', irrigation: 'off', schedule: 'dawn', fertilizer: 'none' },
  };
}

export function initTurf(state) {
  const n = state.course.w * state.course.h;
  state.turf = {
    health: new Float32Array(n),
    moisture: new Float32Array(n),
    nutrients: new Float32Array(n),
    heightMm: new Float32Array(n),
    wear: new Float32Array(n),
    disType: new Uint8Array(n),
    disSev: new Float32Array(n),
    treated: new Uint8Array(n),
  };
  state.maintenance = {
    policies: defaultPolicies(),
    lastMowDay: { green: -10, tee: -10, fairway: -10, rough: -10 },
    lastFertDay: { green: -10, tee: -10, fairway: -10, rough: -10 },
    crewUnits: 1, // the fixer-upper opens with just you
    lastReport: null,
  };

  const rng = rngOf(state);
  const { zones } = state.course;
  const t = state.turf;
  // the fixer-upper look: shaggy everything, hungry greens, worn tees
  const base = {
    green: { health: 58, moisture: 45, nutrients: 36, height: 6, wear: 18 },
    tee: { health: 55, moisture: 45, nutrients: 45, height: 15, wear: 35 },
    fairway: { health: 52, moisture: 42, nutrients: 44, height: 22, wear: 10 },
    rough: { health: 60, moisture: 45, nutrients: 40, height: 70, wear: 4 },
  };
  for (let i = 0; i < n; i++) {
    const key = ZONE_KEY[zones[i]];
    if (!key) continue;
    const b = base[key];
    t.health[i] = clamp(b.health + (rng.next() - 0.5) * 18, 15, 90);
    t.moisture[i] = clamp(b.moisture + (rng.next() - 0.5) * 16, 10, 90);
    t.nutrients[i] = clamp(b.nutrients + (rng.next() - 0.5) * 14, 10, 90);
    t.heightMm[i] = Math.max(2, b.height + (rng.next() - 0.5) * 4);
    t.wear[i] = clamp(b.wear + (rng.next() - 0.5) * 16, 0, 70);
  }

  // three of the nine greens open with dollar spot — the classic hungry-green disease
  const greens = state.sections.filter((s) => s.zone === ZONE.GREEN && s.holeId != null);
  const sickCount = Math.min(3, greens.length);
  const shuffled = [...greens];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (let k = 0; k < sickCount; k++) {
    infectSection(state, shuffled[k], DISEASE.DOLLAR_SPOT, 22 + rng.next() * 22, rng);
  }
}

function infectSection(state, section, kind, severity, rng) {
  const t = state.turf;
  for (const i of section.cells) {
    if (rng.next() < 0.55) {
      t.disType[i] = kind;
      t.disSev[i] = clamp(severity + (rng.next() - 0.5) * 14, 5, 95);
      t.health[i] = clamp(t.health[i] - t.disSev[i] * 0.25, 10, 100);
    }
  }
}

// New sod for cells converted into turf zones; scrub data for cells converted away.
export function turfOnZonesChanged(state, cells) {
  const t = state.turf;
  if (!t) return;
  const { zones } = state.course;
  for (const i of cells) {
    const key = ZONE_KEY[zones[i]];
    t.disType[i] = 0;
    t.disSev[i] = 0;
    t.treated[i] = 0;
    if (key) {
      t.health[i] = 38; // fresh sod has to grow in
      t.moisture[i] = 55;
      t.nutrients[i] = 55;
      t.heightMm[i] = state.maintenance.policies[key].mowHeightMm;
      t.wear[i] = 0;
    } else {
      t.health[i] = 0;
      t.moisture[i] = 0;
      t.nutrients[i] = 0;
      t.heightMm[i] = 0;
      t.wear[i] = 0;
    }
  }
}

// --- disease pressure -------------------------------------------------------------

// 0..1 pressure given today's weather and local turf chemistry.
export function diseasePressure(kind, { today, moisture, nutrients }) {
  const hi = today.tempHiF;
  const lo = today.tempLoF;
  const rh = today.humidity;
  if (kind === DISEASE.DOLLAR_SPOT) {
    // mild days, lingering humidity, underfed turf
    const tempWindow = hi >= 58 && hi <= 90 ? 1 - Math.abs(hi - 74) / 26 : 0;
    const humid = clamp((rh - 0.5) * 2.2, 0, 1);
    const hunger = nutrients < 38 ? 1 : nutrients < 55 ? 0.45 : 0.12;
    return clamp(tempWindow * humid * hunger, 0, 1);
  }
  if (kind === DISEASE.BROWN_PATCH) {
    // hot nights + saturation (overwatering/overfeeding make it worse)
    const nightHeat = clamp((lo - 62) / 14, 0, 1);
    const humid = clamp((rh - 0.55) * 2.4, 0, 1);
    const wet = clamp((moisture - 62) / 30, 0, 1) * 0.7 + clamp((nutrients - 68) / 30, 0, 1) * 0.3;
    return clamp(nightHeat * humid * clamp(wet, 0, 1), 0, 1);
  }
  return 0;
}

// --- hourly physics ------------------------------------------------------------------

export function turfHourlyTick(state, hourOfDay) {
  const t = state.turf;
  if (!t) return;
  const { zones } = state.course;
  const today = state.weather.today;
  const temp = tempAtHour(today, hourOfDay);
  const dormant = today.tempHiF < 45;
  const daylight = hourOfDay >= 6 && hourOfDay <= 20;
  const decay = T().decayMult[state.mode];

  // rain lands in four showers through the day, totalling rainIn * points-per-inch
  const rainThisHour =
    today.rainIn > 0 && hourOfDay % 6 === 1 ? (today.rainIn * T().rainMoisturePerInch) / 4 : 0;

  // evaporation strongest on hot dry afternoons
  const evap =
    (daylight ? T().evapBasePerHour : T().evapBasePerHour * 0.25) *
    (1 + Math.max(0, temp - 78) / 30) *
    (1.25 - today.humidity);

  const growBase = dormant ? 0 : 1 * clamp((temp - 42) / 30, 0, 1) * (temp > 95 ? 0.5 : 1);

  const ideals = T().ideal;
  for (let i = 0; i < zones.length; i++) {
    const key = ZONE_KEY[zones[i]];
    if (!key) continue;
    const ideal = ideals[key];

    // water balance
    let m = t.moisture[i] + rainThisHour - evap;
    m = clamp(m, 0, 100);
    t.moisture[i] = m;

    // growth consumes nutrients
    const moistFactor = m < 20 ? 0.25 : m > 92 ? 0.55 : 1;
    const nutFactor = t.nutrients[i] < 20 ? 0.4 : 1;
    const growth = T().growthMmPerHour[key] * growBase * moistFactor * nutFactor;
    t.heightMm[i] += growth;
    t.nutrients[i] = clamp(t.nutrients[i] - growth * 0.5 - 0.008, 0, 100);

    // disease severity creeps while conditions persist and no protection
    if (t.disType[i] !== DISEASE.NONE) {
      if (t.treated[i] > 0) {
        t.disSev[i] = Math.max(0, t.disSev[i] - 0.5);
      } else {
        const p = diseasePressure(t.disType[i], { today, moisture: m, nutrients: t.nutrients[i] });
        t.disSev[i] = clamp(t.disSev[i] + p * 0.55 - 0.06, 0, 100);
      }
      if (t.disSev[i] <= 0.5) {
        t.disType[i] = DISEASE.NONE;
        t.disSev[i] = 0;
      }
    }

    // health drift
    const [mLo, mHi] = ideal.moisture;
    const [nLo, nHi] = ideal.nutrients;
    let f = 0;
    if (m < mLo) f -= m < 16 ? 2.0 : ((mLo - m) / mLo) * 1.8;
    else if (m > mHi) f -= ((m - mHi) / (100 - mHi)) * 1.35;
    else f += 0.8;
    const nu = t.nutrients[i];
    if (nu < nLo) f -= ((nLo - nu) / nLo) * 0.9;
    else if (nu > nHi) f -= ((nu - nHi) / (100 - nHi)) * 0.5;
    else f += 0.55;
    const hRatio = t.heightMm[i] / ideal.height;
    if (hRatio > 2.4) f -= key === 'rough' ? 0.15 : 0.55;
    else if (hRatio < 0.5) f -= 0.5; // scalped
    else f += 0.25;
    f -= (t.disSev[i] / 100) * 2.4;
    f -= (t.wear[i] / 100) * 0.9;

    // asymmetric drift: grass declines much faster than it recovers
    let drift = f >= 0 ? clamp(f, 0, 1.6) * 0.065 : clamp(f, -3, 0) * 0.18;
    if (dormant) drift = Math.min(0, drift) * 0.25; // winter dormancy: hold, don't grow
    if (drift < 0) drift *= decay;
    t.health[i] = clamp(t.health[i] + drift, 0, 100);
  }
}

// --- daily pass -------------------------------------------------------------------------

export function turfDailyTick(state) {
  const t = state.turf;
  if (!t) return;
  const rng = rngOf(state);
  const today = state.weather.today;
  const onsetMult = T().onsetMult[state.mode];

  // fungicide protection ticks down; light natural wear recovery
  const wearRecovery = 1.5 + (state.progression ? wearRecoveryBonus(state) : 0);
  for (let i = 0; i < t.treated.length; i++) {
    if (t.treated[i] > 0) t.treated[i]--;
    if (t.wear[i] > 0) t.wear[i] = Math.max(0, t.wear[i] - wearRecovery);
  }

  // disease onset checks per turf section
  for (const section of state.sections) {
    if (!TURF_ZONES.has(section.zone)) continue;
    if (section.zone === ZONE.WATER) continue;
    const sum = sectionTurfSummary(state, section);
    if (sum.disease) continue; // already sick
    const resist = section.zone === ZONE.ROUGH ? 0.3 : 1;
    for (const kind of [DISEASE.DOLLAR_SPOT, DISEASE.BROWN_PATCH]) {
      const p = diseasePressure(kind, { today, moisture: sum.moisture, nutrients: sum.nutrients });
      if (rng.chance(p * 0.3 * resist * onsetMult)) {
        infectSection(state, section, kind, 10 + rng.next() * 12, rng);
        break;
      }
    }
  }
}

// --- morning maintenance (5 AM) -----------------------------------------------------------

const MOW_PRIORITY = ['green', 'tee', 'fairway', 'rough'];

export function runMorningMaintenance(state, dayAbs) {
  const t = state.turf;
  const maint = state.maintenance;
  if (!t || !maint) return null;
  const { zones } = state.course;
  const frost = isFrostMorning(state.weather.today);

  // count cells per zone key once
  const cellsByKey = { green: [], tee: [], fairway: [], rough: [] };
  for (let i = 0; i < zones.length; i++) {
    const key = ZONE_KEY[zones[i]];
    if (key) cellsByKey[key].push(i);
  }

  const report = {
    dayAbs,
    done: [],
    skipped: [],
    frostDelay: frost,
    costs: { wages: 0, water: 0, fertilizer: 0 },
  };

  // skilled groundskeeper staff + day-labor headcount both feed capacity
  let hoursLeft = state.staff ? groundsCrewHours(state) : maint.crewUnits * T().crewHoursPerDay;
  report.costs.wages = maint.crewUnits * T().wagePerCrewDay[state.mode];

  // --- irrigation (automatic demand-based sprinklers, no crew time) ---
  // waters each cell up toward the zone's band; skips when real rain is falling
  const rainSkip = state.weather.today.rainIn > 0.2;
  for (const key of MOW_PRIORITY) {
    const pol = maint.policies[key];
    const spec = T().irrigation[pol.irrigation];
    if (!spec || cellsByKey[key].length === 0) continue;
    if (rainSkip) {
      report.done.push({ zone: key, task: 'irrigation skipped (rain)', hours: 0 });
      continue;
    }
    const [mLo, mHi] = T().ideal[key].moisture;
    const target = clamp((mLo + mHi) / 2 + spec.targetOffset, 5, 95);
    const maxDose = spec.max * (pol.schedule === 'both' ? 1.5 : 1);
    let pointsApplied = 0;
    for (const i of cellsByKey[key]) {
      const need = clamp(target - t.moisture[i], 0, maxDose);
      if (need > 0) {
        t.moisture[i] = clamp(t.moisture[i] + need, 0, 100);
        pointsApplied += need;
      }
    }
    report.costs.water += pointsApplied * T().waterCostPerPoint * (state.progression ? waterCostFactor(state) : 1);
  }

  // frost: crews wait for the thaw — mowing/fert skipped today
  if (frost) {
    for (const key of MOW_PRIORITY) {
      if (dayAbs - maint.lastMowDay[key] >= maint.policies[key].mowEveryDays && cellsByKey[key].length) {
        report.skipped.push({ zone: key, task: 'mow', reason: 'frost delay' });
      }
    }
    maint.lastReport = report;
    return report;
  }

  // --- mowing within capacity, greens first ---
  for (const key of MOW_PRIORITY) {
    const pol = maint.policies[key];
    const cells = cellsByKey[key];
    if (!cells.length) continue;
    const due = dayAbs - maint.lastMowDay[key] >= pol.mowEveryDays;
    if (!due) continue;
    const equipFactor = state.progression ? mowHoursFactor(state, key) : 1;
    const needed = cells.length * T().mowHoursPerCell[key] * equipFactor;
    if (needed <= hoursLeft) {
      hoursLeft -= needed;
      for (const i of cells) {
        if (t.heightMm[i] > pol.mowHeightMm) t.heightMm[i] = pol.mowHeightMm;
      }
      maint.lastMowDay[key] = dayAbs;
      report.done.push({ zone: key, task: 'mow', hours: Math.round(needed * 10) / 10 });
    } else {
      report.skipped.push({ zone: key, task: 'mow', reason: `crew short ${Math.ceil(needed - hoursLeft)}h` });
    }
  }

  // --- fertilization program (small crew time) ---
  for (const key of MOW_PRIORITY) {
    const pol = maint.policies[key];
    const add = T().fertAdd[pol.fertilizer] || 0;
    const cells = cellsByKey[key];
    if (add <= 0 || !cells.length) continue;
    if (dayAbs - maint.lastFertDay[key] < T().fertEveryDays) continue;
    const needed = cells.length * 0.004;
    if (needed <= hoursLeft) {
      hoursLeft -= needed;
      for (const i of cells) t.nutrients[i] = clamp(t.nutrients[i] + add, 0, 100);
      maint.lastFertDay[key] = dayAbs;
      report.costs.fertilizer += cells.length * T().fertCostPerCell[pol.fertilizer];
      report.done.push({ zone: key, task: 'fertilize', hours: Math.round(needed * 10) / 10 });
    } else {
      report.skipped.push({ zone: key, task: 'fertilize', reason: 'crew short' });
    }
  }

  report.hoursLeft = Math.round(hoursLeft * 10) / 10;
  maint.lastReport = report;
  return report;
}

// --- player actions ---------------------------------------------------------------------

export function treatSection(state, section) {
  const t = state.turf;
  const cost = Math.round(section.cells.length * T().fungicideCostPerCell * (state.progression ? fungicideCostFactor(state) : 1));
  if (state.cash < cost) return { ok: false, reason: 'Not enough cash for fungicide.' };
  spend(state, 'chemicals', cost);
  for (const i of section.cells) {
    t.treated[i] = T().fungicideProtectionDays;
  }
  if (state.tutorial) state.tutorial.flags.treatedSection = true;
  return { ok: true, cost };
}

export function aerateSection(state, section) {
  const t = state.turf;
  const cost = Math.round(section.cells.length * T().aerateCostPerCell * (state.progression ? aerateCostFactor(state) : 1));
  if (state.cash < cost) return { ok: false, reason: 'Not enough cash to aerate.' };
  spend(state, 'upkeep', cost);
  for (const i of section.cells) {
    t.wear[i] = Math.max(0, t.wear[i] - 35);
    t.health[i] = clamp(t.health[i] + 3, 0, 100);
  }
  return { ok: true, cost };
}

// --- reporting / aggregation ----------------------------------------------------------------

export function sectionTurfSummary(state, section) {
  const t = state.turf;
  let health = 0;
  let moisture = 0;
  let nutrients = 0;
  let height = 0;
  let wear = 0;
  let sevSum = 0;
  let sickCells = 0;
  let sickType = DISEASE.NONE;
  for (const i of section.cells) {
    health += t.health[i];
    moisture += t.moisture[i];
    nutrients += t.nutrients[i];
    height += t.heightMm[i];
    wear += t.wear[i];
    if (t.disType[i] !== DISEASE.NONE && t.disSev[i] > 1) {
      sickCells++;
      sevSum += t.disSev[i];
      sickType = t.disType[i];
    }
  }
  const n = section.cells.length || 1;
  const disease =
    sickCells > Math.max(1, n * 0.08)
      ? { type: sickType, name: DISEASE_NAMES[sickType], severity: Math.round(sevSum / sickCells), coverage: sickCells / n }
      : null;
  return {
    health: Math.round(health / n),
    moisture: Math.round(moisture / n),
    nutrients: Math.round(nutrients / n),
    heightMm: Math.round((height / n) * 10) / 10,
    wear: Math.round(wear / n),
    disease,
  };
}

export function sectionStatus(state, section) {
  const s = sectionTurfSummary(state, section);
  if (s.health >= 68 && !s.disease) return 'Healthy';
  if (s.health < 45 || (s.disease && s.disease.severity > 45)) return 'Declining';
  return 'Stressed';
}

export function diagnoseSection(state, section) {
  const s = sectionTurfSummary(state, section);
  if (!s.disease) return null;
  if (s.disease.type === DISEASE.DOLLAR_SPOT) {
    return (
      `Dollar spot (${s.disease.severity}%) — classic on underfed turf sitting in humid air. ` +
      `Nutrients here read ${s.nutrients}; feed this section and treat with fungicide, and it clears in about a week.`
    );
  }
  return (
    `Brown patch (${s.disease.severity}%) — hot, humid nights on saturated turf. ` +
    `Moisture here reads ${s.moisture}; ease off evening watering and nitrogen, treat with fungicide, and let it dry out.`
  );
}

// Stimp-style pace for a green section. Healthy, tight turf rolls true.
export function greenSpeedOf(state, section) {
  const s = sectionTurfSummary(state, section);
  const sev = s.disease ? s.disease.severity : 0;
  return Math.round(clamp(14.8 - s.heightMm * 1.0 - (100 - s.health) * 0.045 - sev * 0.012, 6, 13.5) * 10) / 10;
}

// A section's contribution to play quality, 0..100.
export function sectionCondition(state, section) {
  const key = ZONE_KEY[section.zone];
  if (!key) return null;
  const s = sectionTurfSummary(state, section);
  const ideal = T().ideal[key];
  const overgrow = clamp((s.heightMm / ideal.height - 1.4) * 30, 0, 30);
  const sev = s.disease ? s.disease.severity * 0.3 : 0;
  return Math.round(clamp(s.health - overgrow - sev - s.wear * 0.25, 0, 100));
}

// Course-wide condition: greens dominate how a course "plays".
const CONDITION_WEIGHT = { green: 3, tee: 1.2, fairway: 1.6, rough: 0.5 };

export function conditionRating(state) {
  let num = 0;
  let den = 0;
  for (const section of state.sections) {
    const key = ZONE_KEY[section.zone];
    if (!key) continue;
    const c = sectionCondition(state, section);
    const w = CONDITION_WEIGHT[key] * section.size;
    num += c * w;
    den += w;
  }
  return den ? Math.round(num / den) : 0;
}
