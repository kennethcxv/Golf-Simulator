#!/usr/bin/env node
// Export the immutable JS catalog into the data-only manifest consumed by
// Blender. Keeping this bridge repeatable prevents 310 filenames, envelopes,
// tiers and placement contracts from drifting between simulation and art.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FURNITURE_CATALOG, FURNITURE_FAMILIES, FURNITURE_TIERS,
} from '../../src/data/furnitureCatalog.js';
import { METERS_TO_YARDS, placeableById } from '../../src/data/placeableCatalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const output = path.join(here, 'furniture_catalog_manifest.json');

const rowsById = new Map(FURNITURE_CATALOG.map((item) => [item.id, item]));
const families = FURNITURE_FAMILIES.map((family, familyIndex) => {
  const items = family.itemIds.map((id) => rowsById.get(id));
  if (items.some((item) => !item)) throw new Error(`incomplete catalog family ${family.id}`);
  const first = items[0];
  const sample = placeableById(`furniture::${first.id}::1`);
  if (!sample) throw new Error(`missing runtime placement profile for ${first.id}`);
  return {
    familyIndex,
    familyId: first.familyId,
    modelFamily: first.modelFamily,
    category: first.category,
    placementMode: first.placementMode,
    dimensionsM: {
      width: Number((sample.bounds.width / METERS_TO_YARDS).toFixed(4)),
      height: Number((sample.bounds.height / METERS_TO_YARDS).toFixed(4)),
      depth: Number((sample.bounds.depth / METERS_TO_YARDS).toFixed(4)),
    },
    tiers: items.map((item) => ({
      id: item.progressionTier,
      skuId: item.id,
      name: item.name,
      quality: item.quality,
      glb: `vendor/models/furniture/catalog/${item.modelFamily}_${item.progressionTier}.glb`,
      thumbnail: `vendor/images/furniture/catalog/${item.modelFamily}_${item.progressionTier}.png`,
    })),
  };
});

const manifest = {
  schema: 1,
  generatedFrom: 'src/data/furnitureCatalog.js + src/data/placeableCatalog.js',
  source: 'Original deterministic Blender Python geometry; project-owned / UNLICENSED',
  units: 'meters',
  axes: 'Blender X width, Y depth, Z height; front -Y; glTF Y-up',
  references: [
    'Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_51_59 PM.png',
    'Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_52_25 PM.png',
    'Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_52_34 PM.png',
  ],
  palette: {
    warmCream: '#E6D7B8', deepGolfGreen: '#173D2A', mutedSage: '#8FA287',
    mediumWalnut: '#68412B', naturalOak: '#B88750', warmCharcoal: '#3E403B',
    restrainedBrass: '#A88743',
  },
  tierOrder: FURNITURE_TIERS.map((tier) => tier.id),
  familyCount: families.length,
  objectCount: families.reduce((sum, family) => sum + family.tiers.length, 0),
  families,
};

if (manifest.familyCount !== 62 || manifest.objectCount !== 310) {
  throw new Error(`unexpected furniture coverage ${manifest.familyCount} families / ${manifest.objectCount} objects`);
}
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(path.relative(repo, output).replaceAll('\\', '/'));
console.log(`${manifest.familyCount} families / ${manifest.objectCount} objects`);
