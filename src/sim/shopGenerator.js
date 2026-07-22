// SEEDED PRO-SHOP GENERATOR
//
// The generator composes from authored zones and course-specific families. It
// never scatters arbitrary props over a rectangle: each family owns a retail
// circulation idea, a room program, a material story, and bounded fixture
// adjustments which the normal placement validator accepts or rejects later.

import { makeRng } from '../core/utils.js';
import { FIXTURES } from '../data/shopLayout.js';
import { DECOR_SPOTS, SHOP_CATALOG } from '../data/shopItems.js';
import { capacityOf, homeFixture } from '../data/fixtureSlots.js';
import { fixtureUnlockedForTier } from './shopProgression.js';

export const SHOP_GENERATION_SCHEMA_VERSION = 1;
export const COURSE_SHOP_LEVELS = Object.freeze([1, 2, 3, 4, 5]);

// All three supplied references remain traceable in code and in the production
// brief. The game uses their design language, not their pixels or exact layouts.
export const SHOP_REFERENCE_SOURCES = Object.freeze([
  Object.freeze({
    file: 'Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_51_59 PM.png',
    use: 'Five-step racks, counters, floors, ceiling treatments, doors, seating, and lighting quality ladder.',
  }),
  Object.freeze({
    file: 'Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_52_25 PM.png',
    use: 'Five clubhouse scales and identities: failing municipal, suburban public, woodland lodge, resort, and private luxury club.',
  }),
  Object.freeze({
    file: 'Designs/ClubHouse/ChatGPT Image Jul 20, 2026, 02_52_34 PM.png',
    use: 'Course-1 room program, worn green/cream palette, open sales hall, small office, storage, restroom, employee, and mechanical spaces.',
  }),
]);

const profile = (spec) => Object.freeze({
  ...spec,
  palettes: Object.freeze(spec.palettes.map((entry) => Object.freeze(entry))),
  checkoutVariants: Object.freeze(spec.checkoutVariants),
  officeVariants: Object.freeze(spec.officeVariants),
  storageVariants: Object.freeze(spec.storageVariants),
  lightingFamilies: Object.freeze(spec.lightingFamilies),
  decorSkus: Object.freeze(spec.decorSkus),
});

