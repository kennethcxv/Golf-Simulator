// PINEHOLLOW PRO-SHOP FURNITURE LIBRARY
//
// This is the single runtime contract shared by the supplier catalog, property
// inventory, placement validation, GLB renderer, and Blender build script. The
// five levels are separate authored models: dimensions, capacity, construction,
// and detail all increase instead of applying a color-only upgrade.

export const PRO_SHOP_FURNITURE_METERS_TO_YARDS = 1.0936133;

const deepFreeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
};

export const PRO_SHOP_FURNITURE_TIERS = deepFreeze([
  { id: 'basic', label: 'Basic', level: 1, size: 0.86, widthScale: 0.86, heightScale: 0.94, depthScale: 0.88, price: 1.0, supplierTier: 1, style: 'utility laminate with exposed powder-coated steel' },
  { id: 'standard', label: 'Standard', level: 2, size: 1.0, widthScale: 1.0, heightScale: 1.0, depthScale: 1.0, price: 1.8, supplierTier: 1, style: 'framed oak laminate with charcoal hardware and added storage' },
  { id: 'premium', label: 'Premium', level: 3, size: 1.14, widthScale: 1.14, heightScale: 1.035, depthScale: 1.10, price: 3.25, supplierTier: 2, style: 'substantial solid oak, sage panels, and walnut joinery' },
  { id: 'luxury', label: 'Luxury', level: 4, size: 1.28, widthScale: 1.28, heightScale: 1.07, depthScale: 1.20, price: 5.75, supplierTier: 3, style: 'paneled walnut, architectural glass, integrated lighting, and brass' },
  { id: 'executive', label: 'Executive', level: 5, size: 1.44, widthScale: 1.44, heightScale: 1.10, depthScale: 1.30, price: 9.5, supplierTier: 3, style: 'custom country-club millwork with leather, fluting, and museum-grade detailing' },
]);

// The desk references use their own player-facing progression.  The wider
// furniture library keeps its historical runtime tier ids for save/catalog
// compatibility, while these records bind those ids to the five authored desk
// names and exact metre dimensions produced by build_desks.py.
export const OFFICE_DESK_TIER_SPECS = deepFreeze({
  basic: {
    assetName: 'Desk_Basic', label: 'Basic', dimensionsM: [1.32, 0.76, 0.68],
    style: 'warm-cream laminate, charcoal steel legs, and a practical two-drawer pedestal',
  },
  standard: {
    assetName: 'Desk_Standard', label: 'Standard', dimensionsM: [1.52, 0.76, 0.72],
    style: 'natural-oak laminate, twin storage pedestals, and satin-steel pulls',
  },
  premium: {
    assetName: 'Desk_Premium', label: 'Premium', dimensionsM: [1.64, 0.78, 0.78],
    style: 'substantial warm oak, paneled storage cabinets, and restrained brass hardware',
  },
  luxury: {
    assetName: 'Desk_HighEnd', label: 'High-End', dimensionsM: [1.74, 0.79, 0.82],
    style: 'deep walnut, raised architectural panels, and refined brass hardware',
  },
  executive: {
    assetName: 'Desk_Luxury', label: 'Luxury', dimensionsM: [1.92, 0.81, 0.90],
    style: 'hand-finished walnut, leather writing insets, fluting, and restrained brass detailing',
  },
});

