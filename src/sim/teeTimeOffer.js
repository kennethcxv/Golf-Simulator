// WHAT THE DESK OFFERS A WALK-IN, AND WHETHER THEY TAKE IT.
//
// Playtest B4: "a customer asking for 1:00 must be checked in at 1:00, 1:30 or
// 2:00 — a slot at or near what they asked for. If nothing is free within 30
// minutes either side, the player OFFERS the nearest available time and the
// customer accepts or declines."
//
// Two things were wrong with what this replaces, and they pull in opposite
// directions.
//
// THE LIST WAS EVERY SLOT IN THREE DAYS. The desk dropdown was built from
// availableSlots() across the horizon, so a 1:00 ask put 1:00 in a list of
// forty times running from this morning to the day after tomorrow, sorted by
// clock rather than by relevance. The right answer was in there; so was every
// wrong one. Offers are now CLUSTERED: the slots inside the window, nearest
// first, which for a 1:00 ask is 1:00, 1:30, 12:30, 2:00 — exactly the shape
// the report describes.
//
// THE CUTOFF WAS A WALL. Anything past 60 minutes from the ask was refused
// outright by createWalkInBooking, so a customer whose only remaining option
// was 90 minutes out always walked, whatever kind of afternoon they were
// having. The report asks for an offer they can accept or decline instead. So
// the window tightens to the stated 30 minutes for "near enough that nobody
// thinks twice", and beyond it the answer belongs to the CUSTOMER: each walk-in
// carries how far they will stretch. That keeps the decision deterministic and
// inspectable — the same person given the same offer always answers the same
// way — rather than a dice roll at the counter that cannot be reasoned about or
// tested.
// Deliberately imports nothing. reservations.js consumes walkInAcceptsOffer, so
// taking availableSlots() from there would close a module cycle for one call
// the caller already has in hand.
export const TEE_OFFER = Object.freeze({
  // "at or near what they asked for" — inside this, nobody hesitates
  windowMin: 30,
  // Nobody hangs around a clubhouse for more than this to play, however
  // relaxed. Caps the flexibility roll so a stretchy customer is still a
  // person.
  maxStretchMin: 150,
  // How many clustered offers are worth showing. Past this the list stops being
  // a cluster and starts being the sheet again.
  maxOffers: 6,
});

const finite = (value, fallback = null) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

// The slots to put in front of the player for this ask, nearest first.
//
// Inside the window they are all genuine near-misses. If NOTHING is inside it,
// the single nearest open slot comes back flagged `beyondWindow`, because the
// report's instruction there is to offer it — not to show an empty list.
export function teeTimeOffers(openSlots, askedMinute, options = {}) {
  const windowMin = finite(options.windowMin, TEE_OFFER.windowMin);
  const asked = finite(askedMinute);
  const open = Array.isArray(openSlots) ? openSlots : [];
  if (!open.length) return { offers: [], beyondWindow: false, none: true };
  if (asked == null) {
    return {
      offers: open.slice(0, TEE_OFFER.maxOffers).map((slot) => ({ slot, deltaMin: null })),
      beyondWindow: false,
      none: false,
    };
  }
  const byDistance = open
    .map((slot) => ({ slot, deltaMin: slot.minute - asked }))
    .sort((a, b) => Math.abs(a.deltaMin) - Math.abs(b.deltaMin)
      // a tie means one earlier and one later by the same amount; prefer the
      // later one, because a player who came in at 1:00 asking for 1:00 cannot
      // travel back to 12:30
      || b.deltaMin - a.deltaMin);
  const within = byDistance.filter((entry) => Math.abs(entry.deltaMin) <= windowMin);
  if (within.length) {
    return { offers: within.slice(0, TEE_OFFER.maxOffers), beyondWindow: false, none: false };
  }
  return { offers: [byDistance[0]], beyondWindow: true, none: false };
}

// How far past the window THIS customer will stretch. Deterministic from their
// own seed so the same person always answers the same way, and so a harness can
// state the answer before it asks the question.
export function teeFlexibilityFor(rng) {
  const roll = typeof rng === 'function' ? Number(rng()) : 0;
  const unit = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0;
  // Most people stretch a little; a few will wait a long time. Squaring the
  // roll keeps the long waits rare without making them impossible.
  return Math.round(TEE_OFFER.windowMin + (TEE_OFFER.maxStretchMin - TEE_OFFER.windowMin) * unit * unit);
}

// Does this customer take that slot? Inside the window, always. Outside it,
// only if it is inside their own stretch.
export function walkInAcceptsOffer(askedMinute, offeredMinute, options = {}) {
  const asked = finite(askedMinute);
  const offered = finite(offeredMinute);
  if (asked == null || offered == null) return { accepts: true, deltaMin: null, withinWindow: true };
  const deltaMin = offered - asked;
  const distance = Math.abs(deltaMin);
  const windowMin = finite(options.windowMin, TEE_OFFER.windowMin);
  if (distance <= windowMin) return { accepts: true, deltaMin, withinWindow: true };
  const stretch = Math.max(windowMin, finite(options.flexibilityMin, TEE_OFFER.windowMin));
  return { accepts: distance <= stretch, deltaMin, withinWindow: false, stretchMin: stretch };
}
