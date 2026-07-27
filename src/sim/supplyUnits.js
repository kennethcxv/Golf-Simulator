import { skuById } from '../data/shopItems.js';

// One implementation of "spend one physical supply unit". Campaign facility
// installs and normal-play structural repairs both consume through here so the
// carried-item and backroom-shelving rules can never drift apart.

const finite = (value) => (Number.isFinite(value) ? value : 0);

export function carriedMatching(state, skuId) {
  const carry = state?.shop?.carry;
  return carry && carry.skuId === skuId ? Math.max(0, Math.floor(finite(carry.qty))) : 0;
}

export function availableSupplyUnits(state, skuId) {
  const inv = state?.shop?.inventory?.[skuId];
  return Math.max(0, Math.floor(finite(inv?.back))) + carriedMatching(state, skuId);
}

export function consumeSupplyUnit(state, skuId) {
  const carry = state?.shop?.carry;
  if (carry?.skuId === skuId && finite(carry.qty) > 0) {
    carry.qty -= 1;
    if (carry.qty <= 0) state.shop.carry = null;
    return { ok: true, from: 'hands' };
  }
  const inv = state?.shop?.inventory?.[skuId];
  if (inv && finite(inv.back) > 0) {
    inv.back -= 1;
    return { ok: true, from: 'backroom' };
  }
  const carrying = state?.shop?.carry;
  const heldName = carrying ? skuById(carrying.skuId)?.name : null;
  return {
    ok: false,
    reason: heldName
      ? `Set down the ${heldName.toLowerCase()} first.`
      : `${skuById(skuId)?.name || 'That item'} must be unpacked and carried here, or stored on the backroom shelving.`,
  };
}
