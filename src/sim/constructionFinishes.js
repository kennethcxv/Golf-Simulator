import { spend } from './economy.js';
import {
  CONSTRUCTION_CATEGORY_BY_ID,
  CONSTRUCTION_FINISH_CATEGORIES,
  CONSTRUCTION_QUALITY_BY_ID,
  constructionFinishFamily,
  constructionFinishSelectionId,
  constructionFinishVariant,
} from '../data/constructionFinishes.js';

export const CONSTRUCTION_FINISH_STATE_VERSION = 1;
export const CONSTRUCTION_PURCHASE_HISTORY_CAP = 80;

export const DEFAULT_CONSTRUCTION_INSTALLATIONS = Object.freeze({
  flooring: Object.freeze({ finishId: 'concrete', qualityId: 'municipal' }),
  ceilings: Object.freeze({ finishId: 'drop-ceiling', qualityId: 'municipal' }),
  walls: Object.freeze({ finishId: 'drywall', qualityId: 'municipal' }),
  windows: Object.freeze({ finishId: 'cheap-aluminum', qualityId: 'municipal' }),
  doors: Object.freeze({ finishId: 'hollow-core', qualityId: 'municipal' }),
  'garage-doors': Object.freeze({ finishId: 'garage-door', qualityId: 'municipal' }),
  lighting: Object.freeze({ finishId: 'led-panels', qualityId: 'municipal' }),
});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function validSelection(categoryId, selection) {
  return isRecord(selection)
    && Boolean(constructionFinishFamily(categoryId, selection.finishId))
    && Boolean(CONSTRUCTION_QUALITY_BY_ID[selection.qualityId]);
}

function defaultState() {
  const installed = {};
  const owned = [];
  for (const categorySpec of CONSTRUCTION_FINISH_CATEGORIES) {
    const selection = DEFAULT_CONSTRUCTION_INSTALLATIONS[categorySpec.id];
    installed[categorySpec.id] = { ...selection };
    owned.push(constructionFinishSelectionId(categorySpec.id, selection.finishId, selection.qualityId));
  }
  return {
    version: CONSTRUCTION_FINISH_STATE_VERSION,
    installed,
    owned,
    purchaseHistory: [],
  };
}

function canonical(value) {
  if (!isRecord(value) || value.version !== CONSTRUCTION_FINISH_STATE_VERSION) return false;
  if (!isRecord(value.installed) || !Array.isArray(value.owned) || !Array.isArray(value.purchaseHistory)) return false;
  return CONSTRUCTION_FINISH_CATEGORIES.every((categorySpec) => (
    validSelection(categorySpec.id, value.installed[categorySpec.id])
  ));
}

function normalize(source) {
  const result = defaultState();
  if (!isRecord(source)) return result;
  for (const categorySpec of CONSTRUCTION_FINISH_CATEGORIES) {
    const candidate = source.installed?.[categorySpec.id];
    if (validSelection(categorySpec.id, candidate)) {
      result.installed[categorySpec.id] = {
        finishId: candidate.finishId,
        qualityId: candidate.qualityId,
      };
    }
  }
  const validOwned = new Set(result.owned);
  for (const id of Array.isArray(source.owned) ? source.owned : []) {
    if (typeof id !== 'string') continue;
    const [categoryId, finishId, qualityId, ...extra] = id.split(':');
    if (extra.length === 0 && constructionFinishVariant(categoryId, finishId, qualityId)) validOwned.add(id);
  }
  for (const [categoryId, selection] of Object.entries(result.installed)) {
    validOwned.add(constructionFinishSelectionId(categoryId, selection.finishId, selection.qualityId));
  }
  result.owned = [...validOwned];
  result.purchaseHistory = (Array.isArray(source.purchaseHistory) ? source.purchaseHistory : [])
    .filter((entry) => isRecord(entry) && typeof entry.selectionId === 'string')
    .slice(-CONSTRUCTION_PURCHASE_HISTORY_CAP)
    .map((entry) => ({ ...entry }));
  return result;
}

export function ensureConstructionFinishes(state) {
  if (!isRecord(state?.shop?.reno)) return null;
  const current = state.shop.reno.constructionFinishes;
  if (canonical(current)) return current;
  const next = normalize(current);
  state.shop.reno.constructionFinishes = next;
  return next;
}

export function installedConstructionFinish(state, categoryId) {
  const construction = ensureConstructionFinishes(state);
  const selection = construction?.installed?.[categoryId];
  if (!selection) return null;
  return constructionFinishVariant(categoryId, selection.finishId, selection.qualityId);
}

export function ownsConstructionFinish(state, categoryId, finishId, qualityId) {
  const construction = ensureConstructionFinishes(state);
  if (!construction) return false;
  return construction.owned.includes(constructionFinishSelectionId(categoryId, finishId, qualityId));
}

function invalid(reason) {
  return { ok: false, changed: false, reason };
}

function recordHistory(state, construction, type, variant, cost) {
  construction.purchaseHistory.push({
    type,
    selectionId: variant.id,
    categoryId: variant.categoryId,
    finishId: variant.finishId,
    qualityId: variant.qualityId,
    cost,
    minute: Number.isFinite(state.clock?.minutes) ? Math.floor(state.clock.minutes) : 0,
  });
  if (construction.purchaseHistory.length > CONSTRUCTION_PURCHASE_HISTORY_CAP) {
    construction.purchaseHistory.splice(0, construction.purchaseHistory.length - CONSTRUCTION_PURCHASE_HISTORY_CAP);
  }
}

export function installConstructionFinish(state, categoryId, finishId, qualityId) {
  if (!CONSTRUCTION_CATEGORY_BY_ID[categoryId]) return invalid('Unknown construction category.');
  const variant = constructionFinishVariant(categoryId, finishId, qualityId);
  if (!variant) return invalid('Unknown construction finish or quality level.');
  const construction = ensureConstructionFinishes(state);
  if (!construction) return invalid('Construction finish state is unavailable.');
  if (!construction.owned.includes(variant.id)) return invalid('Purchase this finish before installing it.');
  const current = construction.installed[categoryId];
  if (current.finishId === finishId && current.qualityId === qualityId) {
    return { ok: true, changed: false, cost: 0, variant };
  }
  construction.installed[categoryId] = { finishId, qualityId };
  recordHistory(state, construction, 'install', variant, 0);
  return { ok: true, changed: true, cost: 0, variant };
}

export function purchaseConstructionFinish(state, categoryId, finishId, qualityId) {
  const variant = constructionFinishVariant(categoryId, finishId, qualityId);
  if (!variant) return invalid('Unknown construction finish or quality level.');
  const construction = ensureConstructionFinishes(state);
  if (!construction) return invalid('Construction finish state is unavailable.');
  if (construction.owned.includes(variant.id)) {
    return installConstructionFinish(state, categoryId, finishId, qualityId);
  }
  if (!Number.isFinite(state.cash) || state.cash < variant.cost) {
    return invalid('Not enough cash for this construction package.');
  }
  spend(state, 'works', variant.cost);
  construction.owned.push(variant.id);
  construction.installed[categoryId] = { finishId, qualityId };
  recordHistory(state, construction, 'purchase', variant, variant.cost);
  return { ok: true, changed: true, cost: variant.cost, variant };
}