// The chair references use the player-facing Basic/Standard/Premium/High-End/
// Luxury progression. Preserve the library's historical Luxury/Executive ids
// while binding them to the separately authored chair assets and exact metre
// dimensions produced by build_chairs.py.
export const CHAIR_TIER_SPECS = deepFreeze({
  basic: {
    assetTierId: 'basic', assetName: 'Chair_Basic', modelFile: 'basic', label: 'Basic',
    dimensionsM: [0.63, 1.04, 0.68], chairKind: 'office', seatHeightM: 0.485,
    heightTravelM: 0.09, reclineDegrees: 0, swivels: true, casters: true,
    style: 'black faux-leather task upholstery, molded-charcoal arms, five casters, and a gas lift',
  },
  standard: {
    assetTierId: 'standard', assetName: 'Chair_Standard', modelFile: 'standard', label: 'Standard',
    dimensionsM: [0.68, 1.12, 0.73], chairKind: 'office', seatHeightM: 0.495,
    heightTravelM: 0.11, reclineDegrees: 12, swivels: true, casters: true,
    style: 'segmented black leather, a padded nine-panel back, adjustable recline, and five casters',
  },
  premium: {
    assetTierId: 'premium', assetName: 'Chair_Premium', modelFile: 'premium', label: 'Premium',
    dimensionsM: [0.78, 1.19, 0.82], chairKind: 'office', seatHeightM: 0.505,
    heightTravelM: 0.12, reclineDegrees: 18, swivels: true, casters: true,
    style: 'warm-brown executive leather, broad padded arms, bronze accents, adjustable recline, and five casters',
  },
  luxury: {
    assetTierId: 'high-end', assetName: 'Chair_HighEnd', modelFile: 'high-end', label: 'High-End',
    dimensionsM: [1.05, 0.92, 0.99], chairKind: 'lounge', seatHeightM: 0.445,
    heightTravelM: 0, reclineDegrees: 0, swivels: false, casters: false,
    style: 'brown tufted club upholstery, rolled arms, piped scroll faces, and turned walnut feet',
  },
  executive: {
    assetTierId: 'luxury', assetName: 'Chair_Luxury', modelFile: 'luxury', label: 'Luxury',
    dimensionsM: [1.20, 0.97, 1.08], chairKind: 'lounge', seatHeightM: 0.45,
    heightTravelM: 0, reclineDegrees: 0, swivels: false, casters: false,
    style: 'deep Chesterfield-inspired leather, dense diamond tufting, rolled arms, and walnut feet',
  },
});

// The clothing-rack references also use a five-name progression that predates
// the library's historical Luxury/Executive runtime ids.  Preserve those ids
// for existing saves while binding them to the exact authored rack, dimensions,
// and stocking/lighting contract exported by build_clothing_racks.py.
export const CLOTHING_RACK_TIER_SPECS = deepFreeze({
  basic: {
    assetTierId: 'basic', assetName: 'ClothingRack_Basic', modelFile: 'basic', label: 'Basic',
    dimensionsM: [1.55, 1.76, 0.56], hangZones: 1, shelfZones: 0, lightNodes: 0,
    style: 'matte charcoal tubular steel, a stable rectangular base, and four detailed casters',
  },
  standard: {
    assetTierId: 'standard', assetName: 'ClothingRack_Standard', modelFile: 'standard', label: 'Standard',
    dimensionsM: [1.62, 1.80, 0.62], hangZones: 1, shelfZones: 1, lightNodes: 0,
    style: 'industrial dark pipework, four casters, and a supported natural-oak merchandise deck',
  },
  premium: {
    assetTierId: 'premium', assetName: 'ClothingRack_Premium', modelFile: 'premium', label: 'Premium',
    dimensionsM: [1.86, 2.08, 0.58], hangZones: 1, shelfZones: 4, lightNodes: 0,
    style: 'substantial squared charcoal steel, a full base shelf, a three-level oak tower, and adjustable feet',
  },
  luxury: {
    assetTierId: 'high-end', assetName: 'ClothingRack_HighEnd', modelFile: 'high-end', label: 'High-End',
    dimensionsM: [2.88, 2.28, 0.62], hangZones: 3, shelfZones: 9, lightNodes: 3,
    style: 'three-bay walnut millwork, dark hanging rods, display shelving, molding, and integrated puck lights',
  },
  executive: {
    assetTierId: 'luxury', assetName: 'ClothingRack_Luxury', modelFile: 'luxury', label: 'Luxury',
    dimensionsM: [3.18, 2.38, 0.68], hangZones: 3, shelfZones: 12, lightNodes: 6,
    style: 'dark-walnut boutique millwork, divided cubbies, restrained brass, cove lighting, and puck lights',
  },
});

