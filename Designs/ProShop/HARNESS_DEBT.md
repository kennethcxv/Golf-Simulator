# QA HARNESS MECHANICAL DEBT — counts before and after

Session of 2026-08-03 (B11). Three named categories, each counted before the
work and after it, with every remaining file listed and given a reason.

---

## 1. Drivers booting through the removed menu

**Before: 36 live drivers. After: 4, all deliberate.**

`tools/qa/lib/qa-boot.mjs` exists precisely because `run-playwright.cjs` launches
an **ephemeral** context: on a clean run "Continue" renders DISABLED, so a raw
`getByText('Continue').click()` either hangs on the load veil or falls through a
`.catch` and hangs on the driver's first in-game wait instead. `clickThroughMenu`
resumes when Continue is genuinely clickable and starts a fresh Relaxed game when
it is not, which is strictly more robust than the raw click in **every** one of
these files — including the save/reload drivers, which click Continue again after
a reload and get the correct branch either way.

Ported by two codemods, both kept in `tools/qa/lib/` so the next sweep is not
hand work:

| pass | tool | files | how |
|---|---|---:|---|
| 1 | `port-menu-boot.mjs` | 23 | six recognised statement shapes, regex-anchored on the whole statement group so a partial match cannot leave a dangling handle |
| 2 | `port-menu-boot-blocks.mjs` | 6 | the `if (enabled) click else new-game` blocks, matched by **brace walking** rather than regex |
| 3 | by hand | 3 | `laptop-tour.js` (its else-branch also BUYS the first course — now `if (bootMode === 'new-game')`), `golf-operations-laptop-booking-probe.js`, `simplified-register-recovery-accessibility.mjs` |

Every ported file was `node --check`ed; `doors-integration-probe.js` was run
end-to-end on a clean profile — the case that was broken — and completed.

### The 4 that keep it, and why

These do not *boot* through the menu; Continue's presence is what they assert.

| file | reason |
|---|---|
| `boot-exception-source.js` | COUNTS the Continue button as a boot diagnostic. It never clicks it. |
| `pine-hills-legacy-save-migration-acceptance.js` | asserts a migrated legacy save exposes a working Continue — that IS the acceptance |
| `pine-hills-restoration-lights-acceptance.js` | `requireCheck('bootstrap autosave exposes Continue', …)` — a named control in the acceptance list |
| `pine-hills-starter-stock-cooler-acceptance.js` | `clickVisibleContinue()` is a named acceptance step with its own visibility precondition |

---

## 2. The renderer gate on performance drivers

**Before: 5 gated. After: 11.**

HARNESS_TRUST rule 5: headless runs get SwiftShader, a CPU rasterizer, and
absolute frame numbers from it are not evidence about the live game.
`tools/qa/perf-renderer-gate.mjs` has existed; most perf drivers recorded a
renderer string at best and left every reader to remember to check it.

Two classes, treated differently — this distinction is the point:

* **GATE (refuse software)** — the driver reports absolute numbers:
  `course-perf.js`, `cleaning-performance-baseline.js`,
  `mountain-clubhouse-performance.js`, `premium-clubhouse-performance.js`,
  `steam-release-checkout-performance.js`, `scenario-performance-master.js`.
* **SOFTWARE-RELATIVE (declared)** — the driver pins its own swiftshader flags
  and compares two runs of *itself*; relative numbers survive a CPU rasterizer,
  so it passes `{ allowSoftware: true }` and the result carries the label:
  `simplified-register-performance.mjs`, `player-experience-performance.mjs`.

### Not gated, with reasons

| file | reason |
|---|---|
| `assets-51-100-sheet06-performance.js` | runs a **hash-pinned frozen fixture**; the driver asserts the fixture's own bytes. Adding a gate to it would break the contract it exists to hold. Gate belongs in the fixture's next revision, not bolted on. |
| `simplified-register-performance-overlay.js` | never samples frames — it READS numbers produced elsewhere and DRAWS an overlay image. Nothing to gate. |
| `sheet06-performance-comparison.mjs` | zero `page.` calls; it compares three completed runs' outputs. Nothing to gate. |

---

## 3. Stale cutter-era drivers

**Before: 15 files matching. After: 15 — and nothing to do.**

Every one of the 15 matches is a **provenance comment** recording that the file
was already ported off the box cutter on 2026-07-30, e.g.

```
// (Ported off the box-cutter equip 2026-07-30 — cartons take one E per flap)
```

There is no live cutter usage in any driver outside `tools/qa/archive/` (14
files, deliberately frozen). This category was closed by the earlier port; the
count in the brief was counting the comments that record it.

---

## Found on the way, not fixed

* **`course-perf.js` is broken independently of the gate.** It waits for
  `getByText('New Empire — Realistic')`, a menu label that no longer exists, and
  fails there before reaching anything else. Its gate is in place for when that
  is fixed. Same class as the stale labels the menu-boot port removed elsewhere —
  worth a sweep of its own for `New Empire` across the harness.
* **`laptop-tour.js` fails on "marketplace: no affordable Buy button"** both
  before and after this session's changes (verified by stashing). An economy
  fixture problem, not a harness-boot one.
