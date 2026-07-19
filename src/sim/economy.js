// FAIRWAY STATE — the club's books.
// Every recurring cash flow routes through addRevenue/addExpense so the ledger
// always reconciles: across any midnight-to-midnight window, yesterday.net equals
// the actual cash movement (a unit-tested invariant). Recurring items accrue at
// the closing midnight of the day they belong to.

export function emptyLines() {
  return {
    revenue: {
      greenFees: 0, dues: 0, outings: 0, range: 0, restaurant: 0, lessons: 0,
      shopSales: 0, rentals: 0, fittings: 0, reciprocal: 0, events: 0,
      bookingRevenue: 0, bookingDeposits: 0, bookingBalances: 0,
      cancellationFees: 0, noShowFees: 0, walkInRevenue: 0,
    },
    expense: {
      wagesStaff: 0, wagesDayLabor: 0, water: 0, fertilizer: 0, chemicals: 0,
      upkeep: 0, utilities: 0, works: 0, severance: 0, training: 0, shopOrders: 0, rentalFleet: 0, events: 0,
      rent: 0, bookingRefunds: 0,
    },
  };
}

export function initLedger(state) {
  state.ledger = { today: emptyLines(), yesterday: null, history: [] };
}

const r2 = (v) => Math.round(v * 100) / 100;

export function addRevenue(state, key, amount) {
  const amt = r2(amount);
  if (amt <= 0) return;
  state.cash += amt;
  state.ledger.today.revenue[key] = r2((state.ledger.today.revenue[key] || 0) + amt);
}

export function addExpense(state, key, amount) {
  const amt = r2(amount);
  if (amt <= 0) return;
  state.cash -= amt;
  state.ledger.today.expense[key] = r2((state.ledger.today.expense[key] || 0) + amt);
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
  if (amt <= 0) return;
  state.cash += amt;
  if (state.ledger) {
    state.ledger.today.expense[key] = r2((state.ledger.today.expense[key] || 0) - amt);
  }
}

// Spend that works with or without a ledger (some unit tests use bare states),
// so sim modules can bill consistently from anywhere.
export function spend(state, key, amount) {
  if (state.ledger) addExpense(state, key, amount);
  else state.cash -= amount;
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
