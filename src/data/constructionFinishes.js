// PURCHASABLE CLUBHOUSE CONSTRUCTION FINISHES
//
// The five quality levels follow the ClubHouse reference boards in
// Designs/ClubHouse: an operating municipal clubhouse grows through practical
// commercial work into a tailored luxury country-club interior. Every finish
// family is sold at every quality level; the finish selects the construction
// language while the quality selects material grade, detailing and warranty.

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const CONSTRUCTION_QUALITY_LEVELS = deepFreeze([
  { id: 'municipal', level: 1, label: 'Municipal', multiplier: 1, warrantyYears: 1, craftsmanship: 'serviceable contractor installation', visual: 'economical profiles, visible fasteners, broad seams and a durable matte finish' },
  { id: 'standard', level: 2, label: 'Standard', multiplier: 1.45, warrantyYears: 3, craftsmanship: 'clean commercial installation', visual: 'straighter joins, coordinated hardware, tighter seams and consistent sheen' },
  { id: 'premium', level: 3, label: 'Premium', multiplier: 2.1, warrantyYears: 7, craftsmanship: 'club-grade fitted installation', visual: 'thicker stock, eased edges, concealed fixings and richer material variation' },
  { id: 'high-end', level: 4, label: 'High-end', multiplier: 3.15, warrantyYears: 12, craftsmanship: 'bespoke millwork and specialist fitting', visual: 'custom proportions, deep profiles, book-matched surfaces and refined metalwork' },
  { id: 'luxury', level: 5, label: 'Luxury country club', multiplier: 5, warrantyYears: 20, craftsmanship: 'heritage country-club fabrication', visual: 'hand-finished materials, tailored transitions, restrained brass and presentation-grade detailing' },
]);

export const CONSTRUCTION_QUALITY_BY_ID = deepFreeze(Object.fromEntries(
  CONSTRUCTION_QUALITY_LEVELS.map((quality) => [quality.id, quality]),
));

const category = (id, label, measurement, finishes) => ({ id, label, measurement, finishes });
const finish = (id, label, baseRate, description, extra = {}) => ({ id, label, baseRate, description, ...extra });

export const CONSTRUCTION_FINISH_CATEGORIES = deepFreeze([
  category('flooring', 'Flooring', { quantity: 2550, unit: 'sq ft' }, [
    finish('concrete', 'Concrete', 2.25, 'Sealed slab with progressively finer aggregate, tint control and polished depth.'),
    finish('vinyl', 'Vinyl', 3.75, 'Resilient commercial flooring progressing from sheet goods to embossed luxury plank.'),
    finish('laminate', 'Laminate', 4.5, 'Hard-wearing floating floor with improving core density, registration and edge treatment.'),
    finish('hardwood', 'Hardwood', 7.5, 'Real timber boards progressing from utility oak to selected long-length stock.'),
    finish('luxury-hardwood', 'Luxury hardwood', 13, 'Wide-plank select timber with deep finish, matched grain and custom borders.'),
    finish('stone-tile', 'Stone tile', 9, 'Natural stone tile with increasingly consistent calibration, veining and grout work.'),
    finish('marble', 'Marble', 18, 'Marble field tile progressing to book-matched slabs and brass transition inlays.'),
    finish('herringbone', 'Herringbone', 14, 'Parquet floor with tighter selection, smaller joints and increasingly elaborate borders.'),
  ]),
  category('ceilings', 'Ceilings', { quantity: 2550, unit: 'sq ft' }, [
    finish('drop-ceiling', 'Drop ceiling', 3, 'Accessible acoustic grid with improving tile density and trim integration.'),
    finish('commercial', 'Commercial', 4.5, 'Clean gypsum commercial ceiling with coordinated service reveals.'),
    finish('wood-beams', 'Wood beams', 12, 'Exposed timber rhythm progressing from wrapped box beams to structural-grade oak.'),
    finish('vaulted', 'Vaulted', 22, 'Raised ceiling volume with improved lining, acoustic control and ridge detailing.'),
    finish('luxury-coffered', 'Luxury coffered', 28, 'Deep coffer grid with layered crown profiles and integrated warm lighting.'),
  ]),
  category('walls', 'Walls', { quantity: 3550, unit: 'sq ft' }, [
    finish('drywall', 'Drywall', 2.4, 'Paint-ready wallboard progressing from patched utility work to level-five finish.'),
    finish('paint', 'Paint', 1.8, 'Warm-cream and sage architectural paint with improving preparation and washability.'),
    finish('wood-panels', 'Wood panels', 9, 'Wall panelling progressing from applied battens to fitted walnut wainscot.'),
    finish('stone', 'Stone', 15, 'Stone wall finish progressing from practical veneer to hand-selected full-depth work.'),
    finish('luxury-trim', 'Luxury trim', 11, 'Layered base, chair rail and casing package in the Pinehollow palette.'),
    finish('luxury-moulding', 'Luxury moulding', 17, 'Custom cornice, pilaster and panel moulding with furniture-grade joinery.'),
  ]),
  category('windows', 'Windows', { quantity: 8, unit: 'window' }, [
    finish('cheap-aluminum', 'Cheap aluminum', 280, 'Basic aluminum units progressing from exposed utility frames to thermally improved assemblies.'),
    finish('commercial', 'Commercial', 520, 'Durable commercial glazing with improved seals, hardware and sightlines.'),
    finish('premium-black', 'Premium black', 950, 'Slim warm-charcoal frames with deeper reveals and coordinated black hardware.'),
    finish('luxury-country-club', 'Luxury country club', 1800, 'Large traditional club windows with divided lights, oak liners and restrained brass latches.'),
  ]),
  category('doors', 'Doors', { quantity: 1, unit: 'opening' }, [
    finish('hollow-core', 'Hollow core', 180, 'Light utility door progressing through better skins, hinges and sound control.'),
    finish('solid', 'Solid', 450, 'Solid-core door with progressively heavier timber skins and hardware.'),
    finish('glass', 'Glass', 1100, 'Glazed entrance door with improving frame depth, safety glass and thermal performance.'),
    finish('luxury-wood', 'Luxury wood', 1800, 'Raised-panel hardwood door with fitted casing and club-grade hardware.'),
    finish('double-entry', 'Double entry', 3200, 'Balanced double-leaf entrance with true hinges, deep casing and coordinated pull hardware.'),
  ]),
  category('garage-doors', 'Garage doors', { quantity: 1, unit: 'opening' }, [
    finish('garage-door', 'Garage door', 1200, 'Service-bay door progressing from ribbed steel to insulated carriage-house joinery.'),
  ]),
  category('lighting', 'Lighting', { quantity: 12, unit: 'fixture' }, [
    finish('led-panels', 'LED panels', 65, 'Efficient flat panels with improving diffusion, trim depth and color rendering.'),
    finish('track-lighting', 'Track lighting', 120, 'Aimable retail lighting with increasingly compact heads and beam control.'),
    finish('pendant-lighting', 'Pendant lighting', 190, 'Warm hanging fixtures progressing from enamel shades to tailored linen and brass.'),
    finish('luxury-chandeliers', 'Luxury chandeliers', 1500, 'Statement chandeliers with escalating scale, crystal restraint and brass detailing.', { quantity: 2 }),
    finish('wall-sconces', 'Wall sconces', 160, 'Layered wall light from practical shielded units to picture-quality brass luminaires.', { quantity: 10 }),
    finish('landscape-lighting', 'Landscape lighting', 140, 'Weatherproof path and facade lighting with improving optics, housings and controls.', { quantity: 24 }),
  ]),
]);

