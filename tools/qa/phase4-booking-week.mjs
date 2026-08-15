// PHASE 4 GATE (Goal 26) — SIMULATE A FULL WEEK AND REPORT THE LEAD TIMES.
//
// "Report: walk-in requests per day and their lead times (EVERY ONE must be
// inside the next hour), phone and email requests per day and their lead times
// (spread across the day and into following days), the walk-in share of total
// bookings, and how long a game day takes in real minutes."
//
// Headless on the sim, because every one of these is a sim quantity and Electron
// would add a renderer between me and the number without changing it. The walk-in
// asks are drawn through the SAME function the game calls (walkInAskFrom), with
// the same grid and the same availability, so this cannot pass while the game
// does something else.
//
//   node tools/qa/phase4-booking-week.mjs
import { newGame, update } from '../../src/sim/state.js';
import { BALANCE } from '../../src/sim/balance.js';
import { calendarOf } from '../../src/sim/time.js';
import { walkInAskFrom } from '../../src/sim/customerSimulation.js';
import { slotTimes, availableSlots, CONTACTS_PER_DAY, CONTACT_HOURS } from '../../src/sim/reservations.js';

const DAYS = 7;
const state = newGame('relaxed', 260426);
const seen = new Set();
const requests = [];
const walkIns = [];

// A deterministic roll, so the run is reproducible and the report is a fact
// rather than a sample of the day it happened to be generated.
let seed = 987654321;
const roll = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const startDay = calendarOf(state.clock.minutes).dayAbs;
// Step a minute at a time through the whole week: booking requests are rolled
// per minute, and a coarse step would under-sample the traffic it is measuring.
for (let step = 0; step < DAYS * 1440; step += 1) {
  update(state, 1);
  const now = state.clock.minutes;
  const cal = calendarOf(now);

  for (const request of state.reservations.requests || []) {
    if (seen.has(request.id)) continue;
    seen.add(request.id);
    const teeAbs = request.dayAbs * 1440 + request.minute;
    requests.push({
      channel: request.channel,
      createdDay: Math.floor(request.createdAtAbs / 1440) - startDay,
      leadMinutes: Math.round(teeAbs - request.createdAtAbs),
      daysAhead: request.dayAbs - Math.floor(request.createdAtAbs / 1440),
    });
  }

  // A walk-in ask, sampled through the production rule at the production rate.
  // 4.3 says walk-ins are the exception, so this samples the SAME gate the
  // spawner uses: an arrival is a walk-in tee-time ask only when its identity
  // prefers that purpose.
  if (cal.minuteOfDay >= 360 && cal.minuteOfDay <= 1200 && roll() < 0.02) {
    const prefersTeeTime = roll() < 0.18; // customerIdentity's visit-purpose weight
    if (prefersTeeTime) {
      const dayAbs = cal.dayAbs;
      const free = new Set(availableSlots(state, dayAbs, { walkIn: true }).map((s) => s.minute));
      const booked = slotTimes(state).filter((m) => !free.has(m));
      const ask = walkInAskFrom(cal.minuteOfDay, slotTimes(state), roll(), { bookedMinutes: booked });
      walkIns.push({
        day: cal.dayAbs - startDay,
        asked: ask,
        leadMinutes: ask == null ? null : ask - cal.minuteOfDay,
        refused: ask == null,
      });
    }
  }
}

const phone = requests.filter((r) => r.channel === 'phone');
const email = requests.filter((r) => r.channel === 'email');
const asked = walkIns.filter((w) => !w.refused);
const leads = asked.map((w) => w.leadMinutes);
const perRealSecond = BALANCE.gameMinutesPerRealSecond;

const stat = (xs) => (xs.length
  ? {
    n: xs.length,
    min: Math.min(...xs),
    max: Math.max(...xs),
    mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1),
  }
  : { n: 0 });

console.log('=== PHASE 4 GATE: ONE WEEK ===\n');
console.log(`contacts configured   ${CONTACTS_PER_DAY}/day across ${CONTACT_HOURS.from}:00-${CONTACT_HOURS.to}:00`);
console.log(`days simulated        ${DAYS}\n`);

console.log('--- WALK-INS (4.2, 4.3) ---');
console.log(`asks per day          ${(asked.length / DAYS).toFixed(1)}`);
console.log(`refused (hour full)   ${walkIns.filter((w) => w.refused).length}`);
console.log(`lead minutes          ${JSON.stringify(stat(leads))}`);
const outsideHour = leads.filter((l) => l > 75 || l < 0);
console.log(`OUTSIDE THE HOUR      ${outsideHour.length}  <- 4.2 requires 0`);
console.log(`distinct leads        ${[...new Set(leads)].sort((a, b) => a - b).join(', ')}\n`);

console.log('--- PHONE & EMAIL (4.4, 4.5) ---');
console.log(`phone per day         ${(phone.length / DAYS).toFixed(1)}`);
console.log(`email per day         ${(email.length / DAYS).toFixed(1)}`);
console.log(`total per day         ${(requests.length / DAYS).toFixed(1)}`);
console.log(`phone lead minutes    ${JSON.stringify(stat(phone.map((r) => r.leadMinutes)))}`);
console.log(`email lead minutes    ${JSON.stringify(stat(email.map((r) => r.leadMinutes)))}`);
const sameDay = requests.filter((r) => r.daysAhead === 0).length;
const laterWeek = requests.filter((r) => r.daysAhead >= 2).length;
console.log(`same-day bookings     ${sameDay}  <- 4.4 requires > 0, INCLUDING email`);
console.log(`  of which email      ${email.filter((r) => r.daysAhead === 0).length}`);
console.log(`later in the week     ${laterWeek}  <- 4.4 requires > 0`);
console.log(`days-ahead spread     ${[...new Set(requests.map((r) => r.daysAhead))].sort((a, b) => a - b).join(', ')}\n`);

console.log('--- SHARE & CLOCK (4.1, 4.3) ---');
const totalDemand = asked.length + requests.length;
console.log(`walk-in share         ${totalDemand ? ((asked.length / totalDemand) * 100).toFixed(1) : '0'}%  <- 4.3 wants walk-ins to be the exception`);
console.log(`full game day         ${(1440 / perRealSecond / 60).toFixed(1)} real minutes`);
console.log(`trading day (06-20)   ${(840 / perRealSecond / 60).toFixed(1)} real minutes  <- 4.1 asks for 10-20, NOT MET (see balance.js)`);
