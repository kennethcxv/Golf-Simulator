// PRO-SHOP EQUIPMENT CATALOG
//
// The five levels come directly from Designs/ClubHouse: Basic, Standard,
// Premium, High-End, Luxury. In game language they describe the course that
// would realistically own the equipment, from a failing municipal operation to
// a destination country club. Geometry, capacity and fixtures change at every
// level; these are not colour variants.

export const EQUIPMENT_QUALITY_TIERS = Object.freeze([
  Object.freeze({ id: 'municipal', level: 1, name: 'Municipal', referenceLabel: 'Basic', costMultiplier: 1, prestigeRequired: 0 }),
  Object.freeze({ id: 'public', level: 2, name: 'Public Course', referenceLabel: 'Standard', costMultiplier: 1.8, prestigeRequired: 8 }),
  Object.freeze({ id: 'premium', level: 3, name: 'Premium', referenceLabel: 'Premium', costMultiplier: 3.4, prestigeRequired: 22 }),
  Object.freeze({ id: 'high_end', level: 4, name: 'High-End', referenceLabel: 'High-End', costMultiplier: 6.2, prestigeRequired: 42 }),
  Object.freeze({ id: 'country_club', level: 5, name: 'Country Club', referenceLabel: 'Luxury', costMultiplier: 11, prestigeRequired: 68 }),
]);

const D = (w, d, h) => Object.freeze({ w, d, h });

