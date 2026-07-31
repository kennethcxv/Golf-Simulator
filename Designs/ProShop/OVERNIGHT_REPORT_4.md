# OVERNIGHT REPORT 4 — 2026-07-31

Branch `feature/pro-shop-vertical-slice`, tip `7723583`, pushed. Full suite
**2655 pass / 0 fail** before every commit. Ranked by what to read first.
Durations are rough wall-clock shares of the night.

---

## 1. THE CHECKOUT, ROUND 7 — every item from your last message  (~5 h)

Commits `7ae35a0` + `f5dbc03`. Renders under
`qa/cash-register-production/simplified-rebuild/checkout-round7/`.

| Ask | State | Look at |
|---|---|---|
| Screen bigger + more left, viewable the whole time | POS at 1.55× scale, pulled to desk-local x 0.30 — every pixel of glass inside the frame in every workspace | `01-working-frame.png`, `05-drawer-open.png` |
| Items drop mid-counter, slide left only | Staging strip re-authored onto the laid bag's own line; the slide target keeps counter height — one lateral run into the mouth | `01` (staged row), `02-rung-up.png` |
| Remove the desk lamp | Gone from the counter — it serves the office desk's authored lamp socket now (whose coords sat *outside the walls*; repaired) | `01` left end, clean |
| Dollar colors back to how they were | All five notes print on one dollar-green stock; the ochre/blue/violet toy money is gone | `05-drawer-open.png` |
| Can't see $1/$5 numerals from the angle | Bill tags now STAND at each divider, tilted to the cash camera — $1 $5 $10 $20 $50 read instantly; coin tags untouched | `05-drawer-open.png` |
| Completely remove the receipt | No paper, no printer, no feed, no delivery beat, nothing in the departure bag. The sim still files print/take/pack silently so banking and reloads keep their contracts | `01` — the black printer box from round 5 is gone |
| Money goes on the desk | The customer LAYS the cash flat on the counter (measured +0.003 above the top); each piece its own click target, one pad still takes the lot | `03-cash-on-desk.png` |
| Highlight = outline, not a blob | Inverted-hull silhouette shells; the emissive fill and additive halo sprite are deleted (probe: 2 shells, 0 visible sprites while hovering) | `04-cash-outline.png` |
| Reader centred at your face, no desk collision | Floats at NDC x **0.011** (dead centre), clamped **0.133 above** the counter — the round-6 eye had left the old constants burying it | `06-reader-centred-entry.png` |
| Card looks better inserted | The card wears the real bank-card face (chip, member number) and hangs further out of the slot | `07-card-inserted-closeup.png` |
| Reader UI polished | Rounded lit glass: branded status strip, gradient caption/amount bands, entry caret, pill hints, themed green Approved / red Declined | `06`, `08-approved.png` |
| A space in the desk for the reader (your screenshot) | **The device bay**: dark-framed tray with a blazing white back panel on the desk's front edge; the reader parks *standing in it* at pocket scale (it grows to working size as it rises), a white pin pad beside it | `10-bay-closeup.png`, `05-drawer-open.png` |
| Don't get kicked out after a transaction | Probed live: `register.isActive()` true for **8/8 seconds** after the sale banked; the screen leads with "Ready for the next customer" | `09-post-sale-stays.png`, `metrics.json → stayInView` |

**Honest gaps.** (a) From the low cashier eye the bay foreshortens — its tray
reads at the frame's bottom edge rather than as the reference's full band;
the reference camera is higher than the eye you asked for, and the eye won.
Lean down or open the drawer view and it's all there. (b) The tendered $40 is
two overlapping notes — a small pile; readable but subtle at working distance.
(c) The desk is still a wide tan expanse against the reference's dark top —
that's the desk asset itself, unchanged this round.

## 2. MECHANICAL DEBT — the harness boot sweep  (~1.5 h)

Commit `7723583`.