export const COURSE_SHOP_PROFILES = Object.freeze({
  1: profile({
    level: 1,
    id: 'failing-municipal',
    label: 'Failing municipal starter shop',
    layoutFamily: 'municipal-open-bay',
    startingTier: 'basic',
    fixtureQuality: 'old-utility',
    furnitureStory: 'Old laminate desk, painted steel rolling racks, and wire stock shelving.',
    palettes: [
      { id: 'faded-sage', wall: 0x87927f, accent: 0x344735, trim: 0xd8d4c6, wood: 0x8a735b, floor: 0xa9a294 },
      { id: 'municipal-cream', wall: 0xb8b1a0, accent: 0x3d4938, trim: 0xe1ddd1, wood: 0x806d58, floor: 0xa29b8e },
      { id: 'washed-green', wall: 0x7f8e80, accent: 0x293d31, trim: 0xcfccbf, wood: 0x776552, floor: 0x999487 },
    ],
    lightingFamilies: ['buzzing-fluorescent', 'sparse-utility-pendants', 'mixed-old-panels'],
    lightCount: [4, 6], lightIntensity: [0.56, 0.68], lightTemperature: [3600, 4300],
    checkoutVariants: ['salvaged-straight-counter', 'secondhand-l-counter', 'municipal-service-desk'],
    officeVariants: ['tiny-east-office', 'rear-window-office', 'partitioned-manager-nook'],
    storageVariants: ['single-wire-store', 'narrow-receiving-room', 'shared-mechanical-store'],
    decorSkus: ['poster1', 'board1'], decorCount: [0, 1],
    productLines: [3, 4], shelfFill: [0.12, 0.22],
  }),
  2: profile({
    level: 2,
    id: 'small-public-retail',
    label: 'Small public-course retail shop',
    layoutFamily: 'suburban-retail-loop',
    startingTier: 'standard',
    fixtureQuality: 'standard-commercial',
    furnitureStory: 'Powder-coated racks, wood shelves, and a durable laminate service counter.',
    palettes: [
      { id: 'oak-and-sage', wall: 0xb7bea8, accent: 0x385541, trim: 0xe8e2d3, wood: 0xb18b5b, floor: 0xc39b61 },
      { id: 'public-club-cream', wall: 0xd1c8b6, accent: 0x31513d, trim: 0xf0eadc, wood: 0xa47b50, floor: 0xb98d57 },
      { id: 'soft-stone', wall: 0xb8b6ac, accent: 0x49624e, trim: 0xe7e2d7, wood: 0xa8855c, floor: 0xb79669 },
    ],
    lightingFamilies: ['commercial-panels', 'black-dome-pendants', 'panel-and-track-mix'],
    lightCount: [7, 10], lightIntensity: [0.74, 0.86], lightTemperature: [3200, 3900],
    checkoutVariants: ['compact-front-counter', 'side-wall-checkout', 'angled-service-counter'],
    officeVariants: ['east-front-office', 'glass-partition-office', 'shared-booking-office'],
    storageVariants: ['rear-receiving-room', 'east-stock-run', 'split-stock-and-cleaning'],
    decorSkus: ['rug1', 'plant1', 'poster1', 'board1'], decorCount: [1, 2],
    productLines: [7, 9], shelfFill: [0.24, 0.38],
  }),
  3: profile({
    level: 3,
    id: 'warm-woodland-lodge',
    label: 'Warm lodge pro shop',
    layoutFamily: 'lodge-hearth-rooms',
    startingTier: 'premium',
    fixtureQuality: 'premium-lodge',
    furnitureStory: 'Medium walnut retail walls, thick timber accents, leather seating, and a stone-hearth composition.',
    palettes: [
      { id: 'walnut-and-moss', wall: 0x9ba08b, accent: 0x294535, trim: 0xe0d5bd, wood: 0x745037, floor: 0x8e6948 },
      { id: 'lodge-cream', wall: 0xc6bda9, accent: 0x304b38, trim: 0xeadfc7, wood: 0x68472f, floor: 0x876243 },
      { id: 'forest-sage', wall: 0x8d9c89, accent: 0x203f31, trim: 0xd8ceb8, wood: 0x6f4b31, floor: 0x926947 },
    ],
    lightingFamilies: ['warm-brass-pendants', 'lodge-drum-and-sconces', 'timber-track-lights'],
    lightCount: [10, 13], lightIntensity: [0.88, 1.02], lightTemperature: [2700, 3200],
    checkoutVariants: ['timber-island-counter', 'hearth-side-checkout', 'wrapped-lodge-desk'],
    officeVariants: ['fireside-manager-office', 'timber-screen-office', 'rear-corner-office'],
    storageVariants: ['lodge-back-store', 'split-stock-and-fitting', 'receiving-with-service-corridor'],
    decorSkus: ['rug1', 'plant1', 'poster1', 'board1', 'light1', 'lounge1'], decorCount: [3, 4],
    productLines: [12, 15], shelfFill: [0.40, 0.56],
  }),
  4: profile({
    level: 4,
    id: 'premium-destination-resort',
    label: 'Premium resort merchandising shop',
    layoutFamily: 'resort-gallery-axis',
    startingTier: 'luxury',
    fixtureQuality: 'high-end-resort',
    furnitureStory: 'Solid-wood display walls, dark stone flooring, track lighting, and a hotel-grade service desk.',
    palettes: [
      { id: 'coastal-resort', wall: 0xd5cdbd, accent: 0x526b59, trim: 0xf1eadb, wood: 0x75543b, floor: 0x6d6a62 },
      { id: 'desert-resort', wall: 0xd6c2a6, accent: 0x6f7054, trim: 0xf2e6d2, wood: 0x795438, floor: 0x665f58 },
      { id: 'resort-charcoal', wall: 0xc7c1b5, accent: 0x2f4a3a, trim: 0xeee7db, wood: 0x654632, floor: 0x55534f },
    ],
    lightingFamilies: ['gallery-track', 'resort-recessed-and-drum', 'focused-merch-spots'],
    lightCount: [13, 17], lightIntensity: [1.00, 1.13], lightTemperature: [2850, 3350],
    checkoutVariants: ['hotel-gallery-counter', 'central-resort-island', 'concierge-retail-desk'],
    officeVariants: ['glazed-resort-office', 'rear-admin-suite', 'concierge-side-office'],
    storageVariants: ['large-receiving-room', 'dual-stock-room', 'merch-prep-and-storage'],
    decorSkus: ['rug1', 'plant1', 'poster1', 'board1', 'lounge1'], decorCount: [4, 5],
    productLines: [17, 20], shelfFill: [0.60, 0.74],
  }),
  5: profile({
    level: 5,
    id: 'private-luxury-boutique',
    label: 'Private-club luxury boutique',
    layoutFamily: 'boutique-salon-enfilade',
    startingTier: 'luxury',
    fixtureQuality: 'bespoke-luxury',
    furnitureStory: 'Bespoke walnut display walls, herringbone oak, restrained brass, tailored seating, and executive millwork.',
    palettes: [
      { id: 'boutique-walnut', wall: 0xd8cdb8, accent: 0x1f432f, trim: 0xf3ecdd, wood: 0x513725, floor: 0x815b3c },
      { id: 'country-club-cream', wall: 0xe2d8c7, accent: 0x264a35, trim: 0xf7f0e4, wood: 0x5a3b28, floor: 0x8a6243 },
      { id: 'sage-and-brass', wall: 0xb8c0aa, accent: 0x173d2c, trim: 0xeee5d3, wood: 0x4b3324, floor: 0x775238 },
    ],
    lightingFamilies: ['boutique-picture-lights', 'restrained-chandelier', 'brass-pendants-and-spots'],
    lightCount: [16, 20], lightIntensity: [1.08, 1.20], lightTemperature: [2550, 3050],
    checkoutVariants: ['bespoke-boutique-desk', 'private-client-counter', 'salon-wrap-counter'],
    officeVariants: ['executive-club-office', 'private-consultation-office', 'hidden-admin-suite'],
    storageVariants: ['concealed-luxury-stock', 'dual-prep-room', 'secure-merchandise-store'],
    decorSkus: ['rug1', 'plant1', 'poster1', 'board1', 'lounge1'], decorCount: [5, 5],
    productLines: [20, 24], shelfFill: [0.74, 0.92],
  }),
});

