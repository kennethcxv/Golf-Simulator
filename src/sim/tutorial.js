// FAIRWAY STATE — the tutorial arc: real objectives against real state, woven
// into the opening hours rather than a separate tutorial level. Each step's
// check reads the live simulation; UI moments (opening a panel, walking the
// shop) set flags. The guide retires itself when the club comes of age.

import { ZONE } from './constants.js';
import {
  campaignView,
  dismissCampaignGuide,
  recordCampaignEvent,
  resetCampaignGuide,
  tickCampaign,
} from './campaign.js';

// 2026-07-14 stabilization pass: a chaptered arc a first-time player can follow
// end to end — arrive, learn the verbs, clean, order, receive, stock, sell,
// save. Every step waits for the REAL action (state checks + UI flags); a step
// done early is banked and skipped past when its turn comes.
export const TUTORIAL_STEPS = [
  // — Chapter 1: Arrival —
  {
    id: 'look',
    chapter: 'Arrival',
    title: 'Take a look around',
    hint: 'Click to capture the mouse and look around — this run-down course is yours now.',
    check: (st) => !!st.tutorial.flags.lookedAround,
  },
  {
    id: 'move',
    chapter: 'Arrival',
    title: 'Walk the grounds',
    hint: 'WASD to walk (Shift runs). Head for the clubhouse porch.',
    check: (st) => !!st.tutorial.flags.walkedABit,
  },
  {
    id: 'front-door',
    chapter: 'Arrival',
    title: 'Open the shop door',
    hint: 'Face the green door and press E. Real hinges — it swings in ahead of you.',
    check: (st) => !!st.tutorial.flags.doorOpened,
  },
  {
    id: 'walk-in',
    chapter: 'Arrival',
    title: 'Step inside',
    hint: 'Through the door — this pro shop is the business end of the property.',
    check: (st) => !!st.tutorial.flags.shopWalked,
  },
  // — Chapter 2: Take stock of the mess —
  {
    id: 'haul-clean',
    chapter: 'The mess',
    title: 'Clear the floor',
    hint: 'Aim at a clutter pile and press E to haul it out. The state of this floor is costing you customers.',
    check: (st) => !!(st.shop && st.shop.reno && st.shop.reno.clutter.some((c) => c.cleared)),
  },
  {
    id: 'wipe-window',
    chapter: 'The mess',
    title: 'Clean a window',
    hint: 'Face a filmed-over pane and press E a few times — daylight is free merchandising.',
    check: (st) => !!st.tutorial.flags.windowWiped,
  },
  // — Chapter 3: The office —
  {
    id: 'laptop-open',
    chapter: 'The office',
    title: 'Open the laptop',
    hint: 'The office desk, back-right. Press E at the laptop — the lid opens and it boots.',
    check: (st) => !!st.tutorial.flags.laptopOpened,
  },
  {
    id: 'order-stock',
    chapter: 'The office',
    title: 'Order stock from the Supplier',
    hint: 'Use the cursor on the screen: Supplier → add cases → confirm. Note the delivery window.',
    check: (st) => st.shop && st.shop.nextOrderId > 1,
  },
  // — Chapter 4: Receiving day —
  {
    id: 'box-carry',
    chapter: 'Receiving',
    title: 'Bring a delivery in',
    hint: 'The truck drops boxes on the pad by the back door during the window. Pick one up (E) and carry it to the stockroom.',
    check: (st) => !!st.tutorial.flags.boxCarried,
  },
  {
    id: 'box-cut',
    chapter: 'Receiving',
    title: 'Cut the case open',
    hint: 'Set it down in the stockroom, then E to cut the tape.',
    check: (st) => !!st.tutorial.flags.boxCut,
  },
  {
    id: 'unbox',
    chapter: 'Receiving',
    title: 'Unpack it',
    hint: 'E again to move armfuls into the backroom until the case is empty.',
    check: (st) => !!(st.shop && st.shop.deliveries && (st.shop.deliveries.openedTotal || 0) > 0),
  },
  {
    id: 'shelve',
    chapter: 'Receiving',
    title: 'Stock a display',
    hint: 'Walk the shop floor to a fixture and shelve from the backroom (E). Shelves sell; backrooms don\'t.',
    check: (st) => !!st.tutorial.flags.shelved,
  },
  // — Chapter 5: The first sale —
  {
    id: 'first-ring',
    chapter: 'First sale',
    title: 'Ring up a customer',
    hint: 'A shopper will bring a pick to the register. Scan (E), total it, then take their cash or run the card.',
    check: (st) => !!(st.shop && st.shop.salesLive && st.shop.salesLive.units > 0),
  },
  // — Chapter 6: Keep it running —
  {
    id: 'save-game',
    chapter: 'Keep it running',
    title: 'Save your progress',
    hint: 'Esc opens the pause menu — save to a slot. The autosave has your back at day close.',
    check: (st) => !!st.tutorial.flags.savedGame,
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

// Independent first-use lessons sit beside the arrival arc. They are triggered
// by the real mode opening, complete from the real action flag, and never hold
// the main tutorial hostage if a player postpones an optional system.
export const CONTEXTUAL_TUTORIALS = [
  {
    id: 'tool-wheel', context: 'walk', title: 'Choose a tool',
    hint: 'Hold F to open the tool belt. Use the mouse or arrow keys, then choose a tool. Q swaps back to the previous one.',
    completeFlag: 'toolSelected',
  },
  {
    id: 'cleaning-tools', context: 'walk', title: 'Clean with steady passes',
    hint: 'Aim at the dirty patch and use the shown mouse button. The live prompt reports what the tool can clean here.',
    completeFlag: 'vacuumed',
  },
  {
    id: 'placement', context: 'placement', title: 'Rearrange the shop',
    hint: 'Aim at a fixture and press E to lift it. R rotates; E places only when the outline says the route is clear.',
    completeFlag: 'fixturePlaced',
  },
  {
    id: 'checkout', context: 'register', title: 'Work the register',
    hint: 'Follow the current register step. Its prompt changes from scanning to payment, receipt, bagging, and handoff.',
    completeFlag: 'checkoutCompleted',
  },
  {
    id: 'front-desk', context: 'walk', title: 'Check in a booking',
    hint: 'At the front desk, the prompt names the arriving player and tee time. Press E once to check them in.',
    completeFlag: 'frontDeskCheckedIn',
  },
  {
    id: 'maintenance-tools', context: 'walk', title: 'Maintain what you inspect',
    hint: 'Your tool readout shows the live turf value. Use the tool on the correct surface until the value improves.',
    completeFlag: 'maintenanceUsed',
  },
];

const CONTEXT_BY_ID = new Map(CONTEXTUAL_TUTORIALS.map((lesson) => [lesson.id, lesson]));
const TUTORIAL_VERSION = 3;

function ensureContextual(tutorial) {
  tutorial.contextual ||= { activeId: null, lessons: {}, disabled: false };
  tutorial.contextual.lessons ||= {};
  for (const lesson of CONTEXTUAL_TUTORIALS) {
    tutorial.contextual.lessons[lesson.id] ||= { triggered: false, complete: false, dismissed: false, remindAfter: 0 };
  }
  return tutorial.contextual;
}

export function initTutorial(state) {
  state.tutorial = { step: 0, complete: false, flags: {}, hidden: false, version: TUTORIAL_VERSION };
  ensureContextual(state.tutorial);
}

// old saves re-derive their position: checks are cumulative state reads, so
// ticking from step 0 fast-forwards past everything already done
export function ensureTutorial(state) {
  if (!state.tutorial) { initTutorial(state); return; }
  if (state.tutorial.version !== TUTORIAL_VERSION) {
    state.tutorial.version = TUTORIAL_VERSION;
    state.tutorial.step = 0;
    if (!state.tutorial.complete) tickTutorial(state);
  }
  state.tutorial.flags ||= {};
  ensureContextual(state.tutorial);
}

export function skipTutorial(state) {
  if (state.campaign?.enabled) {
    dismissCampaignGuide(state);
    if (state.tutorial) state.tutorial.hidden = true;
    return;
  }
  if (!state.tutorial) initTutorial(state);
  state.tutorial.complete = true;
  state.tutorial.hidden = true;
  ensureContextual(state.tutorial).disabled = true;
}

export function replayTutorial(state) {
  if (state.campaign?.enabled) {
    resetCampaignGuide(state);
    if (!state.tutorial) initTutorial(state);
    state.tutorial.hidden = false;
    return;
  }
  initTutorial(state);
  tickTutorial(state); // anything already true banks instantly
}

export function tutorialFlag(state, flag) {
  if (!state.tutorial) return;
  state.tutorial.flags[flag] = true;
  const contextual = ensureContextual(state.tutorial);
  for (const lesson of CONTEXTUAL_TUTORIALS) {
    if (lesson.completeFlag !== flag) continue;
    contextual.lessons[lesson.id].complete = true;
    if (contextual.activeId === lesson.id) contextual.activeId = null;
  }
}

export function triggerContextTutorial(state, id) {
  if (!state?.tutorial) return null;
  const lesson = CONTEXT_BY_ID.get(id);
  if (!lesson) return null;
  const contextual = ensureContextual(state.tutorial);
  if (contextual.disabled) return null;
  const progress = contextual.lessons[id];
  const now = state.clock?.minutes || 0;
  if (progress.complete || progress.dismissed || progress.remindAfter > now) return null;
  progress.triggered = true;
  contextual.activeId = id;
  return lesson;
}

export function completeContextTutorial(state, id) {
  if (!state?.tutorial || !CONTEXT_BY_ID.has(id)) return false;
  const contextual = ensureContextual(state.tutorial);
  contextual.lessons[id].complete = true;
  if (contextual.activeId === id) contextual.activeId = null;
  return true;
}

export function dismissContextTutorial(state, id, { remind = false } = {}) {
  if (!state?.tutorial || !CONTEXT_BY_ID.has(id)) return false;
  const contextual = ensureContextual(state.tutorial);
  const progress = contextual.lessons[id];
  if (remind) progress.remindAfter = (state.clock?.minutes || 0) + 180;
  else progress.dismissed = true;
  if (contextual.activeId === id) contextual.activeId = null;
  return true;
}

export function currentContextTutorial(state, context) {
  if (!state?.tutorial) return null;
  const contextual = ensureContextual(state.tutorial);
  if (contextual.disabled) return null;
  const id = contextual.activeId;
  const lesson = CONTEXT_BY_ID.get(id);
  if (!lesson || lesson.context !== context) return null;
  const progress = contextual.lessons[id];
  if (progress.complete || progress.dismissed || progress.remindAfter > (state.clock?.minutes || 0)) return null;
  return lesson;
}

export function currentStep(state) {
  if (state.campaign?.enabled) {
    const task = campaignView(state)?.currentTask;
    return task ? { ...task, chapter: campaignView(state).mainObjective } : null;
  }
  if (!state.tutorial || state.tutorial.complete) return null;
  return TUTORIAL_STEPS[state.tutorial.step] || null;
}

// Advances through every currently-satisfied step; returns those just cleared.
export function tickTutorial(state) {
  if (state.campaign?.enabled) {
    const result = tickCampaign(state);
    const view = campaignView(state);
    if (state.tutorial && view) {
      state.tutorial.step = view.completedCount;
      state.tutorial.complete = !!state.campaign.firstDayComplete;
      state.tutorial.hidden = !!state.campaign.hidden;
    }
    return result;
  }
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
