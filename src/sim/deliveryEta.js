// FAIRWAY STATE — one delivery promise, used by the supplier quote, the saved
// order, tracking screens and notifications. ETA is derived from the game clock,
// never wall time, so pausing and reloading cannot secretly move a van.

import { calendarOf } from './time.js';

export const DELIVERY_SERVICE = Object.freeze({
  standard: { id: 'standard', label: 'Standard', duration: 1, feeRate: 0 },
  express: { id: 'express', label: 'Express', duration: 0.5, feeRate: 0.06 },
});

// The whole game day is deliberately short (10 game minutes / real second at
// 1x), so promises are expressed in useful same-day game hours. These spans let
// the player finish a shop or grounds task without blocking the opening arc.
export const DELIVERY_PACE = Object.freeze({
  starter: { id: 'starter', label: 'Opening order', min: 150, max: 210, window: 30 },
  local: { id: 'local', label: 'Local merchandise', min: 240, max: 420, window: 60 },
  equipment: { id: 'equipment', label: 'Large equipment', min: 480, max: 780, window: 90 },
});

const cents = (n) => Math.round(n * 100) / 100;
const clampService = (service) => DELIVERY_SERVICE[service] || DELIVERY_SERVICE.standard;

function hashQuote(state, sku, qty, orderId) {
  let h = ((state.seed >>> 0) ^ Math.imul(orderId || 1, 0x45d9f3b)) >>> 0;
  const key = `${sku.id}:${qty}`;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export function isStarterDelivery(state) {
  const tut = state.tutorial;
  if (!tut || tut.complete || (tut.step || 0) > 7) return false;
  const firstMin = state.shop && state.shop.starterOrderMin;
  return firstMin == null || firstMin === state.clock.minutes;
}

export function deliveryPaceFor(state, sku, { starter = isStarterDelivery(state) } = {}) {
  if (starter) return DELIVERY_PACE.starter;
  if (sku.cat === 'supplies' || sku.cat === 'decor') return DELIVERY_PACE.equipment;
  return DELIVERY_PACE.local;
}

export function expressFeeFor(goods, freight) {
  // A visible decision, not a token surcharge: at least $18, then 6% of stock
  // plus the extra handling/freight. It buys half the wait, never instant arrival.
  return cents(Math.max(18, goods * DELIVERY_SERVICE.express.feeRate + freight * 0.5));
}

export function quoteDelivery(state, sku, qty, {
  service = 'standard', orderId = state.shop.nextOrderId, starter = isStarterDelivery(state),
  goods = sku.cost * qty, freight = 0,
} = {}) {
  const svc = clampService(service);
  const pace = deliveryPaceFor(state, sku, { starter });
  const hash = hashQuote(state, sku, qty, orderId);
  const steps = Math.max(1, Math.floor((pace.max - pace.min) / 15));
  const standardMinutes = pace.min + (hash % (steps + 1)) * 15;
  // Quarter-hour steps keep the promise legible and avoid false minute precision.
  const totalMinutes = Math.max(75, Math.round((standardMinutes * svc.duration) / 15) * 15);
  const placedMin = state.clock.minutes;
  const deliveryMin = placedMin + totalMinutes;
  const halfWindow = Math.max(15, Math.round((pace.window * svc.duration) / 30) * 15);
  const open = Math.max(placedMin + 1, deliveryMin - halfWindow);
  const close = deliveryMin + halfWindow;
  const processingMinutes = Math.max(30, Math.round((totalMinutes * (svc.id === 'express' ? 0.35 : 0.42)) / 15) * 15);
  const dispatchMin = placedMin + Math.min(totalMinutes - 15, processingMinutes);
  const expressFee = svc.id === 'express' ? expressFeeFor(goods, freight) : 0;

  return {
    pace: pace.id,
    paceLabel: pace.label,
    service: svc.id,
    serviceLabel: svc.label,
    expressFee,
    expressModifier: svc.duration,
    supplierSpeedModifier: 1,
    placedMin,
    processingMinutes: dispatchMin - placedMin,
    transitMinutes: deliveryMin - dispatchMin,
    dispatchMin,
    deliveryMin,
    arrivesDay: calendarOf(deliveryMin).dayAbs,
    window: { open, close },
  };
}

export function gameDurationText(minutes) {
  const rounded = Math.max(15, Math.round(minutes / 15) * 15);
  if (rounded < 90) return `${rounded} game minutes`;
  const hours = rounded / 60;
  const value = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace('.0', '');
  return `${value} game hours`;
}

export function deliveryQuoteText(quote) {
  const wiggle = Math.max(15, Math.round((quote.window.close - quote.window.open) / 2 / 15) * 15);
  const low = Math.max(15, quote.deliveryMin - quote.placedMin - wiggle);
  const high = quote.deliveryMin - quote.placedMin + wiggle;
  const a = gameDurationText(low);
  const b = gameDurationText(high);
  const unit = a.endsWith('game hours') && b.endsWith('game hours') ? 'game hours'
    : a.endsWith('game minutes') && b.endsWith('game minutes') ? 'game minutes' : null;
  if (!unit) return `Usually ${a}–${b}`;
  return `Usually ${a.slice(0, -unit.length).trim()}–${b.slice(0, -unit.length).trim()} ${unit}`;
}

const clock12 = (absoluteMin) => {
  const m = ((Math.round(absoluteMin / 15) * 15 % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

export function deliveryEtaText(order, nowMin, { expected = false } = {}) {
  if (order.blocked) return 'Delayed — receiving area blocked';
  if (order.status === 'delivered') return 'Delivered';
  const remaining = order.deliveryMin - nowMin;
  if (remaining <= 30 || order.status === 'arriving') return 'Arriving soon';
  const nowDay = calendarOf(nowMin).dayAbs;
  const arrivalDay = calendarOf(order.deliveryMin).dayAbs;
  if (expected || remaining > 6 * 60) {
    const day = arrivalDay === nowDay ? 'today' : arrivalDay === nowDay + 1 ? 'tomorrow' : `in ${arrivalDay - nowDay} days`;
    return `Expected ${day} around ${clock12(order.deliveryMin)}`;
  }
  return `Arrives in approximately ${gameDurationText(remaining)}`;
}

export function deliveryTimingOf(order) {
  if (order.timing) return order.timing;
  const total = Math.max(1, order.deliveryMin - order.placedMin);
  const dispatchMin = order.placedMin + Math.round(total * 0.55);
  return {
    processingMinutes: dispatchMin - order.placedMin,
    transitMinutes: order.deliveryMin - dispatchMin,
    dispatchMin,
    supplierSpeedModifier: 1,
    expressModifier: order.service === 'express' ? 0.5 : 1,
  };
}
