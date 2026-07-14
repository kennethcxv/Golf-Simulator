// FAIRWAY STATE — the tutorial arc: real objectives against real state, woven
// into the opening hours rather than a separate tutorial level. Each step's
// check reads the live simulation; UI moments (opening a panel, walking the
// shop) set flags. The guide retires itself when the club comes of age.

import { ZONE } from './constants.js';

// 2026-07-13: the opening six steps follow the physical clubhouse loop of the
// seamless-shop overhaul (walk in → clean → order at the laptop → unbox →
// shelve → ring a sale); the back four remain the club-maturity arc.
export const TUTORIAL_STEPS = [
  {
    id: 'walk-in',
    title: 'Step inside your clubhouse',
    hint: 'Walk up the porch and open the shop door (E). This building is the business.',
    check: (st) => !!st.tutorial.flags.shopWalked,
  },
  {
    id: 'haul-clean',
    title: 'Clear the floor',
    hint: 'Haul a clutter pile out (E) — and once you own a vacuum, run it on the grime (F, hold LMB).',
    check: (st) => !!(st.shop && st.shop.reno && (st.shop.reno.clutter.some((c) => c.cleared) || st.tutorial.flags.vacuumed)),
  },
  {
    id: 'order-stock',
    title: 'Order stock at the laptop',
    hint: 'The office laptop (E) runs Fairway Office — browse the Supplier and place an order.',
    check: (st) => st.shop && st.shop.nextOrderId > 1,
  },
  {
    id: 'unbox',
    title: 'Receive the delivery',
    hint: 'The truck leaves boxes on the pad by the back door. Carry one into the stockroom and open it (E).',
    check: (st) => !!(st.shop && st.shop.deliveries && (st.shop.deliveries.openedTotal || 0) > 0),
  },
  {
    id: 'shelve',
    title: 'Stock a display',
    hint: 'Walk the floor to a fixture and shelve from the backroom (E). Shelves sell; backrooms don\'t.',
    check: (st) => !!st.tutorial.flags.shelved,
  },
  {
    id: 'first-ring',
    title: 'Ring up a customer',
    hint: 'When a shopper waits at the register, scan their pick and take payment (E, E).',
    check: (st) => !!(st.shop && st.shop.salesLive && st.shop.salesLive.units > 0),
  },
  {
    id: 'treat-green',
    title: 'Save a green',
    hint: 'Walk a sick green (pale blotches), inspect it (E), apply fungicide.',
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
    hint: 'Hire day-labor at the Grounds desk (G) or a groundskeeper at the Club office (C).',
    check: (st) => st.maintenance.crewUnits >= 2 || (st.staff && st.staff.employees.length >= 1),
  },
  {
    id: 'profit-day',
    title: 'Turn a profit',
    hint: 'Close a day in the black (the laptop\'s Finances page shows the books).',
    check: (st) => !!(st.ledger && st.ledger.yesterday && st.ledger.yesterday.net > 0),
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
