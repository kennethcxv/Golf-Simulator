# Economy and progression final report

## Branch and scope

- Branch: `overnight/economy-progression`
- Clean base: `main` at `0c5137e5f0efac9627ce2309b9e66936f1eeb769`
- Product commits:
  - `42ab47e` - exact-once business/progression model and invariant tests
  - `36f4b26` - explainable laptop/property decisions and final balance safeguards
- Main was not merged or modified.
- Existing checkout, laptop, booking, cleaning, maintenance, and save architectures were consumed through their gameplay interfaces rather than replaced.

## Player outcome

The first property now supports one coherent loop: acquire the failing course, improve its real clubhouse/course state, operate the existing shop/tee-time/membership systems, see outcome-grounded reputation and profit, install tangible upgrades, understand current value, request a safe appraisal, keep improving or explicitly sell, then return to a tier-gated property market.

No spreadsheet-only source can create cash or value. The laptop is a read/control surface over simulation state.

## Implemented systems

### Authoritative money and business close

- Ledger version 2 stores an immutable stable ID, timestamp, category, description, signed amount/cash impact, related gameplay ID, property ID, day, source, accounting class, and idempotency key.
- Checkout, reservations, walk-ins, dues, reciprocal guests, events, no-shows, cancellations, rentals, supplier orders/delivery, COGS, cleaning, maintenance, staff, utilities/property costs, equipment, restoration, and shortages post through the ledger.
- Existing aggregate lines remain a compatibility view; all new summaries read entries and outcomes.
- Daily close reconciles opening cash + ledger cash impact = closing cash, then stores gross revenue, COGS, operating expenses, net profit, customers, tee utilization, average transaction, missed sales, no-show impact, cleaning/course condition, reputation movement, value movement, and causal sentences.
- Weekly output is a seven-day aggregation of the same closed books.

### Reputation and pricing

- Reputation is split into cleanliness, retail, course, and service, plus a weighted overall score.
- Reviews and daily changes persist category deltas and reasons derived from real cleanliness, stock/price outcomes, course quality, congestion/waiting, checkout, tee-time, and reliability signals.
- Product markup, green fee, implemented membership dues, and existing rental/guest price controls expose fair value, margin/revenue index, demand/sales likelihood, satisfaction, and a clear response band.
- Extreme prices reduce realization/demand. Maximum price and minimum price are both non-dominant in deterministic tests and simulation.

### Upgrades, condition, and value

- Nine progression upgrades retain cost, prestige requirement, visible result, gameplay effect, property-value effect, and save state: two mower tiers, aerator, spray rig, smart irrigation, premium supplier, reciprocal network, corporate desk, and tournament operations.
- Existing physical washer, vacuum, furniture/decor, lighting, shelves, rental equipment, and maintenance assets continue to contribute from actual ownership/placement/state rather than a second upgrade abstraction.
- The Property screen calculates 13 requested condition categories from live shop renovation, cleaning/washing, furnishing, shelves/stock, safety/utility, turf zones, bunkers, irrigation, equipment, landscaping, access, litter/signage, and repair state.
- Condition/value cannot be farmed by moving furniture or changing stock quantity. Paid physical decor/equipment is capital investment; cancelling the order reverses that investment.
- Valuation has stable contribution IDs and explains acquisition/base land, condition categories, holes/design, equipment, upgrades, membership, reputation, booking demand, trailing profit, unresolved problems, arrears, restoration investment, market rounding, and estimated net proceeds. Contributions reconcile exactly to the displayed value.

### Property decision and progression

- Four ordered data definitions exist: small neglected public, established local, resort-style, and premium private. Each defines purchase range, starting condition, hole count, demand, maintenance complexity, clubhouse scale, upgrade capacity, reputation expectation, operating-cost multiplier, potential value, and unlock requirements.
- Only the framework and next-property market flow were built; this work does not pretend that four separate environments exist.
- A fresh acquisition cannot be sold. Eligibility requires closed operating history, minimum real condition, and manageable arrears.
- Appraisals are persisted, supersede stale offers, expire, and show appraised value, market modifier, offer, closing costs, outstanding costs, and net proceeds.
- `Keep operating`, `Continue improving`, `Reject offer`, and `Accept offer` are explicit choices. Accepting first opens a second permanent-sale confirmation; ownership and cash remain unchanged until that confirmation.
- Confirmation writes a full recovery snapshot before removal, records an exact-once sale ID, pays displayed net once, updates completed-sale progression, and opens the next market.
- Refinance is deliberately unavailable because no safe loan system exists. The UI says so rather than inventing debt.
- Players can keep operating indefinitely; the final tier becomes a sandbox goal.

## Exploit and save safety

The focused invariant suite verifies duplicate checkout/booking/no-show/sale rewards, ledger collision, negative or fractional ordering, restoration/value farming, stock duplication impact, upgrade re-credit, stale appraisals, immediate flip profit, sale replay, and post-load property resurrection.

Ledger/reputation/prices/upgrades/condition inputs/acquisition/appraisals/progression/replay IDs are migrated and serialized through the existing save architecture. Save/load boundaries are exercised around checkout, tee-time check-in, upgrade purchase, appraisal, sale confirmation, and the post-sale property transition.

## Balance result

The final balance run executes 8 strategies x 5 matched seeds x 24 days. Mean 24-day results:

| Scenario | Net profit | Cash change | Condition | Value change | Sale-ready |
| --- | ---: | ---: | ---: | ---: | :---: |
| Poor operation | $1,078.24 | $988.24 | 13.58 | -$9,700 | No |
| Average operation | $21,537.52 | $21,666.63 | 28.06 | +$21,400 | No |
| Skilled operation | $45,976.67 | $46,296.82 | 80.74 | +$67,300 | Yes |
| High-price strategy | $9,669.99 | $9,602.43 | 36.38 | -$1,100 | Yes |
| Low-price strategy | $9,287.27 | $9,875.86 | 28.16 | +$6,300 | No |
| Understocked store | $19,980.49 | $19,881.62 | 26.04 | +$18,900 | No |
| Neglected course | $12,031.69 | $12,243.24 | 54.10 | +$10,100 | Yes |
| Fully restored | $46,039.12 | $46,359.27 | 82.94 | +$67,300 | Yes |

Skilled play beats average play, understocking and course neglect both hurt, neither pricing extreme dominates, poor tutorial play avoids forced bankruptcy, and average play does not create instant wealth. The average first-upgrade time is 5.62 days (skilled: 2.66 days), and no scenario bypasses the next-tier gate immediately.

## QA result

- Automated: **535/535 tests passed** in 18.39 seconds.
- Structured: all 12 requested evidence exports regenerated; 59-entry/8-day fixture reconciles and anti-exploit is true.
- Visual: baseline plus four fix/review loops retained; final route reaches 17/17 laptop pages from the fixed player camera through normal controls.
- Browser runtime: 0 console errors and 0 page errors in final general and sale runs.
- Sale route: keep preserves ownership; Accept alone does not sell; explicit Confirm sells; cash equals displayed net; backup exists; next market appears.
- Listener route: 93 active registrations before and after 24 repeated page switches.
- Performance: see `performance-comparison.md` for the accepted identical-protocol gate and raw reports.

Late `net::ERR_ABORTED` GLB requests occur only while the isolated browser context is closing. The exact URLs are retained in each report; retained screenshots show the scene assets present, and no console/page error accompanies them.

## Evidence index

See `artifact-manifest.md` for the required data exports, screenshots, videos, reports, and exact reproduction tools. See `test-summary.md` for test coverage and commands.
