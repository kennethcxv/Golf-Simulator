# Full integration test results

Validated code head: `04cf42a1e72e9c9d0c0829486de8041eca1dcbca`.

## Automated and packaging gates

| Gate | Result |
|---|---|
| Full `npm test` after final browser fixes | Pass: 2,161 tests; 2,158 pass; 0 fail; 3 skip; 358,707.906 ms |
| Focused laptop/tool-wheel interaction contracts | Pass: 2/2 |
| Production JS/CJS/MJS syntax sweep | Pass: 234 files |
| Clean `npm ci` | Pass: 73 packages added, 74 audited, 0 vulnerabilities |
| `npm ls --all` | Pass; only the expected Windows-inapplicable optional `fsevents` entry |
| `npm pack --dry-run` | Command passes; release-size gate fails at 1.9 GB compressed, 2.0 GB unpacked, 4,048 files |
| Electron storage/security contracts | Pass: 13/13 |
| Electron native smoke | Pass: `file:` launch, title/menu/native bridge/security/display; 0 console, page, or process errors |

The package has no separate `typecheck`, `lint`, or compiled `build` scripts. The repository runs direct ES modules plus Electron; syntax coverage, the full Node suite, dry-run packaging, browser execution, and native Electron smoke are the available compile/build substitutes.

## Checkout acceptance

| Route | Result | Evidence |
|---|---|---|
| Card | Pass: 3 physical scans, `$37.95`, exact amount entry, empty/incorrect rejection, deterministic decline then replacement approval, automatic receipt/bag, one ledger ticket, inventory/reputation/review/departure exactly once, diagnostics 0 | `qa/full-integration/checkout-final-4/card-result.json` and 14,689,479-byte audio/video capture |
| Cash | Pass: 3 physical scans, `$37.95`, tender/drawer/deposit, under/over rejection, coin undo, exact change, visible Done, automatic receipt/bag, one ledger ticket, departure exactly once, diagnostics 0 | `qa/full-integration/checkout-final-4/cash-result.json` and 12,273,168-byte audio/video capture |

## Gameplay routes

| Route | Result |
|---|---|
| Main menu / New Game | Pass: `route-menu-new-game.json` |
| A — cleaning/restoration | Functional 62/64; gameplay works, but its resource-budget and post-GC heap/listener assertions fail |
| A — furniture/placement | All functional and persistence assertions pass; aggregate result is false only for reload-teardown WebGL warnings and one expected aborted GLB |
| B — inventory/delivery | Pass: `route-b-inventory-final-result.json` |
| C — card checkout | Pass; see checkout table |
| D — cash checkout | Pass; see checkout table |
| D — course editor/visual route | Pass with headed video, clean diagnostics, and passing route-local performance checks |
| E — golf operations stress | Pass: 12 parties, 3 check-in batches, all physical; 12 rounds/reviews exactly once; carts released; ball cap 24; diagnostics 0 |
| F — property operations | Pass: portfolio, manager, inspection, auction escrow, climate, travel, market, navigation, diagnostics, and route-local performance |
| F — property vehicles | Pass: storage, lights, cargo/tool lifecycle, persistence, diagnostics, and three route-local performance samples |
| F — cross-mode player soak | Pass: all six player modes, 100 pause cycles, 100 mode transitions, notification cleanup, listener delta 0, washer lifecycle cleanup, save recovery, returning-player Continue, diagnostics 0 |

Authoritative Route F evidence is under `qa/full-integration/route-f-player-experience-final/`. The final returning-player frame was visually inspected from the player-facing menu.

## Save and soak gates

- Six-worktree compatibility matrix: pass, state schema 16, empire schema 3, two repeated reloads, opaque unknown data preserved.
- Logical soak: pass across 100 placements, boxes, customers, check-ins, maintenance steps, and saves; post-GC heap increase 2,702,536 bytes; active-resource deltas zero.
- Golf stress: post-run heap growth 8,947,282 bytes; 12/12 physical parties and exact-once outcomes.

## Performance comparison

The latest authoritative fixed-camera comparison fails overall:

| Metric | Baseline | Final | Change | Gate |
|---|---:|---:|---:|---|
| Average FPS | 116.29 | 94.67 | -18.59% | Fail |
| 1% low FPS | 58.49 | 41.83 | -28.50% | Fail |
| Worst frame | 33.4 ms | 27.9 ms | -16.47% | Pass |
| Final JS heap | 106,561,379 B | 376,139,850 B | +252.98% | Fail |
| UI mutations/frame | 0.0911 | 0.0033 | -96.34% | Pass |
| Draw calls/frame | 4,238 | 2,244 | -47.05% | Pass |
| Triangles/frame | 5,560,606 | 7,498,015 | +34.84% | Fail |
| Materials | 252 | 763 | +202.78% | Fail |
| Visible textures | 149 | 194 | +30.20% | Fail |
| Resident textures | 213 | 75 | -64.79% | Pass |
| Estimated texture memory | 4,830,479,725 B | 610,332,701 B | -87.36% | Pass |
| Active listener delta | 0 | -3 | decrease | Pass |

Evidence: `qa/player-experience-polish/performance/full-integration-final-3/comparison.json`. The run-to-run FPS variance observed in earlier samples does not erase the consistent heap/triangle/material/visible-texture regressions.
