# Player experience polish — acceptance report

## Outcome

The player-experience polish scope passes its release gate on `overnight/player-experience-polish`: entry flow, settings, first-time guidance, pause and controls, save safety, notifications, audio lifecycle, tool selection, responsive presentation, and the existing operational loops were exercised in the running game.

Production checkout is **not** accepted by this report. Its two pre-existing blockers remain visible and unchanged: the cash route stops in the open drawer with `$14.00` due and `$9.00` selected, and the passing card harness clicks the terminal instead of performing the required physical card swipe. No checkout state or accounting logic was rewritten by this player-experience pass.

## Release gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Unit and simulation suite | Pass — 520/520 | `npm test` |
| Four visual QA loops | Pass — 61 captures, 57 recorded findings | `iterations/iteration-1` through `iteration-4` |
| Final walkthrough | Pass — 15 captures and recorded WebM | `iterations/final-acceptance` |
| Browser runtime | Pass — zero unexpected console errors and zero page errors | Visual, stress, operations, and performance result files |
| Interaction stress | Pass — 100 pause cycles, 100 mode transitions, listener delta 0 | `stress/result.json` |
| Save safety | Pass — normal save, forced write failure, backup recovery, newer-version guard | `stress/result.json` and stress screenshots |
| Audio lifecycle | Pass — one created tool loop, suspended/cleared while hidden, clean restore | `stress/result.json` |
| Operational regression | Pass — delivery, clutter, vacuum, placement, front desk, maintenance | `final/operations/result.json` |
| Performance regression | Pass — matched A/B; render workload flat and UI churn lower | `performance/final/comparison.md` |
| Card checkout | Partial — sale completes, but route is click-driven | `final/checkout/card/result.json` |
| Cash checkout | Blocked — change selection stops at `$9.00 / $14.00` | `final/checkout/cash/result.json` |

## Visual QA

| Loop | Profile | Captures | Result |
| --- | --- | ---: | --- |
| 1 | 1440×900 standard | 15 | Found and fixed new-game `null`, focus escape, lost Tab ownership, paused-speed loss, label/HUD collisions |
| 2 | 1440×900 comparison | 15 | Verified focus/mode fixes; improved market hierarchy, loading guidance, and unavailable-tool keyboard inspection |
| 3 | 1100×680 compact | 16 | Verified compact pause/settings, radial legibility, market keyboard scrolling, and overview controls |
| 4 | 2560×1440, reduced motion, high contrast, 125% UI, toggle tools | 15 | Verified persistence, boundaries, scaling, ultrawide composition, and reduced-motion feedback |

Every loop completed the visible menu → settings → new game → market → loading → walk → pause → controls → tool wheel → overview route. Each loop records at least ten ranked observations in its `visual-audit.md`. The final acceptance route repeated the standard profile with zero console/page errors and produced `player-experience-acceptance.webm`.

## Stress and state safety

- First-time Continue is disabled; returning-player Continue becomes available after a valid autosave.
- Master volume `0.60`, sensitivity `1.35`, invert Y, FOV `74`, camera bob off, and UI scale `1.10` persist from menu to game and into a second page.
- Tutorial disable hides and completes guidance; reset restores the opening card and contextual state.
- Slot 1 saves normally. A forced Slot 2 quota failure keeps the prior slot intact and leaves an actionable persistent notice. A corrupted Slot 1 primary recovers from backup. A version `999` Slot 3 is refused as newer/unsupported.
- P pauses and restores walk, tool wheel, placement, laptop, register, overview, and course editor. Walk speed `2` restores exactly; already-paused modes remain at `0`.
- 100 pause cycles leave zero pause nodes and restore speed. 100 Tab transitions return to walk with no stale modal.
- Notification display is capped at three, 70 identical events dedupe to `×70`, and final cleanup leaves zero notification nodes.
- A held washer creates one loop. Simulated page hiding suspends WebAudio and clears the loop; visibility restores a running context without restarting the orphaned loop.

The forced save failure intentionally emits one expected `save slot2 failed` console entry. The stress harness excludes only that injected failure; unexpected console errors remain zero.

## Operational regression

- Delivery: physical pad → cutter → tape → flaps → armful → shelf path passes.
- Cleaning: one clutter pile removed; vacuum grime reduced by `1.402`.
- Placement: fixture moved to a legal destination and the improved placement flow exits automatically.
- Front desk: Morgan Lee advances from `booked` to `played` through E at the register.
- Maintenance: Space pauses world evaporation through the normal control, hose use raises the aimed cell’s moisture by `36.504`.
- Runtime: zero console errors and zero page errors.

## Matched performance comparison

The machine was concurrently running several other repository worktrees, so the acceptance comparison uses a back-to-back baseline-commit/final-commit pair under the same current load. The original quiet baseline remains preserved separately.

| Metric | Paired baseline | Final | Change |
| --- | ---: | ---: | ---: |
| Average FPS | 96.42 | 116.45 | +20.77% |
| 1% low FPS | 31.88 | 80.21 | +151.64% |
| Worst frame | 94.40 ms | 16.70 ms | −82.31% |
| UI mutations/frame | 2.112 | 0.092 | −95.66% |
| Draw calls/frame | 3,769 | 3,781 | +0.32% |
| Rendered triangles/frame | 5,283,328 | 5,279,896 | −0.06% |
| Materials | 229 | 229 | flat |
| Visible / resident textures | 163 / 208 | 163 / 208 | flat |
| Estimated texture bytes | 6,169,904,488 | 6,169,904,488 | flat |
| Final JS heap | 81,094,046 | 91,701,912 | +13.08%, within guardrail |
| Listener delta during sample | 0 | 0 | flat |

The performance browser log contains no console/page errors and no unexpected request failures. Recorded GLB `ERR_ABORTED` entries are optional loader requests that intentionally fall back; required game geometry remained visible.

## Checkout blockers carried forward

1. **Cash drawer:** two items scan and `$80` tender enters the open drawer, but the physical denomination route selects only `$9` of the required `$14` change. The stage remains `cash-drawer`; no receipt prints, no bagging occurs, and no revenue banks.
2. **Card gesture coverage:** the card route completes all accounting, receipt, bagging, and handoff stages, but `tools/qa/register-sale.js` clicks the terminal twice. It does not drag the customer card through the physical swipe slot, so it cannot satisfy checkout-production acceptance.

These are production-priority checkout defects, not regressions introduced by the player-experience changes.

## Evidence index

- `baseline/`: original before screenshots and audits.
- `iterations/iteration-1..4/`: four visual loops, result JSON, screenshots, and ranked audits.
- `iterations/final-acceptance/`: final screenshots, telemetry, and video.
- `stress/`: save, return-player, lifecycle, modal, notification, and listener stress evidence.
- `final/operations/`: normal-control operational screenshots and result JSON.
- `final/checkout/`: cash/card screenshots and machine-readable results.
- `performance/baseline/`: original quiet baseline.
- `performance/paired-baseline/` and `performance/final/`: matched A/B reports and comparison.
- `logs/`: browser console, page error, warning, and request-failure records.