export const CONSTRUCTION_CATEGORY_BY_ID = deepFreeze(Object.fromEntries(
  CONSTRUCTION_FINISH_CATEGORIES.map((entry) => [entry.id, entry]),
));
export const CONSTRUCTION_FINISH_FAMILY_COUNT = CONSTRUCTION_FINISH_CATEGORIES.reduce((sum, entry) => sum + entry.finishes.length, 0);
export const CONSTRUCTION_FINISH_VARIANT_COUNT = CONSTRUCTION_FINISH_FAMILY_COUNT * CONSTRUCTION_QUALITY_LEVELS.length;

export function constructionFinishSelectionId(categoryId, finishId, qualityId) {
  return `${categoryId}:${finishId}:${qualityId}`;
}

export function constructionFinishFamily(categoryId, finishId) {
  return CONSTRUCTION_CATEGORY_BY_ID[categoryId]?.finishes.find((entry) => entry.id === finishId) || null;
}

export function constructionFinishVariant(categoryId, finishId, qualityId) {
  const categorySpec = CONSTRUCTION_CATEGORY_BY_ID[categoryId];
  const family = constructionFinishFamily(categoryId, finishId);
  const quality = CONSTRUCTION_QUALITY_BY_ID[qualityId];
  if (!categorySpec || !family || !quality) return null;
  const quantity = Number.isFinite(family.quantity) ? family.quantity : categorySpec.measurement.quantity;
  const unit = family.unit || categorySpec.measurement.unit;
  const rate = Math.round(family.baseRate * quality.multiplier * 100) / 100;
  const cost = Math.round(rate * quantity * 100) / 100;
  return Object.freeze({
    id: constructionFinishSelectionId(categoryId, finishId, qualityId), categoryId,
    categoryLabel: categorySpec.label, finishId, finishLabel: family.label,
    qualityId, qualityLabel: quality.label, qualityLevel: quality.level,
    description: family.description, craftsmanship: quality.craftsmanship, visual: quality.visual,
    warrantyYears: quality.warrantyYears, quantity, unit, rate, cost,
  });
}

export function allConstructionFinishVariants() {
  return CONSTRUCTION_FINISH_CATEGORIES.flatMap((categorySpec) => categorySpec.finishes.flatMap((family) => (
    CONSTRUCTION_QUALITY_LEVELS.map((quality) => constructionFinishVariant(categorySpec.id, family.id, quality.id))
  )));
}
