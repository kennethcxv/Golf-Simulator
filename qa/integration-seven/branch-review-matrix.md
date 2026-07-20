# Seven completed branches — independent review matrix

All seven branches fork directly from original main `0c5137e5f0efac9627ce2309b9e66936f1eeb769`. No branch changes `package.json` or `package-lock.json`; the repository defines no format, type-check, or production-build script. Accordingly, every branch was checked with the supported equivalents: `git diff --check`, parser checks over all JavaScript modules, the complete `node --test` suite, focused tests, browser launch through the repository server, normal-control gameplay QA, console/request inspection, save/load where relevant, and `npm pack --dry-run`. A clean install and Electron/package smoke are final integrated gates because dependency metadata is identical across all branches.

| Branch | Diff check | Parser | Full tests | Focused tests | Browser/gameplay rerun | Save/load | Hardware/performance | Package dry run | Classification |
|---|---:|---:|---:|---:|---|---|---|---|---|
| `overnight/furniture-customization` | pass | pass | 534/534 | 18/18 | 26/26 placement route; card 15/15; cash 16/16 | pass | pass; matched A/B | pass | merge substantially as product commits; repair/integrate checkout card gesture centrally |
| `overnight/inventory-delivery-loop` | pass | pass | 533/533 | 42/42 | delivery, unbox, carry, stock, recycle pass | pass, every stage | pass; 1,000-unit reconciliation | pass | cherry-pick two product commits; repair stale reorder QA assertion |
| `overnight/customer-simulation` | fail: one blank EOF line in checked-in baseline markdown | pass | 534/534 | 18/18 | arrival/reservation/abandon/queue/checkout pass | queue and half-scan pass | branch SwiftShader numbers rejected; hardware deferred to integration | pass | cherry-pick product and reusable QA commits; repair whitespace and canonical adapters |
| `overnight/course-maintenance` | pass | pass | 527/527 | 11/11 | 12/12 maintenance route after harness-only wait repair | full turf/work-order pass | pass; 60 mount cycles | pass | cherry-pick two product commits; do not import brittle personal-path QA evidence |
| `overnight/golf-operations` | pass | pass | 538/538 | 30/30 | full operating day pass; full laptop route times out only under forced software rendering | schedule pass | pass; stable listener/mutation counts | pass | cherry-pick selected product/performance fixes; repair normal-exit focus and receipt contrast |
| `overnight/economy-progression` | pass | pass | 535/535 | 19/19 | 17 laptop pages and guarded sale route pass | ledger/sale recovery pass | pass; 120 FPS hardware sample | pass | cherry-pick product and reproducible QA commits |
| `overnight/player-experience-polish` | pass | pass | 520/520 | 4/4 preferences | standard and accessibility 15-screen routes; 100 pause and 100 mode cycles pass | preferences/version/failure recovery pass | pass; 116.37 mean FPS, listener delta 0 | pass | cherry-pick product and acceptance-tool commits last; reject stale media/report commits |

## Branch decisions

### Furniture customization

Selected product history: `df46a6f6b16fab10f1f1a3af9e6c79340b338ac6`, `84aba50f54b5165380c4eb9569371a15b1c64eae`, `7d74a280a1f9f1c0aa732fb97a3e7badf37459d5`, `91e13dce70e8c9e9d02bfc2c406b99660ad4df05`, and `b271903ce5d99478f026b0000b344dc957fe1255`.

The branch has coherent product-only history and the strongest placement architecture. The authored GLBs are repository-produced assets with provenance recorded in `ASSET_SOURCES.md`; fresh player-camera inspection showed correct floor/wall/counter/shelf previews and final transforms. Its retail checkout harness demonstrates accounting but does not physically swipe the card, so it is not checkout acceptance evidence.

### Inventory and delivery

Selected product history: `3022dcefd0b6dfd78b67f47589b8b053921b9455` and `5b0f39b326112d789e482978e46a50ffc23c95a0`.

