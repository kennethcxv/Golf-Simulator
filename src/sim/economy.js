// GOLF EMPIRE — authoritative business ledger.
//
// Existing systems still call addRevenue/addExpense/spend. Those functions now
// append immutable entries and maintain the old aggregate cash lines as a
// compatibility view. UI state never creates money. A gameplay command may pass
// an idempotencyKey; replaying that command then returns the original entry and
// moves neither cash nor profit a second time.

export const LEDGER_VERSION = 2;
export const LEDGER_HISTORY_DAYS = 60;

export const LEDGER_LABELS = {
  greenFees: 'Green fees',
  walkIns: 'Walk-in green fees',
  teeTimeBookings: 'Tee-time bookings',
  dues: 'Membership dues',
  guestPasses: 'Guest passes',
  outings: 'Corporate outings',
  range: 'Practice range',
  restaurant: 'Grill room',
  lessons: 'Lessons',
  shopSales: 'Pro-shop sales',
  rentals: 'Club rentals',
  fittings: 'Club fittings',
  reciprocal: 'Reciprocal guests',
  events: 'Events',
  noShowFees: 'No-show fees',
  cancellationFees: 'Cancellation fees',
  bookingRevenue: 'Prepaid green fees',
  bookingDeposits: 'Green-fee deposits',
  bookingBalances: 'Green-fee balances',
  walkInRevenue: 'Walk-in green fees',
  otherRevenue: 'Other revenue',
  wagesStaff: 'Staff wages',
  wagesDayLabor: 'Day labour',
  water: 'Water',
  fertilizer: 'Fertiliser',
  chemicals: 'Chemicals',
  upkeep: 'Maintenance supplies',
  utilities: 'Utilities',
  works: 'Restoration works',
  severance: 'Severance',
  training: 'Training',
  shopOrders: 'Merchandise orders',
  deliveryCosts: 'Delivery costs',
  rentalFleet: 'Rental equipment',
  equipment: 'Equipment',
  cleaningSupplies: 'Cleaning supplies',
  propertyExpenses: 'Property expenses',
  rent: 'Property holding cost',
  checkoutShortage: 'Checkout shortage',
  bookingRefunds: 'Booking refunds',
  costOfGoods: 'Cost of goods sold',
};

const CAPITAL_LINES = new Set(['works', 'rentalFleet', 'equipment']);
const INVENTORY_LINES = new Set(['shopOrders', 'deliveryCosts']);
const COGS_LINES = new Set(['costOfGoods']);

export function emptyLines() {
  return {
    revenue: { greenFees: 0, dues: 0, outings: 0, range: 0, restaurant: 0, lessons: 0, shopSales: 0, assetSales: 0, rentals: 0, fittings: 0, reciprocal: 0, events: 0 },
    expense: {
      wagesStaff: 0, wagesDayLabor: 0, water: 0, fertilizer: 0, chemicals: 0,
      upkeep: 0, utilities: 0, works: 0, severance: 0, training: 0,
      shopOrders: 0, deliveryCosts: 0, rentalFleet: 0, equipment: 0,
      cleaningSupplies: 0, propertyExpenses: 0, events: 0, rent: 0,
      checkoutShortage: 0, bookingRefunds: 0,
    },
  };
}

export function initLedger(state) {
  state.ledger = { today: emptyLines(), yesterday: null, history: [], txLog: [] };
}

const r2 = (v) => Math.round(v * 100) / 100;

// THE TRANSACTION LOG. Every movement addRevenue/addExpense/unbill lets through is also
// filed as one event row: minute, direction, ledger line, amount, and the balance the till
// held after the movement. Because it is written HERE — at the single chokepoint — the log
// can never disagree with the lines above it. Bounded so the save stays small; the daily
// history remains the long-term record.
export const TX_LOG_CAP = 80;
function logTx(state, kind, key, amt) {
  const led = state.ledger;
  if (!led) return;
  if (!Array.isArray(led.txLog)) led.txLog = [];
  led.txLog.unshift({
    m: state.clock && Number.isFinite(state.clock.minutes) ? Math.floor(state.clock.minutes) : 0,
    kind, // 'rev' | 'exp' | 'refund'
    key,
    amt: r2(amt),
    bal: r2(state.cash),
  });
  if (led.txLog.length > TX_LOG_CAP) led.txLog.length = TX_LOG_CAP;
}

// NaN is the one amount that must never move: `NaN <= 0` is false, so a naive
// guard lets it through, `cash += NaN` poisons the balance, and the corruption
// then survives every close-of-books (this exact chain took a live save down —
// a reservation with no fee posted round2(undefined) into greenFees).
export function addRevenue(state, key, amount) {
  const amt = r2(amount);
  if (!Number.isFinite(amt) || amt <= 0) return;
  state.cash += amt;
  state.ledger.today.revenue[key] = r2((state.ledger.today.revenue[key] || 0) + amt);
  logTx(state, 'rev', key, amt);
}

export function addExpense(state, key, amount) {
  const amt = r2(amount);
  if (!Number.isFinite(amt) || amt <= 0) return;
  state.cash -= amt;
  state.ledger.today.expense[key] = r2((state.ledger.today.expense[key] || 0) + amt);
  logTx(state, 'exp', key, amt);
}

