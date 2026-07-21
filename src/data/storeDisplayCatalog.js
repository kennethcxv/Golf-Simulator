// Production catalog for the five-tier pro-shop display library.
//
// The canonical GLBs stay in Assets/pro_shop. They are intentionally loaded on
// demand: eagerly decoding all 90 fixtures would make the ordinary clubhouse
// pay for a development/upgrade catalog the player has not opened.

export const STORE_DISPLAY_TIERS = Object.freeze([
  Object.freeze({ tier: 1, key: 'municipal_value', quality: 'Basic', lights: 0 }),
  Object.freeze({ tier: 2, key: 'suburban_retail', quality: 'Standard', lights: 1 }),
  Object.freeze({ tier: 3, key: 'lodge_crafted', quality: 'Premium', lights: 2 }),
  Object.freeze({ tier: 4, key: 'resort_boutique', quality: 'High-end', lights: 3 }),
  Object.freeze({ tier: 5, key: 'private_club_luxury', quality: 'Luxury', lights: 5 }),
]);

const FAMILY_SPECS = [
  ['clothing_rack', 'Clothing Racks', [[1.20, .55, 1.55], [1.45, .60, 1.75], [1.75, .65, 1.95], [2.20, .70, 2.25], [3.00, .82, 2.58]]],
  ['hat_wall', 'Hat Walls', [[.90, .28, 1.60], [1.20, .34, 1.85], [1.60, .40, 2.08], [2.10, .48, 2.32], [3.00, .58, 2.58]]],
  ['shoe_display', 'Shoe Displays', [[1.00, .42, 1.48], [1.30, .46, 1.76], [1.70, .50, 2.02], [2.20, .56, 2.30], [3.00, .66, 2.58]]],
  ['golf_club_wall', 'Golf Club Walls', [[1.25, .36, 1.75], [1.60, .40, 1.95], [2.05, .44, 2.18], [2.55, .50, 2.38], [3.40, .60, 2.62]]],
  ['ball_display', 'Ball Displays', [[.90, .42, 1.35], [1.20, .46, 1.58], [1.55, .50, 1.85], [2.05, .56, 2.16], [2.80, .64, 2.48]]],
  ['accessory_rack', 'Accessory Racks', [[.85, .42, 1.55], [1.15, .46, 1.78], [1.50, .50, 2.02], [2.00, .56, 2.28], [2.75, .64, 2.55]]],
  ['snack_shelving', 'Snack Shelving', [[.90, .45, 1.45], [1.20, .50, 1.70], [1.55, .54, 1.95], [2.05, .60, 2.22], [2.80, .68, 2.52]]],
  ['drink_refrigerator', 'Drink Refrigerators', [[.72, .68, 1.72], [.92, .72, 1.92], [1.20, .76, 2.08], [1.65, .82, 2.28], [2.35, .90, 2.52]]],
  ['impulse_shelf', 'Impulse Shelves', [[.48, .42, .95], [.62, .46, 1.10], [.78, .50, 1.28], [1.00, .54, 1.48], [1.35, .62, 1.72]]],
  ['checkout_display', 'Checkout Displays', [[.45, .30, .32], [.62, .36, .48], [.82, .42, .65], [1.05, .48, .82], [1.35, .56, 1.02]]],
  ['feature_table', 'Feature Tables', [[1.00, .62, .78], [1.28, .72, .82], [1.58, .82, .86], [1.92, .94, .92], [2.35, 1.12, 1.02]]],
  ['window_display', 'Window Displays', [[1.20, .55, 1.50], [1.55, .65, 1.78], [1.95, .76, 2.02], [2.40, .88, 2.30], [3.10, 1.00, 2.62]]],
  ['luxury_display_island', 'Luxury Display Islands', [[1.20, .75, .92], [1.50, .90, 1.08], [1.85, 1.05, 1.28], [2.25, 1.20, 1.48], [2.80, 1.45, 1.70]]],
  ['wall_slat_system', 'Wall Slat Systems', [[1.00, .24, 1.65], [1.35, .28, 1.90], [1.75, .32, 2.14], [2.25, .38, 2.38], [3.10, .46, 2.62]]],
  ['built_in_cabinetry', 'Built-In Cabinetry', [[1.20, .48, 1.72], [1.55, .52, 1.95], [2.00, .58, 2.18], [2.60, .64, 2.40], [3.50, .72, 2.64]]],
  ['glass_display_tower', 'Glass Display Towers', [[.52, .48, 1.35], [.68, .56, 1.60], [.86, .64, 1.88], [1.08, .72, 2.16], [1.38, .82, 2.45]]],
  ['corner_shelving', 'Corner Shelving', [[1.00, 1.00, 1.55], [1.25, 1.25, 1.80], [1.50, 1.50, 2.04], [1.80, 1.80, 2.30], [2.15, 2.15, 2.58]]],
  ['rotating_display', 'Rotating Displays', [[.62, .62, 1.35], [.78, .78, 1.58], [.94, .94, 1.82], [1.12, 1.12, 2.08], [1.38, 1.38, 2.38]]],
];

export const STORE_DISPLAY_FAMILIES = Object.freeze(FAMILY_SPECS.map(([id, label, dimensions]) => Object.freeze({
  id,
  label,
  dimensions: Object.freeze(dimensions.map((value) => Object.freeze([...value]))),
})));

export const STORE_DISPLAY_CATALOG = Object.freeze(STORE_DISPLAY_FAMILIES.flatMap((family) => (
  STORE_DISPLAY_TIERS.map((tier, index) => {
    const id = `pf_display_${family.id}_t${tier.tier}`;
    return Object.freeze({
      id,
      family: family.id,
      familyLabel: family.label,
      ...tier,
      dimensions: family.dimensions[index],
      glb: `Assets/pro_shop/glb/fixtures/${id}.glb`,
      blend: `Assets/pro_shop/source/fixtures/store_displays/${family.id}/${id}.blend`,
      manifest: `Assets/pro_shop/manifests/fragments/${id}.json`,
    });
  })
)));

const BY_ID = new Map(STORE_DISPLAY_CATALOG.map((asset) => [asset.id, asset]));

export function storeDisplayAsset(family, tier) {
  return BY_ID.get(`pf_display_${family}_t${Number(tier)}`) || null;
}

export function storeDisplayFamily(family) {
  return STORE_DISPLAY_CATALOG.filter((asset) => asset.family === family);
}