// Reference-matched retail shelving. Historical runtime tier ids remain
// stable for saves while Luxury/Executive map to the authored High-End/Luxury
// names used by the player-facing progression.
export const RETAIL_SHELF_TIER_SPECS = deepFreeze({
  basic: {
    assetTierId: 'basic', assetName: 'Shelf_Basic', modelFile: 'shelf_basic', label: 'Basic',
    dimensionsM: [1.15, 1.42, 0.47], shelfZones: 3, zoneCapacity: 8, shelfCapacity: 24,
    cabinetDoors: 0, storageZones: 0, storageZoneCapacity: 0, lightNodes: 0, price: 520,
    wallSnap: { enabled: false, anchorDepthM: 0.235, thresholdM: 0 },
    style: 'utility-grade dark wire decks, tubular posts, shelf collars, truss rails, and leveling feet',
  },
  standard: {
    assetTierId: 'standard', assetName: 'Shelf_Standard', modelFile: 'shelf_standard', label: 'Standard',
    dimensionsM: [1.28, 1.55, 0.48], shelfZones: 3, zoneCapacity: 10, shelfCapacity: 30,
    cabinetDoors: 0, storageZones: 0, storageZoneCapacity: 0, lightNodes: 0, price: 940,
    wallSnap: { enabled: false, anchorDepthM: 0.24, thresholdM: 0 },
    style: 'slotted charcoal commercial uprights, supported composite decks, cross braces, and adjustable feet',
  },
  premium: {
    assetTierId: 'premium', assetName: 'Shelf_Premium', modelFile: 'shelf_premium', label: 'Premium',
    dimensionsM: [1.50, 1.45, 0.52], shelfZones: 3, zoneCapacity: 12, shelfCapacity: 36,
    cabinetDoors: 0, storageZones: 0, storageZoneCapacity: 0, lightNodes: 0, price: 1760,
    wallSnap: { enabled: false, anchorDepthM: 0.26, thresholdM: 0 },
    style: 'broad warm-walnut decks, fabricated charcoal frame, refined brackets, and visible fasteners',
  },
  luxury: {
    assetTierId: 'high-end', assetName: 'Shelf_HighEnd', modelFile: 'shelf_high_end', label: 'High-End',
    dimensionsM: [3.10, 2.40, 0.60], shelfZones: 15, zoneCapacity: 6, shelfCapacity: 90,
    cabinetDoors: 6, storageZones: 6, storageZoneCapacity: 6, lightNodes: 3, price: 6400,
    wallSnap: { enabled: true, anchorDepthM: 0.286, surfaceOffsetM: 0.479, thresholdM: 0.80 },
    style: 'three-bay custom walnut millwork, paneled cabinets, crown and base molding, and warm recessed lighting',
  },
  executive: {
    assetTierId: 'luxury', assetName: 'Shelf_Luxury', modelFile: 'shelf_luxury', label: 'Luxury',
    dimensionsM: [3.75, 2.55, 0.65], shelfZones: 15, zoneCapacity: 8, shelfCapacity: 120,
    cabinetDoors: 6, storageZones: 6, storageZoneCapacity: 6, lightNodes: 15, price: 11800,
    wallSnap: { enabled: true, anchorDepthM: 0.307, surfaceOffsetM: 0.479, thresholdM: 0.80 },
    style: 'dark-mahogany resort millwork, layered molding, brass reveals, premium doors, and shelf-integrated lighting',
  },
});

// Dimensions are believable nominal Standard-tier metres: width, height, depth.
// Wall Y is the bottom height used by the runtime wall-mounted GLB wrapper.
const CATEGORY_ROWS = [
  ['checkout-counters', 'Checkout Counter', [2.40, 1.00, 0.82], 'floor', 1250, 150, true, 0],
  ['office-desks', 'Office Desk', [1.65, 0.78, 0.78], 'floor', 620, 78, true, 0],
  ['chairs', 'Chair', [0.68, 1.12, 0.73], 'floor', 320, 45, true, 0],
  ['tables', 'Merchandising Table', [1.65, 0.94, 0.92], 'floor', 440, 64, true, 0],
  ['coffee-tables', 'Coffee Table', [1.15, 0.47, 0.68], 'floor', 280, 38, true, 0],
  ['benches', 'Clubhouse Bench', [1.65, 0.92, 0.62], 'floor', 390, 58, true, 0],
  ['office-cabinets', 'Office Cabinet', [1.15, 1.95, 0.48], 'floor', 720, 92, true, 0],
  ['wall-cabinets', 'Wall Cabinet', [1.25, 0.92, 0.34], 'wall', 540, 50, false, 1.20],
  ['storage-cabinets', 'Storage Cabinet', [1.25, 2.05, 0.58], 'floor', 760, 118, true, 0],
  ['golf-bag-displays', 'Golf Bag Display', [1.45, 1.48, 0.78], 'floor', 590, 70, true, 0],
  ['hat-displays', 'Hat Display', [1.20, 1.88, 0.58], 'floor', 510, 54, true, 0],
  ['shirt-displays', 'Shirt Display', [1.55, 2.02, 0.62], 'floor', 650, 66, true, 0],
  ['clothing-racks', 'Clothing Rack', [1.62, 1.80, 0.62], 'floor', 480, 64, true, 0],
  ['glass-showcases', 'Glass Showcase', [1.48, 1.92, 0.56], 'floor', 980, 112, true, 0],
  ['jewelry-cases', 'Jewelry Case', [1.35, 1.02, 0.62], 'floor', 860, 88, true, 0],
  ['display-islands', 'Display Island', [1.75, 1.32, 1.18], 'floor', 790, 105, true, 0],
  ['freestanding-shelving', 'Freestanding Shelving', [1.55, 2.02, 0.58], 'floor', 520, 82, true, 0],
  ['wall-shelving', 'Wall Shelving', [1.55, 1.72, 0.34], 'wall', 470, 48, false, 0.72],
  ['pegboard-walls', 'Pegboard Wall', [1.48, 1.78, 0.16], 'wall', 360, 34, false, 0.78],
  ['checkout-islands', 'Checkout Island', [2.05, 1.00, 1.12], 'floor', 1180, 142, true, 0],
  ['waiting-area-furniture', 'Waiting Area Suite', [2.35, 0.98, 1.05], 'floor', 840, 126, true, 0],
  ['locker-units', 'Locker Unit', [1.42, 2.08, 0.52], 'floor', 690, 108, true, 0],
  ['fitting-rooms', 'Fitting Room', [1.45, 2.30, 1.45], 'floor', 1120, 138, true, 0],
  ['mirrors', 'Clubhouse Mirror', [1.08, 1.82, 0.10], 'wall', 310, 26, false, 0.62],
  ['reception-desks', 'Reception Desk', [2.55, 1.12, 0.92], 'floor', 1460, 172, true, 0],
];

