// FAIRWAY STATE — the tutorial arc: real objectives against real state, woven
// into the opening hours rather than a separate tutorial level. Each step's
// check reads the live simulation; UI moments (opening a panel, walking the
// shop) set flags. The guide retires itself when the club comes of age.

import { ZONE } from './constants.js';

export const TUTORIAL_STEPS = [
  {
    id: 'meet-grounds',
    title: 'Walk the property',
    hint: 'Open the Grounds desk (G) and meet your maintenance situation.',
    check: (st) => !!st.tutorial.flags.groundsOpened,
  },
  {
    id: 'treat-green',
    title: 'Save a green',
    hint: 'Click a sick green (pale blotches), read the diagnosis, apply fungicide.',
    check: (st) => {
      if (st.tutorial.flags.treatedSection) return true;
      // or the disease is simply gone
      for (const s of st.sections) {
        if (s.zone !== ZONE.GREEN) continue;
        for (const i of s.cells) {
          if (st.turf.disType[i] && st.turf.disSev[i] > 1) return false;
        }
      }
      return true;
    },
  },
  {
    id: 'staff-up',
    title: 'Get some hands',
    hint: 'Hire day-labor at the Grounds desk or a groundskeeper at the Club office (C).',
    check: (st) => st.maintenance.crewUnits >= 2 || (st.staff && st.staff.employees.length >= 1),
  },
  {
    id: 'stock-shop',
    title: 'Order shop stock',
    hint: 'The shop shelves are nearly bare. Order supplies from the Shop desk (🛍).',
    check: (st) => st.shop && st.shop.nextOrderId > 1,
  },
  {
    id: 'walk-floor',
    title: 'Walk your shop',
    hint: 'Press P and walk the floor. Restock a shelf with E.',
    check: (st) => !!st.tutorial.flags.shopWalked,
  },
  {
    id: 'set-prices',
    title: 'Set your prices',
    hint: 'Nudge the green fee or dues at the Club office — watch the "fair" hints.',
    check: (st) => !!st.tutorial.flags.priceTouched,
  },
  {
    id: 'first-join',
    title: 'Win a member',
    hint: 'Keep the course improving; someone new will sign up.',
    check: (st) => st.golfers && st.golfers.pool.some((g) => g.memberTier && g.joinedDay > 0),
  },
  {
    id: 'profit-day',
    title: 'Turn a profit',
    hint: 'Close a day in the black (Club office shows yesterday\'s books).',
    check: (st) => !!(st.ledger && st.ledger.yesterday && st.ledger.yesterday.net > 0),
  },
  {
    id: 'build',
    title: 'Invest in the club',
    hint: 'Add an amenity or buy an improvement in Development.',
    check: (st) =>
      (st.club && (st.club.amenities.range > 0 || st.club.amenities.restaurant > 0 || st.club.amenities.instruction > 0)) ||
      (st.progression && Object.keys(st.progression.unlocks).length > 0),
  },
  {
    id: 'prestige-30',
    title: 'Get noticed',
    hint: 'Reach prestige 30. The tournament ladder starts at 50 — the Open waits at the top.',
    check: (st) => st.progression && st.progression.prestige >= 30,
  },
];

export function initTutorial(state) {
  state.tutorial = { step: 0, complete: false, flags: {}, hidden: false };
}

export function tutorialFlag(state, flag) {
  if (state.tutorial) state.tutorial.flags[flag] = true;
}

export function currentStep(state) {
  if (!state.tutorial || state.tutorial.complete) return null;
  return TUTORIAL_STEPS[state.tutorial.step] || null;
}

// Advances through every currently-satisfied step; returns those just cleared.
export function tickTutorial(state) {
  const advanced = [];
  if (!state.tutorial || state.tutorial.complete) return { advanced };
  let guard = 0;
  while (state.tutorial.step < TUTORIAL_STEPS.length && guard++ < 20) {
    const step = TUTORIAL_STEPS[state.tutorial.step];
    let ok = false;
    try {
      ok = !!step.check(state);
    } catch {
      ok = false;
    }
    if (!ok) break;
    advanced.push(step);
    state.tutorial.step++;
  }
  if (state.tutorial.step >= TUTORIAL_STEPS.length) state.tutorial.complete = true;
  return { advanced };
}