const FAMILY_SPECS = [
  ['golf_cart', 'Golf carts', 'outdoor', 4500,
    [D(2.40, 1.20, 1.78), D(2.45, 1.22, 1.82), D(2.72, 1.25, 1.88), D(2.76, 1.28, 1.92), D(3.35, 1.32, 1.95)],
    ['2-seat manual municipal cart', '2-seat cart with canopy and bag well', '4-seat cart with windshield and upgraded seats', '4-seat lithium cart with enclosed storage', '6-seat enclosed country-club shuttle']],
  ['push_cart', 'Push carts', 'outdoor', 95,
    [D(1.18, 0.66, 1.05), D(1.22, 0.69, 1.08), D(1.28, 0.72, 1.10), D(1.30, 0.74, 1.12), D(1.34, 0.76, 1.14)],
    ['two-wheel painted-steel frame', 'three-wheel folding frame', 'four-wheel frame with scorecard tray', 'braked aluminum frame with storage console', 'carbon-look concierge cart with brass details']],
  ['utility_cart', 'Utility carts', 'outdoor', 5200,
    [D(2.55, 1.26, 1.76), D(2.62, 1.28, 1.80), D(2.72, 1.32, 1.84), D(2.82, 1.35, 1.88), D(2.92, 1.38, 1.92)],
    ['open two-seat flatbed', 'canopy and drop-side bed', 'windshield and lockable toolbox', 'lithium power with enclosed cab', 'quiet country-club service vehicle with finished cargo box']],
  ['maintenance_cart', 'Maintenance carts', 'outdoor', 6800,
    [D(2.62, 1.30, 1.82), D(2.70, 1.34, 1.86), D(2.80, 1.38, 1.90), D(2.90, 1.40, 1.94), D(3.00, 1.44, 1.98)],
    ['steel work bed and hand-tool rack', 'canopy, side rails and hose reel', 'enclosed tool cabinets and beacon', 'weather cab with powered lift bed', 'quiet fleet unit with integrated wash-down system']],
  ['ball_washer', 'Ball washers', 'course', 180,
    [D(0.34, 0.28, 1.16), D(0.36, 0.30, 1.20), D(0.40, 0.32, 1.24), D(0.43, 0.34, 1.27), D(0.46, 0.36, 1.31)],
    ['single manual drum on painted post', 'powder-coated drum with towel ring', 'dual ball-and-club station', 'cast housing with waste bin and signage', 'walnut-and-brass four-station amenity']],
  ['club_cleaner', 'Club cleaners', 'course', 240,
    [D(0.42, 0.36, 0.98), D(0.45, 0.38, 1.02), D(0.48, 0.40, 1.06), D(0.52, 0.43, 1.10), D(0.56, 0.46, 1.14)],
    ['bucket and fixed brush', 'covered manual brush station', 'dual brush with drip tray', 'powered enclosed cleaner', 'brass-trimmed concierge wash station']],
  ['bag_stand', 'Bag stands', 'indoor', 160,
    [D(0.58, 0.48, 0.70), D(0.62, 0.50, 0.74), D(0.68, 0.54, 0.78), D(0.72, 0.58, 0.82), D(0.78, 0.62, 0.88)],
    ['painted tubular single-bag stand', 'powder-coated two-bag stand', 'oak rail with padded rests', 'walnut valet stand with shelf', 'brass-trimmed four-bag arrival stand']],
  ['range_basket', 'Range baskets', 'practice', 28,
    [D(0.34, 0.34, 0.26), D(0.36, 0.36, 0.28), D(0.38, 0.38, 0.30), D(0.40, 0.40, 0.32), D(0.42, 0.42, 0.34)],
    ['galvanized wire basket', 'coated-steel basket with handle grip', 'molded stackable basket', 'reinforced basket with ball-count plaque', 'woven-look brass-accent range basket']],
  ['scorecard_holder', 'Scorecard holders', 'indoor', 35,
    [D(0.28, 0.20, 0.25), D(0.30, 0.22, 0.27), D(0.33, 0.23, 0.29), D(0.35, 0.25, 0.31), D(0.38, 0.27, 0.34)],
    ['bent sheet-metal pocket', 'powder-coated four-slot holder', 'oak stepped organizer', 'walnut organizer with pencil cup', 'brass-inlaid concierge scorecard cabinet']],
  ['practice_basket', 'Practice baskets', 'practice', 90,
    [D(0.48, 0.48, 0.62), D(0.52, 0.52, 0.68), D(0.56, 0.56, 0.74), D(0.60, 0.60, 0.80), D(0.66, 0.66, 0.88)],
    ['wire chipping basket', 'coated target basket with flag', 'folding basket with two target rings', 'weighted premium target with collection tray', 'brass-ringed academy target and crest flag']],
  ['water_cooler', 'Water coolers', 'course', 140,
    [D(0.46, 0.46, 1.18), D(0.48, 0.48, 1.24), D(0.52, 0.52, 1.30), D(0.56, 0.56, 1.36), D(0.62, 0.62, 1.44)],
    ['insulated jug on steel stand', 'covered cooler with cup dispenser', 'cabinet cooler with drain tray', 'refrigerated refill station', 'stone-base filtered hydration station']],
  ['trash_can', 'Trash cans', 'course', 120,
    [D(0.48, 0.48, 0.76), D(0.52, 0.52, 0.82), D(0.56, 0.56, 0.88), D(0.60, 0.60, 0.96), D(0.66, 0.66, 1.06)],
    ['open galvanized bin', 'lidded powder-coated can', 'slatted oak receptacle', 'walnut dual-stream receptacle', 'stone-and-brass waste/recycling station']],
  ['bench', 'Benches', 'course', 180,
    [D(1.55, 0.52, 0.82), D(1.65, 0.56, 0.86), D(1.75, 0.60, 0.90), D(1.86, 0.64, 0.94), D(2.00, 0.68, 0.98)],
    ['painted steel slat bench', 'treated timber course bench', 'oak bench with back and arms', 'walnut memorial bench', 'curved country-club bench with brass plaque']],
  ['bag_drop_station', 'Bag drop stations', 'outdoor', 1800,
    [D(1.50, 0.72, 1.25), D(1.70, 0.78, 1.55), D(1.92, 0.84, 1.95), D(2.12, 0.90, 2.15), D(2.35, 0.98, 2.32)],
    ['portable bag rack and sign', 'covered two-bay drop rack', 'oak valet counter with canopy', 'walnut four-bay concierge station', 'country-club porte-cochere valet kiosk']],
  ['golf_club_storage', 'Golf club storage', 'indoor', 420,
    [D(1.35, 0.48, 1.85), D(1.50, 0.52, 1.94), D(1.68, 0.56, 2.02), D(1.88, 0.60, 2.10), D(2.10, 0.66, 2.18)],
    ['open steel club rack', 'slotted powder-coated rack', 'oak rack with head dividers', 'walnut locking club cabinet', 'lit country-club club wall with brass rails']],
  ['rental_club_storage', 'Rental club storage', 'indoor', 650,
    [D(1.50, 0.58, 1.82), D(1.68, 0.62, 1.92), D(1.88, 0.66, 2.02), D(2.10, 0.70, 2.12), D(2.35, 0.76, 2.22)],
    ['numbered open rental rack', 'rolling rack with bag bays', 'oak issue station with cubbies', 'walnut locking fleet cabinet', 'lit concierge rental wall with service counter']],
  ['display_tv', 'Display TVs', 'indoor', 420,
    [D(0.82, 0.10, 0.52), D(1.05, 0.10, 0.64), D(1.28, 0.09, 0.76), D(1.58, 0.08, 0.92), D(1.88, 0.08, 1.08)],
    ['small wall display with thick bezel', 'commercial score display', 'thin 4K leaderboard display', 'large multi-input hospitality display', 'framed country-club presentation display']],
  ['pos_terminal', 'POS terminals', 'checkout', 520,
    [D(0.30, 0.23, 0.31), D(0.34, 0.24, 0.34), D(0.38, 0.25, 0.37), D(0.41, 0.26, 0.39), D(0.45, 0.28, 0.42)],
    ['compact button till display', 'touch POS on weighted stand', 'dual-hinge widescreen POS', 'all-in-one hospitality terminal', 'walnut-and-brass concierge POS']],
  ['card_reader', 'Card readers', 'checkout', 120,
    [D(0.084, 0.14, 0.17), D(0.090, 0.15, 0.18), D(0.096, 0.16, 0.19), D(0.104, 0.17, 0.20), D(0.112, 0.18, 0.22)],
    ['magstripe keypad reader', 'chip-and-swipe countertop reader', 'touch reader with contactless target', 'wireless hospitality reader', 'brass-detailed country-club payment reader']],
  ['receipt_printer', 'Receipt printers', 'checkout', 210,
    [D(0.15, 0.18, 0.12), D(0.17, 0.19, 0.13), D(0.18, 0.20, 0.14), D(0.20, 0.22, 0.15), D(0.22, 0.24, 0.17)],
    ['compact impact printer', 'covered thermal printer', 'fast cutter printer with status panel', 'network printer with enclosed roll', 'walnut-clad silent concierge printer']],
  ['cash_drawer', 'Cash drawers', 'checkout', 260,
    [D(0.36, 0.38, 0.10), D(0.39, 0.40, 0.11), D(0.42, 0.42, 0.12), D(0.45, 0.44, 0.13), D(0.48, 0.46, 0.14)],
    ['four-note steel till', 'five-note/five-coin insert', 'locking heavy-duty drawer', 'smart-count hospitality drawer', 'walnut-fronted brass-latched cash drawer']],
  ['computer', 'Computers', 'office', 650,
    [D(0.50, 0.30, 0.52), D(0.56, 0.30, 0.54), D(0.62, 0.31, 0.56), D(0.68, 0.32, 0.58), D(0.74, 0.34, 0.60)],
    ['refurbished desktop with separate tower', 'commercial desktop workstation', 'all-in-one office computer', 'dual-display management workstation', 'walnut-base executive management computer']],
  ['laptop', 'Laptops', 'office', 480,
    [D(0.32, 0.23, 0.22), D(0.34, 0.24, 0.23), D(0.36, 0.25, 0.24), D(0.38, 0.26, 0.25), D(0.40, 0.27, 0.26)],
    ['thick refurbished notebook', 'durable business laptop', 'slim aluminum operations laptop', 'high-resolution executive laptop', 'leather-sleeved brass-accent club laptop']],
  ['office_chair', 'Office chairs', 'office', 180,
    [D(0.56, 0.56, 0.96), D(0.58, 0.58, 1.02), D(0.61, 0.61, 1.08), D(0.64, 0.64, 1.14), D(0.68, 0.68, 1.20)],
    ['simple task chair', 'padded adjustable office chair', 'ergonomic mesh chair with arms', 'leather executive chair', 'tufted country-club chair with walnut arms']],
];