export const PRO_SHOP_FURNITURE_CATEGORIES = deepFreeze(CATEGORY_ROWS.map((row) => ({
  id: row[0], label: row[1], dimensionsM: row[2], mount: row[3], basePrice: row[4],
  baseWeightLb: row[5], blocksMovement: row[6], wallBottomM: row[7],
})));

const round = (value, places = 3) => {
  const power = 10 ** places;
  return Math.round(value * power) / power;
};

const furnitureId = (category, tier) => `pro-shop-furniture:${category.id}:${tier.id}`;
const skuId = (category, tier) => `furn-${category.id}-${tier.id}`;
const authoredTierSpec = (category, tier) => {
  if (category.id === 'office-desks') return OFFICE_DESK_TIER_SPECS[tier.id];
  if (category.id === 'chairs') return CHAIR_TIER_SPECS[tier.id];
  if (category.id === 'clothing-racks') return CLOTHING_RACK_TIER_SPECS[tier.id];
  if (category.id === 'freestanding-shelving') return RETAIL_SHELF_TIER_SPECS[tier.id];
  return null;
};

const modelPath = (category, tier) => {
  const chairSpec = category.id === 'chairs' ? CHAIR_TIER_SPECS[tier.id] : null;
  const rackSpec = category.id === 'clothing-racks' ? CLOTHING_RACK_TIER_SPECS[tier.id] : null;
  const shelfSpec = category.id === 'freestanding-shelving' ? RETAIL_SHELF_TIER_SPECS[tier.id] : null;
  return chairSpec
    ? `vendor/models/pro_shop_furniture/chairs/${chairSpec.modelFile}.glb`
    : rackSpec
    ? `vendor/models/pro_shop_furniture/clothing-racks/${rackSpec.modelFile}.glb`
    : shelfSpec
      ? `vendor/models/pro_shop_furniture/retail-shelving/${shelfSpec.modelFile}.glb`
    : `vendor/models/pro_shop_furniture/${category.id}/${tier.id}.glb`;
};

const authoredLodModelPaths = (category, tier) => (
  category.id === 'office-desks'
    ? [
      `vendor/models/pro_shop_furniture/office-desks/${tier.id}.glb`,
      `vendor/models/pro_shop_furniture/office-desks/${tier.id}_lod1.glb`,
      `vendor/models/pro_shop_furniture/office-desks/${tier.id}_lod2.glb`,
    ]
    : null
);

function dimensionsFor(category, tier) {
  const authoredSpec = authoredTierSpec(category, tier);
  if (authoredSpec) return [...authoredSpec.dimensionsM];
  return [
    round(category.dimensionsM[0] * tier.widthScale),
    round(category.dimensionsM[1] * tier.heightScale),
    round(category.dimensionsM[2] * tier.depthScale),
  ];
}