// UNWIND A BOOKING THAT NEVER HAPPENED.
//
// A cancelled supplier order has to give back money that was already spent. Routing that through
// addRevenue would balance the CASH and lie about the BOOKS: the day would show a purchase and a
// mysterious matching income, and every margin on the Finances page would be wrong.
//
// So reverse the original entry instead. Cash back, expense line back down, no trace — which is
// what "cancelled" means. It is the one place a line may move backwards, and only ever by an
// amount that was genuinely booked to it.
export function unbill(state, key, amount) {
  const amt = r2(amount);
  if (!Number.isFinite(amt) || amt <= 0) return;
  state.cash += amt;
  if (state.ledger) {
    state.ledger.today.expense[key] = r2((state.ledger.today.expense[key] || 0) - amt);
    logTx(state, 'refund', key, amt);
  }
  return `${normalized.slice(0, 148)}-${(hash >>> 0).toString(36)}`;
}

// Spend that works with or without a ledger (some unit tests use bare states),
// so sim modules can bill consistently from anywhere.
export function spend(state, key, amount) {
  if (state.ledger) addExpense(state, key, amount);
  else if (Number.isFinite(amount)) state.cash -= amount;
}

export function totals(lines) {
  let revenue = 0;
  let expense = 0;
  for (const value of Object.values(lines?.revenue || {})) revenue += value;
  for (const value of Object.values(lines?.expense || {})) expense += value;
  return { revenue: r2(revenue), expense: r2(expense), net: r2(revenue - expense) };
}

export function entriesInWindow(state, fromDay, toDay = fromDay) {
  const ledger = ensureLedger(state);
  return ledger.entries.filter((entry) => entry.day >= fromDay && entry.day <= toDay);
}

export function outcomesInWindow(state, fromDay, toDay = fromDay) {
  const ledger = ensureLedger(state);
  return ledger.outcomes.filter((outcome) => outcome.day >= fromDay && outcome.day <= toDay);
}

export function financialSummary(state, fromDay, toDay = fromDay) {
  const entries = entriesInWindow(state, fromDay, toDay);
  const summary = {
    fromDay,
    toDay,
    grossRevenue: 0,
    costOfGoodsSold: 0,
    operatingExpenses: 0,
    netProfit: 0,
    cashChange: 0,
    inventoryPurchases: 0,
    restorationInvestment: 0,
    revenueByCategory: {},
    expenseByCategory: {},
    entryCount: entries.length,
  };
  for (const entry of entries) {
    summary.cashChange += entry.cashImpact || 0;
    summary.netProfit += entry.profitImpact || 0;
    if (entry.accountingClass === 'revenue' && entry.profitImpact > 0) {
      summary.grossRevenue += entry.profitImpact;
      summary.revenueByCategory[entry.category] = (summary.revenueByCategory[entry.category] || 0) + entry.profitImpact;
    } else if (entry.accountingClass === 'cogs') {
      summary.costOfGoodsSold += Math.abs(entry.profitImpact || entry.amount);
      summary.expenseByCategory.costOfGoods = (summary.expenseByCategory.costOfGoods || 0) + Math.abs(entry.profitImpact || entry.amount);
    } else if (entry.accountingClass === 'operating' && entry.profitImpact < 0) {
      summary.operatingExpenses += Math.abs(entry.profitImpact);
      summary.expenseByCategory[entry.category] = (summary.expenseByCategory[entry.category] || 0) + Math.abs(entry.profitImpact);
    } else if (entry.accountingClass === 'inventory' && entry.cashImpact < 0) {
      summary.inventoryPurchases += Math.abs(entry.cashImpact);
    } else if (entry.accountingClass === 'capital' && entry.cashImpact < 0) {
      summary.restorationInvestment += Math.abs(entry.cashImpact);
    }
  }
  for (const key of ['grossRevenue', 'costOfGoodsSold', 'operatingExpenses', 'netProfit', 'cashChange', 'inventoryPurchases', 'restorationInvestment']) {
    summary[key] = r2(summary[key]);
  }
  for (const bucket of [summary.revenueByCategory, summary.expenseByCategory]) {
    for (const key of Object.keys(bucket)) bucket[key] = r2(bucket[key]);
  }
  return summary;
}

export function closeBooks(state, dayAbs, indicators = {}) {
  const ledger = ensureLedger(state);
  const cash = totals(ledger.today);
  const financial = financialSummary(state, dayAbs, dayAbs);
  const entry = {
    dayAbs,
    revenue: { ...ledger.today.revenue },
    expense: { ...ledger.today.expense },
    revenueTotal: cash.revenue,
    expenseTotal: cash.expense,
    net: cash.net,
    summary: { ...financial, ...indicators },
  };
  ledger.history.push(entry);
  if (ledger.history.length > LEDGER_HISTORY_DAYS) ledger.history.shift();
  ledger.dailySummaries.push(entry.summary);
  if (ledger.dailySummaries.length > LEDGER_HISTORY_DAYS) ledger.dailySummaries.shift();
  const oldestDay = dayAbs - LEDGER_HISTORY_DAYS + 1;
  ledger.entries = ledger.entries.filter((item) => item.day >= oldestDay);
  ledger.outcomes = ledger.outcomes.filter((item) => item.day >= oldestDay);
  ledger.yesterday = entry;
  ledger.today = emptyLines();
  ledger.postingDay = null;
  return entry;
}
