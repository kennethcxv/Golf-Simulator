export const PRODUCT_MATRIX = Object.freeze([
  Object.freeze({
    id: 'one-accessory',
    label: '1 item - accessory',
    skuIds: Object.freeze(['marker1']),
    proves: Object.freeze(['1-item', 'accessory']),
  }),
  Object.freeze({
    id: 'two-balls-hat',
    label: '2 items - golf balls and hat',
    skuIds: Object.freeze(['balls2', 'cap1']),
    proves: Object.freeze(['2-item', 'golf-balls', 'hat']),
  }),
  Object.freeze({
    id: 'three-apparel-shoes-accessory',
    label: '3 items - apparel, shoes, and accessory',
    skuIds: Object.freeze(['polo1', 'shoe1', 'towel1']),
    proves: Object.freeze(['3-item', 'apparel', 'shoes', 'accessory']),
  }),
  Object.freeze({
    id: 'five-mixed-oversize',
    label: '5 items - mixed basket with oversize club and provisions',
    skuIds: Object.freeze(['driver2', 'balls1', 'jacket2', 'water1', 'snack1']),
    proves: Object.freeze([
      '5-item', 'mixed', 'club', 'oversize', 'golf-balls', 'apparel',
      'provisions', 'water', 'snack',
    ]),
  }),
]);

export const PRODUCT_MATRIX_REQUIRED_COUNTS = Object.freeze([1, 2, 3, 5]);

export const PRODUCT_MATRIX_REQUIRED_COVERAGE = Object.freeze([
  'club',
  'oversize',
  'apparel',
  'shoes',
  'golf-balls',
  'hat',
  'accessory',
  'provisions',
  'water',
  'snack',
  'mixed',
]);

export function matrixCoverage(cases = PRODUCT_MATRIX) {
  return new Set(cases.flatMap((entry) => entry.proves));
}