function placementProfile(category, tier) {
  const [widthM, heightM, depthM] = dimensionsFor(category, tier);
  return deepFreeze({
    mount: category.mount,
    width: round(widthM * PRO_SHOP_FURNITURE_METERS_TO_YARDS),
    depth: round(depthM * PRO_SHOP_FURNITURE_METERS_TO_YARDS),
    height: round(heightM * PRO_SHOP_FURNITURE_METERS_TO_YARDS),
    offsetX: 0,
    offsetZ: category.mount === 'wall' ? round(depthM * PRO_SHOP_FURNITURE_METERS_TO_YARDS / 2) : 0,
    blocksMovement: category.blocksMovement,
    rotationStep: category.mount === 'wall' ? 0 : Math.PI / 12,
  });
}

export const PRO_SHOP_FURNITURE_SKUS = deepFreeze(PRO_SHOP_FURNITURE_CATEGORIES.flatMap((category) => (
  PRO_SHOP_FURNITURE_TIERS.map((tier) => {
    const dims = dimensionsFor(category, tier);
    const authoredSpec = authoredTierSpec(category, tier);
    const tierLabel = authoredSpec?.label || tier.label;
    const tierStyle = authoredSpec?.style || tier.style;
    const price = authoredSpec?.price || Math.round(category.basePrice * tier.price);
    return {
      id: skuId(category, tier),
      cat: 'decor',
      tier: tier.supplierTier,
      furnitureTier: tier.level,
      furnitureTierId: tier.id,
      authoredTierId: authoredSpec?.assetTierId || tier.id,
      authoredAssetName: authoredSpec?.assetName || null,
      furnitureCategory: category.id,
      name: `${tierLabel} ${category.label}`,
      brand: 'PINEHOLLOW CONTRACT',
      description: `${tierLabel} ${category.label.toLowerCase()} in ${tierStyle}.`,
      cost: price,
      msrp: 0,
      finish: tier.level,
      lb: Math.max(8, Math.round(category.baseWeightLb * tier.size * tier.size)),
      fragile: ['glass-showcases', 'jewelry-cases', 'mirrors'].includes(category.id),
      placeableAssetId: furnitureId(category, tier),
      modelPath: modelPath(category, tier),
      authoredLodModelPaths: authoredLodModelPaths(category, tier),
      modelScale: PRO_SHOP_FURNITURE_METERS_TO_YARDS,
      mountYOffset: round(category.wallBottomM * PRO_SHOP_FURNITURE_METERS_TO_YARDS),
      dimensionsM: dims,
      functionalProfile: category.id === 'clothing-racks' ? {
        hangZones: authoredSpec.hangZones,
        shelfZones: authoredSpec.shelfZones,
        lightNodes: authoredSpec.lightNodes,
        interactionNode: 'INTERACTION_POINT',
        placementNode: 'PLACEMENT_FOOTPRINT',
      } : category.id === 'freestanding-shelving' ? {
        shelfZones: authoredSpec.shelfZones,
        zoneCapacity: authoredSpec.zoneCapacity,
        shelfCapacity: authoredSpec.shelfCapacity,
        cabinetDoors: authoredSpec.cabinetDoors,
        storageZones: authoredSpec.storageZones,
        storageZoneCapacity: authoredSpec.storageZoneCapacity,
        storageCapacity: authoredSpec.storageZones * authoredSpec.storageZoneCapacity,
        lightNodes: authoredSpec.lightNodes,
        interactionNode: 'INTERACTION_POINT',
        placementNode: 'PLACEMENT_FOOTPRINT',
        wallSnapNode: 'WALL_SNAP_ANCHOR',
        lightControlNode: authoredSpec.lightNodes > 0 ? 'INTERACT_ShelfLights' : null,
      } : category.id === 'chairs' ? {
        chairKind: authoredSpec.chairKind,
        seatHeightM: authoredSpec.seatHeightM,
        heightTravelM: authoredSpec.heightTravelM,
        reclineDegrees: authoredSpec.reclineDegrees,
        swivels: authoredSpec.swivels,
        casters: authoredSpec.casters,
        seatNode: 'SEAT_ANCHOR',
        sitInteractionNode: 'SIT_INTERACTION_POINT',
        footNodes: ['FOOT_ANCHOR_LEFT', 'FOOT_ANCHOR_RIGHT'],
        handNodes: ['HAND_ANCHOR_LEFT', 'HAND_ANCHOR_RIGHT'],
        entryNodes: ['ENTRY_POINT_LEFT', 'ENTRY_POINT_RIGHT'],
        exitNodes: ['EXIT_POINT_LEFT', 'EXIT_POINT_RIGHT'],
        placementNode: 'PLACEMENT_FOOTPRINT',
        deskAlignmentNode: authoredSpec.chairKind === 'office' ? 'DESK_ALIGNMENT_ANCHOR' : null,
      } : null,
      lightingProfile: category.id === 'freestanding-shelving' && authoredSpec.lightNodes > 0 ? {
        fixtureKind: 'retail-display-wall',
        defaultOn: true,
        runtimeLights: 3,
        adjustableHeads: 0,
        lightIntensityScale: 1,
        emissiveScale: 1,
      } : null,
      wallSnap: category.id === 'freestanding-shelving' ? {
        enabled: authoredSpec.wallSnap.enabled,
        anchorDepth: round(authoredSpec.wallSnap.anchorDepthM * PRO_SHOP_FURNITURE_METERS_TO_YARDS),
        surfaceOffset: round((authoredSpec.wallSnap.surfaceOffsetM || 0)
          * PRO_SHOP_FURNITURE_METERS_TO_YARDS),
        threshold: round(authoredSpec.wallSnap.thresholdM * PRO_SHOP_FURNITURE_METERS_TO_YARDS),
      } : null,
      authoredLodDistancesM: ['chairs', 'clothing-racks', 'office-desks', 'freestanding-shelving'].includes(category.id)
        ? [0, 8, 18] : null,
      placeableProfile: placementProfile(category, tier),
      geometryProfile: authoredSpec
        ? `${category.id}:${authoredSpec.assetName}:${dims.join('x')}:detail-${tier.level}`
        : `${category.id}:tier-${tier.level}:scale-${tier.widthScale}x${tier.heightScale}x${tier.depthScale}:detail-${tier.level}`,
    };
  })
)));

