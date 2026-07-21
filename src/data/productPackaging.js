// Authoritative, SKU-level physical packaging contracts.
//
// This module is deliberately not wired into the delivery/save pipeline yet. It is the
// migration boundary for the production box library: every SKU names one exact authored
// shell and socket layout, and every packed unit must fit that layout at 1:1 scale. Callers
// get a hard error for unknown products, malformed dimensions or an over-size item; there is
// no generic-carton or shrink-to-fit fallback.

const DIMENSION_KEYS = ['w', 'h', 'd'];
const STATUS = new Set(['retail', 'nonretail']);

function dimensions(w, h, d) {
  return { w, h, d };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function roundTenth(value) {
  return Math.round(value * 10) / 10;
}

function sameDimensions(a, b) {
  return DIMENSION_KEYS.every((key) => Math.abs(a[key] - b[key]) <= 1e-9);
}

function assertDimensions(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a dimensions object`);
  }
  for (const key of DIMENSION_KEYS) {
    if (!Number.isFinite(value[key]) || value[key] <= 0) {
      throw new TypeError(`${label}.${key} must be a finite positive number`);
    }
  }
}

// Runtime dimensions use width (x), height (y), depth (z), in metres. The model ids and
// dimensions match the repeatable Blender delivery-box library; inner dimensions reserve
// honest room for corrugation, folds and inserts.
export const PACKAGING_SHELLS = deepFreeze({
  ACCESSORY_CARTON: {
    id: 'ACCESSORY_CARTON',
    familyId: 'SMALL_ACCESSORIES',
    modelId: 'delivery_accessory_carton',
    dimensions: dimensions(0.42, 0.30, 0.36),
    innerDimensions: dimensions(0.40, 0.27, 0.34),
    tareWeightLb: 0.6,
  },
  BALL_CASE: {
    id: 'BALL_CASE',
    familyId: 'BALL_CASE',
    modelId: 'delivery_golf_ball_case',
    dimensions: dimensions(0.52, 0.34, 0.42),
    innerDimensions: dimensions(0.50, 0.31, 0.40),
    tareWeightLb: 0.9,
  },
  GENERIC_MERCHANDISE: {
    id: 'GENERIC_MERCHANDISE',
    familyId: 'GENERAL_MERCHANDISE',
    modelId: 'delivery_generic_merchandise_box',
    dimensions: dimensions(0.60, 0.40, 0.40),
    innerDimensions: dimensions(0.58, 0.37, 0.38),
    tareWeightLb: 1.1,
  },
  APPAREL_CARTON: {
    id: 'APPAREL_CARTON',
    familyId: 'FOLDED_APPAREL',
    modelId: 'delivery_apparel_box',
    dimensions: dimensions(0.60, 0.35, 0.40),
    innerDimensions: dimensions(0.58, 0.32, 0.38),
    tareWeightLb: 1.0,
  },
  SHOE_CARTON: {
    id: 'SHOE_CARTON',
    familyId: 'SHOES',
    modelId: 'delivery_shoe_carton',
    dimensions: dimensions(0.58, 0.32, 0.44),
    innerDimensions: dimensions(0.56, 0.29, 0.42),
    tareWeightLb: 0.6,
  },
  LONG_CLUB_CARTON: {
    id: 'LONG_CLUB_CARTON',
    familyId: 'LONG_CLUB',
    modelId: 'delivery_golf_club_box',
    dimensions: dimensions(1.25, 0.18, 0.18),
    innerDimensions: dimensions(1.21, 0.14, 0.14),
    tareWeightLb: 1.1,
  },
  GOLF_BAG_CARTON: {
    id: 'GOLF_BAG_CARTON',
    familyId: 'GOLF_BAG',
    modelId: 'delivery_golf_bag_carton',
    dimensions: dimensions(0.72, 1.05, 0.52),
    innerDimensions: dimensions(0.68, 1.01, 0.48),
    tareWeightLb: 1.7,
  },
  FIXTURE_PACKAGE: {
    id: 'FIXTURE_PACKAGE',
    familyId: 'FIXTURE',
    modelId: 'delivery_fixture_package',
    dimensions: dimensions(0.62, 0.55, 0.40),
    innerDimensions: dimensions(0.60, 0.52, 0.38),
    tareWeightLb: 2.6,
  },
  FURNITURE_CRATE: {
    id: 'FURNITURE_CRATE',
    familyId: 'FURNITURE_FREIGHT',
    modelId: 'delivery_furniture_crate',
    dimensions: dimensions(1.25, 0.98, 0.85),
    innerDimensions: dimensions(1.21, 0.94, 0.81),
    tareWeightLb: 14,
  },
  BULK_PROVISIONS: {
    id: 'BULK_PROVISIONS',
    familyId: 'BULK_PROVISIONS',
    modelId: 'delivery_bulk_provisions_carton',
    dimensions: dimensions(0.50, 0.30, 0.38),
    innerDimensions: dimensions(0.48, 0.27, 0.36),
    tareWeightLb: 0.8,
  },
  UMBRELLA_CARTON: {
    id: 'UMBRELLA_CARTON',
    familyId: 'LONG_UMBRELLA',
    modelId: 'delivery_umbrella_carton',
    dimensions: dimensions(0.92, 0.28, 0.38),
    innerDimensions: dimensions(0.88, 0.25, 0.34),
    tareWeightLb: 1.0,
  },
  IRON_SET_CARTON: {
    id: 'IRON_SET_CARTON',
    familyId: 'IRON_SET',
    modelId: 'delivery_iron_set_carton',
    dimensions: dimensions(1.12, 0.24, 0.24),
    innerDimensions: dimensions(1.08, 0.21, 0.21),
    tareWeightLb: 1.3,
  },
});

// slotMaxDimensions describes the full authored clearance of one socket. Capacity is the
// number of separately authored/removable sockets, not a renderer-side representative count.
export const PACKAGING_LAYOUTS = deepFreeze({
  ACCESSORY_CARD12: layout('ACCESSORY_CARD12', 'ACCESSORY_CARTON', 12, dimensions(0.205, 0.13, 0.08)),
  GLOVE8: layout('GLOVE8', 'ACCESSORY_CARTON', 8, dimensions(0.18, 0.04, 0.23)),
  RANGE4: layout('RANGE4', 'ACCESSORY_CARTON', 4, dimensions(0.195, 0.11, 0.15)),
  BALL12: layout('BALL12', 'BALL_CASE', 12, dimensions(0.16, 0.075, 0.13)),
  CAP_NEST8: layout('CAP_NEST8', 'GENERIC_MERCHANDISE', 8, dimensions(0.215, 0.075, 0.215)),
  APPAREL8: layout('APPAREL8', 'APPAREL_CARTON', 8, dimensions(0.22, 0.10, 0.19)),
  FLAT8: layout('FLAT8', 'APPAREL_CARTON', 8, dimensions(0.18, 0.08, 0.15)),
  SHOE4: layout('SHOE4', 'SHOE_CARTON', 4, dimensions(0.25, 0.14, 0.33)),
  CLUB2: layout('CLUB2', 'LONG_CLUB_CARTON', 2, dimensions(1.19, 0.09, 0.105)),
  BAG1: layout('BAG1', 'GOLF_BAG_CARTON', 1, dimensions(0.67, 0.98, 0.45)),
  FIXTURE1: layout('FIXTURE1', 'FIXTURE_PACKAGE', 1, dimensions(0.59, 0.50, 0.37)),
  FURNITURE1: layout('FURNITURE1', 'FURNITURE_CRATE', 1, dimensions(1.19, 0.90, 0.79)),
  DRINK12: layout('DRINK12', 'BULK_PROVISIONS', 12, dimensions(0.075, 0.23, 0.075)),
  BOTTLE8: layout('BOTTLE8', 'BULK_PROVISIONS', 8, dimensions(0.09, 0.25, 0.09)),
  // The project-owned Bunker Bites pouch is 160 x 195 x 71.5 mm. Three
  // face-out pouches span the exact 0.48 m clear width of the bulk carton;
  // the authored sockets provide the packing clearance without shrinking it.
  SNACK12: layout('SNACK12', 'BULK_PROVISIONS', 12, dimensions(0.160, 0.200, 0.075)),
  UMBRELLA6: layout('UMBRELLA6', 'UMBRELLA_CARTON', 6, dimensions(0.87, 0.12, 0.112)),
  IRONSET1: layout('IRONSET1', 'IRON_SET_CARTON', 1, dimensions(1.07, 0.19, 0.19)),
});

function layout(id, shellId, capacity, slotMaxDimensions) {
  return { id, shellId, capacity, slotMaxDimensions };
}

const RETAIL_FIXTURES = {
  driver: ['rack_drivers'],
  irons: ['rack_irons'],
  putter: ['rack_putters'],
  balls: ['shelf_balls'],
  glove: ['shelf_small'],
  polo: ['table_polos'],
  cap: ['hatstand'],
  jacket: ['shelf_small'],
  accessories: ['shelf_acc'],
  bag: ['bagstand'],
  shoe: ['shoerack'],
  socks: ['shelf_small'],
  drinks: ['cold_drinks'],
  snacks: ['snack_rack'],
  scorecards: ['member_station'],
};

function product({
  skuId,
  status,
  category,
  physical,
  packed,
  packedState,
  packedOrientation,
  layoutId,
  unitWeightLb,
  fragile = false,
  longProduct = false,
  fixtureIds,
  exceptionProfile = null,
}) {
  const layoutSpec = PACKAGING_LAYOUTS[layoutId];
  const shell = layoutSpec && PACKAGING_SHELLS[layoutSpec.shellId];
  if (!layoutSpec || !shell) throw new Error(`Packaging spec ${skuId} references missing layout ${layoutId}`);
  return {
    skuId,
    status,
    retail: status === 'retail',
    catalogCategory: category,
    physicalDimensions: physical,
    packing: {
      state: packedState,
      orientation: packedOrientation,
      dimensions: packed,
      allowScale: false,
      contentScale: 1,
    },
    unitsPerBox: layoutSpec.capacity,
    familyId: shell.familyId,
    layoutId,
    box: {
      shellId: shell.id,
      modelId: shell.modelId,
      dimensions: shell.dimensions,
      innerDimensions: shell.innerDimensions,
      tareWeightLb: shell.tareWeightLb,
    },
    unitWeightLb,
    fragile: !!fragile,
    longProduct: !!longProduct,
    allowedStocking: {
      category,
      fixtureIds,
    },
    exceptionProfile,
  };
}

// Product dimensions are the real, unpacked bounds. Packing dimensions are the authored
// occupied bounds after legitimate folding, nesting or disassembly; they are never a render
// scale. The two special long profiles are explicit so an umbrella cannot fall into the small
// accessory carton and an iron set cannot be treated as two individual clubs.
const PRODUCT_SPECS = [
  product({ skuId: 'driver1', status: 'retail', category: 'clubs', physical: dimensions(1.14, 0.0704, 0.0792), packed: dimensions(1.16, 0.08, 0.10), packedState: 'head-and-shaft-guarded', packedOrientation: 'lengthwise-heads-opposed', layoutId: 'CLUB2', unitWeightLb: 0.8, longProduct: true, fixtureIds: RETAIL_FIXTURES.driver }),
  product({ skuId: 'driver2', status: 'retail', category: 'clubs', physical: dimensions(1.16, 0.0716, 0.0806), packed: dimensions(1.18, 0.08, 0.10), packedState: 'head-and-shaft-guarded', packedOrientation: 'lengthwise-heads-opposed', layoutId: 'CLUB2', unitWeightLb: 0.8, longProduct: true, fixtureIds: RETAIL_FIXTURES.driver }),
  product({ skuId: 'driver3', status: 'retail', category: 'clubs', physical: dimensions(1.18, 0.0729, 0.0820), packed: dimensions(1.19, 0.085, 0.105), packedState: 'head-and-shaft-guarded', packedOrientation: 'lengthwise-heads-opposed', layoutId: 'CLUB2', unitWeightLb: 0.8, longProduct: true, fixtureIds: RETAIL_FIXTURES.driver }),
  product({ skuId: 'irons1', status: 'retail', category: 'clubs', physical: dimensions(1.02, 0.0792, 0.1554), packed: dimensions(1.05, 0.18, 0.18), packedState: 'complete-set-bundled-with-head-divider', packedOrientation: 'lengthwise-single-set', layoutId: 'IRONSET1', unitWeightLb: 8.5, longProduct: true, fixtureIds: RETAIL_FIXTURES.irons, exceptionProfile: 'IRON_SET1' }),
  product({ skuId: 'irons2', status: 'retail', category: 'clubs', physical: dimensions(1.04, 0.0807, 0.1584), packed: dimensions(1.07, 0.19, 0.19), packedState: 'complete-set-bundled-with-head-divider', packedOrientation: 'lengthwise-single-set', layoutId: 'IRONSET1', unitWeightLb: 8.5, longProduct: true, fixtureIds: RETAIL_FIXTURES.irons, exceptionProfile: 'IRON_SET1' }),
  product({ skuId: 'putter1', status: 'retail', category: 'clubs', physical: dimensions(0.94, 0.0517, 0.0542), packed: dimensions(0.97, 0.07, 0.09), packedState: 'head-and-shaft-guarded', packedOrientation: 'lengthwise-heads-opposed', layoutId: 'CLUB2', unitWeightLb: 1.2, longProduct: true, fixtureIds: RETAIL_FIXTURES.putter }),
  product({ skuId: 'putter2', status: 'retail', category: 'clubs', physical: dimensions(0.96, 0.0528, 0.0554), packed: dimensions(0.99, 0.07, 0.09), packedState: 'head-and-shaft-guarded', packedOrientation: 'lengthwise-heads-opposed', layoutId: 'CLUB2', unitWeightLb: 1.2, longProduct: true, fixtureIds: RETAIL_FIXTURES.putter }),
  product({ skuId: 'putter3', status: 'retail', category: 'clubs', physical: dimensions(0.98, 0.0540, 0.0570), packed: dimensions(1.01, 0.075, 0.095), packedState: 'head-and-shaft-guarded', packedOrientation: 'lengthwise-heads-opposed', layoutId: 'CLUB2', unitWeightLb: 1.2, longProduct: true, fixtureIds: RETAIL_FIXTURES.putter }),
  product({ skuId: 'wedge1', status: 'retail', category: 'clubs', physical: dimensions(0.96, 0.0779, 0.0710), packed: dimensions(0.99, 0.085, 0.10), packedState: 'head-and-shaft-guarded', packedOrientation: 'lengthwise-heads-opposed', layoutId: 'CLUB2', unitWeightLb: 0.95, longProduct: true, fixtureIds: RETAIL_FIXTURES.irons }),
  product({ skuId: 'wedge2', status: 'retail', category: 'clubs', physical: dimensions(0.98, 0.0795, 0.0725), packed: dimensions(1.01, 0.085, 0.10), packedState: 'head-and-shaft-guarded', packedOrientation: 'lengthwise-heads-opposed', layoutId: 'CLUB2', unitWeightLb: 0.95, longProduct: true, fixtureIds: RETAIL_FIXTURES.irons }),

  product({ skuId: 'balls1', status: 'retail', category: 'balls', physical: dimensions(0.155, 0.0740, 0.1288), packed: dimensions(0.155, 0.0740, 0.1288), packedState: 'sealed-retail-dozen-carton', packedOrientation: 'brand-face-up', layoutId: 'BALL12', unitWeightLb: 1.4, fixtureIds: RETAIL_FIXTURES.balls }),
  product({ skuId: 'balls2', status: 'retail', category: 'balls', physical: dimensions(0.155, 0.0740, 0.1288), packed: dimensions(0.155, 0.0740, 0.1288), packedState: 'sealed-retail-dozen-carton', packedOrientation: 'brand-face-up', layoutId: 'BALL12', unitWeightLb: 1.4, fixtureIds: RETAIL_FIXTURES.balls }),
  product({ skuId: 'balls3', status: 'retail', category: 'balls', physical: dimensions(0.155, 0.0740, 0.1288), packed: dimensions(0.155, 0.0740, 0.1288), packedState: 'sealed-retail-dozen-carton', packedOrientation: 'brand-face-up', layoutId: 'BALL12', unitWeightLb: 1.4, fixtureIds: RETAIL_FIXTURES.balls }),

  product({ skuId: 'glove1', status: 'retail', category: 'apparel', physical: dimensions(0.1723, 0.0293, 0.2200), packed: dimensions(0.22, 0.03, 0.18), packedState: 'retail-hang-card-flat', packedOrientation: 'cards-face-up', layoutId: 'GLOVE8', unitWeightLb: 0.1, fixtureIds: RETAIL_FIXTURES.glove }),
  product({ skuId: 'glove2', status: 'retail', category: 'apparel', physical: dimensions(0.1723, 0.0293, 0.2200), packed: dimensions(0.22, 0.03, 0.18), packedState: 'retail-hang-card-flat', packedOrientation: 'cards-face-up', layoutId: 'GLOVE8', unitWeightLb: 0.1, fixtureIds: RETAIL_FIXTURES.glove }),
  product({ skuId: 'polo1', status: 'retail', category: 'apparel', physical: dimensions(0.2000, 0.0925, 0.1650), packed: dimensions(0.2000, 0.0925, 0.1650), packedState: 'folded-with-tissue-and-size-tag', packedOrientation: 'collar-face-up', layoutId: 'APPAREL8', unitWeightLb: 0.5, fixtureIds: RETAIL_FIXTURES.polo }),
  product({ skuId: 'polo2', status: 'retail', category: 'apparel', physical: dimensions(0.2000, 0.0925, 0.1650), packed: dimensions(0.2000, 0.0925, 0.1650), packedState: 'folded-with-tissue-and-size-tag', packedOrientation: 'collar-face-up', layoutId: 'APPAREL8', unitWeightLb: 0.5, fixtureIds: RETAIL_FIXTURES.polo }),
  product({ skuId: 'pants2', status: 'retail', category: 'apparel', physical: dimensions(0.2200, 0.1050, 0.1900), packed: dimensions(0.2200, 0.1000, 0.1900), packedState: 'folded-compressed-with-tissue-and-size-tag', packedOrientation: 'waistband-face-up', layoutId: 'APPAREL8', unitWeightLb: 1.0, fixtureIds: RETAIL_FIXTURES.polo }),
  product({ skuId: 'shorts1', status: 'retail', category: 'apparel', physical: dimensions(0.2100, 0.0950, 0.1800), packed: dimensions(0.2100, 0.0950, 0.1800), packedState: 'folded-with-tissue-and-size-tag', packedOrientation: 'waistband-face-up', layoutId: 'APPAREL8', unitWeightLb: 0.7, fixtureIds: RETAIL_FIXTURES.polo }),
  product({ skuId: 'cap1', status: 'retail', category: 'apparel', physical: dimensions(0.2081, 0.1235, 0.2100), packed: dimensions(0.2081, 0.0700, 0.2100), packedState: 'nested-crowns-with-tissue-form', packedOrientation: 'bills-aligned-face-front', layoutId: 'CAP_NEST8', unitWeightLb: 0.25, fixtureIds: RETAIL_FIXTURES.cap }),
  product({ skuId: 'cap2', status: 'retail', category: 'apparel', physical: dimensions(0.2081, 0.1235, 0.2100), packed: dimensions(0.2081, 0.0700, 0.2100), packedState: 'nested-crowns-with-tissue-form', packedOrientation: 'bills-aligned-face-front', layoutId: 'CAP_NEST8', unitWeightLb: 0.25, fixtureIds: RETAIL_FIXTURES.cap }),
  product({ skuId: 'jacket2', status: 'retail', category: 'apparel', physical: dimensions(0.2150, 0.0947, 0.1822), packed: dimensions(0.2150, 0.0947, 0.1822), packedState: 'folded-with-tissue-and-size-tag', packedOrientation: 'zipper-face-up', layoutId: 'APPAREL8', unitWeightLb: 1.3, fixtureIds: RETAIL_FIXTURES.jacket }),
  product({ skuId: 'shoe1', status: 'retail', category: 'apparel', physical: dimensions(0.3100, 0.1150, 0.1900), packed: dimensions(0.32, 0.13, 0.24), packedState: 'pair-in-retail-shoe-box-with-tissue', packedOrientation: 'toe-end-face-front', layoutId: 'SHOE4', unitWeightLb: 2.4, fixtureIds: RETAIL_FIXTURES.shoe }),
  product({ skuId: 'shoe3', status: 'retail', category: 'apparel', physical: dimensions(0.3150, 0.1200, 0.1950), packed: dimensions(0.32, 0.13, 0.24), packedState: 'pair-in-retail-shoe-box-with-tissue', packedOrientation: 'toe-end-face-front', layoutId: 'SHOE4', unitWeightLb: 2.1, fixtureIds: RETAIL_FIXTURES.shoe }),
  product({ skuId: 'sock1', status: 'retail', category: 'apparel', physical: dimensions(0.1500, 0.0731, 0.1269), packed: dimensions(0.1500, 0.0731, 0.1269), packedState: 'banded-folded-pair', packedOrientation: 'label-face-up', layoutId: 'FLAT8', unitWeightLb: 0.15, fixtureIds: RETAIL_FIXTURES.socks }),

  product({ skuId: 'tees1', status: 'retail', category: 'accessories', physical: dimensions(0.1300, 0.1200, 0.0460), packed: dimensions(0.1300, 0.1200, 0.0460), packedState: 'sealed-retail-pouch', packedOrientation: 'label-face-up', layoutId: 'ACCESSORY_CARD12', unitWeightLb: 0.35, fixtureIds: RETAIL_FIXTURES.accessories }),
  product({ skuId: 'towel1', status: 'retail', category: 'accessories', physical: dimensions(0.2000, 0.1034, 0.0751), packed: dimensions(0.2000, 0.1034, 0.0751), packedState: 'rolled-and-banded', packedOrientation: 'hang-tag-face-up', layoutId: 'ACCESSORY_CARD12', unitWeightLb: 0.4, fixtureIds: RETAIL_FIXTURES.accessories }),
  product({ skuId: 'marker1', status: 'retail', category: 'accessories', physical: dimensions(0.1400, 0.1050, 0.0195), packed: dimensions(0.1400, 0.1050, 0.0195), packedState: 'sealed-retail-blister-card', packedOrientation: 'card-face-up', layoutId: 'ACCESSORY_CARD12', unitWeightLb: 0.2, fixtureIds: RETAIL_FIXTURES.accessories }),
  product({ skuId: 'divot1', status: 'retail', category: 'accessories', physical: dimensions(0.1200, 0.1000, 0.0180), packed: dimensions(0.1200, 0.1000, 0.0180), packedState: 'sealed-retail-blister-card', packedOrientation: 'card-face-up', layoutId: 'ACCESSORY_CARD12', unitWeightLb: 0.15, fixtureIds: RETAIL_FIXTURES.accessories }),
  product({ skuId: 'range2', status: 'retail', category: 'accessories', physical: dimensions(0.1900, 0.1023, 0.1435), packed: dimensions(0.1900, 0.1023, 0.1435), packedState: 'retail-box-in-padded-cell', packedOrientation: 'display-face-up', layoutId: 'RANGE4', unitWeightLb: 0.75, fragile: true, fixtureIds: RETAIL_FIXTURES.accessories }),
  product({ skuId: 'sunglasses2', status: 'retail', category: 'accessories', physical: dimensions(0.1800, 0.0700, 0.0800), packed: dimensions(0.1900, 0.1000, 0.1000), packedState: 'hard-case-in-padded-cell', packedOrientation: 'display-face-up', layoutId: 'RANGE4', unitWeightLb: 0.15, fragile: true, fixtureIds: RETAIL_FIXTURES.accessories }),
  product({ skuId: 'bottle1', status: 'retail', category: 'accessories', physical: dimensions(0.0750, 0.2400, 0.0750), packed: dimensions(0.0750, 0.2400, 0.0750), packedState: 'protective-sleeve-upright', packedOrientation: 'upright-labels-out', layoutId: 'BOTTLE8', unitWeightLb: 0.7, fixtureIds: RETAIL_FIXTURES.accessories }),
  product({ skuId: 'umb1', status: 'retail', category: 'accessories', physical: dimensions(0.8400, 0.1116, 0.1077), packed: dimensions(0.86, 0.115, 0.112), packedState: 'sleeved-with-tip-and-handle-guards', packedOrientation: 'lengthwise-alternating-handles', layoutId: 'UMBRELLA6', unitWeightLb: 1.2, longProduct: true, fixtureIds: RETAIL_FIXTURES.accessories, exceptionProfile: 'UMBRELLA_LONG6' }),
  product({ skuId: 'bag1', status: 'retail', category: 'accessories', physical: dimensions(0.72, 0.25, 0.30), packed: dimensions(0.66, 0.24, 0.30), packedState: 'protective-sleeve-with-straps-compressed', packedOrientation: 'length-axis-vertical', layoutId: 'BAG1', unitWeightLb: 5.5, longProduct: true, fixtureIds: RETAIL_FIXTURES.bag }),
  product({ skuId: 'bag3', status: 'retail', category: 'accessories', physical: dimensions(0.72, 0.25, 0.30), packed: dimensions(0.66, 0.24, 0.30), packedState: 'protective-sleeve-with-straps-compressed', packedOrientation: 'length-axis-vertical', layoutId: 'BAG1', unitWeightLb: 7.5, longProduct: true, fixtureIds: RETAIL_FIXTURES.bag }),
  product({ skuId: 'scorecard1', status: 'retail', category: 'accessories', physical: dimensions(0.1500, 0.0040, 0.1000), packed: dimensions(0.1500, 0.0200, 0.1000), packedState: 'banded-scorecard-stack', packedOrientation: 'print-face-up', layoutId: 'ACCESSORY_CARD12', unitWeightLb: 0.05, fixtureIds: RETAIL_FIXTURES.scorecards }),

  product({ skuId: 'vac1', status: 'nonretail', category: 'supplies', physical: dimensions(0.42, 0.68, 0.38), packed: dimensions(0.58, 0.36, 0.37), packedState: 'hose-and-wand-detached-in-moulded-insert', packedOrientation: 'motor-base-on-side', layoutId: 'FIXTURE1', unitWeightLb: 17, fixtureIds: ['restoration-bay'] }),
  product({ skuId: 'repairkit1', status: 'nonretail', category: 'supplies', physical: dimensions(0.50, 0.25, 0.35), packed: dimensions(0.55, 0.30, 0.35), packedState: 'labelled-replacement-parts-in-divided-tray', packedOrientation: 'hardware-tray-flat', layoutId: 'FIXTURE1', unitWeightLb: 18, fixtureIds: ['campaign-repair-site'] }),
  product({ skuId: 'desk1', status: 'nonretail', category: 'supplies', physical: dimensions(1.90, 0.95, 0.75), packed: dimensions(1.18, 0.78, 0.76), packedState: 'flat-packed-desk-panels-with-protected-top', packedOrientation: 'panels-lengthwise', layoutId: 'FURNITURE1', unitWeightLb: 74, fixtureIds: ['campaign-office-desk'] }),
  product({ skuId: 'chair1', status: 'nonretail', category: 'supplies', physical: dimensions(0.68, 1.05, 0.70), packed: dimensions(0.58, 0.40, 0.36), packedState: 'seat-back-and-base-disassembled', packedOrientation: 'seat-shell-on-side', layoutId: 'FIXTURE1', unitWeightLb: 24, fixtureIds: ['campaign-office-chair'] }),
  product({ skuId: 'laptop1', status: 'nonretail', category: 'supplies', physical: dimensions(0.36, 0.025, 0.25), packed: dimensions(0.40, 0.08, 0.30), packedState: 'closed-laptop-in-padded-sleeve', packedOrientation: 'screen-flat-label-up', layoutId: 'FIXTURE1', unitWeightLb: 8, fragile: true, fixtureIds: ['campaign-office-laptop'] }),
  product({ skuId: 'counter1', status: 'nonretail', category: 'supplies', physical: dimensions(2.90, 1.05, 1.00), packed: dimensions(1.18, 0.80, 0.78), packedState: 'counter-carcass-flat-packed-with-top-protected', packedOrientation: 'panels-lengthwise', layoutId: 'FURNITURE1', unitWeightLb: 150, fixtureIds: ['campaign-front-counter'] }),
  product({ skuId: 'shelfkit1', status: 'nonretail', category: 'supplies', physical: dimensions(2.80, 2.10, 0.55), packed: dimensions(1.18, 0.72, 0.52), packedState: 'shelf-uprights-and-decks-banded-flat', packedOrientation: 'uprights-lengthwise', layoutId: 'FURNITURE1', unitWeightLb: 72, fixtureIds: ['campaign-display-shelves', 'campaign-stockroom-shelves'] }),
  product({ skuId: 'safetykit1', status: 'nonretail', category: 'supplies', physical: dimensions(0.58, 0.50, 0.25), packed: dimensions(0.55, 0.45, 0.25), packedState: 'extinguisher-first-aid-and-signage-braced', packedOrientation: 'extinguisher-valve-up', layoutId: 'FIXTURE1', unitWeightLb: 14, fixtureIds: ['campaign-safety-station'] }),
  product({ skuId: 'rug1', status: 'nonretail', category: 'decor', physical: dimensions(2.40, 0.018, 1.60), packed: dimensions(1.18, 0.24, 0.24), packedState: 'rolled-on-core-with-end-blocks', packedOrientation: 'roll-lengthwise', layoutId: 'FURNITURE1', unitWeightLb: 24, longProduct: true, fixtureIds: ['decor-floor'] }),
  product({ skuId: 'plant1', status: 'nonretail', category: 'decor', physical: dimensions(0.35, 0.65, 0.35), packed: dimensions(0.34, 0.28, 0.34), packedState: 'crown-netted-and-pot-braced', packedOrientation: 'pot-upright', layoutId: 'FIXTURE1', unitWeightLb: 9, fixtureIds: ['decor-floor'] }),
  product({ skuId: 'poster1', status: 'nonretail', category: 'decor', physical: dimensions(0.52, 0.04, 0.36), packed: dimensions(0.56, 0.07, 0.37), packedState: 'framed-face-protected-with-corner-blocks', packedOrientation: 'frame-on-edge', layoutId: 'FIXTURE1', unitWeightLb: 2.5, fragile: true, fixtureIds: ['decor-wall'] }),
  product({ skuId: 'board1', status: 'nonretail', category: 'decor', physical: dimensions(0.58, 0.06, 0.42), packed: dimensions(0.58, 0.10, 0.36), packedState: 'rail-detached-with-corner-blocks', packedOrientation: 'board-on-edge', layoutId: 'FIXTURE1', unitWeightLb: 15, fixtureIds: ['decor-wall'] }),
  product({ skuId: 'light1', status: 'nonretail', category: 'decor', physical: dimensions(0.36, 0.48, 0.36), packed: dimensions(0.36, 0.32, 0.36), packedState: 'stem-detached-shade-in-foam-ring', packedOrientation: 'shade-upright', layoutId: 'FIXTURE1', unitWeightLb: 5.5, fragile: true, fixtureIds: ['decor-ceiling'] }),
  product({ skuId: 'lounge1', status: 'nonretail', category: 'decor', physical: dimensions(2.10, 0.90, 0.85), packed: dimensions(1.18, 0.80, 0.78), packedState: 'flat-packed-frame-cushions-compressed', packedOrientation: 'panels-lengthwise', layoutId: 'FURNITURE1', unitWeightLb: 110, fixtureIds: ['decor-floor'] }),

  // Planned sellable provisions. They are included now so the physical delivery contract lands
  // before catalog/save integration and cannot later fall through to a generic carton.
  product({ skuId: 'water1', status: 'retail', category: 'provisions', physical: dimensions(0.068, 0.218, 0.068), packed: dimensions(0.068, 0.218, 0.068), packedState: 'sealed-pet-bottle-with-tamper-band', packedOrientation: 'upright-labels-out', layoutId: 'DRINK12', unitWeightLb: 1.1, fixtureIds: RETAIL_FIXTURES.drinks }),
  product({ skuId: 'sportdrink2', status: 'retail', category: 'accessories', physical: dimensions(0.072, 0.225, 0.072), packed: dimensions(0.072, 0.225, 0.072), packedState: 'sealed-pet-bottle-with-tamper-band', packedOrientation: 'upright-labels-out', layoutId: 'DRINK12', unitWeightLb: 1.2, fixtureIds: RETAIL_FIXTURES.drinks }),
  product({ skuId: 'soda1', status: 'retail', category: 'accessories', physical: dimensions(0.066, 0.122, 0.066), packed: dimensions(0.066, 0.122, 0.066), packedState: 'sealed-aluminium-can', packedOrientation: 'upright-labels-out', layoutId: 'DRINK12', unitWeightLb: 0.8, fixtureIds: RETAIL_FIXTURES.drinks }),
  product({ skuId: 'chips1', status: 'retail', category: 'accessories', physical: dimensions(0.160, 0.195, 0.0715), packed: dimensions(0.160, 0.195, 0.0715), packedState: 'sealed-retail-snack-pouch', packedOrientation: 'upright-labels-out', layoutId: 'SNACK12', unitWeightLb: 0.15, fixtureIds: RETAIL_FIXTURES.snacks }),
  product({ skuId: 'bar2', status: 'retail', category: 'accessories', physical: dimensions(0.145, 0.055, 0.025), packed: dimensions(0.145, 0.055, 0.025), packedState: 'sealed-retail-bar-wrapper', packedOrientation: 'label-face-up', layoutId: 'SNACK12', unitWeightLb: 0.12, fixtureIds: RETAIL_FIXTURES.snacks }),
  product({ skuId: 'crackers1', status: 'retail', category: 'accessories', physical: dimensions(0.150, 0.180, 0.060), packed: dimensions(0.150, 0.180, 0.060), packedState: 'sealed-retail-snack-pouch', packedOrientation: 'upright-labels-out', layoutId: 'SNACK12', unitWeightLb: 0.18, fixtureIds: RETAIL_FIXTURES.snacks }),
  product({ skuId: 'snack1', status: 'retail', category: 'provisions', physical: dimensions(0.160, 0.195, 0.0715), packed: dimensions(0.160, 0.195, 0.0715), packedState: 'sealed-retail-snack-pouch', packedOrientation: 'upright-labels-out', layoutId: 'SNACK12', unitWeightLb: 0.12, fragile: false, fixtureIds: RETAIL_FIXTURES.snacks }),
];

export const PRODUCT_PACKAGING = deepFreeze(Object.fromEntries(
  PRODUCT_SPECS.map((entry) => [entry.skuId, entry]),
));

export const PLANNED_PACKAGING_SKU_IDS = Object.freeze([]);
export const PRODUCT_PACKAGING_SKU_IDS = Object.freeze(Object.keys(PRODUCT_PACKAGING).sort());

const PRODUCT_BY_ID = new Map(Object.entries(PRODUCT_PACKAGING));

export function hasProductPackaging(skuId) {
  return typeof skuId === 'string' && PRODUCT_BY_ID.has(skuId);
}

export function productPackagingFor(skuId) {
  if (typeof skuId !== 'string' || !PRODUCT_BY_ID.has(skuId)) {
    throw new RangeError(`Unknown product packaging SKU: ${String(skuId)}`);
  }
  return PRODUCT_BY_ID.get(skuId);
}

export function dimensionsFitUnderRotation(itemDimensions, maximumDimensions) {
  assertDimensions(itemDimensions, 'itemDimensions');
  assertDimensions(maximumDimensions, 'maximumDimensions');
  const values = DIMENSION_KEYS.map((key) => itemDimensions[key]);
  const maxima = DIMENSION_KEYS.map((key) => maximumDimensions[key]);
  const permutations = [
    [0, 1, 2], [0, 2, 1],
    [1, 0, 2], [1, 2, 0],
    [2, 0, 1], [2, 1, 0],
  ];
  return permutations.some((order) => order.every((sourceIndex, targetIndex) => (
    values[sourceIndex] <= maxima[targetIndex] + 1e-9
  )));
}

export function validateProductPackagingContract(contract, { knownSkuIds = PRODUCT_PACKAGING_SKU_IDS } = {}) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new TypeError('Product packaging contract must be an object');
  }
  const known = knownSkuIds instanceof Set ? knownSkuIds : new Set(knownSkuIds);
  if (typeof contract.skuId !== 'string' || !known.has(contract.skuId)) {
    throw new RangeError(`Unknown product packaging SKU: ${String(contract.skuId)}`);
  }
  if (!STATUS.has(contract.status) || contract.retail !== (contract.status === 'retail')) {
    throw new TypeError(`${contract.skuId} must declare a consistent retail/nonretail status`);
  }
  if (typeof contract.catalogCategory !== 'string' || !contract.catalogCategory) {
    throw new TypeError(`${contract.skuId} must declare a catalog category`);
  }
  assertDimensions(contract.physicalDimensions, `${contract.skuId}.physicalDimensions`);
  if (!contract.packing || typeof contract.packing !== 'object') {
    throw new TypeError(`${contract.skuId} must declare its packed state`);
  }
  if (typeof contract.packing.state !== 'string' || !contract.packing.state
    || typeof contract.packing.orientation !== 'string' || !contract.packing.orientation) {
    throw new TypeError(`${contract.skuId} packed state and orientation must be explicit`);
  }
  assertDimensions(contract.packing.dimensions, `${contract.skuId}.packing.dimensions`);
  if (contract.packing.allowScale !== false || contract.packing.contentScale !== 1) {
    throw new TypeError(`${contract.skuId} must use authored 1:1 contents with no shrink fallback`);
  }
  if (!Number.isInteger(contract.unitsPerBox) || contract.unitsPerBox < 1) {
    throw new TypeError(`${contract.skuId}.unitsPerBox must be a positive integer`);
  }
  const layoutSpec = PACKAGING_LAYOUTS[contract.layoutId];
  if (!layoutSpec) throw new RangeError(`${contract.skuId} uses unknown layout ${String(contract.layoutId)}`);
  const shell = PACKAGING_SHELLS[layoutSpec.shellId];
  if (!shell) throw new RangeError(`${contract.skuId} uses unknown shell ${String(layoutSpec.shellId)}`);
  if (contract.unitsPerBox !== layoutSpec.capacity) {
    throw new RangeError(`${contract.skuId} quantity ${contract.unitsPerBox} does not match ${layoutSpec.id} capacity ${layoutSpec.capacity}`);
  }
  if (contract.familyId !== shell.familyId || !contract.box || contract.box.shellId !== shell.id
    || contract.box.modelId !== shell.modelId) {
    throw new RangeError(`${contract.skuId} family/layout/shell contract is inconsistent`);
  }
  assertDimensions(contract.box.dimensions, `${contract.skuId}.box.dimensions`);
  assertDimensions(contract.box.innerDimensions, `${contract.skuId}.box.innerDimensions`);
  if (!sameDimensions(contract.box.dimensions, shell.dimensions)
    || !sameDimensions(contract.box.innerDimensions, shell.innerDimensions)) {
    throw new RangeError(`${contract.skuId} box dimensions drifted from shell ${shell.id}`);
  }
  if (!dimensionsFitUnderRotation(layoutSpec.slotMaxDimensions, shell.innerDimensions)) {
    throw new RangeError(`${layoutSpec.id} socket is larger than shell ${shell.id}`);
  }
  if (!dimensionsFitUnderRotation(contract.packing.dimensions, layoutSpec.slotMaxDimensions)) {
    throw new RangeError(`${contract.skuId} packed dimensions do not fit layout ${layoutSpec.id} at 1:1 scale`);
  }
  if (!Number.isFinite(contract.unitWeightLb) || contract.unitWeightLb <= 0
    || typeof contract.fragile !== 'boolean' || typeof contract.longProduct !== 'boolean') {
    throw new TypeError(`${contract.skuId} weight, fragile and long-product flags must be explicit`);
  }
  if (!contract.allowedStocking || contract.allowedStocking.category !== contract.catalogCategory
    || !Array.isArray(contract.allowedStocking.fixtureIds)
    || contract.allowedStocking.fixtureIds.length < 1
    || contract.allowedStocking.fixtureIds.some((id) => typeof id !== 'string' || !id)) {
    throw new TypeError(`${contract.skuId} must declare an allowed stocking category and fixture`);
  }
  const expectedException = contract.skuId === 'umb1'
    ? 'UMBRELLA_LONG6'
    : (contract.skuId === 'irons1' || contract.skuId === 'irons2' ? 'IRON_SET1' : null);
  if (contract.exceptionProfile !== expectedException) {
    throw new RangeError(`${contract.skuId} has an incorrect exception profile`);
  }
  return true;
}

export function validateProductPackagingCatalog(catalog, expectedSkuIds = PRODUCT_PACKAGING_SKU_IDS) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new TypeError('Product packaging catalog must be an object');
  }
  const expected = [...expectedSkuIds].sort();
  const actual = Object.keys(catalog).sort();
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    const missing = expected.filter((id) => !Object.hasOwn(catalog, id));
    const unknown = actual.filter((id) => !expected.includes(id));
    throw new RangeError(`Packaging catalog coverage mismatch (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'})`);
  }
  const known = new Set(expected);
  for (const id of actual) {
    if (catalog[id]?.skuId !== id) throw new RangeError(`Packaging key ${id} does not match its SKU`);
    validateProductPackagingContract(catalog[id], { knownSkuIds: known });
  }
  return true;
}

// Deterministic, quantity-aware bridge for a future delivery migration. Optional criteria let
// the integration prove it is selecting for the product it actually has. A mismatch or over-size
// unit rejects the shipment instead of silently choosing a generic box or shrinking a mesh.
export function planProductPackaging(skuId, quantity, criteria = {}) {
  const contract = productPackagingFor(skuId);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError(`Packaging quantity for ${skuId} must be a positive integer`);
  }
  if (criteria.category != null && criteria.category !== contract.catalogCategory) {
    throw new RangeError(`${skuId} category does not match its packaging contract`);
  }
  if (criteria.fragile != null && criteria.fragile !== contract.fragile) {
    throw new RangeError(`${skuId} fragility does not match its packaging contract`);
  }
  if (criteria.longProduct != null && criteria.longProduct !== contract.longProduct) {
    throw new RangeError(`${skuId} long-product flag does not match its packaging contract`);
  }
  if (criteria.unitWeightLb != null && criteria.unitWeightLb !== contract.unitWeightLb) {
    throw new RangeError(`${skuId} unit weight does not match its packaging contract`);
  }
  const packedDimensions = criteria.packedDimensions || contract.packing.dimensions;
  const layoutSpec = PACKAGING_LAYOUTS[contract.layoutId];
  if (!dimensionsFitUnderRotation(packedDimensions, layoutSpec.slotMaxDimensions)) {
    throw new RangeError(`${skuId} packed dimensions do not fit ${layoutSpec.id}; shrink fallback is forbidden`);
  }
  const boxes = [];
  let remaining = quantity;
  while (remaining > 0) {
    const units = Math.min(contract.unitsPerBox, remaining);
    remaining -= units;
    boxes.push({
      units,
      familyId: contract.familyId,
      layoutId: contract.layoutId,
      shellId: contract.box.shellId,
      modelId: contract.box.modelId,
      dimensions: contract.box.dimensions,
      weightLb: roundTenth(contract.box.tareWeightLb + contract.unitWeightLb * units),
      fragile: contract.fragile,
      longProduct: contract.longProduct,
      contentScale: 1,
    });
  }
  return deepFreeze({
    skuId,
    quantity,
    unitsPerBox: contract.unitsPerBox,
    boxCount: boxes.length,
    boxes,
  });
}

// Fail fast during module evaluation if an authored entry drifts from the schema.
validateProductPackagingCatalog(PRODUCT_PACKAGING);
