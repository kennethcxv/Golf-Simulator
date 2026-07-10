// FAIRWAY STATE — bunker footprints: play traffic roughs up the sand, the hand
// rake smooths it. ADDITIVE: rides the existing turf.wear array on BUNKER
// cells only, which the health/condition math never reads (verified), and the
// daily wear-recovery pass gently smooths (wind + the morning crew). turf.js
// stays untouched.

import { ZONE } from './constants.js';

export const BUNKER_MESS = {
  perRound: 0.35, // wear added per round played, per day
  dailyMax: 6,    // even a packed tee sheet only tramples so much
  cap: 85,        // fully footprinted, never "diseased"
};

export function bunkerDailyMess(state) {
  const t = state.turf;
  if (!t || !state.course) return;
  const rounds = state.club ? state.club.lastRounds || 0 : 0;
  if (rounds <= 0) return;
  const add = Math.min(BUNKER_MESS.dailyMax, rounds * BUNKER_MESS.perRound);
  const zones = state.course.zones;
  for (let i = 0; i < zones.length; i++) {
    if (zones[i] === ZONE.BUNKER) {
      t.wear[i] = Math.min(BUNKER_MESS.cap, t.wear[i] + add);
    }
  }
}
