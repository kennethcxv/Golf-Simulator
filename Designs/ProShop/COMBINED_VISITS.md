# C6 — buy AND book in one visit

**Status: NOT DONE. Analysed, costed, not built.** Declared rather than shipped
shallow, per the standing rule.

Two separate things make this bigger than it looks, and they compound: the
combined visit does not exist *by construction*, and the acceptance measurement
the brief asks for is a ten-hour instrument.

---

## 1. The combined share is exactly zero, and it is one line

`src/render3d/clubhouse.js`, in `spawnCustomer`:

```js
const walkInRequest = !toCounter
  && options.allowWalkInRequest === true
  && identity.visitProfile.preferredPurpose === 'tee-time'
  && ['friendly', 'exacting'].includes(identity.personality);
…
if (!toCounter && !walkInRequest) {
  const floorFixtures = placedFixtures(state);
  const browsable = floorFixtures.filter((f) => f.skus && f.skus.length > 0);
  …
  organicPlan = planOrganicOrder(browsable, state.shop.inventory, rng);
  …                       // ← every browse stop is built inside this branch
}
```

`toCounter` is "arrived against a pre-registered tee time". `walkInRequest` is
"here to ask for one". **A customer who is doing either never receives a
shopping plan, never receives a browse stop, and therefore can never buy
anything.** The split is not low; it is structurally 0%, and no tuning changes
it.

The three arrival intents the amendment asks about map onto the spawn like this:

| the brief's intent | how it arrives today | can they also buy? |
|---|---|---|
| buys AND asks for an available tee time | `walkInRequest` | **no** — gated out above |
| buys AND checks in against a pre-registration | `toCounter` (`reservationId != null`) | **no** — gated out above |
| does only one of the two | everything else, or either of the above | yes (retail only) |

`releaseReservationCustomer()` (clubhouse.js) confirms the other end: whatever
the desk outcome, a tee-time customer is sent straight to `exit`.

```js
c.checkoutPhase = 'reservation-leaving';
c.currentDestination = 'exit';
const exitIdx = c.stops.findIndex((stop) => stop.kind === 'exit');
if (exitIdx >= 0) c.stopIdx = exitIdx;
```

There is no branch in which a checked-in golfer turns round and looks at the
glove wall.

## 2. The measurement is 10.5 wall-hours per leg

From `tools/qa/proshop-greybox-customer-day.js`'s own header:

> Per SIM-TIME-001, NPC verification runs at 1× ONLY; a full 9:00–19:30 day at
> 1× is **10.5 wall-hours per leg**, so the practical instrument is the peak
> window.

The brief asks for the split "across a 1x day", before AND after. That is 21
wall-hours of measurement on top of the feature. The 60-minute peak window is
the honest substitute and would still be two wall-hours; it samples one hour of
one shape of day, and the combined share is exactly the kind of number that
moves with the hour sampled.

## 3. What building it actually takes

Not a probability tweak. The browse-stop construction is ~60 lines inline in
`spawnCustomer` and would have to be extracted so it can also be called from
the desk-resolution site; then:

1. **Extract** `buildBrowseStops(customer, state, rng)` out of `spawnCustomer`,
   preserving the fixture-local browse pose and the stand-occupancy claim
   (NAV-WAIT-001's spaced wait points depend on both).
2. **Plan at spawn for tee-time arrivals too**, on a roll, and keep the plan on
   the customer instead of turning it into stops immediately.
3. **Branch at the desk**: `releaseReservationCustomer()` and the walk-in
   booking path both currently head for `exit`. Either would need to hand a
   customer with a pending plan to `checkoutPhase = 'shopping'` and splice the
   browse stops in before the exit stop.
4. **Then they queue a second time**, at the same counter, for a retail
   transaction — so the desk has to cope with the same person arriving twice
   with two different reasons, and `counterQueue` / `openWalkInCustomer` /
   `deskReservationList` all key off `checkoutPhase` prefixes
   (`String(c.checkoutPhase || '').startsWith('reservation')`). A customer
   mid-shop after a check-in is in none of those states and must not reappear
   on the desk's reservation list.
5. **Reviews and visit history**: `recordCustomerVisit` takes a single
   `purpose` and a single `outcome`. A combined visit is two of each, and
   `history.completedPurchases` / `completedCheckIns` are incremented from one
   call site each.

Point 4 is the one that makes this a session rather than a patch: the phase
machine currently encodes "why this person is here" as a single value, and a
combined visit is two reasons in sequence.

## 4. What I would do first

Split the state that is currently overloaded before adding the flow:

- `customer.errand` — an ordered list (`['tee-time', 'retail']`), replacing the
  implicit single purpose carried by `checkoutPhase`'s prefix.
- `checkoutPhase` then means only "where in the CURRENT errand are they", which
  is what its transitions already model well.

With that in place, step 3 is a splice and step 4 falls out: the desk lists key
off `errand[0] === 'tee-time'` rather than a string prefix, and a shopper who
has already checked in simply is not in that list.

Then the acceptance run is one peak window at 1×, reporting the three intents
the amendment names, and the number is honest about being one hour of one day.
