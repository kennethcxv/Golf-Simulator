// Durable, forward-only checkout settlement.
//
// The physical register spans several independently persisted authorities:
// inventory lots, the cash drawer, ledger entries, tax liability, sales
// analytics, transaction history, and customer history. JavaScript cannot make
// those writes one machine-level transaction. A small write-ahead settlement
// record is therefore the commit decision: it is persisted before the first
// irreversible write and contains absolute targets that can be reconciled after
// any synchronous exception or save/load.

import {
  postLedgerEntry,
  preflightLedgerEntry,
  preflightOutcome,
  recordOutcome,
} from './economy.js';
import {
  INVENTORY_STAGE,
  moveInventory,
} from './inventoryLifecycle.js';
import {
  preflightCustomerVisitEvent,
  reconcileCustomerVisitEvents,
} from './customerIdentity.js';
import { t } from '../core/i18n.js';
import { skuById } from '../data/shopItems.js';
import { checkoutPaymentContract } from './checkoutCashContract.js';

export const CHECKOUT_SETTLEMENT_VERSION = 1;
const SETTLEMENT_VERSION = CHECKOUT_SETTLEMENT_VERSION;
const MAX_SETTLEMENT_RECEIPTS = 2000;
const CHECKOUT_INVENTORY_PREFIX = 'checkout-sale-batch:v2:';
const CHECKOUT_PRICE_AUTHORITY_VERSION = 1;
const CHECKOUT_PRICE_AUTHORITY_FIELD = 'checkoutPriceAuthority';
export const CHECKOUT_WAL_QUARANTINE_FIELD = 'pendingCheckoutsQuarantine';
// Absolute analytics and drawer targets assume one register settlement owns the
// commit boundary at a time. The renderer is single-counter already; enforcing
// that invariant here also prevents two prepared plans from sharing a `before`.
const MAX_PENDING_CHECKOUTS = 1;
const RESERVATION_CHECK_IN_TYPE = 'reservation-check-in';
const RESERVATION_GREEN_FEE_SKU = 'service:green-fee';
const RESERVATION_REVENUE_KEY = 'greenFees';
const CHECKOUT_DRAWER_DENOMINATION_CENTS = new Set([
  5000, 2000, 1000, 500, 100, 50, 25, 10, 5, 1,
]);

const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const round2 = (value) => Math.round(Number(value) * 100) / 100;
const checkoutPropertyId = (state) => String(
  state?.property?.id || state?.propertyId || `club-${state?.seed}`,
);

export function checkoutWalIsQuarantined(state) {
  return state?.shop?.[CHECKOUT_WAL_QUARANTINE_FIELD]?.active === true;
}

