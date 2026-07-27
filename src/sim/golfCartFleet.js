import { clamp } from '../core/utils.js';
import {
  GOLF_CART_TIERS,
  golfCartTier,
  golfCartUpgradeCost,
  nextGolfCartTier,
} from '../data/golfCarts.js';
import { ensureGolfDay } from './golfDay.js';
import { spend } from './economy.js';

const MAX_OWNED_CARTS = 18;
const readyStatuses = new Set(['available']);

const nowMinute = (state) => Number(state.clock?.minutes || 0);

function fleetCart(state, cartId) {
  const day = ensureGolfDay(state);
  return day.carts.find((cart) => cart.id === cartId) || null;
}

function nextCartId(carts) {
  const highest = carts.reduce((max, cart) => {
    const match = /^cart-(\d+)$/.exec(String(cart.id || ''));
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0);
  return `cart-${highest + 1}`;
}

function blockedForWorkshop(cart) {
  if (!cart) return 'That cart is not in the fleet.';
  if (cart.status === 'assigned') return 'That cart is currently assigned to a party.';
  if (cart.status === 'staff-assigned') return 'Release that cart from staff duty first.';
  if (cart.status === 'player-driving') return 'Park that cart before workshop work.';
  if (cart.status === 'cleaning') return 'Finish cleaning before workshop work.';
  if (cart.status === 'charging') return 'That cart is already charging.';
  return null;
}

export function golfCartFleetSummary(state) {
  const day = ensureGolfDay(state);
  const byStatus = {};
  const byTier = {};
  for (const cart of day.carts) {
    byStatus[cart.status] = (byStatus[cart.status] || 0) + 1;
    byTier[cart.tierId] = (byTier[cart.tierId] || 0) + 1;
  }
  return {
    owned: day.carts.length,
    capacity: MAX_OWNED_CARTS,
    available: byStatus.available || 0,
    assigned: byStatus.assigned || 0,
    staffAssigned: byStatus['staff-assigned'] || 0,
    cleaning: byStatus.cleaning || 0,
    charging: byStatus.charging || 0,
    averageCondition: day.carts.length
      ? Math.round(day.carts.reduce((sum, cart) => sum + cart.condition, 0) / day.carts.length)
      : 0,
    averageBattery: day.carts.length
      ? Math.round(day.carts.reduce((sum, cart) => sum + cart.batteryPercent, 0) / day.carts.length)
      : 0,
    byStatus,
    byTier,
  };
}

export function purchaseGolfCart(state, tierId) {
  const day = ensureGolfDay(state);
  const tier = GOLF_CART_TIERS.find((candidate) => candidate.id === tierId);
  if (!tier) return { ok: false, reason: 'Unknown golf-cart tier.' };
  if (day.carts.length >= MAX_OWNED_CARTS) return { ok: false, reason: `The fleet yard is full (${MAX_OWNED_CARTS} carts).` };
  if (!Number.isFinite(state.cash) || state.cash < tier.purchaseCost) return { ok: false, reason: 'Not enough cash for that cart.' };
  spend(state, 'golfCarts', tier.purchaseCost);
  const cart = {
    id: nextCartId(day.carts),
    tierId: tier.id,
    status: 'available',
    assignedPartyId: null,
    assignedStaffId: null,
    condition: 100,
    batteryPercent: 100,
    position: day.routeNetwork?.facilities?.cartBarn
      ? { ...day.routeNetwork.facilities.cartBarn }
      : null,
    homeSlot: day.carts.length,
    yaw: 0,
    lightsOn: false,
    parkedByPlayer: false,
    drivenDistanceYd: 0,
    trips: 0,
    upgrades: 0,
    purchasedMinute: nowMinute(state),
    serviceReadyMinute: null,
    lastReturnedMinute: null,
  };
  day.carts.push(cart);
  return { ok: true, cart, tier, cost: tier.purchaseCost };
}

export function chargeGolfCart(state, cartId) {
  const cart = fleetCart(state, cartId);
  const blocked = blockedForWorkshop(cart);
  if (blocked) return { ok: false, reason: blocked };
  if (cart.batteryPercent >= 99.5) return { ok: false, reason: 'That cart is already fully charged.' };
  const tier = golfCartTier(cart.tierId);
  const missing = clamp(100 - cart.batteryPercent, 0, 100);
  const duration = Math.max(0.35, tier.chargeMinutes * (missing / 100));
  cart.status = 'charging';
  cart.assignedPartyId = null;
  cart.assignedStaffId = null;
  cart.lightsOn = false;
  cart.parkedByPlayer = false;
  const barn = ensureGolfDay(state).routeNetwork?.facilities?.cartBarn;
  if (barn) cart.position = { ...barn };
  cart.yaw = 0;
  cart.serviceReadyMinute = Math.round((nowMinute(state) + duration) * 100) / 100;
  return { ok: true, cart, readyMinute: cart.serviceReadyMinute };
}

export function repairGolfCart(state, cartId) {
  const cart = fleetCart(state, cartId);
  const blocked = blockedForWorkshop(cart);
  if (blocked) return { ok: false, reason: blocked };
  const tier = golfCartTier(cart.tierId);
  const missing = clamp(100 - cart.condition, 0, 100);
  if (missing < 0.05) return { ok: false, reason: 'That cart is already in perfect condition.' };
  const cost = Math.max(25, Math.round(missing * tier.repairPerPoint));
  if (!Number.isFinite(state.cash) || state.cash < cost) return { ok: false, reason: 'Not enough cash for that repair.' };
  spend(state, 'golfCartRepairs', cost);
  cart.condition = 100;
  return { ok: true, cart, cost };
}

export function parkGolfCart(state, cartId) {
  const day = ensureGolfDay(state);
  const cart = day.carts.find((candidate) => candidate.id === cartId);
  if (!cart) return { ok: false, reason: 'That cart is not in the fleet.' };
  if (cart.status === 'assigned') return { ok: false, reason: 'That cart is currently assigned to a party.' };
  if (cart.status === 'player-driving') return { ok: false, reason: 'Exit that cart before returning it to the fleet yard.' };
  const barn = day.routeNetwork?.facilities?.cartBarn;
  cart.position = barn ? { ...barn } : null;
  if (!['cleaning', 'charging'].includes(cart.status)) cart.status = 'available';
  cart.assignedPartyId = null;
  cart.assignedStaffId = null;
  cart.yaw = 0;
  cart.lightsOn = false;
  cart.parkedByPlayer = false;
  return { ok: true, cart };
}

export function assignGolfCartToStaff(state, cartId, employeeId) {
  const cart = fleetCart(state, cartId);
  if (!cart) return { ok: false, reason: 'That cart is not in the fleet.' };
  if (cart.status !== 'available') return { ok: false, reason: 'Only an available cart can be assigned to staff.' };
  const employee = state.staff?.employees?.find((candidate) => candidate.id === employeeId);
  if (!employee || Number(employee.trainingDays || 0) > 0) {
    return { ok: false, reason: 'Choose an on-duty staff member.' };
  }
  const alreadyAssigned = ensureGolfDay(state).carts.find((candidate) => (
    candidate.id !== cart.id && candidate.assignedStaffId === employee.id
  ));
  if (alreadyAssigned) return { ok: false, reason: `${employee.name} already has ${alreadyAssigned.id.toUpperCase()}.` };
  cart.status = 'staff-assigned';
  cart.assignedPartyId = null;
  cart.assignedStaffId = employee.id;
  cart.lightsOn = false;
  cart.parkedByPlayer = false;
  const barn = ensureGolfDay(state).routeNetwork?.facilities?.cartBarn;
  if (barn) cart.position = { ...barn };
  cart.yaw = 0;
  return { ok: true, cart, employee };
}

export function releaseGolfCartFromStaff(state, cartId) {
  const cart = fleetCart(state, cartId);
  if (!cart) return { ok: false, reason: 'That cart is not in the fleet.' };
  if (cart.status !== 'staff-assigned') return { ok: false, reason: 'That cart is not assigned to staff.' };
  const employee = state.staff?.employees?.find((candidate) => candidate.id === cart.assignedStaffId) || null;
  cart.status = 'available';
  cart.assignedPartyId = null;
  cart.assignedStaffId = null;
  return { ok: true, cart, employee };
}

export function upgradeGolfCart(state, cartId) {
  const cart = fleetCart(state, cartId);
  const blocked = blockedForWorkshop(cart);
  if (blocked) return { ok: false, reason: blocked };
  const next = nextGolfCartTier(cart.tierId);
  if (!next) return { ok: false, reason: 'That cart is already the top Luxury tier.' };
  const cost = golfCartUpgradeCost(cart.tierId);
  if (!Number.isFinite(state.cash) || state.cash < cost) return { ok: false, reason: 'Not enough cash for that upgrade.' };
  const previousTierId = cart.tierId;
  spend(state, 'golfCartUpgrades', cost);
  cart.tierId = next.id;
  cart.upgrades = Number(cart.upgrades || 0) + 1;
  cart.condition = Math.max(92, cart.condition);
  cart.batteryPercent = 100;
  cart.serviceReadyMinute = null;
  cart.status = 'available';
  return { ok: true, cart, previousTierId, tier: next, cost };
}

export function golfCartOperationReadiness(cart) {
  return {
    canWorkshop: readyStatuses.has(cart?.status),
    canCharge: readyStatuses.has(cart?.status) && Number(cart?.batteryPercent || 0) < 99.5,
    canRepair: readyStatuses.has(cart?.status) && Number(cart?.condition || 0) < 99.95,
    canUpgrade: readyStatuses.has(cart?.status) && !!nextGolfCartTier(cart?.tierId),
  };
}
