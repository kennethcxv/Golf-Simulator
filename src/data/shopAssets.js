// Project-owned, repeatable Blender fixture pack. Keeping this list outside the
// renderer lets tests verify that every promised production module ships as a
// valid GLB instead of silently falling back to primitives.
export const SHOP_FIXTURE_MODELS = Object.freeze([
  'club_wall_bay',
  'pegboard_wall',
  'apparel_wall',
  'ball_wall',
  'hat_wall',
  'shoe_wall',
  'basket_station',
  'demo_club_rack',
  'feature_table',
  'fitting_room',
  'drinks_fridge',
  'snack_rack',
  'service_station',
  'premium_case',
  'putting_demo',
]);

export const SHOP_FIXTURE_MODEL_BY_KIND = Object.freeze({
  shelf: 'ball_wall',
  pegboard: 'pegboard_wall',
  apparelwall: 'apparel_wall',
  rack: 'club_wall_bay',
  hatwall: 'hat_wall',
  shoerack: 'shoe_wall',
  fittingroom: 'fitting_room',
  fridge: 'drinks_fridge',
  snackrack: 'snack_rack',
  service: 'basket_station',
  premiumcase: 'premium_case',
  demo: 'putting_demo',
  demorack: 'demo_club_rack',
  feature: 'feature_table',
});