**Menu-boot debt — before: 169 files, after: 0.** Every driver that booted by
clicking the menu's "Continue" (117 `getByText` + 52 `getByRole` sites; 70
completely unguarded) was betting on a save that never exists — run-playwright
uses an ephemeral profile, so they hung on the load veil or on their first
in-game wait. All now boot through **`tools/qa/lib/qa-boot.mjs`**: resume when
Continue is actually *enabled* (it renders disabled on clean profiles — that
discovery is the fix), else New game → Relaxed. Verified: `register-boot.js`,
previously a guaranteed hang, runs end-to-end; `node --check` green across all
drivers. The 42 remaining "Continue" references are mid-run resume clicks in
save/reload drivers that create their own save first — legitimate.

**Renderer-gate debt — counted, not executed.** The perf family is **23
files; 4 gated, 19 ungated** (`assets-51-100-sheet06-performance`,
`checkout-terminal-canvas-hotpath`, `cleaning-performance-baseline`,
`course-editor-stroke-perf`, `course-perf`, `doors-performance`,
`matrix-update-hotpath`, `mountain-clubhouse-performance`,
`patience-geometry-churn`, `pine-hills-performance-isolation`,
`premium-clubhouse-performance`, `proshop-perf-noise`,
`scenario-performance-master`, `sheet06-performance-contribution-probe`,
`simplified-register-performance-overlay`, `simplified-register-performance`,
`steam-release-checkout-performance`, `tractor-performance`,
`water-rebuild-churn`). `gateRenderer(page)` must run *after* each file's own
boot-complete point, which differs per harness — blind insertion would gate
before `window.__fw` exists and pass vacuously, so these 19 are named here
for a deliberate pass instead.

## 3. THE STANDING BRIEF ITEMS — already landed in rounds 1–6, evidence intact

- **Broom** — modelled hands, sleeved forearms, no green near-plane mass,
  lower-centre head, held-use sweep arc. Clip:
  `qa/broom-round4/video/*.webm` (re-recorded on the extended rig,
  commit `1a8d698`). What still doesn't match House Flipper: our arms are
  simpler geometry than HF's skinned arms, and the sweep is a kinematic arc,
  not a mocap cycle.
- **Dirt visibility** — hold-Q reveal through geometry with lower-left eye
  chip, Tab overview dirt markers with count, reticle prompt over cleanable
  dirt: `qa/dirt-visibility/01…06`.
- **Doorway lighting** — dark state blends on the VIEWED volume; before/after
  from the fixed half-yard-outside pose:
  `qa/doorway-fill/doorway-before-position-only.png` vs
  `doorway-after-view-blend.png`, plus the walk-in profile JSON showing no
  step on crossing the threshold.
- **Card reader keys** — physical keys handle input; red X / yellow backspace
  / green enter decals (`checkout-round4/06-reader-keys-labelled.png`), still
  true in round 7's `06`.
- **Cash drawer** — 1¢ 5¢ 10¢ **25¢** 50¢ (no 20¢ coin), lit white tray,
  denominations distinct — now via numerals + standing tags rather than tints
  (your round-7 correction), `checkout-round7/05-drawer-open.png`.
- **Laptop** — every input survives re-render (multi-character test in
  `tests/laptop-input-focus.test.js`), rebuilt search rows name-first:
  `qa/laptop-round3/*.png`.

## 4. CONTRACTS ADDED/UPDATED THIS ROUND

`tests/checkout-playtest-round7.test.js` (10 new pins: bay, centred float +
clamp, desk tender, green family, standing tags, no-receipt-anywhere,
stay-at-till). Updated to the new intent rather than deleted:
`checkout-playtest-round5`, `checkout-physicality-round4`,
`checkout-presentation`, `checkout-audio-routing`,
`checkout-payment-presentation`, `customer-paid-bag`,
`register-camera-poses`, `register-durable-fulfillment-contract`,
`register-physical-fulfillment-contract`, `rigid-visual-batch`,
`furniture-customization`, `checkout-display-brand`. One genuine repair the
lamp move surfaced: the office-desk placement sockets were authored at
x 9.71/9.67 — outside the 17.9-yd interior — and nothing had ever validated
them.

## 5. NOT DONE, DELIBERATELY

- The 19 ungated perf drivers (§2) — named, needs per-file placement.
- Phase 5 hero assets — excluded by your brief.
- Raising the desk to true counter height and darkening its top toward the
  reference mat — the remaining root cause of "wide tan expanse"; ripples
  through every fixture/collider/reach, so it needs its own pass.
