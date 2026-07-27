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
  state.tractor = {
    steps,
    repaired,
    condition: repaired ? 0.88 : 0.38,
    fuel: repaired ? 1 : 0,
    attachment: repaired ? 'mower' : null,
    location: null,
    engineHours: 0,
  };
}

export function ensureTractor(state, { legacyRepaired = false } = {}) {
  if (!state.tractor) initTractor(state, legacyRepaired);
  const t = state.tractor;
  if (!t.steps) {
    t.steps = {};
    for (const s of TRACTOR_STEPS) t.steps[s] = !!t.repaired;
  }
  if (!Number.isFinite(t.condition)) t.condition = t.repaired ? 0.88 : 0.38;
  t.condition = Math.max(0, Math.min(1, t.condition));
  if (!Number.isFinite(t.fuel)) t.fuel = t.repaired ? 1 : 0;
  t.fuel = Math.max(0, Math.min(1, t.fuel));
  if (!Object.hasOwn(t, 'attachment')) t.attachment = t.repaired ? 'mower' : null;
  if (t.attachment !== 'mower') t.attachment = null;
  if (!t.location || ![t.location.x, t.location.z, t.location.yaw].every(Number.isFinite)) t.location = null;
  if (!Number.isFinite(t.engineHours) || t.engineHours < 0) t.engineHours = 0;
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
  t.condition = Math.max(0.88, t.condition || 0);
  t.fuel = 1;
  t.attachment = 'mower';
  return { ok: true };
}

export function setTractorLocation(state, x, z, yaw) {
  const t = state.tractor;
  if (!t || !t.repaired || ![x, z, yaw].every(Number.isFinite)) return { ok: false };
  if (!t.location) t.location = {};
  t.location.x = Math.round(x * 1000) / 1000;
  t.location.z = Math.round(z * 1000) / 1000;
  t.location.yaw = Math.round(yaw * 10000) / 10000;
  return { ok: true, location: t.location };
}

export function recordTractorUse(state, { x, z, yaw, seconds = 0, mowing = false } = {}) {
  const moved = setTractorLocation(state, x, z, yaw);
  if (!moved.ok) return moved;
  const t = state.tractor;
  const used = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  t.engineHours = Math.round((t.engineHours + used / 3600) * 100000000) / 100000000;
  const wearPerSecond = mowing ? 0.000002 : 0.000001;
  t.condition = Math.max(0.2, Math.round((t.condition - used * wearPerSecond) * 100000000) / 100000000);
  if (used > 0) t.fuel = Math.max(0, Math.round((t.fuel - used * 0.00001) * 100000000) / 100000000);
  return { ok: true, location: t.location, condition: t.condition, fuel: t.fuel };
}