export function quarantineCheckoutWal(
  state,
  reason = 'malformed-persisted-checkout-journal',
  evidence = null,
) {
  if (!isRecord(state?.shop)) return null;
  const prior = isRecord(state.shop[CHECKOUT_WAL_QUARANTINE_FIELD])
    ? state.shop[CHECKOUT_WAL_QUARANTINE_FIELD] : null;
  const preservedEvidence = isRecord(prior?.evidence) ? jsonClone(prior.evidence) : {};
  if (isRecord(evidence)) Object.assign(preservedEvidence, jsonClone(evidence));
  const quarantine = {
    ...(prior || {}),
    active: true,
    reason: typeof reason === 'string' && reason ? reason : 'checkout-journal-unavailable',
    ...(Object.keys(preservedEvidence).length > 0 ? { evidence: preservedEvidence } : {}),
  };
  state.shop[CHECKOUT_WAL_QUARANTINE_FIELD] = quarantine;
  return quarantine;
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
  )).join(',')}}`;
}

function canAssignProperty(target, key) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) return false;
  const own = Object.getOwnPropertyDescriptor(target, key);
  if (own) {
    return Object.hasOwn(own, 'value') && own.writable === true;
  }
  let prototype = Object.getPrototypeOf(target);
  while (prototype) {
    const inherited = Object.getOwnPropertyDescriptor(prototype, key);
    if (inherited) {
      if (!Object.hasOwn(inherited, 'value')) return false;
      if (inherited.writable !== true) return false;
      break;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return Object.isExtensible(target);
}

function canDeleteProperty(target, key) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) return false;
  const own = Object.getOwnPropertyDescriptor(target, key);
  return !own || own.configurable === true;
}

function canMutateArray(array, { append = false, remove = false } = {}) {
  if (!Array.isArray(array) || !canAssignProperty(array, 'length')) return false;
  if (append && !Object.isExtensible(array)) return false;
  if (remove) {
    for (const key of Object.keys(array)) {
      if (!/^\d+$/u.test(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(array, key);
      if (!descriptor || descriptor.writable !== true || descriptor.configurable !== true) return false;
    }
  }
  return true;
}

function signatureFor(plan) {
  const unsigned = { ...plan };
  delete unsigned.signature;
  return stableSerialize(unsigned);
}

export function checkoutSettlementMarker(settlementId) {
  return {
    version: CHECKOUT_SETTLEMENT_VERSION,
    settlementId,
  };
}

function markerMatches(value, settlementId) {
  return isRecord(value)
    && typeof settlementId === 'string'
    && settlementId.length > 0
    && value.version === CHECKOUT_SETTLEMENT_VERSION
    && value.settlementId === settlementId;
}

function validTicketKey(key) {
  if (!isRecord(key)) return false;
  const keys = Object.keys(key).sort(compareText);
  if (key.kind === 'transaction') {
    return stableSerialize(keys) === stableSerialize(['kind', 'transactionId'])
      && typeof key.transactionId === 'string'
      && key.transactionId.length > 0
      && key.transactionId.trim() === key.transactionId;
  }
  if (key.kind === 'service') {
    return stableSerialize(keys) === stableSerialize(['kind', 'referenceId', 'type'])
      && typeof key.type === 'string'
      && /^[A-Za-z0-9._-]+$/u.test(key.type)
      && typeof key.referenceId === 'string'
      && key.referenceId.length > 0
      && key.referenceId.trim() === key.referenceId;
  }
  return false;
}

export function canonicalCheckoutSettlementId(key) {
  if (!validTicketKey(key)) return null;
  return key.kind === 'transaction'
    ? `checkout:${key.transactionId}`
    : `service:${key.type}:${key.referenceId}`;
}

export function checkoutInventoryIdentity(referenceId) {
  if (typeof referenceId !== 'string' || !referenceId.startsWith(CHECKOUT_INVENTORY_PREFIX)) {
    return null;
  }
  let identity;
  try {
    identity = JSON.parse(referenceId.slice(CHECKOUT_INVENTORY_PREFIX.length));
  } catch {
    return null;
  }
  if (!isRecord(identity) || typeof identity.transactionId !== 'string'
      || !identity.transactionId || !Array.isArray(identity.items)
      || identity.items.length === 0
      || identity.items.some((item) => !Array.isArray(item) || item.length !== 2
        || typeof item[0] !== 'string' || !item[0]
        || typeof item[1] !== 'string' || !item[1])) return null;
  const identities = identity.items.map(([uid, skuId]) => [uid, skuId]);
  const uids = identities.map(([uid]) => uid);
  if (new Set(uids).size !== uids.length) return null;
  const sorted = [...identities]
    .sort((left, right) => compareText(left[0], right[0]) || compareText(left[1], right[1]));
  if (stableSerialize(sorted) !== stableSerialize(identities)) return null;
  return { transactionId: identity.transactionId, items: identities };
}

function canonicalPostingIdentity(ticketKey, alternateTicketKeys, posting) {
  const primaryId = canonicalCheckoutSettlementId(ticketKey);
  if (!primaryId || !isRecord(posting)) return null;
  const primaryRelatedId = ticketKey.kind === 'transaction'
    ? ticketKey.transactionId : ticketKey.referenceId;
  const commonSuffixes = new Map([
    ['cash-over-short', 'cash-over-short'],
    ['cash-overage', 'cash-overage'],
  ]);
  if (ticketKey.kind === 'service') {
    const suffix = posting.component === 'revenue'
      ? 'revenue' : commonSuffixes.get(posting.component);
    return suffix ? {
      idempotencyKey: `${primaryId}:${suffix}`,
      relatedId: ticketKey.referenceId,
    } : null;
  }
  const suffix = new Map([
    ['sale', 'sale'],
    ['sales-tax', 'salestax'],
    ['cogs', 'cogs'],
    ...commonSuffixes,
  ]).get(posting.component);
  if (suffix) return {
    idempotencyKey: `${primaryId}:${suffix}`,
    relatedId: primaryRelatedId,
  };
  if (posting.component !== 'service') return null;
  const serviceKeys = (alternateTicketKeys || []).filter((key) => key.kind === 'service');
  if (serviceKeys.length !== 1) return null;
  return {
    idempotencyKey: `${canonicalCheckoutSettlementId(serviceKeys[0])}:revenue`,
    relatedId: serviceKeys[0].referenceId,
  };
}

function postingMatchesTicketKeys(ticketKey, alternateTicketKeys, posting, {
  receipt = false,
} = {}) {
  const expected = canonicalPostingIdentity(ticketKey, alternateTicketKeys, posting);
  if (!expected) return false;
  const source = receipt ? posting : posting.spec;
  return source?.idempotencyKey === expected.idempotencyKey
    && source?.relatedId != null
    && String(source?.relatedId) === expected.relatedId;
}

function ticketInventoryPairs(ticket) {
  if (!Array.isArray(ticket?.items)) return null;
  const pairs = [];
  const seen = new Set();
  for (const item of ticket.items) {
    if (!isRecord(item) || typeof item.uid !== 'string' || !item.uid
        || typeof item.skuId !== 'string' || !item.skuId) return null;
    if (seen.has(item.uid)) return null;
    seen.add(item.uid);
    if (!item.skuId.startsWith('service:')) pairs.push([item.uid, item.skuId]);
  }
  return pairs.sort((left, right) => (
    compareText(left[0], right[0]) || compareText(left[1], right[1])
  ));
}

function ticketItemsByKind(ticket, { service }) {
  if (!Array.isArray(ticket?.items)) return null;
  return ticket.items.filter((item) => (
    typeof item?.skuId === 'string'
      && item.skuId.startsWith('service:') === service
  ));
}

function ticketItemsTotal(items) {
  if (!Array.isArray(items)
      || items.some((item) => !validMoneyDelta(Number(item?.price)))) return null;
  const total = round2(items.reduce((sum, item) => sum + Number(item.price), 0));
  return validMoneyDelta(total) ? total : null;
}

function normalizedPriceAuthorityLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const normalized = [];
  const seen = new Set();
  for (const line of lines) {
    const price = Number(line?.price);
    if (!isRecord(line)
        || typeof line.uid !== 'string' || !line.uid
        || typeof line.skuId !== 'string' || !line.skuId
        || line.skuId.startsWith('service:')
        || !validMoneyDelta(price) || price <= 0
        || seen.has(line.uid)) return null;
    seen.add(line.uid);
    normalized.push({ uid: line.uid, skuId: line.skuId, price });
  }
  return normalized.sort((left, right) => (
    compareText(left.uid, right.uid) || compareText(left.skuId, right.skuId)
  ));
}

function checkoutPricingFromAuthority(authority) {
  return {
    version: authority.version,
    goodsSubtotal: authority.goodsSubtotal,
    discountAmount: authority.discountAmount,
    saleRevenue: authority.saleRevenue,
    taxRate: authority.taxRate,
    tax: authority.tax,
    serviceTotal: authority.serviceTotal,
    total: authority.total,
  };
}

function validCheckoutPriceAuthority(authority) {
  if (!isRecord(authority)
      || authority.version !== CHECKOUT_PRICE_AUTHORITY_VERSION
      || typeof authority.transactionId !== 'string' || !authority.transactionId) return false;
  const lines = normalizedPriceAuthorityLines(authority.lines);
  const goodsSubtotal = Number(authority.goodsSubtotal);
  const discountAmount = Number(authority.discountAmount);
  const saleRevenue = Number(authority.saleRevenue);
  const taxRate = Number(authority.taxRate);
  const tax = Number(authority.tax);
  const serviceTotal = Number(authority.serviceTotal);
  const total = Number(authority.total);
  if (!lines
      || !validMoneyDelta(goodsSubtotal) || goodsSubtotal <= 0
      || !validMoneyDelta(discountAmount) || discountAmount > goodsSubtotal
      || !validMoneyDelta(saleRevenue) || saleRevenue <= 0
      || typeof taxRate !== 'number' || !Number.isFinite(taxRate)
      || taxRate < 0 || taxRate > 1
      || Math.round(taxRate * 100000) / 100000 !== taxRate
      || !validMoneyDelta(tax)
      || !validMoneyDelta(serviceTotal)
      || !validMoneyDelta(total) || total <= 0) return false;
  return round2(lines.reduce((sum, line) => sum + line.price, 0)) === goodsSubtotal
    && round2(goodsSubtotal - discountAmount) === saleRevenue
    && round2(saleRevenue * taxRate) === tax
    && round2(saleRevenue + tax + serviceTotal) === total;
}

function checkoutPriceAuthorityMatchesTicket(authority, ticket) {
  if (!validCheckoutPriceAuthority(authority)
      || !isRecord(ticket)
      || ticket.transactionId !== authority.transactionId
      || !isRecord(ticket.pricing)
      || stableSerialize(ticket.pricing)
        !== stableSerialize(checkoutPricingFromAuthority(authority))) return false;
  const retailItems = ticketItemsByKind(ticket, { service: false });
  const serviceItems = ticketItemsByKind(ticket, { service: true });
  const lines = normalizedPriceAuthorityLines(authority.lines);
  return Array.isArray(retailItems)
    && stableSerialize(lines) === stableSerialize(normalizedPriceAuthorityLines(retailItems))
    && ticketItemsTotal(serviceItems) === authority.serviceTotal
    && Number(ticket.net) === authority.saleRevenue
    && Number(ticket.tax ?? 0) === authority.tax
    && Number(ticket.taxRate ?? 0) === authority.taxRate
    && Number(ticket.serviceTotal ?? 0) === authority.serviceTotal
    && Number(ticket.total) === authority.total;
}

function checkoutPriceAuthorityForState(state, inventory) {
  const operations = state?.shop?.inventoryLifecycle?.operations;
  if (!isRecord(operations) || !isRecord(inventory)) return null;
  const authorities = [];
  const settled = operations[inventory.referenceId]?.[CHECKOUT_PRICE_AUTHORITY_FIELD];
  if (settled != null) authorities.push(settled);
  for (const entry of inventory.entries || []) {
    const pickOperation = operations[`customer-pick:${entry?.uid}`];
    if (pickOperation == null) continue;
    if (!isRecord(pickOperation)
        || pickOperation[CHECKOUT_PRICE_AUTHORITY_FIELD] == null) return null;
    authorities.push(pickOperation[CHECKOUT_PRICE_AUTHORITY_FIELD]);
  }
  if (authorities.length === 0) return null;
  const signature = stableSerialize(authorities[0]);
  return authorities.every((authority) => stableSerialize(authority) === signature)
    ? authorities[0] : null;
}

function checkoutPriceAuthorityMatchesState(
  state,
  inventory,
  ticket,
  { allowMissing = false } = {},
) {
  if (!isRecord(inventory)
      || !validCheckoutPriceAuthority(inventory.priceAuthority)
      || !checkoutPriceAuthorityMatchesTicket(inventory.priceAuthority, ticket)) return false;
  if (state == null) return true;
  const authority = checkoutPriceAuthorityForState(state, inventory);
  // Before the WAL is admitted the quote has only been fully preflighted; its
  // commit is the same narrow write that follows successful journal admission.
  // During load/reconciliation, a persisted WAL must have the independent
  // customer-pick (or terminal sold-operation) copy.
  return authority == null
    ? allowMissing
    : stableSerialize(authority) === stableSerialize(inventory.priceAuthority);
}

function checkoutReceiptPriceAuthorityMatchesState(state, receipt, ticket) {
  if (state == null) return true;
  const authority = state?.shop?.inventoryLifecycle?.operations?.[
    receipt?.inventoryReferenceId
  ]?.[CHECKOUT_PRICE_AUTHORITY_FIELD];
  return authority != null && checkoutPriceAuthorityMatchesTicket(authority, ticket);
}

export function bindCheckoutPriceAuthority(state, items, transactionId, pricing) {
  const lines = normalizedPriceAuthorityLines(items);
  const authority = {
    version: CHECKOUT_PRICE_AUTHORITY_VERSION,
    transactionId: String(transactionId || ''),
    lines: lines || [],
    goodsSubtotal: Number(pricing?.goodsSubtotal),
    discountAmount: Number(pricing?.discountAmount),
    saleRevenue: Number(pricing?.saleRevenue),
    taxRate: Number(pricing?.taxRate),
    tax: Number(pricing?.tax),
    serviceTotal: Number(pricing?.serviceTotal ?? 0),
    total: Number(pricing?.total),
  };
  if (!validCheckoutPriceAuthority(authority)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout price authority is invalid.' };
  }
  const held = Array.isArray(state?.shop?.held) ? state.shop.held : [];
  const operations = state?.shop?.inventoryLifecycle?.operations;
  if (!isRecord(operations)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The held-product price authority is unavailable.' };
  }
  const targets = [];
  for (const line of authority.lines) {
    const matches = held.filter((entry) => entry?.uid === line.uid);
    const operation = operations[`customer-pick:${line.uid}`];
    if (matches.length !== 1 || matches[0].skuId !== line.skuId) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The held product identity does not match this checkout.' };
    }
    if (!isRecord(operation) || operation.ok !== true
        || operation.from !== INVENTORY_STAGE.SHELF
        || operation.to !== INVENTORY_STAGE.CUSTOMER_HELD
        || operation.moved !== 1) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The held product has no independent price authority.' };
    }
    const prior = operation[CHECKOUT_PRICE_AUTHORITY_FIELD];
    if (prior != null && stableSerialize(prior) !== stableSerialize(authority)) {
      return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The held product was already quoted for a different checkout.' };
    }
    if (prior == null && !canAssignProperty(operation, CHECKOUT_PRICE_AUTHORITY_FIELD)) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The held-product price authority is not writable.' };
    }
    targets.push(operation);
  }
  return {
    ok: true,
    authority,
    commit() {
      for (const operation of targets) {
        if (operation[CHECKOUT_PRICE_AUTHORITY_FIELD] == null) {
          operation[CHECKOUT_PRICE_AUTHORITY_FIELD] = jsonClone(authority);
        }
      }
      return authority;
    },
  };
}

function ticketCatalogCost(ticket) {
  const retailItems = ticketItemsByKind(ticket, { service: false });
  if (!Array.isArray(retailItems)) return null;
  let total = 0;
  for (const item of retailItems) {
    const cost = Number(skuById(item.skuId)?.cost);
    if (!validMoneyDelta(cost)) return null;
    total += cost;
  }
  const rounded = round2(total);
  return validMoneyDelta(rounded) ? rounded : null;
}

function postingByComponent(postings, component) {
  return postings.find((posting) => posting.component === component) || null;
}

function hasOwn(target, key) {
  return isRecord(target) && Object.hasOwn(target, key);
}

function exactRecordKeys(target, expectedKeys) {
  return isRecord(target)
    && stableSerialize(Object.keys(target).sort(compareText))
      === stableSerialize([...expectedKeys].sort(compareText));
}

function snapshotDescriptor(snapshot, key) {
  if (!isRecord(snapshot) || !hasOwn(snapshot, key)) return null;
  const descriptor = snapshot[key];
  if (!isRecord(descriptor) || typeof descriptor.present !== 'boolean') return null;
  const expectedKeys = descriptor.present ? ['present', 'value'] : ['present'];
  return exactRecordKeys(descriptor, expectedKeys) ? descriptor : null;
}

function reservationTicketDetails(ticket, serviceKey, serviceTotal) {
  const details = ticket?.details;
  const expectedKeys = [
    'reservationId', 'customerId', 'dayAbs', 'minute', 'depositPaid',
    'depositReferenceId', 'totalReservationFee', 'priorPaid',
    'priorPaymentMethod', 'checkInAmount',
  ];
  if (!exactRecordKeys(details, expectedKeys)
      || String(details.reservationId) !== serviceKey.reservationId
      || details.customerId !== (ticket.customerId ?? null)
      || !Number.isSafeInteger(details.dayAbs) || details.dayAbs < 0
      || !Number.isSafeInteger(details.minute) || details.minute < 0
      || !validMoneyDelta(Number(details.depositPaid))
      || !validMoneyDelta(Number(details.totalReservationFee))
      || !validMoneyDelta(Number(details.priorPaid))
      || !validMoneyDelta(Number(details.checkInAmount))
      || Number(details.checkInAmount) !== serviceTotal
      || Number(details.depositPaid) > Number(details.priorPaid)
      || round2(Number(details.priorPaid) + serviceTotal)
        !== Number(details.totalReservationFee)
      || (details.depositReferenceId !== null
        && (typeof details.depositReferenceId !== 'string'
          || !details.depositReferenceId))
      || (details.priorPaymentMethod !== null
        && (typeof details.priorPaymentMethod !== 'string'
          || !details.priorPaymentMethod))) return null;
  return details;
}

function reservationCheckInServiceAuthorityMatchesTicket({
  ticketKey,
  alternateTicketKeys = [],
  ticketDraft,
  postings,
}) {
  const reservationKeys = [ticketKey, ...alternateTicketKeys]
    .filter((key) => key?.kind === 'service' && key.type === RESERVATION_CHECK_IN_TYPE);
  if (reservationKeys.length === 0) return true;
  if (reservationKeys.length !== 1 || !Array.isArray(postings)) return false;
  const serviceKey = reservationKeys[0];
  const reservationId = serviceKey.referenceId
    .match(/^reservation:(.+):check-in$/u)?.[1];
  if (!reservationId || ticketDraft?.type !== RESERVATION_CHECK_IN_TYPE
      || ticketDraft.referenceId !== serviceKey.referenceId) return false;
  const serviceItems = ticketItemsByKind(ticketDraft, { service: true });
  const serviceTotal = ticketItemsTotal(serviceItems);
  if (serviceItems?.length !== 1 || serviceTotal == null
      || serviceItems[0].uid !== `${serviceKey.referenceId}:green-fee`
      || serviceItems[0].skuId !== RESERVATION_GREEN_FEE_SKU
      || serviceItems[0].name !== 'Green Fee'
      || !reservationTicketDetails(
        ticketDraft,
        { ...serviceKey, reservationId },
        serviceTotal,
      )) return false;
  const combined = ticketKey.kind === 'transaction';
  const expectedComponent = combined ? 'service' : 'revenue';
  const servicePosting = postingByComponent(postings, expectedComponent);
  const declaredRevenueKey = combined
    ? ticketDraft.serviceRevenueKey : ticketDraft.revenueKey;
  if (declaredRevenueKey !== RESERVATION_REVENUE_KEY
      || (!!servicePosting !== (serviceTotal > 0))) return false;
  if (!servicePosting) return true;
  const spec = servicePosting.spec;
  return spec.lineKey === RESERVATION_REVENUE_KEY
    && spec.category === RESERVATION_REVENUE_KEY
    && Number(spec.amount) === serviceTotal
    && spec.source === 'service-payment'
    && spec.metadata?.type === RESERVATION_CHECK_IN_TYPE
    && spec.metadata?.method === ticketDraft.method
    && (combined
      ? spec.metadata.withGoods === true
      : !hasOwn(spec.metadata, 'withGoods'));
}

function postingEconomicContract(posting) {
  const spec = posting?.spec;
  if (!isRecord(spec)) return false;
  const amount = Number(spec.amount);
  if (!validMoneyDelta(amount) || amount <= 0) return false;
  const expected = {
    sale: {
      direction: 'revenue', accountingClass: 'revenue', cashImpact: amount,
      profitImpact: amount, aggregate: { side: 'revenue', key: 'shopSales', amount },
    },
    service: {
      direction: 'revenue', accountingClass: 'revenue', cashImpact: amount,
      profitImpact: amount, aggregate: { side: 'revenue', key: spec.lineKey, amount },
    },
    revenue: {
      direction: 'revenue', accountingClass: 'revenue', cashImpact: amount,
      profitImpact: amount, aggregate: { side: 'revenue', key: spec.lineKey, amount },
    },
    'sales-tax': {
      direction: 'revenue', accountingClass: 'liability', cashImpact: amount,
      profitImpact: 0, aggregate: null,
    },
    cogs: {
      direction: 'expense', accountingClass: 'cogs', cashImpact: 0,
      profitImpact: -amount, aggregate: null,
    },
    'cash-over-short': {
      direction: 'expense', accountingClass: 'operating', cashImpact: -amount,
      profitImpact: -amount, aggregate: { side: 'expense', key: 'cashOverShort', amount },
    },
    'cash-overage': {
      direction: 'revenue', accountingClass: 'revenue', cashImpact: amount,
      profitImpact: amount, aggregate: { side: 'revenue', key: 'cashOverShort', amount },
    },
  }[posting.component];
  if (!expected) return false;
  const actualAccountingClass = spec.accountingClass || (
    expected.direction === 'revenue'
      ? 'revenue' : posting.component === 'cogs' ? 'cogs' : 'operating'
  );
  const actualCashImpact = hasOwn(spec, 'cashImpact')
    ? Number(spec.cashImpact) : expected.direction === 'expense' ? -amount : amount;
  const actualProfitImpact = hasOwn(spec, 'profitImpact')
    ? Number(spec.profitImpact)
    : expected.direction === 'revenue' ? amount
      : actualAccountingClass === 'operating' || actualAccountingClass === 'cogs'
        ? -amount : 0;
  const actualAggregate = hasOwn(spec, 'aggregate')
    ? spec.aggregate
    : expected.direction === 'revenue'
      ? { side: 'revenue', key: spec.lineKey, amount }
      : actualCashImpact < 0
        ? { side: 'expense', key: spec.lineKey, amount }
        : null;
  return spec.direction === expected.direction
    && actualAccountingClass === expected.accountingClass
    && actualCashImpact === expected.cashImpact
    && actualProfitImpact === expected.profitImpact
    && stableSerialize(actualAggregate) === stableSerialize(expected.aggregate)
    && spec.category === spec.lineKey
    && (posting.component !== 'sale' || spec.lineKey === 'shopSales')
    && (posting.component !== 'sales-tax' || spec.lineKey === 'salesTaxCollected')
    && (posting.component !== 'cogs' || spec.lineKey === 'costOfGoods')
    && (!posting.component.startsWith('cash-over') || spec.lineKey === 'cashOverShort');
}

function variancePostingsMatchTicket(ticket, postings) {
  const lost = Number(ticket?.lost ?? 0);
  if (!checkoutPaymentContract(ticket)) return false;
  const shortage = postingByComponent(postings, 'cash-over-short');
  const overage = postingByComponent(postings, 'cash-overage');
  if (lost > 0) {
    return !!shortage && !overage
      && shortage.spec.direction === 'expense'
      && Number(shortage.spec.amount) === lost;
  }
  return !shortage && !overage;
}

function ticketLedgerBindingsMatch(ticket, postings) {
  if (!isRecord(ticket?.ledgerIdempotencyKeys)
      || !isRecord(ticket?.ledgerEntryIds)) return false;
  const components = postings.map((posting) => posting.component).sort(compareText);
  return stableSerialize(Object.keys(ticket.ledgerIdempotencyKeys).sort(compareText))
      === stableSerialize(components)
    && stableSerialize(Object.keys(ticket.ledgerEntryIds).sort(compareText))
      === stableSerialize(components)
    && postings.every((posting) => (
      ticket.ledgerIdempotencyKeys[posting.component] === posting.spec.idempotencyKey
      && ticket.ledgerEntryIds[posting.component] === posting.spec.entryId
    ));
}

function stampSettlementPlan(plan) {
  const marker = checkoutSettlementMarker(plan.settlementId);
  plan.checkoutSettlement = marker;
  plan.ticketDraft.checkoutSettlement = marker;
  for (const posting of plan.postings || []) {
    posting.spec.metadata = {
      ...(isRecord(posting.spec.metadata) ? posting.spec.metadata : {}),
      checkoutSettlement: marker,
    };
  }
  for (const projection of plan.projections || []) projection.checkoutSettlement = marker;
  if (isRecord(plan.inventory)) plan.inventory.checkoutSettlement = marker;
  if (isRecord(plan.outcomeSpec)) {
    plan.outcomeSpec.metadata = {
      ...(isRecord(plan.outcomeSpec.metadata) ? plan.outcomeSpec.metadata : {}),
      checkoutSettlement: marker,
    };
  }
}

export function checkoutSettlementReceiptForPlan(plan, outcomeId = null) {
  const postingEntryIds = isRecord(plan.ticketDraft?.ledgerEntryIds)
    ? plan.ticketDraft.ledgerEntryIds : {};
  const receipt = {
    version: CHECKOUT_SETTLEMENT_VERSION,
    settlementId: plan.settlementId,
    ticketKey: jsonClone(plan.ticketKey),
    alternateTicketKeys: jsonClone(plan.alternateTicketKeys || []),
    transactionId: plan.ticketKey?.kind === 'transaction'
      ? plan.ticketKey.transactionId : null,
    ticketNumber: plan.ticketNumber,
    minute: Number.isFinite(plan.ticketDraft?.minute) ? plan.ticketDraft.minute : null,
    ticketSnapshot: checkoutSettlementTicketSnapshot(plan.ticketDraft),
    drawer: jsonClone(plan.drawer ?? null),
    projections: jsonClone(plan.projections || []),
    reservationTarget: jsonClone(plan.reservationTarget ?? null),
    inventoryReferenceId: typeof plan.inventory?.referenceId === 'string'
      ? plan.inventory.referenceId : null,
    itemUids: (plan.inventory?.entries || []).map((item) => item.uid),
    postings: (plan.postings || []).map((posting) => ({
      component: posting.component,
      idempotencyKey: posting.spec.idempotencyKey,
      entryId: postingEntryIds[posting.component] || null,
      relatedId: posting.spec.relatedId == null ? null : String(posting.spec.relatedId),
      spec: {
        ...jsonClone(posting.spec),
        entryId: postingEntryIds[posting.component] || null,
      },
    })),
    outcomeKey: typeof plan.outcomeSpec?.idempotencyKey === 'string'
      ? plan.outcomeSpec.idempotencyKey : null,
    outcomeId: typeof outcomeId === 'string' && outcomeId ? outcomeId : null,
    outcomeSpec: jsonClone(plan.outcomeSpec ?? null),
  };
  receipt.signature = signatureFor(receipt);
  return receipt;
}

export function validateCheckoutSettlementReceipt(
  receipt,
  settlementId = receipt?.settlementId,
  state = null,
) {
  if (!isRecord(receipt)) {
    return { ok: false, diagnostic: 'The persisted checkout settlement receipt is invalid.' };
  }
  const primaryKey = receipt?.ticketKey;
  const alternateKeys = receipt?.alternateTicketKeys;
  const safeAlternateKeys = Array.isArray(alternateKeys) ? alternateKeys : [];
  const canonicalId = canonicalCheckoutSettlementId(primaryKey);
  const canonicalPropertyId = state == null ? null : checkoutPropertyId(state);
  const ticketSnapshot = receipt?.ticketSnapshot;
  const ticketKeysValid = validTicketKey(primaryKey)
    && Array.isArray(alternateKeys)
    && alternateKeys.every((key) => validTicketKey(key))
    && new Set([primaryKey, ...alternateKeys].map((key) => stableSerialize(key))).size
      === 1 + alternateKeys.length;
  const commonValid = isRecord(receipt)
    && receipt.version === CHECKOUT_SETTLEMENT_VERSION
    && receipt.settlementId === settlementId
    && receipt.settlementId === canonicalId
    && ticketKeysValid
    && (receipt.transactionId === null
      || (typeof receipt.transactionId === 'string' && receipt.transactionId))
    && Number.isSafeInteger(receipt.ticketNumber) && receipt.ticketNumber > 0
    && (receipt.minute === null
      || (Number.isSafeInteger(receipt.minute) && receipt.minute >= 0))
    && isRecord(ticketSnapshot)
    && ticketSnapshot.number === receipt.ticketNumber
    && (receipt.minute === null
      ? ticketSnapshot.minute == null
      : ticketSnapshot.minute === receipt.minute)
    && markerMatches(ticketSnapshot.checkoutSettlement, settlementId)
    && checkoutSettlementTicketDigest(ticketSnapshot) === stableSerialize(ticketSnapshot)
    && (ticketSnapshot.method === 'cash' || ticketSnapshot.method === 'card')
    && validMoneyDelta(Number(ticketSnapshot.total))
    && Array.isArray(ticketSnapshot.items)
    && ticketSnapshot.items.every((item) => isRecord(item)
      && typeof item.uid === 'string' && item.uid
      && typeof item.skuId === 'string' && item.skuId
      && typeof item.name === 'string'
      && validMoneyDelta(Number(item.price)))
    && new Set(ticketSnapshot.items.map((item) => item.uid)).size
      === ticketSnapshot.items.length
    && [primaryKey, ...safeAlternateKeys].every((key) => ticketKeyMatches(ticketSnapshot, key))
    && customerEventMatchesTicket(ticketSnapshot, primaryKey)
    && (receipt.inventoryReferenceId === null
      || (typeof receipt.inventoryReferenceId === 'string' && receipt.inventoryReferenceId))
    && Array.isArray(receipt.itemUids)
    && receipt.itemUids.every((uid) => typeof uid === 'string' && uid)
    && new Set(receipt.itemUids).size === receipt.itemUids.length
    && Array.isArray(receipt.postings)
    && receipt.postings.every((posting) => isRecord(posting)
      && typeof posting.component === 'string' && posting.component
      && typeof posting.idempotencyKey === 'string' && posting.idempotencyKey
      && typeof posting.entryId === 'string' && posting.entryId
      && (posting.relatedId === null
        || (typeof posting.relatedId === 'string' && posting.relatedId))
      && isRecord(posting.spec)
      && posting.spec.strictIdentity === true
      && posting.spec.idempotencyKey === posting.idempotencyKey
      && posting.spec.entryId === posting.entryId
      && typeof posting.spec.propertyId === 'string' && posting.spec.propertyId
      && (canonicalPropertyId == null || posting.spec.propertyId === canonicalPropertyId)
      && posting.spec.entryId
        === `le:${posting.spec.propertyId}:${posting.spec.idempotencyKey}`
      && posting.spec.timestamp === receipt.minute
      && posting.spec.day === Math.floor(receipt.minute / 1440)
      && posting.spec.relatedId != null
      && String(posting.spec.relatedId) === posting.relatedId
      && validMoneyDelta(Number(posting.spec.amount))
      && Number(posting.spec.amount) > 0
      && postingEconomicContract(posting)
      && markerMatches(posting.spec.metadata?.checkoutSettlement, settlementId))
    && new Set(receipt.postings.map((posting) => posting.component)).size
      === receipt.postings.length
    && new Set(receipt.postings.map((posting) => posting.idempotencyKey)).size
      === receipt.postings.length
    && (receipt.outcomeKey === null
      || (typeof receipt.outcomeKey === 'string' && receipt.outcomeKey))
    && (receipt.outcomeId === null
      || (typeof receipt.outcomeId === 'string' && receipt.outcomeId))
    && ((receipt.outcomeKey === null) === (receipt.outcomeId === null))
    && typeof receipt.signature === 'string'
    && signatureFor(receipt) === receipt.signature
    && ticketLedgerBindingsMatch(ticketSnapshot, receipt.postings)
    && reservationTargetMatchesTicket({
      ticketKey: primaryKey,
      alternateTicketKeys: safeAlternateKeys,
      ticketDraft: ticketSnapshot,
      postings: receipt.postings,
      ticketNumber: receipt.ticketNumber,
      reservationTarget: receipt.reservationTarget ?? null,
    })
    && reservationCustomerEventMatchesTicket({
      ticketKey: primaryKey,
      alternateTicketKeys: safeAlternateKeys,
      ticketDraft: ticketSnapshot,
    })
    && terminalReservationTargetMatchesState(
      state,
      receipt.reservationTarget ?? null,
      receipt.minute,
    )
    && reservationCheckInServiceAuthorityMatchesTicket({
      ticketKey: primaryKey,
      alternateTicketKeys: safeAlternateKeys,
      ticketDraft: ticketSnapshot,
      postings: receipt.postings,
    });
  if (!commonValid) {
    return { ok: false, diagnostic: 'The persisted checkout settlement receipt is invalid.' };
  }
  if (primaryKey.kind === 'service') {
    const serviceItems = ticketItemsByKind(ticketSnapshot, { service: true });
    const serviceTotal = ticketItemsTotal(serviceItems);
    const revenue = postingByComponent(receipt.postings, 'revenue');
    const allowedComponents = new Set(['revenue', 'cash-over-short']);
    const validService = primaryKey.type === RESERVATION_CHECK_IN_TYPE
      && receipt.transactionId === null
      && receipt.inventoryReferenceId === null
      && receipt.itemUids.length === 0
      && receipt.outcomeKey === null
      && receipt.outcomeId === null
      && receipt.outcomeSpec === null
      && Array.isArray(receipt.projections) && receipt.projections.length === 0
      && alternateKeys.length === 0
      && serviceItems?.length > 0
      && serviceItems?.length === ticketSnapshot.items.length
      && serviceTotal === Number(ticketSnapshot.total)
      && (!!revenue === (serviceTotal > 0))
      && (!revenue || (revenue.spec.direction === 'revenue'
        && Number(revenue.spec.amount) === serviceTotal
        && revenue.spec.lineKey === ticketSnapshot.revenueKey
        && revenue.spec.customerCount === 1))
      && checkoutPaymentContract(ticketSnapshot)
      && receipt.postings.every((posting) => allowedComponents.has(posting.component))
      && variancePostingsMatchTicket(ticketSnapshot, receipt.postings)
      && serviceAuthoritiesMatchTicket({
        ticketDraft: ticketSnapshot,
        postings: receipt.postings,
        drawer: receipt.drawer,
      })
      && receipt.postings.every((posting) => postingMatchesTicketKeys(
        primaryKey,
        alternateKeys,
        posting,
        { receipt: true },
      ));
    return validService
      ? { ok: true, kind: 'service', ticketKey: primaryKey }
      : { ok: false, diagnostic: 'The persisted service settlement receipt is invalid.' };
  }
  const inventoryIdentity = checkoutInventoryIdentity(receipt.inventoryReferenceId);
  const snapshotInventoryPairs = ticketInventoryPairs(ticketSnapshot);
  const sortedItemUids = [...receipt.itemUids].sort(compareText);
  const expectedItemUids = inventoryIdentity?.items.map(([uid]) => uid).sort(compareText) || [];
  const alternateServiceKeys = alternateKeys.filter((key) => key.kind === 'service');
  const serviceItems = ticketItemsByKind(ticketSnapshot, { service: true });
  const serviceTotal = ticketItemsTotal(serviceItems);
  const servicePosting = postingByComponent(receipt.postings, 'service');
  const salePosting = postingByComponent(receipt.postings, 'sale');
  const taxPosting = postingByComponent(receipt.postings, 'sales-tax');
  const cogsPosting = postingByComponent(receipt.postings, 'cogs');
  const catalogCost = ticketCatalogCost(ticketSnapshot);
  const retailItems = ticketItemsByKind(ticketSnapshot, { service: false });
  const ticketNet = Number(ticketSnapshot.net);
  const ticketTax = Number(ticketSnapshot.tax ?? 0);
  const declaredServiceTotal = Number(ticketSnapshot.serviceTotal ?? 0);
  const allowedComponents = new Set([
    'sale', 'service', 'sales-tax', 'cogs', 'cash-over-short',
  ]);
  const saleKey = `checkout:${primaryKey.transactionId}:sale`;
  const outcomeKey = `checkout:${primaryKey.transactionId}:completed`;
  const validTransaction = receipt.transactionId === primaryKey.transactionId
    && inventoryIdentity?.transactionId === primaryKey.transactionId
    && stableSerialize(snapshotInventoryPairs) === stableSerialize(inventoryIdentity?.items)
    && stableSerialize(sortedItemUids) === stableSerialize(expectedItemUids)
    && alternateServiceKeys.length === alternateKeys.length
    && alternateServiceKeys.length <= 1
    && alternateServiceKeys.every((key) => key.type === RESERVATION_CHECK_IN_TYPE)
    && serviceItems != null
    && serviceTotal != null
    && (serviceItems.length > 0) === (alternateServiceKeys.length === 1)
    && declaredServiceTotal === serviceTotal
    && (!!servicePosting === (serviceTotal > 0))
    && (!servicePosting || (servicePosting.spec.direction === 'revenue'
      && Number(servicePosting.spec.amount) === serviceTotal
      && servicePosting.spec.lineKey === ticketSnapshot.serviceRevenueKey
      && servicePosting.spec.customerCount === 1
      && servicePosting.spec.metadata?.type === alternateServiceKeys[0]?.type))
    && validMoneyDelta(ticketNet) && ticketNet > 0
    && !!salePosting
    && salePosting.idempotencyKey === saleKey
    && salePosting.spec.direction === 'revenue'
    && Number(salePosting.spec.amount) === ticketNet
    && salePosting.spec.units === retailItems?.length
    && salePosting.spec.customerCount === 1
    && validMoneyDelta(ticketTax)
    && (!!taxPosting === (ticketTax > 0))
    && (!taxPosting || (taxPosting.spec.direction === 'revenue'
      && Number(taxPosting.spec.amount) === ticketTax
      && taxPosting.spec.customerCount === 1))
    && catalogCost != null
    && (!!cogsPosting === (catalogCost > 0))
    && (!cogsPosting || (Number(cogsPosting.spec.amount) === catalogCost
      && cogsPosting.spec.units === retailItems.length
      && stableSerialize(cogsPosting.spec.metadata?.skuIds)
        === stableSerialize(retailItems.map((item) => item.skuId))))
    && round2(ticketNet + ticketTax + serviceTotal) === Number(ticketSnapshot.total)
    && checkoutPaymentContract(ticketSnapshot)
    && receipt.postings.every((posting) => allowedComponents.has(posting.component))
    && variancePostingsMatchTicket(ticketSnapshot, receipt.postings)
    && receipt.postings.every((posting) => postingMatchesTicketKeys(
      primaryKey,
      alternateKeys,
      posting,
      { receipt: true },
    ))
    && receipt.outcomeKey === outcomeKey
    && typeof receipt.outcomeId === 'string' && receipt.outcomeId
    && isRecord(receipt.outcomeSpec)
    && (canonicalPropertyId == null
      || receipt.outcomeSpec.propertyId === canonicalPropertyId)
    && receipt.outcomeSpec.idempotencyKey === receipt.outcomeKey
    && receipt.outcomeSpec.id === receipt.outcomeId
    && markerMatches(receipt.outcomeSpec.metadata?.checkoutSettlement, settlementId)
    && Array.isArray(receipt.projections)
    && new Set(receipt.projections.map((projection) => projection.kind)).size
      === receipt.projections.length
    && receipt.projections.every((projection) => validProjectionPlan(projection)
      && projection.id === (projection.kind === 'sales'
        ? `${settlementId}:sales-projection`
        : `${settlementId}:tax-projection`))
    && receipt.projections.every((projection) => markerMatches(
      projection.checkoutSettlement,
      settlementId,
    ))
    && transactionAuthoritiesMatchTicket({
      ticketDraft: ticketSnapshot,
      postings: receipt.postings,
      projections: receipt.projections,
      outcomeSpec: receipt.outcomeSpec,
      drawer: receipt.drawer,
    })
    && checkoutReceiptPriceAuthorityMatchesState(state, receipt, ticketSnapshot);
  return validTransaction
    ? { ok: true, kind: 'transaction', ticketKey: primaryKey, inventoryIdentity }
    : { ok: false, diagnostic: 'The persisted transaction settlement receipt is invalid.' };
}

function validReceipt(receipt, settlementId = receipt?.settlementId, state = null) {
  return validateCheckoutSettlementReceipt(receipt, settlementId, state).ok;
}

export function validateCheckoutSettlementReceipts(value, order, state = null) {
  if (!isRecord(value) || !Array.isArray(order)) {
    return { ok: false, diagnostic: 'The persisted checkout settlement receipts are invalid.' };
  }
  const orderSet = new Set(order);
  if (Object.keys(value).length > MAX_SETTLEMENT_RECEIPTS
      || order.length > MAX_SETTLEMENT_RECEIPTS
      || orderSet.size !== order.length
      || order.some((settlementId) => typeof settlementId !== 'string'
        || !Object.hasOwn(value, settlementId))
      || Object.keys(value).some((settlementId) => !orderSet.has(settlementId)
        || !validReceipt(value[settlementId], settlementId, state))) {
    return { ok: false, diagnostic: 'The persisted checkout settlement receipts are invalid.' };
  }
  return { ok: true };
}

export function validateCheckoutSettlementAuthorities(state) {
  const shop = state?.shop;
  const required = [
    'pendingCheckouts',
    'checkoutSettlementReceipts',
    'checkoutSettlementReceiptKeys',
    'checkoutProjectionIds',
  ];
  if (!isRecord(shop) || required.some((field) => !Object.hasOwn(shop, field))) {
    return { ok: false, diagnostic: 'The checkout settlement authority is incomplete.' };
  }
  const wal = validateCheckoutWalRecord(shop.pendingCheckouts, state);
  if (!wal.ok) return wal;
  const receipts = validateCheckoutSettlementReceipts(
    shop.checkoutSettlementReceipts,
    shop.checkoutSettlementReceiptKeys,
    state,
  );
  if (!receipts.ok) return receipts;
  if (!isRecord(shop.checkoutProjectionIds)
      || Object.entries(shop.checkoutProjectionIds).some(([id, projection]) => {
        const settlementId = projection?.checkoutSettlement?.settlementId;
        const owningPlan = isRecord(shop.pendingCheckouts)
          ? shop.pendingCheckouts[settlementId] : null;
        const plannedProjection = (owningPlan?.projections || [])
          .find((candidate) => candidate.id === id);
        return typeof id !== 'string' || !id
          || !isRecord(projection)
          || !markerMatches(projection.checkoutSettlement, settlementId)
          || (id !== `${settlementId}:sales-projection`
            && id !== `${settlementId}:tax-projection`)
          || typeof projection.signature !== 'string' || !projection.signature
          || !isRecord(projection.after)
          || (projection.status !== 'prepared' && projection.status !== 'applied')
          || !plannedProjection
          || projection.signature !== projectionSignature(plannedProjection)
          || stableSerialize(projection.after) !== stableSerialize(plannedProjection.after);
      })) {
    return { ok: false, diagnostic: 'The checkout projection authority is invalid.' };
  }
  return { ok: true };
}

function copyStack(stack) {
  const out = {};
  for (const [denom, count] of Object.entries(stack || {})) {
    if (Number.isInteger(count) && count > 0) out[denom] = count;
  }
  return out;
}

function sameStack(left, right) {
  return stableSerialize(copyStack(left)) === stableSerialize(copyStack(right));
}

function stackCents(stack) {
  if (!isRecord(stack)) return null;
  let cents = 0;
  for (const [rawDenomination, count] of Object.entries(stack)) {
    const denomination = Number(rawDenomination);
    if (!Number.isFinite(denomination) || denomination <= 0
        || !Number.isSafeInteger(count) || count <= 0
        || !Number.isSafeInteger(Math.round(denomination * 100))
        || !CHECKOUT_DRAWER_DENOMINATION_CENTS.has(
          Math.round(denomination * 100),
        )) return null;
    const next = cents + Math.round(denomination * 100) * count;
    if (!Number.isSafeInteger(next)) return null;
    cents = next;
  }
  return cents;
}

function expectedPerSku(ticket) {
  const perSku = {};
  for (const item of ticketItemsByKind(ticket, { service: false }) || []) {
    perSku[item.skuId] = (perSku[item.skuId] || 0) + 1;
  }
  return perSku;
}

function transactionAuthoritiesMatchTicket(plan) {
  const ticket = plan.ticketDraft;
  const retailItems = ticketItemsByKind(ticket, { service: false });
  if (!Array.isArray(retailItems) || retailItems.length === 0) return false;
  const saleRevenue = Number(ticket.net);
  const tax = Number(ticket.tax ?? 0);
  const ticketTotal = Number(ticket.total);
  const lost = Number(ticket.lost ?? 0);
  const ticketCash = Number(ticket.cash);
  const perSku = expectedPerSku(ticket);
  const catalogCost = ticketCatalogCost(ticket);
  const cogsPosting = postingByComponent(plan.postings, 'cogs');
  const salePosting = postingByComponent(plan.postings, 'sale');
  const taxPosting = postingByComponent(plan.postings, 'sales-tax');
  const salesProjection = (plan.projections || [])
    .find((projection) => projection.kind === 'sales');
  const taxProjection = (plan.projections || [])
    .find((projection) => projection.kind === 'tax') || null;
  if (!salesProjection
      || salesProjection.delta.units !== retailItems.length
      || salesProjection.delta.revenue !== saleRevenue
      || stableSerialize(salesProjection.delta.perSku) !== stableSerialize(perSku)) return false;
  if (!salePosting || salePosting.spec.units !== retailItems.length
      || salePosting.spec.customerCount !== 1
      || (taxPosting && taxPosting.spec.customerCount !== 1)) return false;
  if (catalogCost == null
      || (!!cogsPosting !== (catalogCost > 0))
      || (cogsPosting && (Number(cogsPosting.spec.amount) !== catalogCost
        || cogsPosting.spec.units !== retailItems.length
        || stableSerialize(cogsPosting.spec.metadata?.skuIds)
          !== stableSerialize(retailItems.map((item) => item.skuId))))) return false;
  if (tax > 0) {
    if (!taxProjection
        || taxProjection.delta.collected !== tax
        || taxProjection.delta.owed !== tax
        || taxProjection.delta.taxableSales !== saleRevenue) return false;
  } else if (taxProjection) return false;

  const outcome = plan.outcomeSpec;
  if (!isRecord(outcome)
      || outcome.count !== 1
      || Number(outcome.amount) !== ticketTotal
      || outcome.day !== Math.floor(Math.round(Number(ticket.minute)) / 1440)
      || outcome.timestamp !== Math.round(Number(ticket.minute))
      || !isRecord(outcome.metadata)
      || outcome.metadata.units !== retailItems.length
      || outcome.metadata.method !== ticket.method
      || (ticket.type == null
        ? (Object.hasOwn(outcome.metadata, 'serviceRevenue')
          || Object.hasOwn(outcome.metadata, 'serviceType'))
        : (Number(outcome.metadata.serviceRevenue) !== Number(ticket.serviceTotal)
          || outcome.metadata.serviceType !== ticket.type))) return false;

  if (!checkoutPaymentContract(ticket)) return false;
  if (ticket.method === 'card') {
    return lost === 0 && ticketCash === ticketTotal && plan.drawer == null;
  }
  if (ticket.method !== 'cash') return false;
  const beforeCents = stackCents(plan.drawer?.before);
  const afterCents = stackCents(plan.drawer?.after);
  return beforeCents != null && afterCents != null
    && afterCents - beforeCents === Math.round(ticketCash * 100);
}

function serviceAuthoritiesMatchTicket(plan) {
  const ticket = plan.ticketDraft;
  const total = Number(ticket.total);
  const lost = Number(ticket.lost ?? 0);
  const ticketCash = Number(ticket.cash);
  if (!validMoneyDelta(total) || !checkoutPaymentContract(ticket)) return false;
  if (ticket.method === 'card') {
    return lost === 0 && ticketCash === total && plan.drawer == null;
  }
  if (ticket.method !== 'cash') return false;
  if (total === 0) return lost === 0 && ticketCash === 0 && plan.drawer == null;
  const beforeCents = stackCents(plan.drawer?.before);
  const afterCents = stackCents(plan.drawer?.after);
  return beforeCents != null && afterCents != null
    && afterCents - beforeCents === Math.round(ticketCash * 100);
}

function customerEventMatchesTicket(ticket, ticketKey) {
  const event = ticket?.customerVisitEvent;
  if (event == null) return true;
  if (!isRecord(event) || event.countsAsVisit !== true
      || event.customerId !== ticket.customerId
      || event.paymentMethod !== ticket.method
      || Number(event.amount) !== Number(ticket.total)) return false;
  const expectedId = ticketKey.kind === 'transaction'
    ? `checkout:${ticketKey.transactionId}:customer-visit`
    : `service:${ticketKey.type}:${ticketKey.referenceId}:customer-visit`;
  return event.id === expectedId
    && (ticket.details?.reservationId == null
      || event.reservationId === String(ticket.details.reservationId))
    && (ticket.details?.dayAbs == null || event.dayAbs === ticket.details.dayAbs);
}

function reservationCustomerEventMatchesTicket(plan) {
  const keys = [plan.ticketKey, ...(plan.alternateTicketKeys || [])];
  const reservationKeys = keys.filter((key) => (
    key?.kind === 'service' && key.type === RESERVATION_CHECK_IN_TYPE
  ));
  if (reservationKeys.length === 0) return true;
  if (reservationKeys.length !== 1) return false;
  const ticket = plan.ticketDraft;
  const event = ticket?.customerVisitEvent;
  const details = ticket?.details;
  if (!isRecord(event) || !isRecord(details)
      || String(event.reservationId) !== String(details.reservationId)
      || event.dayAbs !== details.dayAbs) return false;
  if (plan.ticketKey.kind === 'transaction') {
    return event.purpose === 'tee-time+retail'
      && stableSerialize(event.outcomes) === stableSerialize(['purchase', 'check-in']);
  }
  return (event.purpose === 'tee-time' || event.purpose === 'walk-in-tee')
    && stableSerialize(event.outcomes) === stableSerialize(['check-in']);
}

function reservationTargetMatchesTicket(plan) {
  const target = plan.reservationTarget;
  const reservationKeys = [plan.ticketKey, ...(plan.alternateTicketKeys || [])]
    .filter((key) => key.kind === 'service' && key.type === RESERVATION_CHECK_IN_TYPE);
  if (target == null) return reservationKeys.length === 0;
  if (!exactRecordKeys(target, [
    'reservationId', 'expected', 'fields', 'paymentExpected', 'paymentFields',
  ]) || typeof target.reservationId !== 'string' || !target.reservationId
      || !isRecord(target.expected) || !isRecord(target.fields)) return false;
  const serviceKey = reservationKeys.length === 1 ? reservationKeys[0] : null;
  const expectedReferenceId = `reservation:${target.reservationId}:check-in`;
  const serviceTotal = ticketItemsTotal(ticketItemsByKind(
    plan.ticketDraft,
    { service: true },
  ));
  if (!serviceKey || serviceKey.referenceId !== expectedReferenceId
      || serviceTotal == null
      || !reservationCheckInServiceAuthorityMatchesTicket(plan)) return false;

  const fields = target.fields;
  const expected = target.expected;
  const expectedBaseKeys = [
    'status', 'reservationStatus', 'checkedInAt', 'checkInReferenceId',
    'paymentMethod', 'paidAmount', 'totalPaid', 'paymentStatus',
    'currentDestination', 'arrivalStatus', 'checkInStatus', 'checkIn',
    'arrival', 'courseAccess', 'party', 'fee', 'depositPaid',
    'depositReferenceId',
  ];
  const expectedHasBalances = hasOwn(expected, 'balanceDue')
    || hasOwn(expected, 'remainingBalance');
  if (expectedHasBalances
      && (!hasOwn(expected, 'balanceDue') || !hasOwn(expected, 'remainingBalance'))) {
    return false;
  }
  const expectedKeys = expectedHasBalances
    ? [...expectedBaseKeys, 'balanceDue', 'remainingBalance'] : expectedBaseKeys;
  if (!exactRecordKeys(expected, expectedKeys)
      || expectedKeys.some((key) => !snapshotDescriptor(expected, key))) return false;

  const partyExpected = snapshotDescriptor(expected, 'party');
  const fieldKeys = [
    'status', 'reservationStatus', 'checkedInAt', 'checkInReferenceId',
    'paymentMethod', 'paidAmount', 'totalPaid', 'paymentStatus',
    'currentDestination', 'arrivalStatus', 'checkInStatus', 'checkIn',
    'arrival', 'courseAccess', 'checkInTransactionNumber',
    ...(partyExpected.present ? ['party'] : []),
    ...(expectedHasBalances ? ['balanceDue', 'remainingBalance'] : []),
  ];
  if (!exactRecordKeys(fields, fieldKeys)) return false;

  const statusExpected = snapshotDescriptor(expected, 'status');
  const feeExpected = snapshotDescriptor(expected, 'fee');
  const depositPaidExpected = snapshotDescriptor(expected, 'depositPaid');
  const depositReferenceExpected = snapshotDescriptor(expected, 'depositReferenceId');
  if (!statusExpected.present || statusExpected.value !== 'booked'
      || !feeExpected.present || !validMoneyDelta(Number(feeExpected.value))) return false;
  const depositPaid = depositPaidExpected.present
    ? Number(depositPaidExpected.value) : 0;
  if (!validMoneyDelta(depositPaid)) return false;
  const depositReferenceId = depositReferenceExpected.present
    ? depositReferenceExpected.value : null;
  if (depositReferenceId !== null
      && (typeof depositReferenceId !== 'string' || !depositReferenceId)) return false;

  const paymentKeys = ['total', 'amountPaid', 'amountDue', 'status', 'method', 'pending'];
  const hasPayment = target.paymentExpected !== null || target.paymentFields !== null;
  if ((target.paymentExpected === null) !== (target.paymentFields === null)) return false;
  let priorPaid = depositPaid;
  let paymentTotal = Number(feeExpected.value);
  let priorPaymentMethod = null;
  if (hasPayment) {
    if (!exactRecordKeys(target.paymentExpected, paymentKeys)
        || paymentKeys.some((key) => !snapshotDescriptor(target.paymentExpected, key))
        || !exactRecordKeys(target.paymentFields, paymentKeys)) return false;
    const totalExpected = snapshotDescriptor(target.paymentExpected, 'total');
    const amountPaidExpected = snapshotDescriptor(target.paymentExpected, 'amountPaid');
    const amountDueExpected = snapshotDescriptor(target.paymentExpected, 'amountDue');
    const methodExpected = snapshotDescriptor(target.paymentExpected, 'method');
    if (totalExpected.present) paymentTotal = Number(totalExpected.value);
    const canonicalPaid = amountPaidExpected.present
      ? Number(amountPaidExpected.value) : 0;
    const canonicalDue = amountDueExpected.present
      ? Number(amountDueExpected.value) : round2(paymentTotal - canonicalPaid);
    if (!validMoneyDelta(paymentTotal) || !validMoneyDelta(canonicalPaid)
        || !validMoneyDelta(canonicalDue)
        || round2(canonicalPaid + canonicalDue) !== paymentTotal) return false;
    priorPaid = Math.max(priorPaid, canonicalPaid);
    priorPaymentMethod = methodExpected.present ? methodExpected.value : null;
    if (priorPaymentMethod !== null
        && (typeof priorPaymentMethod !== 'string' || !priorPaymentMethod)) return false;
  }
  priorPaid = round2(priorPaid);
  const totalPaid = round2(priorPaid + serviceTotal);
  const ticket = plan.ticketDraft;
  const details = reservationTicketDetails(
    ticket,
    { ...serviceKey, reservationId: target.reservationId },
    serviceTotal,
  );
  if (!details || paymentTotal !== Number(feeExpected.value)
      || totalPaid !== paymentTotal
      || Number(details.priorPaid) !== priorPaid
      || Number(details.totalReservationFee) !== paymentTotal
      || Number(details.depositPaid) !== depositPaid
      || details.depositReferenceId !== depositReferenceId
      || details.priorPaymentMethod !== priorPaymentMethod
      || String(details.reservationId) !== target.reservationId
      || details.customerId !== (ticket.customerId ?? null)) return false;

  if (fields.status !== 'played'
      || fields.reservationStatus !== 'played'
      || fields.checkedInAt !== ticket.minute
      || fields.checkInReferenceId !== expectedReferenceId
      || fields.paymentMethod !== ticket.method
      || Number(fields.paidAmount) !== serviceTotal
      || Number(fields.totalPaid) !== totalPaid
      || fields.paymentStatus !== 'paid'
      || fields.currentDestination !== 'course'
      || fields.arrivalStatus !== 'arrived'
      || fields.checkInStatus !== 'checked-in'
      || fields.checkInTransactionNumber !== plan.ticketNumber
      || (expectedHasBalances
        && (Number(fields.balanceDue) !== 0 || Number(fields.remainingBalance) !== 0))) {
    return false;
  }
  if (!hasPayment) return true;
  const paymentMethod = serviceTotal > 0
    ? ticket.method : (priorPaymentMethod || ticket.method || null);
  return Number(target.paymentFields.total) === paymentTotal
    && Number(target.paymentFields.amountPaid) === totalPaid
    && Number(target.paymentFields.amountDue) === 0
    && target.paymentFields.status === 'paid'
    && target.paymentFields.method === paymentMethod
    && target.paymentFields.pending === null;
}

function terminalReservationTargetMatchesState(state, target, minute) {
  if (state == null || target == null) return true;
  const reservation = (Array.isArray(state?.reservations?.booked)
    ? state.reservations.booked : [])
    .find((entry) => String(entry?.id) === target.reservationId);
  if (!reservation) {
    const currentDay = Math.floor((Number(state?.clock?.minutes) || 0) / 1440);
    const receiptDay = Number.isFinite(minute) ? Math.floor(minute / 1440) : currentDay;
    return currentDay - receiptDay > 30;
  }
  const irreversibleFields = [
    'status', 'reservationStatus', 'checkedInAt', 'checkInReferenceId',
    'paymentMethod', 'paidAmount', 'totalPaid', 'paymentStatus',
    'checkInTransactionNumber',
  ];
  return irreversibleFields.every((key) => (
    stableSerialize(reservation[key]) === stableSerialize(target.fields?.[key])
  )) && (target.paymentFields == null
    || matchesFields(reservation.payment, target.paymentFields));
}

function pendingMap(state, { create = false } = {}) {
  if (!state?.shop) return null;
  if (checkoutWalIsQuarantined(state)) return null;
  if (state.shop.pendingCheckouts == null) {
    if (!create) return null;
    state.shop.pendingCheckouts = {};
  }
  if (!isRecord(state.shop.pendingCheckouts)) return null;
  return state.shop.pendingCheckouts;
}

function preflightPendingJournal(state, settlementId) {
  const shop = state?.shop;
  if (!isRecord(shop)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The shop checkout journal is unavailable.' };
  }
  if (checkoutWalIsQuarantined(state)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The shop checkout journal is quarantined.' };
  }
  if (shop.pendingCheckouts == null) {
    if (!canAssignProperty(shop, 'pendingCheckouts')) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The shop checkout journal is not writable.' };
    }
    return { ok: true, pending: null };
  }
  if (!isRecord(shop.pendingCheckouts)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The shop checkout journal is unavailable.' };
  }
  const pending = shop.pendingCheckouts;
  if (Object.hasOwn(pending, settlementId)) {
    if (!canDeleteProperty(pending, settlementId)) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout settlement journal is not writable.' };
    }
  } else if (!canAssignProperty(pending, settlementId)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The shop checkout journal is not writable.' };
  }
  return { ok: true, pending };
}

function operationMap(state, { create = false } = {}) {
  if (!state?.shop) return null;
  if (state.shop.checkoutProjectionIds == null) {
    if (!create) return null;
    state.shop.checkoutProjectionIds = {};
  }
  if (!isRecord(state.shop.checkoutProjectionIds)) return null;
  return state.shop.checkoutProjectionIds;
}

export function pendingCheckout(state, settlementId) {
  const pending = pendingMap(state);
  return pending && typeof settlementId === 'string' ? pending[settlementId] || null : null;
}

export function pendingCheckoutCount(state) {
  if (checkoutWalIsQuarantined(state)) return 1;
  const pending = pendingMap(state);
  return pending ? Object.keys(pending).length : 0;
}

function validAllocation(allocation) {
  return isRecord(allocation)
    && typeof allocation.lotId === 'string'
    && allocation.lotId.length > 0
    && Number.isSafeInteger(allocation.quantity)
    && allocation.quantity > 0;
}

function normalizedAllocations(allocations) {
  if (!Array.isArray(allocations) || allocations.some((allocation) => !validAllocation(allocation))) {
    return Array.isArray(allocations)
      ? allocations.map((allocation) => ({
        lotId: allocation?.lotId,
        quantity: allocation?.quantity,
      }))
      : [];
  }
  const totals = new Map();
  for (const allocation of allocations || []) {
    const lotId = allocation?.lotId;
    const quantity = allocation?.quantity;
    totals.set(lotId, (totals.get(lotId) || 0) + quantity);
  }
  return [...totals]
    .map(([lotId, quantity]) => ({ lotId, quantity }))
    .sort((a, b) => compareText(a.lotId, b.lotId) || a.quantity - b.quantity);
}

function allocationsCover(available, required) {
  const totals = new Map(
    normalizedAllocations(available).map((allocation) => [allocation.lotId, allocation.quantity]),
  );
  return normalizedAllocations(required).every((allocation) => (
    (totals.get(allocation.lotId) || 0) >= allocation.quantity
  ));
}

function referencedAllocationLots(state, allocations) {
  const requested = new Set((allocations || []).map((allocation) => allocation?.lotId));
  const lots = new Map();
  for (const lot of state?.shop?.inventoryLifecycle?.lots || []) {
    if (!requested.has(lot?.id)) continue;
    if (lots.has(lot.id)) {
      return {
        ok: false,
        conflict: true,
        reason: t('checkout.integrityUnavailable'), diagnostic: `Inventory lot ${lot.id} is ambiguous.`,
      };
    }
    lots.set(lot.id, lot);
  }
  for (const lotId of requested) {
    if (!lots.has(lotId)) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Requested inventory lot is unavailable.' };
    }
  }
  return { ok: true, lots };
}

function allocationsMatchEntries(state, allocations, entries) {
  const expected = new Map();
  for (const entry of entries) expected.set(entry.skuId, (expected.get(entry.skuId) || 0) + 1);
  const resolved = referencedAllocationLots(state, allocations);
  if (!resolved.ok) return false;
  const actual = new Map();
  for (const allocation of allocations) {
    const lot = resolved.lots.get(allocation.lotId);
    if (!lot || typeof lot.skuId !== 'string' || !lot.skuId) return false;
    actual.set(lot.skuId, (actual.get(lot.skuId) || 0) + allocation.quantity);
  }
  if (actual.size !== expected.size) return false;
  return [...expected].every(([skuId, quantity]) => actual.get(skuId) === quantity);
}

function allocationsReachedSold(state, allocations) {
  const resolved = referencedAllocationLots(state, allocations);
  if (!resolved.ok) return false;
  return normalizedAllocations(allocations).every((allocation) => {
    const lot = resolved.lots.get(allocation.lotId);
    const held = lot?.buckets?.[INVENTORY_STAGE.CUSTOMER_HELD] ?? 0;
    const sold = lot?.buckets?.[INVENTORY_STAGE.SOLD] ?? 0;
    return lot
      && Number.isSafeInteger(held) && held >= 0
      && Number.isSafeInteger(sold) && sold >= allocation.quantity;
  });
}

function allocationCanMoveToSold(lot, quantity) {
  const held = lot?.buckets?.[INVENTORY_STAGE.CUSTOMER_HELD] ?? 0;
  const sold = lot?.buckets?.[INVENTORY_STAGE.SOLD] ?? 0;
  return isRecord(lot)
    && isRecord(lot.buckets)
    && lot.active !== false
    && Number.isSafeInteger(held)
    && held >= quantity
    && Number.isSafeInteger(sold)
    && sold >= 0
    && Number.isSafeInteger(sold + quantity);
}

// Build the immutable inventory half of a settlement without changing stock.
// UID/SKU pairs are encoded as JSON and bound to the settlement identity, so a
// single UID containing a delimiter cannot collide with a multi-item basket.
export function prepareCheckoutInventory(state, items, transactionId, priceAuthority = null) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The sale has no held products.' };
  }
  if (typeof transactionId !== 'string' || !transactionId) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The sale has no settlement identity.' };
  }
  if (!validCheckoutPriceAuthority(priceAuthority)
      || priceAuthority.transactionId !== transactionId) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The sale has no independent price authority.' };
  }

  const seen = new Set();
  const entries = [];
  const held = Array.isArray(state?.shop?.held) ? state.shop.held : [];
  const heldAllocations = state?.shop?.inventoryLifecycle?.heldAllocations || {};
  const pairs = [];
  const liveAllocations = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item.uid !== 'string' || !item.uid
        || typeof item.skuId !== 'string' || !item.skuId) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Every sold product needs a held UID and SKU.' };
    }
    if (seen.has(item.uid)) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: `Held UID ${item.uid} appears twice in the sale.` };
    }
    seen.add(item.uid);
    pairs.push([item.uid, item.skuId]);
  }
  pairs.sort((left, right) => compareText(left[0], right[0]) || compareText(left[1], right[1]));
  const referenceId = `checkout-sale-batch:v2:${JSON.stringify({
    transactionId,
    items: pairs,
  })}`;
  const prior = state?.shop?.inventoryLifecycle?.operations?.[referenceId] || null;

  for (const [uid, skuId] of pairs) {
    const matches = held.filter((entry) => entry?.uid === uid);
    if (matches.length === 0) {
      if (!prior) return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: `Held UID ${uid} is no longer available.` };
    }
    if (matches.length > 1) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: `Held UID ${uid} is ambiguous in inventory.` };
    }
    if (matches.length === 1 && matches[0].skuId !== skuId) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: `Held UID ${uid} does not match ${skuId}.` };
    }
    const itemAllocations = heldAllocations[uid];
    if (matches.length === 1) {
      if (!Array.isArray(itemAllocations) || !itemAllocations.length
          || itemAllocations.some((allocation) => !validAllocation(allocation))
          || itemAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0) !== 1) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Checkout inventory provenance is incomplete.' };
      }
      liveAllocations.push(...itemAllocations);
    } else if (!prior) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Checkout inventory provenance is incomplete.' };
    }
    entries.push({
      uid,
      skuId,
    });
  }
  entries.sort((a, b) => compareText(a.uid, b.uid) || compareText(a.skuId, b.skuId));
  const allocations = normalizedAllocations(
    prior?.allocations || pairs.flatMap(([uid]) => heldAllocations[uid]),
  );
  const resolvedLots = referencedAllocationLots(state, allocations);
  if (!resolvedLots.ok) return resolvedLots;
  if (allocations.some((allocation) => !validAllocation(allocation))
      || allocations.reduce((sum, allocation) => sum + allocation.quantity, 0) !== entries.length
      || !allocationsMatchEntries(state, allocations, entries)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Checkout inventory provenance is incomplete.' };
  }
  if (!prior) {
    for (const allocation of normalizedAllocations(allocations)) {
      const lot = resolvedLots.lots.get(allocation.lotId);
      if (!isRecord(lot) || lot.active === false) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Requested inventory lot is unavailable.' };
      }
      const available = lot?.buckets?.[INVENTORY_STAGE.CUSTOMER_HELD];
      if (!Number.isSafeInteger(available) || available < allocation.quantity) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Not enough inventory in the requested lot.' };
      }
      if (!allocationCanMoveToSold(lot, allocation.quantity)) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The requested inventory lot would overflow.' };
      }
    }
  }
  if (prior && (prior.ok !== true
      || prior.from !== INVENTORY_STAGE.CUSTOMER_HELD
      || prior.to !== INVENTORY_STAGE.SOLD
      || prior.moved !== entries.length)) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory reference belongs to a different movement.' };
  }
  if (prior && !allocationsReachedSold(state, allocations)) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory checkpoint has no matching sold-stock projection.' };
  }
  if (prior && liveAllocations.length > 0 && !allocationsCover(allocations, liveAllocations)) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory checkpoint does not own the live held-stock allocation.' };
  }
  return {
    ok: true,
    inventory: {
      referenceId,
      entries,
      allocations,
      quantity: entries.length,
      priceAuthority: jsonClone(priceAuthority),
    },
  };
}

function validatePlan(
  plan,
  settlementId = plan?.settlementId,
  state = null,
  { allowUncommittedPriceAuthority = false } = {},
) {
  if (!isRecord(plan) || plan.version !== SETTLEMENT_VERSION
      || typeof plan.settlementId !== 'string' || !plan.settlementId
      || plan.settlementId !== settlementId
      || plan.settlementId !== canonicalCheckoutSettlementId(plan.ticketKey)
      || !Number.isSafeInteger(plan.ticketNumber) || plan.ticketNumber <= 0
      || !Number.isSafeInteger(plan.ticketNumber + 1)
      || !isRecord(plan.ticketDraft)
      || !Number.isSafeInteger(plan.ticketDraft.minute)
      || plan.ticketDraft.minute < 0
      || !isRecord(plan.ticketKey)
      || !Array.isArray(plan.postings)
      || !markerMatches(plan.checkoutSettlement, settlementId)
      || !markerMatches(plan.ticketDraft?.checkoutSettlement, settlementId)
      || typeof plan.signature !== 'string'
      || signatureFor(plan) !== plan.signature) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout settlement is invalid.' };
  }
  if (plan.postings.some((posting) => (
    !isRecord(posting) || typeof posting.component !== 'string' || !posting.component
    || !isRecord(posting.spec)
    || typeof posting.spec.idempotencyKey !== 'string' || !posting.spec.idempotencyKey
    || posting.spec.strictIdentity !== true
    || posting.spec.relatedId == null
    || typeof posting.spec.propertyId !== 'string' || !posting.spec.propertyId
    || (state != null && posting.spec.propertyId !== checkoutPropertyId(state))
    || typeof posting.spec.entryId !== 'string' || !posting.spec.entryId
    || posting.spec.entryId !== `le:${posting.spec.propertyId}:${posting.spec.idempotencyKey}`
    || posting.spec.entryId !== plan.ticketDraft.ledgerEntryIds?.[posting.component]
    || posting.spec.timestamp !== plan.ticketDraft.minute
    || posting.spec.day !== Math.floor(plan.ticketDraft.minute / 1440)
    || !validMoneyDelta(Number(posting.spec.amount))
    || Number(posting.spec.amount) <= 0
    || !postingEconomicContract(posting)
    || !markerMatches(posting.spec.metadata?.checkoutSettlement, settlementId)
  ))) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout ledger plan is invalid.' };
  }
  if (!validTicketKey(plan.ticketKey)
      || (plan.alternateTicketKeys != null && (!Array.isArray(plan.alternateTicketKeys)
        || plan.alternateTicketKeys.some((key) => !validTicketKey(key))))) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout ticket identity is invalid.' };
  }
  const allKeys = [plan.ticketKey, ...(plan.alternateTicketKeys || [])];
  const keySignatures = allKeys.map((key) => stableSerialize(key));
  if (new Set(keySignatures).size !== keySignatures.length
      || Number(plan.ticketDraft.number) !== plan.ticketNumber
      || !allKeys.every((key) => ticketKeyMatches(plan.ticketDraft, key))
      || (plan.ticketDraft.method !== 'cash' && plan.ticketDraft.method !== 'card')
      || !validMoneyDelta(Number(plan.ticketDraft.total))
      || !Array.isArray(plan.ticketDraft.items)
      || plan.ticketDraft.items.some((item) => !isRecord(item)
        || typeof item.uid !== 'string' || !item.uid
        || typeof item.skuId !== 'string' || !item.skuId
        || typeof item.name !== 'string'
        || !validMoneyDelta(Number(item.price)))
      || new Set(plan.ticketDraft.items.map((item) => item.uid)).size
        !== plan.ticketDraft.items.length) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout ticket draft is invalid.' };
  }
  if (!customerEventMatchesTicket(plan.ticketDraft, plan.ticketKey)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout customer event disagrees with its ticket.' };
  }
  if (!reservationCustomerEventMatchesTicket(plan)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending reservation customer event is invalid.' };
  }
  if (!reservationCheckInServiceAuthorityMatchesTicket(plan)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending reservation service authority is invalid.' };
  }
  if (!reservationTargetMatchesTicket(plan)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout reservation target disagrees with its ticket.' };
  }
  if (state != null && plan.reservationTarget != null) {
    const liveReservation = preflightReservationTarget(state, plan.reservationTarget);
    if (!liveReservation.ok) {
      return {
        ok: false,
        ...(liveReservation.conflict ? { conflict: true } : {}),
        reason: t('checkout.integrityUnavailable'),
        diagnostic: liveReservation.diagnostic
          || 'The pending checkout reservation no longer matches its settlement.',
      };
    }
  }
  const postingKeys = plan.postings.map((posting) => posting.spec.idempotencyKey);
  const postingComponents = plan.postings.map((posting) => posting.component);
  if (new Set(postingKeys).size !== postingKeys.length
      || new Set(postingComponents).size !== postingComponents.length) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout repeats a ledger checkpoint.' };
  }
  if (plan.postings.some((posting) => !postingMatchesTicketKeys(
    plan.ticketKey,
    plan.alternateTicketKeys || [],
    posting,
  ))) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout ledger identity is invalid.' };
  }
  if (!isRecord(plan.ticketDraft.ledgerIdempotencyKeys)
      || !isRecord(plan.ticketDraft.ledgerEntryIds)
      || stableSerialize(Object.keys(plan.ticketDraft.ledgerIdempotencyKeys).sort(compareText))
        !== stableSerialize([...postingComponents].sort(compareText))
      || stableSerialize(Object.keys(plan.ticketDraft.ledgerEntryIds).sort(compareText))
        !== stableSerialize([...postingComponents].sort(compareText))
      || plan.postings.some((posting) => (
        plan.ticketDraft.ledgerIdempotencyKeys[posting.component]
          !== posting.spec.idempotencyKey
        || typeof plan.ticketDraft.ledgerEntryIds[posting.component] !== 'string'
        || !plan.ticketDraft.ledgerEntryIds[posting.component]
      ))) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout ticket has invalid ledger bindings.' };
  }
  if (plan.projections != null && (!Array.isArray(plan.projections)
      || plan.projections.some((projection) => !isRecord(projection)
        || typeof projection.id !== 'string' || !projection.id
        || (projection.kind !== 'sales' && projection.kind !== 'tax')
        || !isRecord(projection.delta)
        || !markerMatches(projection.checkoutSettlement, settlementId)))) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout projection plan is invalid.' };
  }
  const projectionIds = (plan.projections || []).map((projection) => projection.id);
  if (new Set(projectionIds).size !== projectionIds.length) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout repeats a projection checkpoint.' };
  }
  const projectionKinds = (plan.projections || []).map((projection) => projection.kind);
  if (new Set(projectionKinds).size !== projectionKinds.length
      || (plan.projections || []).some((projection) => !validProjectionPlan(projection))) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout projection targets are invalid.' };
  }
  if (plan.outcomeSpec != null
      && (!isRecord(plan.outcomeSpec)
        || typeof plan.outcomeSpec.idempotencyKey !== 'string'
        || !plan.outcomeSpec.idempotencyKey
        || typeof plan.outcomeSpec.propertyId !== 'string' || !plan.outcomeSpec.propertyId
        || (state != null && plan.outcomeSpec.propertyId !== checkoutPropertyId(state))
        || plan.outcomeSpec.id !== `out:${plan.outcomeSpec.propertyId}:${plan.outcomeSpec.idempotencyKey}`
        || plan.outcomeSpec.timestamp !== plan.ticketDraft.minute
        || plan.outcomeSpec.day !== Math.floor(plan.ticketDraft.minute / 1440)
        || (plan.postings.length > 0
          && plan.postings.some((posting) => (
            posting.spec.propertyId !== plan.outcomeSpec.propertyId
          )))
        || !markerMatches(plan.outcomeSpec.metadata?.checkoutSettlement, settlementId))) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout outcome plan is invalid.' };
  }
  if (plan.inventory != null
      && !markerMatches(plan.inventory.checkoutSettlement, settlementId)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout inventory plan is invalid.' };
  }
  if (plan.ticketKey.kind === 'service') {
    const serviceItems = ticketItemsByKind(plan.ticketDraft, { service: true });
    const serviceTotal = ticketItemsTotal(serviceItems);
    const revenue = postingByComponent(plan.postings, 'revenue');
    const allowedComponents = new Set(['revenue', 'cash-over-short']);
    if (plan.ticketKey.type !== RESERVATION_CHECK_IN_TYPE
        || (plan.alternateTicketKeys || []).length !== 0
        || plan.inventory != null
        || plan.outcomeSpec != null
        || (plan.projections || []).length !== 0
        || !(serviceItems?.length > 0)
        || serviceItems?.length !== plan.ticketDraft.items.length
        || serviceTotal !== Number(plan.ticketDraft.total)
        || (!!revenue !== (serviceTotal > 0))
        || (revenue && (revenue.spec.direction !== 'revenue'
          || Number(revenue.spec.amount) !== serviceTotal
          || revenue.spec.lineKey !== plan.ticketDraft.revenueKey
          || revenue.spec.customerCount !== 1))
        || plan.postings.some((posting) => !allowedComponents.has(posting.component))
        || !variancePostingsMatchTicket(plan.ticketDraft, plan.postings)
        || !serviceAuthoritiesMatchTicket(plan)) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending service settlement owns incompatible retail authorities.' };
    }
  } else {
    const inventoryIdentity = checkoutInventoryIdentity(plan.inventory?.referenceId);
    const ticketPairs = ticketInventoryPairs(plan.ticketDraft);
    const inventoryPairs = Array.isArray(plan.inventory?.entries)
      ? plan.inventory.entries.map((entry) => [entry?.uid, entry?.skuId]) : null;
    const alternateServiceKeys = (plan.alternateTicketKeys || [])
      .filter((key) => key.kind === 'service');
    const serviceItems = ticketItemsByKind(plan.ticketDraft, { service: true });
    const serviceTotal = ticketItemsTotal(serviceItems);
    const servicePosting = postingByComponent(plan.postings, 'service');
    const salePosting = postingByComponent(plan.postings, 'sale');
    const taxPosting = postingByComponent(plan.postings, 'sales-tax');
    const ticketNet = Number(plan.ticketDraft.net);
    const ticketTax = Number(plan.ticketDraft.tax ?? 0);
    const declaredServiceTotal = Number(plan.ticketDraft.serviceTotal ?? 0);
    const allowedComponents = new Set([
      'sale', 'service', 'sales-tax', 'cogs', 'cash-over-short',
    ]);
    if (!inventoryIdentity
        || inventoryIdentity.transactionId !== plan.ticketKey.transactionId
        || !Array.isArray(inventoryPairs)
        || stableSerialize(inventoryIdentity.items) !== stableSerialize(inventoryPairs)
        || stableSerialize(inventoryIdentity.items) !== stableSerialize(ticketPairs)
        || plan.postings.filter((posting) => posting.component === 'sale').length !== 1
        || alternateServiceKeys.length > 1
        || alternateServiceKeys.some((key) => key.type !== RESERVATION_CHECK_IN_TYPE)
        || serviceItems == null
        || serviceTotal == null
        || (serviceItems.length > 0) !== (alternateServiceKeys.length === 1)
        || declaredServiceTotal !== serviceTotal
        || (!!servicePosting !== (serviceTotal > 0))
        || (servicePosting && (servicePosting.spec.direction !== 'revenue'
          || Number(servicePosting.spec.amount) !== serviceTotal
          || servicePosting.spec.lineKey !== plan.ticketDraft.serviceRevenueKey
          || servicePosting.spec.customerCount !== 1
          || servicePosting.spec.metadata?.type !== alternateServiceKeys[0]?.type))
        || !validMoneyDelta(ticketNet) || ticketNet <= 0
        || !salePosting || salePosting.spec.direction !== 'revenue'
        || Number(salePosting.spec.amount) !== ticketNet
        || !validMoneyDelta(ticketTax)
        || (!!taxPosting !== (ticketTax > 0))
        || (taxPosting && (taxPosting.spec.direction !== 'revenue'
          || Number(taxPosting.spec.amount) !== ticketTax))
        || round2(ticketNet + ticketTax + serviceTotal) !== Number(plan.ticketDraft.total)
        || plan.postings.some((posting) => !allowedComponents.has(posting.component))
        || !variancePostingsMatchTicket(plan.ticketDraft, plan.postings)
        || !checkoutPriceAuthorityMatchesState(
          state,
          plan.inventory,
          plan.ticketDraft,
          { allowMissing: allowUncommittedPriceAuthority },
        )
        || !transactionAuthoritiesMatchTicket(plan)
        || !isRecord(plan.outcomeSpec)
        || plan.outcomeSpec.idempotencyKey !== `${settlementId}:completed`
        || plan.outcomeSpec.type !== 'checkoutCompleted'
        || plan.outcomeSpec.relatedId == null
        || String(plan.outcomeSpec.relatedId) !== plan.ticketKey.transactionId
        || !(plan.projections || []).some((projection) => (
          projection.kind === 'sales'
          && projection.id === `${settlementId}:sales-projection`
        ))
        || (plan.projections || []).some((projection) => projection.id !== (
          projection.kind === 'sales'
            ? `${settlementId}:sales-projection`
            : `${settlementId}:tax-projection`
        ))) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending retail settlement authorities disagree.' };
    }
  }
  return { ok: true };
}

export function validateCheckoutWalRecord(value, state = null) {
  if (!isRecord(value)) {
    return { ok: false, diagnostic: 'The persisted checkout settlement journal is not a record.' };
  }
  if (Object.keys(value).length > MAX_PENDING_CHECKOUTS) {
    return { ok: false, diagnostic: 'The persisted checkout settlement journal exceeds register capacity.' };
  }
  for (const [settlementId, plan] of Object.entries(value)) {
    const validation = validatePlan(plan, settlementId, state);
    if (!validation.ok) {
      return {
        ok: false,
        settlementId,
        diagnostic: validation.diagnostic || 'The persisted checkout settlement is invalid.',
      };
    }
  }
  return { ok: true };
}

export function preparePendingCheckout(state, rawPlan) {
  const plan = jsonClone({
    ...rawPlan,
    version: SETTLEMENT_VERSION,
  });
  delete plan.taxProjection;
  delete plan.analytics;
  delete plan.signature;
  if (plan.alternateTicketKeys == null) plan.alternateTicketKeys = [];
  const propertyId = checkoutPropertyId(state);
  for (const posting of plan.postings || []) {
    const entryId = plan.ticketDraft?.ledgerEntryIds?.[posting.component];
    if (posting.spec.entryId == null) posting.spec.entryId = entryId;
    if (posting.spec.propertyId == null) posting.spec.propertyId = propertyId;
  }
  if (isRecord(plan.outcomeSpec)) {
    if (plan.outcomeSpec.propertyId == null) plan.outcomeSpec.propertyId = propertyId;
    if (plan.outcomeSpec.id == null) {
      plan.outcomeSpec.id = `out:${propertyId}:${plan.outcomeSpec.idempotencyKey}`;
    }
  }
  stampSettlementPlan(plan);
  plan.signature = signatureFor(plan);
  const validation = validatePlan(
    plan,
    plan.settlementId,
    state,
    { allowUncommittedPriceAuthority: true },
  );
  if (!validation.ok) return validation;

  const inventoryPreflight = preflightInventoryState(state, plan.inventory ?? null);
  if (!inventoryPreflight.ok) return inventoryPreflight;
  const drawerPreflight = preflightDrawer(state, plan.drawer ?? null);
  if (!drawerPreflight.ok) return drawerPreflight;
  const ticketPreflight = preflightTicket(state, plan);
  if (!ticketPreflight.ok) return ticketPreflight;
  const postingsPreflight = preflightPostings(state, plan.postings);
  if (!postingsPreflight.ok) return postingsPreflight;
  const projectionsPreflight = preflightProjectionState(state, plan.projections || []);
  if (!projectionsPreflight.ok) return projectionsPreflight;
  const outcomePreflight = preflightOutcomeSpec(state, plan.outcomeSpec ?? null);
  if (!outcomePreflight.ok) return outcomePreflight;
  const reservationPreflight = preflightReservationTarget(state, plan.reservationTarget ?? null);
  if (!reservationPreflight.ok) return reservationPreflight;
  const customerPreflight = preflightCustomerEvent(state, plan.ticketDraft);
  if (!customerPreflight.ok) return customerPreflight;
  const receiptPreflight = preflightSettlementReceipt(state, plan, outcomePreflight);
  if (!receiptPreflight.ok) return receiptPreflight;
  const journalPreflight = preflightPendingJournal(state, plan.settlementId);
  if (!journalPreflight.ok) return journalPreflight;

  // Keep preparation pure until the complete immutable record has validated.
  // A rejected caller must not leave even an empty journal authority behind.
  const pending = pendingMap(state, { create: true });
  if (!pending) return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The shop checkout journal is unavailable.' };

  const existing = pending[plan.settlementId];
  if (existing) {
    if (validatePlan(existing, plan.settlementId, state).ok && existing.signature === plan.signature) {
      return { ok: true, already: true, plan: existing };
    }
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'That checkout identity has a different pending settlement.' };
  }
  if (Object.keys(pending).length >= MAX_PENDING_CHECKOUTS) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Resolve the pending register settlements before starting another sale.' };
  }
  pending[plan.settlementId] = plan;
  const nextTransactionNo = Math.max(
    Number(state.shop.nextTransactionNo) || 1,
    plan.ticketNumber + 1,
  );
  if (state.shop.nextTransactionNo !== nextTransactionNo) {
    state.shop.nextTransactionNo = nextTransactionNo;
  }
  return { ok: true, already: false, plan };
}

function ticketKeyMatches(ticket, key) {
  if (key.kind === 'transaction') return ticket?.transactionId === key.transactionId;
  if (key.kind === 'service') {
    return ticket?.type === key.type && ticket?.referenceId === key.referenceId;
  }
  return false;
}

export function checkoutSettlementTicketSnapshot(ticket) {
  const clone = jsonClone(ticket);
  delete clone.customerVisitRecorded;
  if (isRecord(clone.customerVisitEvent)) {
    delete clone.customerVisitEvent.status;
    delete clone.customerVisitEvent.failureReason;
  }
  return clone;
}

export function checkoutSettlementTicketDigest(ticket) {
  return stableSerialize(checkoutSettlementTicketSnapshot(ticket));
}

function preflightTicket(state, plan) {
  const shop = state?.shop;
  if (!isRecord(shop) || !Array.isArray(shop.transactionHistory)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout transaction history is unavailable.' };
  }
  if (!Number.isSafeInteger(shop.nextTransactionNo) || shop.nextTransactionNo < 1) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout ticket counter is invalid.' };
  }
  const history = shop.transactionHistory;
  const keys = [plan.ticketKey, ...(Array.isArray(plan.alternateTicketKeys)
    ? plan.alternateTicketKeys : [])];
  const keyedGroups = keys.map((key) => history.filter((ticket) => ticketKeyMatches(ticket, key)));
  if (keyedGroups.some((matches) => matches.length > 1)) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout ticket identity is ambiguous.' };
  }
  const numberedTickets = history.filter(
    (ticket) => Number(ticket?.number) === plan.ticketNumber,
  );
  if (numberedTickets.length > 1) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout ticket number is ambiguous.' };
  }
  const keyedTickets = keyedGroups.map((matches) => matches[0] || null);
  const keyed = keyedTickets[0];
  const alternateConflict = keyedTickets.slice(1).find((ticket) => ticket && ticket !== keyed) || null;
  const numbered = numberedTickets[0] || null;
  if (alternateConflict) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'A service reference already belongs to another checkout ticket.' };
  }
  if (keyed && numbered && keyed !== numbered) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout ticket identity and number disagree.' };
  }
  const existing = keyed || numbered;
  if (existing && (!keys.every((key) => ticketKeyMatches(existing, key))
      || stableSerialize(checkoutSettlementTicketSnapshot(existing))
        !== stableSerialize(checkoutSettlementTicketSnapshot(plan.ticketDraft)))) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout ticket conflicts with transaction history.' };
  }
  const nextTransactionNo = Math.max(shop.nextTransactionNo, plan.ticketNumber + 1);
  if ((!existing && !canAssignProperty(shop, 'transactionHistory'))
      || (shop.nextTransactionNo !== nextTransactionNo
        && !canAssignProperty(shop, 'nextTransactionNo'))) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout ticket publication authority is not writable.' };
  }
  return { ok: true, history, ticket: existing };
}

function preflightInventoryState(state, inventory) {
  if (inventory == null) return { ok: true, skipped: true };
  if (!isRecord(inventory) || typeof inventory.referenceId !== 'string'
      || !Array.isArray(inventory.entries) || !inventory.entries.length
      || !Array.isArray(inventory.allocations)
      || !validCheckoutPriceAuthority(inventory.priceAuthority)
      || inventory.entries.some((entry) => !isRecord(entry)
        || typeof entry.uid !== 'string' || !entry.uid
        || typeof entry.skuId !== 'string' || !entry.skuId)
      || inventory.allocations.some((allocation) => !validAllocation(allocation))
      || inventory.quantity !== inventory.entries.length
      || inventory.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0)
        !== inventory.quantity) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout inventory plan is invalid.' };
  }
  const shop = state?.shop;
  const lifecycle = shop?.inventoryLifecycle;
  if (!isRecord(shop) || !isRecord(lifecycle)
      || !isRecord(lifecycle.operations)
      || !Array.isArray(lifecycle.operationKeys)
      || !Array.isArray(lifecycle.lots)
      || !isRecord(lifecycle.heldAllocations)
      || !Array.isArray(lifecycle.events)
      || !Array.isArray(shop.held)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory authority is unavailable.' };
  }

  const expected = new Map(inventory.entries.map((entry) => [entry.uid, entry.skuId]));
  if (expected.size !== inventory.entries.length) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout repeats a product identity.' };
  }
  const resolvedLots = referencedAllocationLots(state, inventory.allocations);
  if (!resolvedLots.ok) return resolvedLots;
  if (!allocationsMatchEntries(state, inventory.allocations, inventory.entries)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Checkout inventory provenance is incomplete.' };
  }
  const prior = lifecycle.operations[inventory.referenceId] || null;
  if (prior && (
    prior.ok !== true
    || prior.from !== INVENTORY_STAGE.CUSTOMER_HELD
    || prior.to !== INVENTORY_STAGE.SOLD
    || prior.moved !== inventory.quantity
    || stableSerialize(prior[CHECKOUT_PRICE_AUTHORITY_FIELD])
      !== stableSerialize(inventory.priceAuthority)
    || stableSerialize(normalizedAllocations(prior.allocations))
      !== stableSerialize(normalizedAllocations(inventory.allocations))
  )) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory reference belongs to a different movement.' };
  }
  if (prior && !allocationsReachedSold(state, inventory.allocations)) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory checkpoint has no matching sold-stock projection.' };
  }
  if (!prior) {
    for (const allocation of normalizedAllocations(inventory.allocations)) {
      const lot = resolvedLots.lots.get(allocation.lotId);
      const available = lot?.buckets?.[INVENTORY_STAGE.CUSTOMER_HELD];
      if (!isRecord(lot) || lot.active === false) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Requested inventory lot is unavailable.' };
      }
      if (!Number.isSafeInteger(available) || available < allocation.quantity) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Not enough inventory in the requested lot.' };
      }
      if (!allocationCanMoveToSold(lot, allocation.quantity)) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The requested inventory lot would overflow.' };
      }
    }
  }
  const liveUids = [];
  const liveAllocations = [];
  for (const [uid, skuId] of expected) {
    const matches = shop.held.filter((held) => held?.uid === uid);
    if (matches.length > 1) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: `Held UID ${uid} is ambiguous in inventory.` };
    }
    if (matches.length === 1) {
      if (matches[0].skuId !== skuId) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: `Held UID ${uid} does not match ${skuId}.` };
      }
      const itemAllocations = lifecycle.heldAllocations[uid];
      if (!Array.isArray(itemAllocations) || !itemAllocations.length
          || itemAllocations.some((allocation) => !validAllocation(allocation))
          || itemAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0) !== 1) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Checkout inventory provenance is incomplete.' };
      }
      liveUids.push(uid);
      liveAllocations.push(...itemAllocations);
    }
  }
  if (!prior && liveUids.length !== inventory.quantity) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Committed checkout inventory is missing before its sale movement.' };
  }
  if (prior && liveAllocations.length > 0
      && !allocationsCover(inventory.allocations, liveAllocations)) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory checkpoint does not own the live held-stock allocation.' };
  }
  if (liveUids.length > 0 && !canMutateArray(shop.held, { remove: true })) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout held-stock authority is not writable.' };
  }
  for (const uid of expected.keys()) {
    if (Object.hasOwn(lifecycle.heldAllocations, uid)
        && !canDeleteProperty(lifecycle.heldAllocations, uid)) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout allocation authority is not writable.' };
    }
  }
  if (prior) return { ok: true, prior };

  if (!canAssignProperty(lifecycle.operations, inventory.referenceId)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory journal is not writable.' };
  }
  if (!canMutateArray(lifecycle.operationKeys, { append: true, remove: true })) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory journal order is not writable.' };
  }
  if (!canMutateArray(lifecycle.events, { append: true, remove: true })) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory event journal is not writable.' };
  }
  for (const allocation of normalizedAllocations(inventory.allocations)) {
    const lot = resolvedLots.lots.get(allocation.lotId);
    if (!isRecord(lot) || !isRecord(lot.buckets)
        || !canAssignProperty(lot.buckets, INVENTORY_STAGE.CUSTOMER_HELD)
        || !canAssignProperty(lot.buckets, INVENTORY_STAGE.SOLD)) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory lot authority is not writable.' };
    }
  }

  if (lifecycle.operationKeys.length + 1 > 2500) {
    const pendingPlans = Object.values(shop.pendingCheckouts || {});
    const pinned = new Set(pendingPlans
      .map((plan) => plan?.inventory?.referenceId)
      .filter((referenceId) => typeof referenceId === 'string' && referenceId));
    for (const plan of pendingPlans) {
      for (const entry of plan?.inventory?.entries || []) {
        if (typeof entry?.uid === 'string' && entry.uid) {
          pinned.add(`customer-pick:${entry.uid}`);
        }
      }
    }
    for (const receipt of Object.values(shop.checkoutSettlementReceipts || {})) {
      if (typeof receipt?.inventoryReferenceId === 'string' && receipt.inventoryReferenceId) {
        pinned.add(receipt.inventoryReferenceId);
      }
    }
    pinned.add(inventory.referenceId);
    const removable = lifecycle.operationKeys.find((key) => !pinned.has(key));
    if (removable == null || !canDeleteProperty(lifecycle.operations, removable)) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory journal cannot retire an old checkpoint.' };
    }
  }
  return { ok: true, prior: null };
}

function applyInventory(state, inventory) {
  const authority = preflightInventoryState(state, inventory);
  if (!authority.ok || authority.skipped) return authority;
  if (inventory == null) return { ok: true, skipped: true };
  if (!isRecord(inventory) || typeof inventory.referenceId !== 'string'
      || !Array.isArray(inventory.entries) || !inventory.entries.length
      || !Array.isArray(inventory.allocations)
      || !validCheckoutPriceAuthority(inventory.priceAuthority)
      || inventory.entries.some((entry) => !isRecord(entry)
        || typeof entry.uid !== 'string' || !entry.uid
        || typeof entry.skuId !== 'string' || !entry.skuId)
      || inventory.allocations.some((allocation) => !validAllocation(allocation))
      || inventory.quantity !== inventory.entries.length
      || inventory.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0)
        !== inventory.quantity
      || !allocationsMatchEntries(state, inventory.allocations, inventory.entries)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout inventory plan is invalid.' };
  }

  const expected = new Map(inventory.entries.map((entry) => [entry.uid, entry.skuId]));
  if (expected.size !== inventory.entries.length) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout repeats a product identity.' };
  }
  const held = Array.isArray(state.shop.held) ? state.shop.held : [];
  const heldAllocations = state.shop.inventoryLifecycle?.heldAllocations || {};
  const indices = [];
  const liveAllocations = [];
  for (const [uid, skuId] of expected) {
    const matches = [];
    for (let index = 0; index < held.length; index += 1) {
      if (held[index]?.uid === uid) matches.push(index);
    }
    if (matches.length > 1) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: `Held UID ${uid} is ambiguous in inventory.` };
    }
    if (matches.length === 1) {
      const index = matches[0];
      if (held[index]?.skuId !== skuId) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: `Held UID ${uid} does not match ${skuId}.` };
      }
      const itemAllocations = heldAllocations[uid];
      if (!Array.isArray(itemAllocations) || !itemAllocations.length
          || itemAllocations.some((allocation) => !validAllocation(allocation))
          || itemAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0) !== 1) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Checkout inventory provenance is incomplete.' };
      }
      liveAllocations.push(...itemAllocations);
      indices.push(index);
    }
  }

  const prior = state.shop.inventoryLifecycle?.operations?.[inventory.referenceId] || null;
  if (prior && (
    prior.ok !== true
    || prior.from !== INVENTORY_STAGE.CUSTOMER_HELD
    || prior.to !== INVENTORY_STAGE.SOLD
    || prior.moved !== inventory.quantity
    || stableSerialize(prior[CHECKOUT_PRICE_AUTHORITY_FIELD])
      !== stableSerialize(inventory.priceAuthority)
    || stableSerialize(normalizedAllocations(prior.allocations))
      !== stableSerialize(normalizedAllocations(inventory.allocations))
  )) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory reference belongs to a different movement.' };
  }
  if (prior && !allocationsReachedSold(state, inventory.allocations)) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory checkpoint has no matching sold-stock projection.' };
  }
  if (prior && liveAllocations.length > 0
      && !allocationsCover(inventory.allocations, liveAllocations)) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory checkpoint does not own the live held-stock allocation.' };
  }
  if (!prior && indices.length !== inventory.quantity) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Committed checkout inventory is missing before its sale movement.' };
  }

  const moved = prior || moveInventory(state, {
    from: INVENTORY_STAGE.CUSTOMER_HELD,
    to: INVENTORY_STAGE.SOLD,
    quantity: inventory.quantity,
    allocations: inventory.allocations,
    referenceId: inventory.referenceId,
    cause: `Durable checkout settlement ${inventory.referenceId}`,
    skipNormalization: true,
  });
  if (!moved?.ok) return moved || { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'Checkout inventory could not be moved.' };
  if (moved.from !== INVENTORY_STAGE.CUSTOMER_HELD
      || moved.to !== INVENTORY_STAGE.SOLD
      || moved.moved !== inventory.quantity
      || stableSerialize(normalizedAllocations(moved.allocations))
        !== stableSerialize(normalizedAllocations(inventory.allocations))) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory movement did not match its settlement.' };
  }
  const persistedOperation = state.shop.inventoryLifecycle?.operations?.[inventory.referenceId];
  if (!isRecord(persistedOperation)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout price authority could not be retained.' };
  }
  const persistedPriceAuthority = persistedOperation[CHECKOUT_PRICE_AUTHORITY_FIELD];
  if (persistedPriceAuthority == null) {
    if (!canAssignProperty(persistedOperation, CHECKOUT_PRICE_AUTHORITY_FIELD)) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout price authority is not writable.' };
    }
    persistedOperation[CHECKOUT_PRICE_AUTHORITY_FIELD] = jsonClone(inventory.priceAuthority);
  } else if (stableSerialize(persistedPriceAuthority)
      !== stableSerialize(inventory.priceAuthority)) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout inventory price authority conflicts with its settlement.' };
  }

  indices.sort((a, b) => b - a);
  for (const index of indices) held.splice(index, 1);
  for (const uid of expected.keys()) delete heldAllocations[uid];
  return { ok: true, already: !!prior, moved: inventory.quantity };
}

function applyDrawer(state, drawer) {
  const preflight = preflightDrawer(state, drawer);
  if (!preflight.ok || preflight.skipped || preflight.already) return preflight;
  // One property assignment is the recoverable projection boundary. Keeping a
  // partially-mutated denomination object would create a third CAS state.
  state.shop.drawer = copyStack(drawer.after);
  return { ok: true, already: false };
}

function preflightDrawer(state, drawer) {
  if (drawer == null) return { ok: true, skipped: true };
  if (!isRecord(drawer) || !isRecord(drawer.before) || !isRecord(drawer.after)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout drawer plan is invalid.' };
  }
  if (!isRecord(state?.shop)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout drawer authority is unavailable.' };
  }
  const current = state.shop.drawer || {};
  if (sameStack(current, drawer.after)) return { ok: true, already: true };
  if (!sameStack(current, drawer.before)) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The cash drawer no longer matches the pending checkout.' };
  }
  if (!canAssignProperty(state.shop, 'drawer')) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout drawer authority is not writable.' };
  }
  return { ok: true, already: false };
}

function applyPostings(state, postings) {
  const prepared = [];
  for (const posting of postings) {
    const preflight = preflightLedgerEntry(state, posting.spec);
    if (!preflight.ok) return preflight;
    prepared.push({ posting, preflight });
  }
  for (const { posting, preflight } of prepared) {
    if (preflight.duplicate) continue;
    const posted = postLedgerEntry(state, posting.spec);
    if (!posted.ok) return posted;
    if (posted.duplicate && !preflight.duplicate) {
      const verified = preflightLedgerEntry(state, posting.spec);
      if (!verified.ok || !verified.duplicate) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: `The ${posting.component} ledger checkpoint changed during settlement.` };
      }
    }
  }
  return { ok: true };
}

function preflightPostings(state, postings) {
  for (const posting of postings) {
    const preflight = preflightLedgerEntry(state, posting.spec);
    if (!preflight.ok) return preflight;
  }
  return { ok: true };
}

function preflightOutcomeSpec(state, outcomeSpec) {
  if (outcomeSpec == null) return { ok: true, skipped: true };
  return preflightOutcome(state, outcomeSpec);
}

function preflightCustomerEvent(state, ticketDraft) {
  if (!ticketDraft?.customerVisitEvent) return { ok: true, skipped: true };
  return preflightCustomerVisitEvent(state, ticketDraft.customerVisitEvent);
}

function validMoneyDelta(value) {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= 0 && round2(value) === value
    && Number.isSafeInteger(Math.round(value * 100));
}

function validCountDelta(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validSalesSnapshot(snapshot) {
  return isRecord(snapshot)
    && validCountDelta(snapshot.units)
    && validMoneyDelta(snapshot.revenue)
    && isRecord(snapshot.perSku)
    && Object.entries(snapshot.perSku).every(([skuId, quantity]) => (
      !!skuId && validCountDelta(quantity)
    ));
}

function validTaxSnapshot(snapshot) {
  return isRecord(snapshot)
    && validMoneyDelta(snapshot.collected)
    && validMoneyDelta(snapshot.owed)
    && validMoneyDelta(snapshot.taxableSales);
}

function validProjectionPlan(projection) {
  if (!isRecord(projection) || !isRecord(projection.delta)
      || !isRecord(projection.before) || !isRecord(projection.after)) return false;
  if (projection.kind === 'sales') {
    const { delta, before, after } = projection;
    if (!validCountDelta(delta.units) || !validMoneyDelta(delta.revenue)
        || !isRecord(delta.perSku)
        || Object.entries(delta.perSku).some(([skuId, quantity]) => (
          !skuId || !validCountDelta(quantity)
        ))
        || !validSalesSnapshot(before) || !validSalesSnapshot(after)
        || stableSerialize(Object.keys(before.perSku).sort())
          !== stableSerialize(Object.keys(delta.perSku).sort())
        || stableSerialize(Object.keys(after.perSku).sort())
          !== stableSerialize(Object.keys(delta.perSku).sort())
        || !Number.isSafeInteger(before.units + delta.units)
        || after.units !== before.units + delta.units
        || after.revenue !== round2(before.revenue + delta.revenue)) return false;
    return Object.entries(delta.perSku).every(([skuId, quantity]) => (
      Number.isSafeInteger(before.perSku[skuId] + quantity)
      && after.perSku[skuId] === before.perSku[skuId] + quantity
    ));
  }
  if (projection.kind === 'tax') {
    const { delta, before, after } = projection;
    return validMoneyDelta(delta.collected)
      && validMoneyDelta(delta.owed)
      && validMoneyDelta(delta.taxableSales)
      && validTaxSnapshot(before)
      && validTaxSnapshot(after)
      && after.collected === round2(before.collected + delta.collected)
      && after.owed === round2(before.owed + delta.owed)
      && after.taxableSales === round2(before.taxableSales + delta.taxableSales);
  }
  return false;
}

function projectionSignature(projection) {
  return stableSerialize({
    kind: projection.kind,
    delta: projection.delta,
    before: projection.before,
    after: projection.after,
  });
}

function currentProjectionSnapshot(state, projection) {
  if (projection.kind === 'sales') {
    const live = state.shop.salesLive == null
      ? { units: 0, revenue: 0 }
      : state.shop.salesLive;
    const today = state.shop.salesToday == null ? {} : state.shop.salesToday;
    if (!isRecord(live) || !isRecord(today)) return null;
    return {
      units: live.units ?? 0,
      revenue: live.revenue ?? 0,
      perSku: Object.fromEntries(Object.keys(projection.delta.perSku)
        .map((skuId) => [skuId, today[skuId] ?? 0])),
    };
  }
  if (!isRecord(state.salesTax)) return null;
  return {
    collected: state.salesTax.collected,
    owed: state.salesTax.owed,
    taxableSales: state.salesTax.taxableSales,
  };
}

function projectionAtOrBeyond(current, target, kind) {
  if (kind === 'sales') {
    return current.units >= target.units
      && current.revenue >= target.revenue
      && Object.keys(target.perSku).every((skuId) => (
        current.perSku[skuId] >= target.perSku[skuId]
      ));
  }
  return current.collected >= target.collected
    && current.owed >= target.owed
    && current.taxableSales >= target.taxableSales;
}

function preflightProjectionState(state, projections) {
  if (!Array.isArray(projections)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout projection plan is invalid.' };
  }
  if (!isRecord(state?.shop)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout projection authorities are unavailable.' };
  }
  if (!isRecord(state?.shop?.checkoutProjectionIds)
      && state?.shop?.checkoutProjectionIds != null) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout projection journal is unavailable.' };
  }
  if (state.shop.checkoutProjectionIds == null
      && !canAssignProperty(state.shop, 'checkoutProjectionIds')) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout projection journal is not writable.' };
  }
  const operations = operationMap(state);
  for (const projection of projections) {
    if (!validProjectionPlan(projection)) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout projection targets are invalid.' };
    }
    const delta = projection.delta;
    const prior = operations?.[projection.id];
    const signature = projectionSignature(projection);
    if (prior != null && (!isRecord(prior) || prior.signature !== signature
        || stableSerialize(prior.after) !== stableSerialize(projection.after)
        || !markerMatches(prior.checkoutSettlement, projection.checkoutSettlement.settlementId)
        || (prior.status !== 'prepared' && prior.status !== 'applied'))) {
      return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'A checkout projection checkpoint has conflicting details.' };
    }
    if (prior != null && (!canDeleteProperty(operations, projection.id)
        || !canAssignProperty(operations, projection.id))) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout projection journal cannot retire its checkpoint.' };
    }
    if (prior == null && operations != null
        && !canAssignProperty(operations, projection.id)) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout projection journal is not writable.' };
    }
    const current = currentProjectionSnapshot(state, projection);
    if (current == null
        || (projection.kind === 'sales' && !validSalesSnapshot(current))
        || (projection.kind === 'tax' && !validTaxSnapshot(current))) {
      return {
        ok: false,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: projection.kind === 'sales'
          ? 'The checkout sales projection is invalid.'
          : 'The sales-tax authority is invalid.',
      };
    }
    if (prior?.status === 'applied') {
      if (!projectionAtOrBeyond(current, projection.after, projection.kind)) {
        return {
          ok: false,
          conflict: true,
          reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout projection checkpoint has no matching result.',
        };
      }
      continue;
    }
    if (prior?.status === 'prepared'
        && projectionAtOrBeyond(current, projection.after, projection.kind)) {
      continue;
    }
    if (stableSerialize(current) !== stableSerialize(projection.before)) {
      return {
        ok: false,
        conflict: true,
        reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout projection authority changed before settlement.',
      };
    }
    if (projection.kind === 'sales') {
      if (state.shop.salesLive != null && (!isRecord(state.shop.salesLive)
          || !validCountDelta(state.shop.salesLive.units)
          || !validMoneyDelta(state.shop.salesLive.revenue))) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The live-sales authority is invalid.' };
      }
      if (state.shop.salesLive == null) {
        if (!canAssignProperty(state.shop, 'salesLive')) {
          return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The live-sales projection is not writable.' };
        }
      } else if (!canAssignProperty(state.shop.salesLive, 'units')
          || !canAssignProperty(state.shop.salesLive, 'revenue')) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The live-sales projection is not writable.' };
      }
      if (state.shop.salesToday != null && (!isRecord(state.shop.salesToday)
          || Object.entries(state.shop.salesToday).some(([skuId, quantity]) => (
            !skuId || !validCountDelta(quantity)
          )))) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The daily sales authority is invalid.' };
      }
      if (state.shop.salesToday == null) {
        if (!canAssignProperty(state.shop, 'salesToday')) {
          return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The daily sales projection is not writable.' };
        }
      } else if (Object.keys(delta.perSku)
        .some((skuId) => !canAssignProperty(state.shop.salesToday, skuId))) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The daily sales projection is not writable.' };
      }
    } else if (projection.kind === 'tax') {
      if (!canAssignProperty(state.salesTax, 'collected')
          || !canAssignProperty(state.salesTax, 'owed')
          || !canAssignProperty(state.salesTax, 'taxableSales')) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The sales-tax projection is not writable.' };
      }
    }
  }
  return { ok: true };
}

function applyProjections(state, projections) {
  const preflight = preflightProjectionState(state, projections);
  if (!preflight.ok) return preflight;
  const operations = operationMap(state, { create: true });
  if (!operations) return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout projection journal is unavailable.' };
  let applied = 0;
  let already = 0;
  for (const projection of projections) {
    const signature = projectionSignature(projection);
    const prior = operations[projection.id];
    if (prior != null) {
      if (!isRecord(prior) || prior.signature !== signature) {
        return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'A checkout projection checkpoint has conflicting details.' };
      }
      const current = currentProjectionSnapshot(state, projection);
      if (prior.status === 'applied'
          || projectionAtOrBeyond(current, projection.after, projection.kind)) {
        if (prior.status !== 'applied') {
          operations[projection.id] = {
            signature,
            after: jsonClone(projection.after),
            status: 'applied',
            checkoutSettlement: jsonClone(projection.checkoutSettlement),
          };
        }
        already += 1;
        continue;
      }
    } else {
      operations[projection.id] = {
        signature,
        after: jsonClone(projection.after),
        status: 'prepared',
        checkoutSettlement: jsonClone(projection.checkoutSettlement),
      };
    }
    if (projection.kind === 'sales') {
      if (!isRecord(state.shop.salesLive)) state.shop.salesLive = { units: 0, revenue: 0 };
      if (!isRecord(state.shop.salesToday)) state.shop.salesToday = {};
      state.shop.salesLive.units = projection.after.units;
      state.shop.salesLive.revenue = projection.after.revenue;
      for (const [skuId, quantity] of Object.entries(projection.after.perSku)) {
        state.shop.salesToday[skuId] = quantity;
      }
    } else {
      state.salesTax.collected = projection.after.collected;
      state.salesTax.owed = projection.after.owed;
      state.salesTax.taxableSales = projection.after.taxableSales;
    }
    operations[projection.id] = {
      signature,
      after: jsonClone(projection.after),
      status: 'applied',
      checkoutSettlement: jsonClone(projection.checkoutSettlement),
    };
    applied += 1;
  }
  return { ok: true, applied, already };
}

function matchesFields(target, fields) {
  return Object.entries(fields || {}).every(([key, expected]) => {
    if (isRecord(expected) && typeof expected.present === 'boolean') {
      const present = isRecord(target) && Object.hasOwn(target, key);
      return present === expected.present
        && (!expected.present
          || stableSerialize(target[key]) === stableSerialize(expected.value));
    }
    return stableSerialize(target?.[key]) === stableSerialize(expected);
  });
}

function preflightReservationTarget(state, target) {
  if (target == null) return { ok: true, skipped: true, reservation: null };
  if (!isRecord(target) || typeof target.reservationId !== 'string'
      || !isRecord(target.expected) || !isRecord(target.fields)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout reservation target is invalid.' };
  }
  const reservation = (Array.isArray(state?.reservations?.booked) ? state.reservations.booked : [])
    .find((entry) => String(entry?.id) === target.reservationId);
  if (!reservation) return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout reservation is unavailable.' };
  const fieldsAtTarget = matchesFields(reservation, target.fields);
  const fieldsAtExpected = matchesFields(reservation, target.expected);
  const paymentAtTarget = target.paymentFields == null
    || matchesFields(reservation.payment, target.paymentFields);
  const paymentAtExpected = target.paymentExpected == null
    || matchesFields(reservation.payment, target.paymentExpected);
  if ((!fieldsAtTarget && !fieldsAtExpected) || (!paymentAtTarget && !paymentAtExpected)) {
    return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'The reservation changed during checkout recovery.' };
  }
  if (!fieldsAtTarget && Object.keys(target.fields)
    .some((key) => !canAssignProperty(reservation, key))) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The reservation authority is not writable.' };
  }
  if (target.paymentFields != null && !paymentAtTarget) {
    if (!isRecord(reservation.payment)) {
      if (!canAssignProperty(reservation, 'payment')) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The reservation payment authority is not writable.' };
      }
    } else if (Object.keys(target.paymentFields)
      .some((key) => !canAssignProperty(reservation.payment, key))) {
      return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The reservation payment authority is not writable.' };
    }
  }
  return {
    ok: true,
    reservation,
    fieldsAtTarget,
    paymentAtTarget,
    already: fieldsAtTarget && paymentAtTarget,
  };
}

function applyReservationTarget(state, target, preflight = null) {
  const checked = preflight || preflightReservationTarget(state, target);
  if (!checked.ok || checked.skipped || checked.already) return checked;
  if (!checked.fieldsAtTarget) Object.assign(checked.reservation, jsonClone(target.fields));
  if (target.paymentFields != null && !checked.paymentAtTarget) {
    if (!isRecord(checked.reservation.payment)) checked.reservation.payment = {};
    Object.assign(checked.reservation.payment, jsonClone(target.paymentFields));
  }
  return { ok: true, already: false, reservation: checked.reservation };
}

function settlementReceiptPinned(state, settlementId, receipt) {
  const shop = state?.shop;
  if (!isRecord(shop)) return true;
  if (isRecord(shop.pendingCheckouts) && Object.hasOwn(shop.pendingCheckouts, settlementId)) {
    return true;
  }
  if (Object.values(isRecord(shop.checkoutProjectionIds)
    ? shop.checkoutProjectionIds : {}).some((projection) => (
    markerMatches(projection?.checkoutSettlement, settlementId)
  ))) return true;
  if ((Array.isArray(shop.transactionHistory) ? shop.transactionHistory : [])
    .some((ticket) => markerMatches(ticket?.checkoutSettlement, settlementId))) return true;
  if ((Array.isArray(state?.ledger?.entries) ? state.ledger.entries : [])
    .some((entry) => markerMatches(entry?.metadata?.checkoutSettlement, settlementId))) return true;
  if ((Array.isArray(state?.ledger?.outcomes) ? state.ledger.outcomes : [])
    .some((outcome) => markerMatches(outcome?.metadata?.checkoutSettlement, settlementId))) return true;
  // A terminal inventory operation and its receipt are one retained evidence
  // pair. The operation alone must not make the pair immortal; when no ticket,
  // ledger, outcome, projection, or pending WAL still refers to it, receipt
  // admission may retire both records together.
  return false;
}

function appendTicket(state, plan, preflight) {
  if (preflight.ticket) return { ok: true, already: true, ticket: preflight.ticket };
  const ticket = jsonClone(plan.ticketDraft);
  state.shop.transactionHistory = [ticket, ...preflight.history].slice(0, 100);
  const nextTransactionNo = Math.max(
    Number(state.shop.nextTransactionNo) || 1,
    plan.ticketNumber + 1,
  );
  if (state.shop.nextTransactionNo !== nextTransactionNo) {
    state.shop.nextTransactionNo = nextTransactionNo;
  }
  return { ok: true, already: false, ticket };
}

function preflightSettlementReceipt(state, plan, outcomePreflight) {
  const shop = state?.shop;
  if (!isRecord(shop)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout receipt authority is unavailable.' };
  }
  const receipts = shop.checkoutSettlementReceipts;
  const order = shop.checkoutSettlementReceiptKeys;
  if (receipts != null && !isRecord(receipts)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout receipt authority is invalid.' };
  }
  if (order != null && !Array.isArray(order)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout receipt order is invalid.' };
  }
  if (receipts == null && !canAssignProperty(shop, 'checkoutSettlementReceipts')) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout receipt authority is not writable.' };
  }
  if (order == null && !canAssignProperty(shop, 'checkoutSettlementReceiptKeys')) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout receipt order is not writable.' };
  }
  const liveReceipts = receipts || {};
  const liveOrder = order || [];
  const validation = validateCheckoutSettlementReceipts(liveReceipts, liveOrder);
  if (!validation.ok) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: validation.diagnostic };
  }
  const outcomeId = outcomePreflight?.outcome?.id || outcomePreflight?.preview?.id || null;
  const receipt = checkoutSettlementReceiptForPlan(plan, outcomeId);
  if (!validReceipt(receipt, plan.settlementId)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout receipt plan is invalid.' };
  }
  const prior = liveReceipts[plan.settlementId] || null;
  if (prior) {
    if (stableSerialize(prior) !== stableSerialize(receipt)) {
      return { ok: false, conflict: true, reason: t('checkout.integrityUnavailable'), diagnostic: 'That checkout identity has a conflicting settlement receipt.' };
    }
    return { ok: true, already: true, receipt, retire: null };
  }
  if (!canAssignProperty(liveReceipts, plan.settlementId)
      || !canMutateArray(liveOrder, { append: true, remove: true })) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout receipt authority is not writable.' };
  }
  const retire = liveOrder.length >= MAX_SETTLEMENT_RECEIPTS
    ? liveOrder.find((settlementId) => !settlementReceiptPinned(
      state,
      settlementId,
      liveReceipts[settlementId],
    )) ?? null
    : null;
  if (liveOrder.length >= MAX_SETTLEMENT_RECEIPTS && retire == null) {
    return {
      ok: false,
      reason: t('checkout.integrityUnavailable'),
      diagnostic: 'The checkout receipt retention authority is full of live settlement evidence.',
    };
  }
  if (retire != null && !canDeleteProperty(liveReceipts, retire)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout receipt authority cannot retire an old record.' };
  }
  const retireOperationReferences = [];
  if (retire != null) {
    const retiredReceipt = liveReceipts[retire];
    const lifecycle = shop.inventoryLifecycle;
    const referenceId = retiredReceipt?.inventoryReferenceId;
    if (typeof referenceId === 'string' && referenceId
        && isRecord(lifecycle?.operations)
        && Object.hasOwn(lifecycle.operations, referenceId)) {
      if (!Array.isArray(lifecycle.operationKeys)
          || lifecycle.operationKeys.filter((key) => key === referenceId).length !== 1
          || !canDeleteProperty(lifecycle.operations, referenceId)
          || !canMutateArray(lifecycle.operationKeys, { remove: true })) {
        return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout receipt inventory evidence cannot be retired safely.' };
      }
      retireOperationReferences.push(referenceId);
    }
  }
  return { ok: true, already: false, receipt, retire, retireOperationReferences };
}

function applySettlementReceipt(state, preflight) {
  if (!preflight.ok || preflight.already) return preflight;
  if (!isRecord(state.shop.checkoutSettlementReceipts)) {
    state.shop.checkoutSettlementReceipts = {};
  }
  if (!Array.isArray(state.shop.checkoutSettlementReceiptKeys)) {
    state.shop.checkoutSettlementReceiptKeys = [];
  }
  if (preflight.retire != null) {
    delete state.shop.checkoutSettlementReceipts[preflight.retire];
    const retireIndex = state.shop.checkoutSettlementReceiptKeys.indexOf(preflight.retire);
    if (retireIndex >= 0) state.shop.checkoutSettlementReceiptKeys.splice(retireIndex, 1);
    const references = new Set(preflight.retireOperationReferences || []);
    const lifecycle = state.shop.inventoryLifecycle;
    if (isRecord(lifecycle?.operations) && Array.isArray(lifecycle.operationKeys)) {
      for (const referenceId of references) delete lifecycle.operations[referenceId];
      for (let index = lifecycle.operationKeys.length - 1; index >= 0; index -= 1) {
        if (references.has(lifecycle.operationKeys[index])) lifecycle.operationKeys.splice(index, 1);
      }
    }
  }
  state.shop.checkoutSettlementReceipts[preflight.receipt.settlementId] = preflight.receipt;
  state.shop.checkoutSettlementReceiptKeys.push(preflight.receipt.settlementId);
  return { ok: true, already: false, receipt: preflight.receipt };
}

export function reconcilePendingCheckout(state, settlementId, {
  applyCustomerEvents = true,
  qaFaultAfterInventory = null,
  qaFaultAfterCoreCommit = null,
} = {}) {
  const pending = pendingMap(state);
  const plan = pending?.[settlementId];
  if (!plan) return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'No pending checkout settlement was found.' };
  if (!canDeleteProperty(pending, settlementId)) {
    return { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The pending checkout settlement journal is not writable.' };
  }
  const validation = validatePlan(plan, settlementId, state);
  if (!validation.ok) return validation;
  const inventoryPreflight = preflightInventoryState(state, plan.inventory ?? null);
  if (!inventoryPreflight.ok) return inventoryPreflight;
  const drawerPreflight = preflightDrawer(state, plan.drawer ?? null);
  if (!drawerPreflight.ok) return drawerPreflight;
  const ticketPreflight = preflightTicket(state, plan);
  if (!ticketPreflight.ok) return ticketPreflight;

  // Every potentially failing projection is checked before the first core
  // mutation. Once this gate passes, reconciliation is a forward-only replay of
  // operation-keyed writes plus one-property ticket publication.
  const postingsPreflight = preflightPostings(state, plan.postings);
  if (!postingsPreflight.ok) return postingsPreflight;
  const projectionsPreflight = preflightProjectionState(state, plan.projections || []);
  if (!projectionsPreflight.ok) return projectionsPreflight;
  const outcomePreflight = preflightOutcomeSpec(state, plan.outcomeSpec ?? null);
  if (!outcomePreflight.ok) return outcomePreflight;
  const reservationPreflight = preflightReservationTarget(state, plan.reservationTarget ?? null);
  if (!reservationPreflight.ok) return reservationPreflight;
  const customerPreflight = preflightCustomerEvent(state, plan.ticketDraft);
  if (!customerPreflight.ok) return customerPreflight;
  const receiptPreflight = preflightSettlementReceipt(state, plan, outcomePreflight);
  if (!receiptPreflight.ok) return receiptPreflight;

  const inventory = applyInventory(state, plan.inventory ?? null);
  if (!inventory.ok) return inventory;
  if (typeof qaFaultAfterInventory === 'function'
      && !inventory.skipped && !inventory.already) {
    qaFaultAfterInventory();
  }
  const drawer = applyDrawer(state, plan.drawer ?? null);
  if (!drawer.ok) return drawer;
  const postings = applyPostings(state, plan.postings);
  if (!postings.ok) return postings;
  const projections = applyProjections(state, plan.projections || []);
  if (!projections.ok) return projections;

  if (typeof qaFaultAfterCoreCommit === 'function' && !ticketPreflight.ticket) {
    qaFaultAfterCoreCommit();
  }

  if (plan.outcomeSpec != null && !outcomePreflight.duplicate) {
    const outcome = recordOutcome(state, plan.outcomeSpec);
    if (!outcome.ok || !outcome.outcome) {
      return outcome.ok
        ? { ok: false, reason: t('checkout.integrityUnavailable'), diagnostic: 'The checkout outcome checkpoint is incomplete.' }
        : outcome;
    }
  }
  const appended = appendTicket(state, plan, ticketPreflight);
  if (!appended.ok) return appended;

  if (!applyCustomerEvents && (plan.reservationTarget != null || appended.ticket.customerVisitEvent)) {
    return {
      ok: true,
      pendingTail: true,
      ticket: appended.ticket,
      settlementId,
    };
  }

  const reservation = applyReservationTarget(
    state,
    plan.reservationTarget ?? null,
    reservationPreflight,
  );
  if (!reservation.ok) {
    return {
      ok: true,
      pendingTail: true,
      ticket: appended.ticket,
      settlementId,
      reservation,
    };
  }

  let customer = { ok: true, skipped: true };
  if (appended.ticket.customerVisitEvent) {
    customer = reconcileCustomerVisitEvents(state, { tickets: [appended.ticket] });
    if (!customer.ok) {
      return {
        ok: true,
        pendingTail: true,
        ticket: appended.ticket,
        settlementId,
        customer,
      };
    }
  }
  const receipt = applySettlementReceipt(state, receiptPreflight);
  if (!receipt.ok) {
    return {
      ok: true,
      pendingTail: true,
      ticket: appended.ticket,
      settlementId,
      receipt,
    };
  }
  const operations = operationMap(state);
  if (operations) {
    for (const projection of plan.projections || []) delete operations[projection.id];
  }
  delete pending[settlementId];
  return {
    ok: true,
    recovered: inventory.already || drawer.already || appended.already,
    ticket: appended.ticket,
    settlementId,
    customer,
    reservation,
  };
}

export function reconcilePendingCheckouts(state, options = {}) {
  if (checkoutWalIsQuarantined(state)) {
    return {
      ok: false,
      completed: 0,
      pending: 1,
      failures: [{
        settlementId: null,
        reason: t('checkout.integrityUnavailable'),
        diagnostic: 'The checkout settlement journal is quarantined and cannot be recovered automatically.',
      }],
    };
  }
  const pending = pendingMap(state);
  if (!pending) return { ok: true, completed: 0, pending: 0, failures: [] };
  const plans = Object.entries(pending)
    .sort(([, left], [, right]) => (Number(left?.ticketNumber) || 0) - (Number(right?.ticketNumber) || 0));
  const report = { completed: 0, pending: 0, failures: [] };
  for (const [settlementId] of plans) {
    let result;
    try {
      result = reconcilePendingCheckout(state, settlementId, options);
    } catch (error) {
      result = { ok: false, diagnostic: String(error?.message || error) };
    }
    if (result.ok && !result.pendingTail) report.completed += 1;
    else {
      report.pending += 1;
      if (!result.ok) {
        report.failures.push({
          settlementId,
          diagnostic: result.diagnostic || result.reason || 'Settlement recovery failed.',
        });
      }
    }
  }
  return { ok: report.failures.length === 0, ...report };
}

export function checkoutTicketByTransaction(state, transactionId) {
  if (typeof transactionId !== 'string' || !transactionId) return null;
  return (Array.isArray(state?.shop?.transactionHistory) ? state.shop.transactionHistory : [])
    .find((ticket) => ticket?.transactionId === transactionId) || null;
}

export function drainPendingCheckoutCore(state) {
  return reconcilePendingCheckouts(state, { applyCustomerEvents: false });
}

export function settlementRound2(value) {
  return round2(value);
}
