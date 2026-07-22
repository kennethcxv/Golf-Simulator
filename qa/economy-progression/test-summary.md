# Economy and progression test summary

## Final automated run

- Command: `npm test`
- Date: 2026-07-19 (America/Los_Angeles)
- Result: **535 passed, 0 failed, 0 skipped, 0 cancelled**
- Duration reported by Node's test runner: **18,391.09 ms**
- Working commit: `36f4b26` on `overnight/economy-progression`

## New invariant coverage

The focused economy and property suites cover:

- complete immutable ledger schema, stable IDs, collision rejection, and idempotent replay;
- checkout revenue and cost-of-goods replay after save/load;
- tee-time check-in replay after save/load, including a deliberately stale booking status;
- repeated no-show housekeeping and save/load replay;
- invalid supplier quantities (zero, negative, fractional, and non-numeric);
- daily cash/profit reconciliation and causal summary text;
- invalid pricing plus high-price and low-price non-dominance;
- extreme membership dues without a captive-member windfall;
- reasoned category-specific reputation movement;
- all 13 live property-condition categories with stable source IDs;
- furniture movement and stock-quantity valuation farming;
- upgrade persistence and exact-once charging;
- capital restoration investment and cancellation reversal;
- exact valuation reconciliation;
- ordered, data-driven four-tier property progression;
- refusal of immediate profitable flipping;
- persisted appraisal without implicit destruction;
- stale appraisal supersession;
- explicit sale confirmation, recovery backup, exact-once proceeds, and no property resurrection after load.

## Deterministic simulation runs

- Command: `node tools/qa/economy-balance.mjs`
- Coverage: 8 named operating strategies x 5 matched seeds x 24 closed days = **40 real accelerated runs / 960 simulated property-days**.
- Result: every declared balance finding passed. Raw runs are in `simulated-scenarios.json`; assumptions and aggregate findings are in `balance-report.md`.

## Structured evidence export

- Command: `node tools/qa/economy-evidence.mjs`
- Result: 12 required evidence files regenerated from the current code.
- Fixture: 59 authoritative ledger entries, 8 closed days, exact sale net of $76,235, and every anti-exploit assertion true.

## Browser validation

- General route: `node tools/qa/economy-browser-qa.mjs --url=http://127.0.0.1:8461/ --phase=final-accepted --out=qa/economy-progression/final-accepted`
- Sale route: `node tools/qa/economy-sale-browser-qa.mjs --url=http://127.0.0.1:8461/ --out=qa/economy-progression/sale-browser`
- Result: 17/17 laptop pages, 0 console errors, 0 page errors; sale keep/accept/confirm/payout/backup/next-market checks all true.
