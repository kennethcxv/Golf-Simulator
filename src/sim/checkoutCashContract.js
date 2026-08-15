export const MAX_EXTRA_CHANGE_CENTS = 500;

const round2 = (value) => Math.round(Number(value) * 100) / 100;
const validCentValue = (value, { signed = false } = {}) => (
  typeof value === 'number'
  && Number.isFinite(value)
  && (signed || value >= 0)
  && round2(value) === value
  && Number.isSafeInteger(Math.round(value * 100))
);

// Persisted checkout money must describe a payment the player can actually
// perform at the register. Cash customers tender at least the amount due; the
// player returns all required change and may deliberately add no more than $5.
export function checkoutPaymentContract(ticket) {
  const total = Number(ticket?.total);
  const cash = Number(ticket?.cash);
  const lost = Number(ticket?.lost ?? 0);
  if (!validCentValue(total) || !validCentValue(cash, { signed: true })
      || !validCentValue(lost)) return false;

  if (ticket?.method === 'card') {
    return lost === 0
      && cash === total
      && (!Object.hasOwn(ticket, 'tendered') || ticket.tendered === null)
      && (!Object.hasOwn(ticket, 'changeGiven') || ticket.changeGiven === null)
      && (!Object.hasOwn(ticket, 'extraChange') || ticket.extraChange === null);
  }
  if (ticket?.method !== 'cash') return false;

  const tendered = Number(ticket.tendered);
  const changeGiven = Number(ticket.changeGiven);
  const extraChange = Number(ticket.extraChange);
  if (!validCentValue(tendered) || !validCentValue(changeGiven)
      || !validCentValue(extraChange)
      || tendered < total
      || Math.round(lost * 100) > MAX_EXTRA_CHANGE_CENTS) return false;
  const requiredChange = round2(tendered - total);
  return extraChange === lost
    && changeGiven === round2(requiredChange + lost)
    && cash === round2(tendered - changeGiven)
    && cash === round2(total - lost);
}
