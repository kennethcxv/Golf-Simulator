// Customer carrying is presentation wrapped around an authoritative held SKU.
// These state labels never debit or credit inventory; checkout.js owns that ledger.

export const CARRY = Object.freeze({
  BASKET: 'basket-compatible',
  HAND: 'hand-carried',
  TWO_HAND: 'two-hand-carry',
  SPECIAL: 'special-checkout-delivery',
  HANGER: 'clothing-on-hanger',
});

const HAND_IDS = new Set(['umb1']);
const SPECIAL_IDS = new Set(['bag1']);
const HANGER_IDS = new Set(['jacket2']);

export function carryCategory(sku) {
  if (!sku) return CARRY.HAND;
  if (SPECIAL_IDS.has(sku.id)) return CARRY.SPECIAL;
  if (HANGER_IDS.has(sku.id)) return CARRY.HANGER;
  if (HAND_IDS.has(sku.id)) return CARRY.HAND;
  if (sku.cat === 'clubs' || (sku.lb || 0) >= 4) return CARRY.TWO_HAND;
  return CARRY.BASKET;
}

export function basketCompatible(sku) {
  return carryCategory(sku) === CARRY.BASKET;
}

export function selectedUnit({ uid, skuId, price, container = 'hand' }) {
  return {
    uid,
    skuId,
    price,
    selectedSku: skuId,
    reserved: true,
    container,
    checkoutState: 'shopping',
    abandoned: false,
    sold: false,
  };
}

export function stageUnit(unit) {
  if (!unit || unit.abandoned || unit.sold) return false;
  unit.container = 'counter';
  unit.checkoutState = 'staged';
  return true;
}

export function abandonUnit(unit) {
  if (!unit || unit.sold) return false;
  unit.reserved = false;
  unit.container = 'shelf';
  unit.checkoutState = 'abandoned';
  unit.abandoned = true;
  return true;
}

export function sellUnit(unit) {
  if (!unit || unit.abandoned) return false;
  unit.reserved = false;
  unit.container = 'purchase-bag';
  unit.checkoutState = 'sold';
  unit.sold = true;
  return true;
}

export function visibleBasketSlots(units, capacity = 3) {
  return (units || []).filter((unit) => unit.container === 'basket').slice(0, Math.max(0, capacity));
}

