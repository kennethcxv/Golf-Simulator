// Runtime integration for the pure seeded definition in shopGenerator.js.
// Called once when a marketplace property becomes a playable holding.

import { generateShopDefinition, shopGenerationFingerprint } from './shopGenerator.js';
import { placeDecor } from './shop.js';
import { ensureLayout, routesIntact, validatePlacement } from './layout.js';

const STARTING_RENO_BY_LEVEL = Object.freeze({
  1: Object.freeze({ grimeScale: 1.00, windowScale: 1.00, unclearedClutter: Infinity }),
  2: Object.freeze({ grimeScale: 0.58, windowScale: 0.52, unclearedClutter: 2 }),
  3: Object.freeze({ grimeScale: 0.25, windowScale: 0.22, unclearedClutter: 0 }),
  4: Object.freeze({ grimeScale: 0.09, windowScale: 0.09, unclearedClutter: 0 }),
  5: Object.freeze({ grimeScale: 0.025, windowScale: 0.025, unclearedClutter: 0 }),
});

function applyCourseStartingCondition(state, courseLevel) {
  const reno = state.shop.reno;
  if (!reno) return;
  const target = STARTING_RENO_BY_LEVEL[courseLevel] || STARTING_RENO_BY_LEVEL[1];
  reno.grime = reno.grime.map((value) => Math.round(value * target.grimeScale * 1000) / 1000);
  reno.windows = reno.windows.map((value) => Math.round(value * target.windowScale * 1000) / 1000);
  reno.clutter.forEach((pile, index) => {
    pile.cleared = index >= target.unclearedClutter;
  });

  // Loose sweepable debris is part of the failing-municipal fantasy, not a
  // universal inheritance. Mark the field intentionally seeded so the renderer
  // does not add thirty pebbles and wrappers to otherwise clean properties.
  if (courseLevel >= 2) {
    reno.debris = [];
    reno.debrisSeeded = true;
  }
}

export function initializeGeneratedShop(state, property = {}) {
  if (!state?.shop) return null;
  if (state.shop.generation?.schemaVersion) return state.shop.generation;

  const generation = generateShopDefinition({
    seed: property.seed ?? state.seed,
    propertyId: property.id ?? state.property?.id ?? `property:${state.seed}`,
    courseLevel: property.shopLevel ?? 1,
  });
  state.shop.generation = generation;
  state.shop.progression.tier = generation.startingTier;
  state.shop.progression.pending = null;
  state.shop.progression.legacyFullLayout = false;
  state.shop.unlockedTier = Math.max(
    state.shop.unlockedTier || 1,
    generation.courseLevel >= 3 ? 3 : generation.courseLevel,
  );
  applyCourseStartingCondition(state, generation.courseLevel);
  const layout = ensureLayout(state);
  for (const fixtureId of generation.startingStoredFixtures || []) {
    if (!layout.stored.includes(fixtureId)) layout.stored.push(fixtureId);
  }

  // Validate the complete authored plan as one arrangement. Validating poses
  // one at a time left not-yet-moved fixtures at the universal fallback and
  // made safe swaps look like collisions. Re-run after each rejection because
  // that fixture falls back to its authored base position.
  const candidates = { ...generation.fixturePoses };
  generation.fixturePoses = { ...candidates };
  let changed = true;
  while (changed) {
    changed = false;
    for (const [fixtureId, pose] of Object.entries(generation.fixturePoses)) {
      const checked = validatePlacement(state, fixtureId, pose.x, pose.z, pose.ry);
      if (!checked.ok) {
        delete generation.fixturePoses[fixtureId];
        generation.audit.rejectedFixturePoses.push({ fixtureId, reasons: checked.reasons });
        changed = true;
      }
    }
  }
  generation.audit.acceptedFixturePoses = Object.keys(generation.fixturePoses);
  generation.audit.routesIntact = routesIntact(state);

  // The conveyed shop starts with the generated facings, not the universal
  // fixer-upper four-line spread. Retail stock remains conserved thereafter.
  for (const [skuId, inventory] of Object.entries(state.shop.inventory)) {
    if (!inventory || state.shop.reno?.decor?.some((entry) => entry.skuId === skuId)) continue;
    inventory.shelf = generation.merchandising.shelfInventory[skuId] || 0;
    inventory.back = 0;
  }

  // Authored decor poses enter the same property inventory used by build mode,
  // so every generated piece can be packed, moved, sold, and bought again.
  generation.audit.decorPlacements = [];
  for (const entry of generation.decor) {
    const inventory = state.shop.inventory[entry.skuId];
    if (!inventory) continue;
    inventory.back += 1;
    const placed = placeDecor(state, entry.skuId, entry.spot);
    if (placed.ok) generation.audit.decorPlacements.push(placed.placement.id);
    else {
      inventory.back = Math.max(0, inventory.back - 1);
      generation.audit.decorPlacements.push({ objectId: entry.objectId, error: placed.reason || 'placement failed' });
    }
  }
  generation.fingerprint = shopGenerationFingerprint(generation);
  return generation;
}