Rejected from product integration: baseline/evidence commits `92f9f9e`, `385aa09`, and `12600d4`. They add generated QA media rather than runtime behavior. The branch conservation model is the canonical inventory quantity model. The reorder route's cash-total assertion is incorrect in a running simulation because unrelated daily expenses can post; integration QA will assert the order ledger event and shipment value exactly instead.

### Customer simulation

Selected history: `4c9b426f11ff5b365ab4b19ed6ee5ff4248a097d`, `173f4aa0754349e1eeba167fd2cd974c0fb91c3c`, `86303b4dc0889e042006ec6962acefecc63d090d`, and reusable acceptance tools from `5741dde059d8f2dc9dfcaafb4c1044159053f048`.

Rejected generated evidence: `7434e7d` and `3cfbca4`. Customer AI will consume canonical inventory reservations and golf-operation schedule/check-in events; its own reservation model must not become a second booking ledger. The blank baseline-markdown line is excluded with the baseline commit.

### Course maintenance

Selected product history: `d402f1767af8105c02fc9bbc2264de3f3e60d968` and `9b664ded5212997e9178c5f10131fe9b3d57ee56`.

Rejected generated/brittle evidence: `36b05de` and `2a0ab21`. Fresh reruns proved the product route and Blender assets, but the checked-in QA uses a personal Playwright path and fixed load delay. Integration will use portable Playwright resolution and real veil/world readiness. The treatment-route floating rectangle remains a visual repair item.

### Golf operations

Selected product history: `76d48a5de427ac1bbed260bcf4b2d22beaba74a9`, `2ababf534b5d48b96c44e4af44531dc31646b917`, `d47d720b3082cabec7c4638c7c1b4d4d9715f15e`, `c8ef8550b23bdc092536fbcf1885564fcbdfc075`, `553f821f19ae3b322903c5bfac471ed94e44a194`, and `a08be3444290203bfa007be23edfcc065b115047`.

QA-only scrolling/timing/audit commits and final media are not selected. The schedule and booking lifecycle are canonical for golf operations; physical customer movement consumes their events. Integration must restore controller focus on normal tee-desk exit and improve receipt contrast.

### Economy and progression

Selected product history: `42ab47eba0ca47bf536240e33c39d3bb5f9d6b5d` and `36f4b266e8c8ab5a5f80bd9246c57e83ac2b993f`; selected reusable QA: `20a20c8a4ff9ec4bc52165ae40ed27bbab50665f` and the controlled benchmark adjustment `7488c53c991c7109eea389277290cbb78ecada39`.

Rejected generated evidence: `16b7570`. `economy.js` becomes the authoritative immutable exact-once journal; `business.js` derives explainable summaries and progression projections without creating a competing ledger. Checkout, orders, bookings, cancellations/no-shows, upgrades, and property sale must enter through stable event IDs.

### Player experience polish

Selected product history: `376bbb5ee5ca7021c65aa6e2316cfcde87bdf8ea` and `4fe0b9998ba73394d33975cffc64ad0a5893fa5e`; selected reusable acceptance tools: `3d15f12dd2db9f55edf566711326b52f1378a1bb`.

Rejected generated evidence: `c540a96` and `bf072a1`. This branch supplies the canonical notification queue, tutorial path, prompt priority, settings persistence, audio lifecycle, menus, and mode transition presentation. Fresh evidence supersedes a stale checked-in claim that notification cleanup always leaves zero nodes; one deliberate contextual/persistent message can validly remain.

## Unsupported checks

- Formatting script: not defined.
- Type-check script: not defined; the project is JavaScript.
- Production build script: not defined; final integration uses parser checks, `npm pack --dry-run`, repository server/preview smoke, and Electron launch.
- Failed-network interpretation: all reruns had only optional GLB requests aborted during deterministic scene changes; no required route or resource produced a blocking failure.

## Explicit exclusion

`overnight/gameplay-progression` at `3ddb082f90cdb78325e633ec722fd04a3bf98fdf` remains active, dirty, and intentionally excluded. Its uncommitted contents were not inspected, and no commit or working-tree state from it is used by this review.
