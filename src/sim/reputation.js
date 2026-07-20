import { clamp } from '../core/utils.js';

export const REPUTATION_CATEGORIES = ['cleanliness', 'retail', 'course', 'service'];
export const REPUTATION_LABELS = {
  cleanliness: 'Cleanliness',
  retail: 'Retail',
  course: 'Golf course',
  service: 'Service',
};

const WEIGHTS = { cleanliness: 0.2, retail: 0.25, course: 0.3, service: 0.25 };
const r1 = (value) => Math.round(value * 10) / 10;
const dayOf = (state) => Math.floor((state.clock?.minutes || 0) / 1440);

export function initReputation(state, initial = state.club?.reputation ?? 30) {
  const score = clamp(r1(initial), 0, 100);
  state.reputation = {
    overall: score,
    categories: Object.fromEntries(REPUTATION_CATEGORIES.map((category) => [category, score])),
    history: [],
    processedIds: {},
  };
  if (state.club) state.club.reputation = score;
  return state.reputation;
}

export function ensureReputation(state) {
  if (!state.reputation) initReputation(state, state.club?.reputation ?? 30);
  const rep = state.reputation;
  rep.categories ||= {};
  for (const category of REPUTATION_CATEGORIES) {
    if (!Number.isFinite(rep.categories[category])) rep.categories[category] = rep.overall ?? state.club?.reputation ?? 30;
    rep.categories[category] = clamp(r1(rep.categories[category]), 0, 100);
  }
  // Older systems and saves exposed club.reputation as the writable score. If a
  // legacy caller changed it directly, carry that delta into every category once
  // instead of silently discarding the player's earned reputation.
  const legacyScore = Number(state.club?.reputation);
  if (Number.isFinite(legacyScore) && Number.isFinite(rep.overall) && Math.abs(legacyScore - rep.overall) >= 0.05) {
    const delta = legacyScore - rep.overall;
    for (const category of REPUTATION_CATEGORIES) {
      rep.categories[category] = clamp(r1(rep.categories[category] + delta), 0, 100);
    }
    rep.overall = clamp(r1(legacyScore), 0, 100);
  }
  rep.history ||= [];
  rep.processedIds ||= {};
  recalculateReputation(state);
  return rep;
}

export function recalculateReputation(state) {
  const rep = state.reputation;
  if (!rep) return state.club?.reputation ?? 30;
  let overall = 0;
  for (const category of REPUTATION_CATEGORIES) overall += rep.categories[category] * WEIGHTS[category];
  rep.overall = clamp(r1(overall), 0, 100);
  if (state.club) state.club.reputation = rep.overall;
  return rep.overall;
}

export function seedReputation(state, score) {
  const rep = ensureReputation(state);
  for (const category of REPUTATION_CATEGORIES) rep.categories[category] = clamp(r1(score), 0, 100);
  return recalculateReputation(state);
}

export function reputationOverall(state) {
  return ensureReputation(state).overall;
}

export function reputationSnapshot(state) {
  const rep = ensureReputation(state);
  return { overall: rep.overall, categories: { ...rep.categories } };
}

export function applyReputationChange(state, spec = {}) {
  const rep = ensureReputation(state);
  const id = String(spec.id || `rep:${dayOf(state)}:${rep.history.length + 1}`);
  if (rep.processedIds[id]) {
    return { ok: true, duplicate: true, change: rep.history.find((item) => item.id === id) || null };
  }

  const requested = spec.categories || (spec.category ? [spec.category] : REPUTATION_CATEGORIES);
  const categories = [...new Set(requested)].filter((category) => REPUTATION_CATEGORIES.includes(category));
  if (!categories.length) return { ok: false, reason: 'No valid reputation category.' };
  const delta = r1(Number(spec.delta) || 0);
  if (delta === 0) return { ok: false, reason: 'Reputation change is zero.' };

  const before = reputationSnapshot(state);
  const categoryDeltas = {};
  for (const category of categories) {
    const old = rep.categories[category];
    const next = clamp(r1(old + delta), 0, 100);
    rep.categories[category] = next;
    categoryDeltas[category] = r1(next - old);
  }
  const afterOverall = recalculateReputation(state);
  const change = {
    id,
    day: Number.isInteger(spec.day) ? spec.day : dayOf(state),
    timestamp: Number.isFinite(spec.timestamp) ? spec.timestamp : Math.round(state.clock?.minutes || 0),
    source: spec.source || 'simulation',
    sourceId: spec.sourceId == null ? null : String(spec.sourceId),
    reason: spec.reason || 'Operational outcome',
    categoryDeltas,
    overallDelta: r1(afterOverall - before.overall),
    before: before.overall,
    after: afterOverall,
  };
  rep.history.unshift(change);
  if (rep.history.length > 120) rep.history.length = 120;
  rep.processedIds[id] = true;
  return { ok: true, duplicate: false, change };
}

export function reputationChangesForDay(state, day) {
  return ensureReputation(state).history.filter((change) => change.day === day);
}
