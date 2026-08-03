// THE OPEN / CLOSED SIGN — the shape of the day.
//
// Before this existed, the shop's doors were governed by the clock alone: at
// 6 AM customers simply started arriving, whatever state the room was in. That
// gave the day no preparation window and made "am I ready?" a question the game
// answered for the player.
//
// With the sign, the morning is: arrive, unlock, clean, stock, check the tee
// sheet — and THEN flip it. Only then does the pressure start. That window is
// where restocking properly actually pays off, and readiness becomes the
// player's judgment rather than a timer's.
//
// The costs are deliberately unannounced (Designs/ROADMAP.md, "Implemented from
// this document"): opening late costs customers, opening filthy costs
// reputation, and NEITHER gets a warning popup. The player learns it.
//
// Trading HOURS remain a real constraint on top of the sign: flipping to OPEN
// at 3 AM does not conjure customers. The sign gates arrivals WITHIN the hours
// the world already keeps; it does not extend them.

export const SHOP_HOURS = Object.freeze({ openMinute: 360, closeMinute: 1200 });

/** Trading hours, independent of the sign. Minute-of-day, 0..1439. */
export function withinTradingHours(minuteOfDay) {
  const minute = ((Number(minuteOfDay) || 0) % 1440 + 1440) % 1440;
  return minute >= SHOP_HOURS.openMinute && minute <= SHOP_HOURS.closeMinute;
}

/** Is the physical sign turned to OPEN? Defaults to CLOSED on a fresh state. */
export function signIsOpen(state) {
  return !!state?.shop?.signOpen;
}

/**
 * The one question the customer loop asks: may new shoppers walk in right now?
 * Both conditions must hold — the world's hours AND the player's sign.
 */
export function shopAcceptsWalkIns(state, minuteOfDay) {
  return withinTradingHours(minuteOfDay) && signIsOpen(state);
}

/**
 * Flip it. Returns the new state plus the facts a caller needs to narrate the
 * flip — no toasts are raised from here, because the sim does not own words.
 */
export function flipSign(state, minuteOfDay) {
  if (!state || !state.shop) return { ok: false, reason: 'no shop' };
  const wasOpen = signIsOpen(state);
  state.shop.signOpen = !wasOpen;
  if (state.shop.signOpen) {
    // Remember WHEN, so "opened late" is measurable rather than a feeling.
    state.shop.signOpenedAtMinute = Math.round(Number(minuteOfDay) || 0);
  }
  return {
    ok: true,
    open: state.shop.signOpen,
    withinHours: withinTradingHours(minuteOfDay),
    minutesLate: state.shop.signOpen
      ? Math.max(0, Math.round(
        (((Number(minuteOfDay) || 0) % 1440 + 1440) % 1440) - SHOP_HOURS.openMinute,
      ))
      : 0,
  };
}

/**
 * Every new day starts CLOSED. The preparation window is the point of the
 * feature; a sign that stayed open overnight would delete it.
 */
export function closeSignForNewDay(state) {
  if (!state || !state.shop) return false;
  state.shop.signOpen = false;
  state.shop.signOpenedAtMinute = null;
  return true;
}

/**
 * Older saves predate the sign. They must not load into a shop that silently
 * refuses every customer, so a save with no sign field at all is healed to the
 * state its player last experienced: open during trading hours.
 */
export function healShopSign(state) {
  if (!state || !state.shop) return false;
  if (typeof state.shop.signOpen === 'boolean') return false;
  state.shop.signOpen = true;
  state.shop.signOpenedAtMinute = SHOP_HOURS.openMinute;
  return true;
}