function surfaceRules(category) {
  return {
    allowed: [category.mount],
    floor: { maxSlopeDeg: 6 },
    wall: {
      minHeight: 0.35, maxHeight: 3.45, interior: true, exterior: false,
      allowGlass: false, allowDoors: false, gap: 0.018,
    },
    counter: { authoredSocketsPreferred: true },
    shelf: { authoredSlotsOnly: true },
    ceiling: { minHeight: 3.0, maxHeight: 3.6 },
  };
}

export const PRO_SHOP_FURNITURE_PLACEABLES = deepFreeze(PRO_SHOP_FURNITURE_SKUS.map((sku) => {
  const category = PRO_SHOP_FURNITURE_CATEGORIES.find((entry) => entry.id === sku.furnitureCategory);
  const profile = sku.placeableProfile;
  return {
    id: sku.placeableAssetId,
    assetId: sku.placeableAssetId,
    assetNumber: null,
    label: sku.name,
    placementCategory: category.id,
    source: 'pinehollow-procedural-blender-library',
    render: {
      kind: 'glb', path: sku.modelPath, scale: sku.modelScale, mountSocket: 'SOCKET_PLACEMENT',
      authoredRoot: sku.authoredAssetName,
      lodDistancesM: sku.authoredLodDistancesM,
    },
    surfaceRules: surfaceRules(category),
    rotation: {
      increment: profile.rotationStep, free: category.mount !== 'wall', snapDefault: true,
    },
    snapPoints: ['SOCKET_PLACEMENT'],
    bounds: {
      type: 'box', width: profile.width, height: profile.height, depth: profile.depth,
      volumes: [{ x: profile.offsetX, z: profile.offsetZ, width: profile.width, depth: profile.depth }],
    },
    collision: {
      mode: 'analytic', blocksPlayer: category.blocksMovement, blocksCustomers: category.blocksMovement,
    },
    wallSnap: sku.wallSnap,
    requiredClearance: 0.05,
    navigationClearance: category.blocksMovement ? 0.34 : 0,
    doorClearance: 0.16,
    interactionClearance: 0.42,
    purchasePrice: sku.cost,
    sellValue: Math.round(sku.cost * 0.6),
    storageBehavior: 'allowed',
    requiredObject: false,
    placementRestrictions: ['preserve-customer-routes', 'preserve-checkout-access'],
    variants: [sku.furnitureTierId],
    defaultVariant: sku.furnitureTierId,
    defaultState: 'sold',
    defaultTransform: {
      x: 0, y: 0, z: 0, ry: 0, surface: category.mount, attachment: null, room: 'storage',
    },
  };
}));

export const PRO_SHOP_FURNITURE_PIECE_COUNT = PRO_SHOP_FURNITURE_SKUS.length;
