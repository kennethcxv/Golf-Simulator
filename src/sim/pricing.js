import { clamp } from '../core/utils.js';
import { SHOP_CATALOG, RETAIL_CATS } from '../data/shopItems.js';
import { priceFor } from './shop.js';
import { clubRatings, amenityScore, fairGreenFee, fairDues, demandMultiplier } from './club.js';

const r2 = (value) => Math.round(value * 100) / 100;

export function responseBand(ratio) {
  if (ratio < 0.8) return {
    id: 'value', label: 'Value-led', tone: 'warn',
    satisfaction: 'Customers love the value, but margin is thin.', reputationEffect: 'positive',
  };
  if (ratio <= 1.05) return {
    id: 'fair', label: 'Fair', tone: 'ok',
    satisfaction: 'Price and quality are in balance.', reputationEffect: 'stable',
  };
  if (ratio <= 1.2) return {
    id: 'premium', label: 'Premium', tone: 'warn',
    satisfaction: 'Some demand falls away; quality must justify it.', reputationEffect: 'at risk',
  };
  if (ratio <= 1.4) return {
    id: 'expensive', label: 'Expensive', tone: 'bad',
    satisfaction: 'Most price-sensitive customers walk.', reputationEffect: 'negative',
  };
  return {
    id: 'punishing', label: 'Punishing', tone: 'bad',
    satisfaction: 'Margin per sale is high, but sales and reputation collapse.', reputationEffect: 'strongly negative',
  };
}

export function productPricingResponse(state, category, markup = state.shop.markup[category]) {
  const value = clamp(Number(markup) || 1, 0.7, 1.5);
  const products = SHOP_CATALOG.filter((sku) => RETAIL_CATS.has(sku.cat) && sku.cat === category && sku.tier <= state.shop.unlockedTier);
  const demandFactor = clamp(Math.pow(1 / value, 2.35), 0.14, 1.5);
  const margins = products.map((sku) => {
    const price = priceFor(sku, value, null);
    return price > 0 ? (price - sku.cost) / price : 0;
  });
  const averageMargin = margins.length ? margins.reduce((sum, margin) => sum + margin, 0) / margins.length : 0;
  return {
    type: 'product',
    category,
    value,
    fairValue: 1,
    ratio: value,
    band: responseBand(value),
    demandFactor: r2(demandFactor),
    salesLikelihoodPercent: Math.round(clamp(demandFactor, 0, 1) * 100),
    revenueIndex: r2(value * demandFactor),
    averageMargin: r2(averageMargin),
  };
}

export function teePricingResponse(state, fee = state.club.greenFee) {
  const ratings = clubRatings(state);
  const fair = fairGreenFee(ratings.overall, amenityScore(state));
  const ratio = Number(fee) / Math.max(1, fair);
  const demand = demandMultiplier(Number(fee), fair);
  return {
    type: 'teeTime',
    value: Number(fee),
    fairValue: r2(fair),
    ratio: r2(ratio),
    band: responseBand(ratio),
    demandFactor: r2(demand),
    salesLikelihoodPercent: Math.round(clamp(demand / 1.8, 0, 1) * 100),
    revenueIndex: r2(ratio * demand),
  };
}

export function membershipPricingResponse(state, tier, due = state.club.dues[tier]) {
  const ratings = clubRatings(state);
  const fair = fairDues(state, tier, ratings.overall, amenityScore(state));
  const ratio = Number(due) / Math.max(1, fair);
  const demand = clamp(Math.pow(1 / Math.max(0.1, ratio), 2), 0.03, 2.2);
  return {
    type: 'membership',
    tier,
    value: Number(due),
    fairValue: r2(fair),
    ratio: r2(ratio),
    band: responseBand(ratio),
    demandFactor: r2(demand),
    salesLikelihoodPercent: Math.round(clamp(demand / 2.2, 0, 1) * 100),
    revenueIndex: r2(ratio * demand),
  };
}

export function rentalPricingResponse(state, price = state.shop.rentalFleet.pricePerRound) {
  const condition = state.shop.rentalFleet.condition || 0;
  const fair = 10 + condition * 0.14;
  const ratio = Number(price) / Math.max(1, fair);
  const demand = clamp(Math.pow(1 / Math.max(0.1, ratio), 1.7), 0.1, 1.6);
  return {
    type: 'rental',
    value: Number(price),
    fairValue: r2(fair),
    ratio: r2(ratio),
    band: responseBand(ratio),
    demandFactor: r2(demand),
    salesLikelihoodPercent: Math.round(clamp(demand / 1.6, 0, 1) * 100),
    revenueIndex: r2(ratio * demand),
  };
}

function valid(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function setProductMarkup(state, category, value) {
  if (!(category in state.shop.markup)) return { ok: false, reason: 'Unknown product category.' };
  const number = valid(value, 0.7, 1.5);
  if (number === null) return { ok: false, reason: 'Product markup must stay between 70% and 150% of book.' };
  state.shop.markup[category] = r2(number);
  return { ok: true, response: productPricingResponse(state, category) };
}

export function setGreenFee(state, value) {
  const number = valid(value, 10, 150);
  if (number === null) return { ok: false, reason: 'Green fee must stay between $10 and $150.' };
  state.club.greenFee = r2(number);
  return { ok: true, response: teePricingResponse(state) };
}

export function setMembershipDue(state, tier, value) {
  if (!(tier in state.club.dues)) return { ok: false, reason: 'Unknown membership tier.' };
  const number = valid(value, 100, 2000);
  if (number === null) return { ok: false, reason: 'Season dues must stay between $100 and $2,000.' };
  state.club.dues[tier] = r2(number);
  return { ok: true, response: membershipPricingResponse(state, tier) };
}

export function setRentalPrice(state, value) {
  const number = valid(value, 5, 60);
  if (number === null) return { ok: false, reason: 'Rental price must stay between $5 and $60.' };
  state.shop.rentalFleet.pricePerRound = r2(number);
  return { ok: true, response: rentalPricingResponse(state) };
}
