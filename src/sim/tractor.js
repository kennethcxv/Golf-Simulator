// FAIRWAY STATE — the earned tractor: a broken machine by the maintenance shed
// that three honest chores bring back to life. Additive state only; the drive
// mechanics live in the walkable course (courseScene) and are simply GATED on
// state.tractor.repaired. Migration rule: saves from before this arc already
// had a working tractor — they migrate to repaired, never losing capability.

export const TRACTOR_STEPS = ['cleared', 'fuel', 'belt'];

export const STEP_LABEL = {
  cleared: 'clear the junk around it',
  fuel: 'fuel in the tank',
  belt: 'a new drive belt',
};

export function initTractor(state, repaired = false) {
  const steps = {};
  for (const s of TRACTOR_STEPS) steps[s] = repaired;
  state.tractor = { steps, repaired };
}

export function ensureTractor(state, { legacyRepaired = false } = {}) {
  if (!state.tractor) initTractor(state, legacyRepaired);
}

export function tractorStep(state, step) {
  const t = state.tractor;
  if (!t || t.repaired) return { ok: false };
  if (!TRACTOR_STEPS.includes(step)) return { ok: false };
  if (t.steps[step]) return { ok: false };
  t.steps[step] = true;
  return { ok: true };
}

export function tractorRemaining(state) {
  const t = state.tractor;
  if (!t) return [];
  return TRACTOR_STEPS.filter((s) => !t.steps[s]);
}

export function repairTractor(state) {
  const t = state.tractor;
  if (!t || t.repaired) return { ok: false };
  if (tractorRemaining(state).length > 0) return { ok: false };
  t.repaired = true;
  return { ok: true };
}