const freezeFamily = ([id, name, placement, baseCost, dimensions, progression]) => Object.freeze({
  id,
  name,
  placement,
  baseCost,
  dimensions: Object.freeze(dimensions),
  progression: Object.freeze(progression),
});

export const PRO_SHOP_EQUIPMENT_FAMILIES = Object.freeze(FAMILY_SPECS.map(freezeFamily));

export const PRO_SHOP_EQUIPMENT_CATALOG = Object.freeze(
  PRO_SHOP_EQUIPMENT_FAMILIES.flatMap((family) => EQUIPMENT_QUALITY_TIERS.map((tier, index) => {
    const assetId = `${family.id}_${tier.id}`;
    return Object.freeze({
      id: assetId,
      assetId,
      familyId: family.id,
      familyName: family.name,
      placement: family.placement,
      tierId: tier.id,
      tierName: tier.name,
      referenceTier: tier.referenceLabel,
      qualityLevel: tier.level,
      prestigeRequired: tier.prestigeRequired,
      cost: Math.round(family.baseCost * tier.costMultiplier / 5) * 5,
      dimensionsM: family.dimensions[index],
      visualProgression: family.progression[index],
      glb: `/vendor/models/pro_shop_equipment/${assetId}.glb`,
      source: `asset_sources/blender/pro_shop_equipment/${family.id}.blend#${assetId}`,
      license: 'Project-owned / UNLICENSED',
    });
  })),
);

const BY_ID = new Map(PRO_SHOP_EQUIPMENT_CATALOG.map((entry) => [entry.id, entry]));
const BY_FAMILY = new Map(PRO_SHOP_EQUIPMENT_FAMILIES.map((family) => [family.id, family]));

export const proShopEquipmentById = (id) => BY_ID.get(id) || null;
export const proShopEquipmentFamily = (id) => BY_FAMILY.get(id) || null;
export const proShopEquipmentTiers = (familyId) => (
  PRO_SHOP_EQUIPMENT_CATALOG.filter((entry) => entry.familyId === familyId)
);

export const equipmentQualityTierForPrestige = (prestige = 0) => {
  const value = Number.isFinite(Number(prestige)) ? Number(prestige) : 0;
  return EQUIPMENT_QUALITY_TIERS.reduce(
    (best, tier) => (value >= tier.prestigeRequired ? tier : best),
    EQUIPMENT_QUALITY_TIERS[0],
  );
};

export const CHECKOUT_EQUIPMENT_FAMILIES = Object.freeze([
  'pos_terminal',
  'card_reader',
  'receipt_printer',
  'cash_drawer',
]);
