// FAIRWAY STATE — the club's books.
// Every recurring cash flow routes through addRevenue/addExpense so the ledger
// always reconciles: across any midnight-to-midnight window, yesterday.net equals
// the actual cash movement (a unit-tested invariant). Recurring items accrue at
// the closing midnight of the day they belong to.

export function emptyLines() {
  return {
    revenue: { greenFees: 0, dues: 0, outings: 0, range: 0, restaurant: 0, lessons: 0, shopSales: 0, rentals: 0, fittings: 0, reciprocal: 0, events: 0 },
    expense: {
      wagesStaff: 0, wagesDayLabor: 0, water: 0, fertilizer: 0, chemicals: 0,
      upkeep: 0, utilities: 0, works: 0, severance: 0, training: 0, shopOrders: 0, rentalFleet: 0, events: 0,
      rent: 0,
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
  for (const v of Object.values(lines.revenue)) revenue += v;
  for (const v of Object.values(lines.expense)) expense += v;
  return { revenue: r2(revenue), expense: r2(expense), net: r2(revenue - expense) };
}

export function closeBooks(state, dayAbs) {
  const t = totals(state.ledger.today);
  const entry = {
    dayAbs,
    revenue: { ...state.ledger.today.revenue },
    expense: { ...state.ledger.today.expense },
    revenueTotal: t.revenue,
    expenseTotal: t.expense,
    net: t.net,
  };
  state.ledger.history.push(entry);
  if (state.ledger.history.length > 30) state.ledger.history.shift();
  state.ledger.yesterday = entry;
  state.ledger.today = emptyLines();
}
