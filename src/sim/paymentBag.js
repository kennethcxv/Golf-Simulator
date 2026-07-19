// THE PAYMENT-METHOD BAG. Cash-or-card is drawn from a balanced shuffled bag —
// five of each per batch — so over any complete batch the split is exactly
// 50/50 while the order stays random. A customer draws ONCE, when they are
// created or queued, and keeps that preference for life: nothing about entering
// the register, saving, reloading, or starting payment ever rerolls it.
//
// The bag itself lives in state.shop.paymentBag, so a half-used batch survives
// save/load and the balance guarantee holds across sessions. Scripted customers
// (tutorials, QA sendToCounter with an explicit method) bypass the bag; golfers
// whose round is already paid never draw at all.

const CASH_PER_BATCH = 5;
const CARD_PER_BATCH = 5;

export const PAYMENT_BAG_BATCH = CASH_PER_BATCH + CARD_PER_BATCH;

const isMethod = (value) => value === 'cash' || value === 'card';

function shopOf(state) {
  return state && state.shop ? state.shop : null;
}

// Drop anything a hand-edited or corrupted save put in the bag. An invalid bag
// never breaks a draw — it just refills.
export function ensurePaymentBag(state) {
  const shop = shopOf(state);
  if (!shop) return [];
  if (!Array.isArray(shop.paymentBag)) shop.paymentBag = [];
  shop.paymentBag = shop.paymentBag.filter(isMethod);
  const cash = shop.paymentBag.filter((method) => method === 'cash').length;
  const card = shop.paymentBag.length - cash;
  if (shop.paymentBag.length > PAYMENT_BAG_BATCH || cash > CASH_PER_BATCH || card > CARD_PER_BATCH) {
    shop.paymentBag = [];
  }
  return shop.paymentBag;
}

export function refillPaymentBag(state, rng = Math.random) {
  const shop = shopOf(state);
  if (!shop) return [];
  const batch = [
    ...Array(CASH_PER_BATCH).fill('cash'),
    ...Array(CARD_PER_BATCH).fill('card'),
  ];
  // Fisher–Yates with the caller's (seeded) rng keeps runs reproducible.
  for (let i = batch.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [batch[i], batch[j]] = [batch[j], batch[i]];
  }
  shop.paymentBag = batch;
  return shop.paymentBag;
}

// The one draw a customer makes. Also feeds the development diagnostic tallies —
// they are bookkeeping only and are never shown to players.
export function drawPaymentMethod(state, rng = Math.random) {
  const shop = shopOf(state);
  if (!shop) return rng() < 0.5 ? 'cash' : 'card';
  const bag = ensurePaymentBag(state);
  if (!bag.length) refillPaymentBag(state, rng);
  const method = shop.paymentBag.pop();
  const stats = paymentBagStats(state);
  stats.assigned[method] += 1;
  stats.recent.push(method);
  if (stats.recent.length > 100) stats.recent.splice(0, stats.recent.length - 100);
  return method;
}

export function paymentBagStats(state) {
  const shop = shopOf(state);
  if (!shop) return { assigned: { cash: 0, card: 0 }, recent: [] };
  if (!shop.paymentBagStats
      || !shop.paymentBagStats.assigned
      || !Array.isArray(shop.paymentBagStats.recent)) {
    shop.paymentBagStats = { assigned: { cash: 0, card: 0 }, recent: [] };
  }
  const { assigned } = shop.paymentBagStats;
  if (!Number.isSafeInteger(assigned.cash) || assigned.cash < 0) assigned.cash = 0;
  if (!Number.isSafeInteger(assigned.card) || assigned.card < 0) assigned.card = 0;
  shop.paymentBagStats.recent = shop.paymentBagStats.recent.filter(isMethod).slice(-100);
  return shop.paymentBagStats;
}

// Development-only diagnostic: current bag composition, lifetime assignment
// tallies, the last 100 draws, and the methods of the last 100 banked eligible
// transactions from history.
export function paymentDistributionReport(state) {
  const shop = shopOf(state);
  const bag = ensurePaymentBag(state);
  const stats = paymentBagStats(state);
  const recent = { cash: 0, card: 0 };
  for (const method of stats.recent) {
    if (isMethod(method)) recent[method] += 1;
  }
  const banked = { cash: 0, card: 0 };
  const history = shop && Array.isArray(shop.transactionHistory) ? shop.transactionHistory : [];
  for (const ticket of history.slice(0, 100)) {
    if (ticket && isMethod(ticket.method)) banked[ticket.method] += 1;
  }
  return {
    bag: [...bag],
    bagRemaining: { cash: bag.filter((m) => m === 'cash').length, card: bag.filter((m) => m === 'card').length },
    assigned: { ...stats.assigned },
    last100Draws: recent,
    last100Banked: banked,
  };
}
