# tools/qa/archive — retired harnesses

Moved here 2026-07-28 during the HARNESS_TRUST.md remediation. Nothing in this
directory runs, is referenced by a live harness, or counts as QA evidence; the
`tests/qa-harness-integrity.test.js` sweep excludes it and fails any live file
that tries to load from it. Files keep their git history (`git log --follow`).

Every entry is here for one of two reasons: it **cannot run as committed**
(parse error, removed API), or it drives a **superseded register UX** (the
physical card swipe, replaced by the automatic insert). The live successor for
each claim is named — if a claim below matters, run the successor, not the
archive.

| File | Why archived | Live successor for the claim |
|---|---|---|
| `register-sale.js` | SyntaxError (`const money` declared twice), undefined `BASE_URL`, calls removed `register.getHandFeedback()` — the file never parses | `register-acceptance-driver.mjs` (+ card/cash wrappers), `proshop-greybox-checkout.js` |
| `customer-simulation-checkout.mjs` | Standalone gate that `eval`s `register-sale.js` — inherits the SyntaxError; the committed integration gates run checkout through the acceptance wrappers instead | `run-integration-gates.mjs` gates `checkout-card` / `checkout-cash` |
| `pro-shop-checkout.mjs` | Imports `register-sale.js` + swipe-era choreography at module top level — dies at import | `register-acceptance-driver.mjs`, `proshop-greybox-checkout.js` |
| `player-experience-checkout-baseline.mjs` | Loads `register-sale.js` as its choreography source | `simplified-register-performance.mjs` (checkout feel/perf), `register-acceptance-driver.mjs` (choreography) |
| `register-swipe.js` | Drives `register.swipeAt()` — the physical swipe was removed for the automatic insert (`insertAt`) | `register-acceptance-card.js` |
| `register-swipe-before.js` | Baseline capture of the superseded swipe UX | none needed — historical capture |
| `register-performance.js` | Swipe-era matched checkout performance capture | `simplified-register-performance.mjs` |
| `register-recovery-driver.mjs` | Recovery choreography via `register.swipeAt()` | `simplified-register-recovery-accessibility.mjs`, `simplified-register-save-reload.mjs` |
| `register-recovery.js` | Wrapper of the archived recovery driver | as above |
| `pine-hills-joined-tee-card-acceptance.mjs` | Joined tee-time + card acceptance on the swipe register | `simplified-reservation-card-acceptance.mjs` |
| `pine-hills-joined-tee-card.js` | Wrapper of the archived tee-card acceptance | as above |
| `register-recover-legacy.js` (was `register-recover.js`) | Revival attempted 2026-07-28 through SIX drift layers (undefined BASE_URL, retired "New Empire" menu route, removed PROPERTY MARKET screen, stale (−8,+228) world offset, pre-move desk stand, and finally a drag-to-scan choreography the one-click register no longer has). Its claim — save during an incomplete transaction survives reload with the books intact — is held against the live contract by the successor | `simplified-register-save-reload.js` (+ `tests/simplified-register-save-reload-matrix.test.js`, both in the integration `save-reload` gate) |

The `qa/` evidence folders these files produced in their era remain valid as
history of that era's build, but are **unreproducible** with today's code — do
not cite them for today's claims.
