// C1 (Goal 20) — HOW MANY BOOKING CONTACTS ARRIVE IN A DAY?
//
// The brief asks for the measured arrivals per day BEFORE and AFTER, so this is
// the meter, kept so the number can be re-taken at any time. It ticks the real
// golfOperationsTick a minute at a time across whole days and counts what the
// phone and the inbox actually received — not what the rate constant implies.
//
//   node tools/qa/booking-traffic-measure.mjs
import { newGame } from '../../src/sim/state.js';
import { golfOperationsTick } from '../../src/sim/reservations.js';

const DAYS = 10;

function measure(seed) {
  const state = newGame('relaxed', seed);
  if (state.campaign) state.campaign.businessOpen = true;
  // requests is created lazily by the first tick, so read it through a getter
  const reqs = () => state.reservations?.requests || [];
  const start = Math.floor(state.clock.minutes);
  const seen = new Set(reqs().map((r) => r.id));
  const perDay = [];
  let phone = 0;
  let email = 0;
  for (let day = 0; day < DAYS; day += 1) {
    let dayCount = 0;
    for (let m = 0; m < 1440; m += 1) {
      const minute = start + day * 1440 + m;
      state.clock.minutes = minute;
      golfOperationsTick(state, minute);
      for (const r of reqs()) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        dayCount += 1;
        if (r.channel === 'phone') phone += 1; else email += 1;
      }
    }
    perDay.push(dayCount);
  }
  return { perDay, phone, email, total: phone + email };
}

const seeds = [11, 22, 33];
const runs = seeds.map(measure);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`BOOKING CONTACTS PER DAY over ${DAYS} days x ${seeds.length} seeds`);
for (let i = 0; i < seeds.length; i += 1) {
  const r = runs[i];
  console.log(`  seed ${seeds[i]}: ${r.perDay.join(', ')}  ->  mean ${(r.total / DAYS).toFixed(2)}/day `
    + `(phone ${(r.phone / DAYS).toFixed(2)}, email ${(r.email / DAYS).toFixed(2)})`);
}
console.log(`  ALL SEEDS mean ${mean(runs.map((r) => r.total / DAYS)).toFixed(2)} per day `
  + `(phone ${mean(runs.map((r) => r.phone / DAYS)).toFixed(2)}, `
  + `email ${mean(runs.map((r) => r.email / DAYS)).toFixed(2)})`);