const clampLevel = (value) => Math.max(1, Math.min(5, Math.round(Number(value) || 1)));
const choose = (rng, values) => values[rng.int(values.length)];
const range = (rng, [lo, hi]) => lo + rng.next() * (hi - lo);
const intRange = (rng, [lo, hi]) => lo + rng.int(hi - lo + 1);
const snap = (value, step = 0.25) => Math.round(value / step) * step;

function stringSeed(value) {
  let hash = 2166136261;
  for (const char of String(value || 'property')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableHash(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

const pose = (x, z, ry = 0) => Object.freeze({ x, z, ry });

// These are five authored circulation plans, not one universal plan with a
// random offset. Randomness is deliberately confined to the displays that can
// move without weakening the composition; the production placement validator
// still accepts the complete arrangement before it reaches the renderer.
const COURSE_LAYOUT_BLUEPRINTS = Object.freeze({
  1: Object.freeze({
    id: 'municipal-three-bay',
    stored: Object.freeze(['shelf_small']),
    poses: Object.freeze({
      shelf_balls: pose(-6.90, -6.15, 0),
      shelf_acc: pose(-3.70, -6.15, 0),
      hatstand: pose(-5.25, -1.25, 0),
      backshelf_n: pose(8.00, -5.90, 0),
    }),
    jitter: Object.freeze(['hatstand']),
  }),
  2: Object.freeze({
    id: 'public-north-loop',
    stored: Object.freeze([]),
    poses: Object.freeze({
      rack_drivers: pose(-8.00, -4.75, 0),
      rack_irons: pose(-5.00, -4.75, 0),
      shelf_balls: pose(-8.00, -6.15, 0),
      shelf_acc: pose(-4.80, -6.15, 0),
      shelf_small: pose(-1.60, -6.15, 0),
      table_polos: pose(-6.40, -2.40, 0),
      hatstand: pose(-3.50, -2.30, 0),
      bagstand: pose(1.60, -2.55, 0),
      snackrack: pose(-6.60, 6.02, Math.PI),
      backshelf_n: pose(7.45, -5.95, 0),
      backshelf_e: pose(9.85, -5.45, -Math.PI / 2),
    }),
    jitter: Object.freeze(['table_polos', 'hatstand', 'bagstand']),
  }),
  3: Object.freeze({
    id: 'lodge-hearth-rooms',
    stored: Object.freeze([]),
    poses: Object.freeze({
      rack_drivers: pose(-9.90, -3.45, Math.PI / 2),
      rack_irons: pose(-9.90, -0.99, Math.PI / 2),
      rack_putters: pose(-9.90, 2.02, Math.PI / 2),
      shelf_balls: pose(-7.20, -6.15, 0),
      shelf_acc: pose(-3.80, -6.15, 0),
      shelf_small: pose(-0.40, -6.15, 0),
      table_polos: pose(-5.80, -0.45, 0),
      rail_outer: pose(-4.20, 1.55, 0),
      hatstand: pose(-3.15, -1.40, 0),
      bagstand: pose(1.75, -2.65, 0),
      shoerack: pose(5.10, -0.60, -Math.PI / 2),
      apparel_display: pose(5.44, 1.30, -Math.PI / 2),
      feature: pose(-4.75, 3.45, 0),
      snackrack: pose(-6.60, 6.02, Math.PI),
      backshelf_n: pose(7.45, -5.95, 0),
      backshelf_e: pose(9.85, -5.65, -Math.PI / 2),
      backshelf_e2: pose(9.85, -0.55, -Math.PI / 2),
    }),
    jitter: Object.freeze(['table_polos', 'rail_outer', 'hatstand', 'bagstand', 'feature']),
  }),
  4: Object.freeze({
    id: 'resort-gallery-axis',
    stored: Object.freeze([]),
    poses: Object.freeze({
      rack_drivers: pose(-8.00, -4.75, 0),
      rack_irons: pose(-5.00, -4.75, 0),
      rack_putters: pose(-2.15, -4.75, 0),
      shelf_balls: pose(-8.00, -6.15, 0),
      shelf_acc: pose(-4.80, -6.15, 0),
      shelf_small: pose(-1.60, -6.15, 0),
      table_polos: pose(-7.10, 0.35, 0),
      rail_outer: pose(-4.65, 0.35, 0),
      hatstand: pose(-2.40, -1.65, 0),
      bagstand: pose(1.60, -2.65, 0),
      shoerack: pose(5.10, -0.60, -Math.PI / 2),
      apparel_display: pose(5.44, 1.30, -Math.PI / 2),
      feature: pose(-5.10, 3.45, 0),
      snackrack: pose(-6.60, 6.02, Math.PI),
      backshelf_n: pose(7.40, -5.95, 0),
      backshelf_e: pose(6.25, -3.65, -Math.PI / 2),
      backshelf_e2: pose(9.85, -0.55, -Math.PI / 2),
    }),
    jitter: Object.freeze(['table_polos', 'rail_outer', 'hatstand', 'bagstand', 'feature']),
  }),
  5: Object.freeze({
    id: 'boutique-salon-enfilade',
    stored: Object.freeze([]),
    poses: Object.freeze({
      rack_drivers: pose(-9.90, -3.45, Math.PI / 2),
      rack_irons: pose(-9.90, -0.99, Math.PI / 2),
      rack_putters: pose(-9.90, 2.02, Math.PI / 2),
      shelf_balls: pose(-7.75, -4.85, 0),
      shelf_acc: pose(-4.25, -4.85, 0),
      shelf_small: pose(-0.75, -4.85, 0),
      table_polos: pose(-6.75, 0.10, 0),
      rail_outer: pose(-4.25, 1.80, 0),
      hatstand: pose(-3.70, -1.20, 0),
      bagstand: pose(1.60, -2.65, 0),
      shoerack: pose(5.10, -0.60, -Math.PI / 2),
      apparel_display: pose(5.44, 1.30, -Math.PI / 2),
      feature: pose(-5.20, 3.45, 0),
      snackrack: pose(-6.60, 6.02, Math.PI),
      backshelf_n: pose(7.25, -5.95, 0),
      backshelf_e: pose(9.85, -5.45, -Math.PI / 2),
      backshelf_e2: pose(6.25, -0.50, -Math.PI / 2),
    }),
    jitter: Object.freeze(['table_polos', 'rail_outer', 'hatstand', 'bagstand', 'feature']),
  }),
});

const HERO_PRODUCTS_BY_LEVEL = Object.freeze({
  1: Object.freeze(['balls1', 'tees1', 'cap1']),
  2: Object.freeze(['driver1', 'balls1', 'polo1', 'cap1', 'bag1', 'shoe1']),
  3: Object.freeze(['driver2', 'balls2', 'polo2', 'jacket2', 'cap1', 'bag1', 'shoe1', 'range2']),
  4: Object.freeze(['driver3', 'balls3', 'polo2', 'jacket2', 'cap1', 'bag1', 'shoe1', 'range2']),
  5: Object.freeze(['driver3', 'irons2', 'balls3', 'polo2', 'jacket2', 'cap1', 'bag1', 'shoe1', 'range2']),
});

function fixtureCandidates(rng, level, tier) {
  const blueprint = COURSE_LAYOUT_BLUEPRINTS[level];
  const jitter = new Set(blueprint.jitter);
  const candidates = {};
  for (const fixture of FIXTURES) {
    const authored = blueprint.poses[fixture.id];
    if (!authored || !fixtureUnlockedForTier(fixture.id, tier)) continue;
    const dx = jitter.has(fixture.id) ? choose(rng, [-0.50, -0.25, 0, 0.25, 0.50]) : 0;
    const dz = jitter.has(fixture.id) ? choose(rng, [-0.50, -0.25, 0, 0.25, 0.50]) : 0;
    candidates[fixture.id] = { x: snap(authored.x + dx), z: snap(authored.z + dz), ry: authored.ry };
  }
  return { blueprintId: blueprint.id, startingStoredFixtures: [...blueprint.stored], poses: candidates };
}

const OFFICE_PLACEMENTS = Object.freeze({
  'east-front': Object.freeze({
    desk: Object.freeze({ x: 9.50, z: 4.50, ry: Math.PI / 2 }),
    chair: Object.freeze({ x: 8.50, z: 4.50, ry: Math.PI / 2 }),
    laptop: Object.freeze({ x: 9.50, z: 4.50, ry: Math.PI / 2 }),
    filing: Object.freeze({ x: 9.75, z: 3.00, ry: -Math.PI / 2 }),
    lamp: Object.freeze({ x: 9.72, z: 5.18, ry: -1.10 }),
    phone: Object.freeze({ x: 9.70, z: 3.98, ry: -1.40 }),
    printer: Object.freeze({ x: 9.72, z: 2.95, ry: Math.PI / 2 }),
  }),
  'east-rear': Object.freeze({
    desk: Object.freeze({ x: 8.25, z: 5.75, ry: Math.PI }),
    chair: Object.freeze({ x: 8.25, z: 4.75, ry: Math.PI }),
    laptop: Object.freeze({ x: 8.25, z: 5.75, ry: Math.PI }),
    filing: Object.freeze({ x: 9.75, z: 3.25, ry: -Math.PI / 2 }),
    lamp: Object.freeze({ x: 7.60, z: 5.55, ry: -0.25 }),
    phone: Object.freeze({ x: 8.78, z: 5.54, ry: -0.10 }),
    printer: Object.freeze({ x: 9.72, z: 3.36, ry: Math.PI / 2 }),
  }),
  'rear-corner': Object.freeze({
    desk: Object.freeze({ x: 6.50, z: 4.50, ry: -Math.PI / 2 }),
    chair: Object.freeze({ x: 7.50, z: 4.50, ry: -Math.PI / 2 }),
    laptop: Object.freeze({ x: 6.50, z: 4.50, ry: -Math.PI / 2 }),
    filing: Object.freeze({ x: 9.75, z: 3.25, ry: -Math.PI / 2 }),
    lamp: Object.freeze({ x: 6.62, z: 3.95, ry: 1.10 }),
    phone: Object.freeze({ x: 6.62, z: 5.14, ry: 1.35 }),
    printer: Object.freeze({ x: 9.72, z: 3.36, ry: Math.PI / 2 }),
  }),
});

const STORAGE_PLACEMENTS = Object.freeze({
  'east-rear': Object.freeze({
    packing: Object.freeze({ x: 7.00, z: -1.00, ry: 0 }),
  }),
  'rear-spine': Object.freeze({
    packing: Object.freeze({ x: 6.75, z: -2.25, ry: Math.PI / 2 }),
  }),
  'split-east': Object.freeze({
    packing: Object.freeze({ x: 8.75, z: -0.50, ry: Math.PI / 2 }),
  }),
});

function roomPlan(rng, profileSpec) {
  const office = choose(rng, profileSpec.officeVariants);
  const storage = choose(rng, profileSpec.storageVariants);
  const officeSide = choose(rng, ['east-front', 'east-rear', 'rear-corner']);
  const storageSide = choose(rng, ['east-rear', 'rear-spine', 'split-east']);
  const secondary = profileSpec.level === 1
    ? ['restroom', 'employee-room', 'mechanical-closet']
    : profileSpec.level === 2
      ? ['restroom', 'cleaning-closet', 'employee-nook']
      : profileSpec.level === 3
        ? ['fitting-room', 'member-lounge', 'restroom']
        : profileSpec.level === 4
          ? ['fitting-suite', 'guest-lounge', 'merch-prep']
          : ['private-fitting-room', 'client-salon', 'secure-stock'];
  return {
    office: { variant: office, side: officeSide, pose: OFFICE_PLACEMENTS[officeSide] },
    storage: { variant: storage, side: storageSide, pose: STORAGE_PLACEMENTS[storageSide] },
    secondary,
    circulation: profileSpec.layoutFamily,
  };
}

function decorPlan(rng, profileSpec) {
  const count = intRange(rng, profileSpec.decorCount);
  const pool = [...profileSpec.decorSkus];
  for (let index = pool.length - 1; index > 0; index--) {
    const other = rng.int(index + 1);
    [pool[index], pool[other]] = [pool[other], pool[index]];
  }
  return pool.slice(0, count).flatMap((skuId) => {
    const spots = DECOR_SPOTS[skuId] || [];
    if (!spots.length) return [];
    const spot = rng.int(spots.length);
    const pose = spots[spot];
    return [{
      objectId: `decor:${skuId}:${spot}`,
      skuId,
      spot,
      pose: { ...pose },
      sellable: true,
      replaceable: true,
    }];
  });
}

function merchandisingPlan(rng, profileSpec, tier) {
  const fixtures = new Set(FIXTURES
    .filter((fixture) => fixtureUnlockedForTier(fixture.id, tier))
    .map((fixture) => fixture.id));
  const lines = SHOP_CATALOG.filter((sku) => {
    if (!['clubs', 'balls', 'apparel', 'accessories', 'provisions'].includes(sku.cat)) return false;
    const fixture = homeFixture(sku.id);
    return fixture && fixtures.has(fixture.id) && sku.tier <= (profileSpec.level >= 3 ? 3 : profileSpec.level);
  });
  for (let index = lines.length - 1; index > 0; index--) {
    const other = rng.int(index + 1);
    [lines[index], lines[other]] = [lines[other], lines[index]];
  }
  const lineCount = Math.min(lines.length, intRange(rng, profileSpec.productLines));
  const allowedIds = new Set(lines.map((sku) => sku.id));
  const heroIds = HERO_PRODUCTS_BY_LEVEL[profileSpec.level].filter((id) => allowedIds.has(id));
  const selected = [
    ...heroIds.map((id) => lines.find((sku) => sku.id === id)),
    ...lines.filter((sku) => !heroIds.includes(sku.id)),
  ].slice(0, lineCount);
  const fill = range(rng, profileSpec.shelfFill);
  const inventory = {};
  for (const sku of selected) {
    const capacity = Math.max(1, capacityOf(sku.id));
    const variation = 0.82 + rng.next() * 0.36;
    inventory[sku.id] = Math.max(1, Math.min(capacity, Math.round(capacity * fill * variation)));
  }
  return {
    displayPattern: choose(rng, ['category-blocks', 'alternating-facings', 'hero-and-support', 'tonal-runs']),
    heroCategory: choose(rng, ['clubs', 'apparel', 'balls', 'accessories']),
    targetFill: fill,
    productLineCount: selected.length,
    shelfInventory: inventory,
  };
}

export function shopGenerationFingerprint(generation) {
  return stableHash({
    level: generation.courseLevel,
    family: generation.layoutFamily,
    palette: generation.palette?.id,
    lighting: generation.lighting,
    checkout: generation.checkout,
    rooms: generation.rooms,
    fixtures: generation.fixturePoses,
    decor: generation.decor,
    merchandise: generation.merchandising,
  });
}

export function generateShopDefinition({ seed = 1, propertyId = 'property', courseLevel = 1 } = {}) {
  const level = clampLevel(courseLevel);
  const profileSpec = COURSE_SHOP_PROFILES[level];
  const derivedSeed = (((Number(seed) >>> 0) ^ stringSeed(propertyId) ^ Math.imul(level, 0x9e3779b1)) >>> 0) || 1;
  const rng = makeRng(derivedSeed);
  const palette = { ...choose(rng, profileSpec.palettes) };
  const fixturePlan = fixtureCandidates(rng, level, profileSpec.startingTier);
  const rooms = roomPlan(rng, profileSpec);
  Object.assign(fixturePlan.poses, {
    office_desk: { ...rooms.office.pose.desk },
    office_chair: { ...rooms.office.pose.chair },
    office_filing: { ...rooms.office.pose.filing },
    packing_bench: { ...rooms.storage.pose.packing },
  });
  const decor = decorPlan(rng, profileSpec);
  const lighting = {
    family: choose(rng, profileSpec.lightingFamilies),
    fixtureCount: intRange(rng, profileSpec.lightCount),
    intensityScale: Math.round(range(rng, profileSpec.lightIntensity) * 1000) / 1000,
    temperatureK: Math.round(range(rng, profileSpec.lightTemperature) / 25) * 25,
    // Practical indices use one accepted rig; per-property masks make it read
    // sparse, rhythmic, gallery-focused, or fully illuminated without adding
    // unbounded light objects.
    disabledPracticalIndices: Array.from({ length: Math.max(0, 6 - level) }, () => rng.int(15))
      .filter((value, index, values) => values.indexOf(value) === index),
  };
  const checkout = {
    variant: choose(rng, profileSpec.checkoutVariants),
    serviceSide: choose(rng, ['left-bagging', 'right-bagging']),
    queueShape: choose(rng, ['straight', 'soft-angle', 'short-serpentine']),
    transactionAnchor: 'accepted-register-workspace-v1',
  };
  const generation = {
    schemaVersion: SHOP_GENERATION_SCHEMA_VERSION,
    seed: derivedSeed,
    propertyId: String(propertyId),
    courseLevel: level,
    profileId: profileSpec.id,
    profileLabel: profileSpec.label,
    layoutFamily: profileSpec.layoutFamily,
    layoutBlueprintId: fixturePlan.blueprintId,
    startingTier: profileSpec.startingTier,
    startingStoredFixtures: fixturePlan.startingStoredFixtures,
    fixtureQuality: profileSpec.fixtureQuality,
    furnitureStory: profileSpec.furnitureStory,
    palette,
    lighting,
    checkout,
    rooms,
    fixturePoses: fixturePlan.poses,
    decor,
    merchandising: merchandisingPlan(rng, profileSpec, profileSpec.startingTier),
    referenceFiles: SHOP_REFERENCE_SOURCES.map((source) => source.file),
    generatedObjects: [],
    audit: { acceptedFixturePoses: [], rejectedFixturePoses: [] },
  };
  const installed = FIXTURES.filter((fixture) => fixtureUnlockedForTier(fixture.id, profileSpec.startingTier));
  generation.generatedObjects = [
    ...installed.map((fixture) => ({
      objectId: `fixture:${fixture.id}`,
      kind: 'fixture',
      sourceId: fixture.id,
      sellable: true,
      replaceable: true,
      quality: profileSpec.fixtureQuality,
    })),
    ...decor.map((entry) => ({
      objectId: entry.objectId,
      kind: 'decor',
      sourceId: entry.skuId,
      sellable: true,
      replaceable: true,
      quality: profileSpec.fixtureQuality,
    })),
  ];
  generation.fingerprint = shopGenerationFingerprint(generation);
  return generation;
}

export function courseShopProfile(courseLevel) {
  return COURSE_SHOP_PROFILES[clampLevel(courseLevel)];
}
