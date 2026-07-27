# TCG-Style Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, batched with checkpoints). Steps use checkbox (`- [ ]`) syntax for tracking. Much of Phases B–D are visual iteration verified by in-game screenshots, not unit tests — those steps say so explicitly.

**Goal:** Rework the pro-shop checkout into the TCG Card Shop Simulator loop in Pinehollow identity — click-to-bag, card auto-insert + always-approve + type-total, cash auto-open drawer + click-denomination change — with rebuilt hero assets and restyled diegetic UI, preserving the tested money/inventory core.

**Architecture:** Keep `sim/register.js` (money/stages) + `sim/checkout.js` (held-inventory) + `reservationCheckIn.js` (greens fee) as the authority; add one capability (`runCard` force-approve). Do the interaction rework in the LIVE renderer `simplifiedRegisterMode.js` and the canvas UIs (`frontDeskMonitorUi.js` + card/cash panels). Rebuild hero GLBs via headless Blender (`build_checkout_assets.py`, plus a new POS-monitor builder). Delete the dead `registerMode.js` + `cardSwipe.js`.

**Tech Stack:** Vanilla ES modules + Three.js (WebGL); Node `node --test`; headless Blender 5.1.2 Python; Playwright QA harness under `tools/qa/`.

## Global Constraints

- Benchmark TCG for clarity/composition/interaction only; **copy no** TCG assets/UI/fonts/branding — original Pinehollow implementation (AGENTS.md).
- Palette: warm cream, deep golf green, muted sage, medium walnut, natural oak, warm charcoal, restrained brass. Stylized PBR; no photorealism.
- Money is integer cents in `register.js`. Revenue/inventory move **only** in `completeSale`, exactly once. Cash stays transaction-local until commit.
- Blender: 1 unit = 1 m, Z-up authored → glTF Y-up, `-Y` = player-facing front. Apply transforms; correct pivots; `COL_*` collision proxies (alpha-0 material); clean UVs; verify **in-game**, not just the Blender viewport.
- Blender exe: `C:/Program Files/Blender Foundation/Blender 5.1/blender.exe`. Build one asset: `... --background --factory-startup --python tools/blender/build_checkout_assets.py -- <id>`; validate with `validate_checkout_assets.py`; preview with `render_checkout_assets.py`.
- Blender gotchas: sRGB-encode procedural textures (`lin2srgb`); `inset_region` is a no-op (boolean difference instead); assign material before `modifier_apply` + force `material_index=0`; slice-assign `img.pixels[:]`; cylinders need `uv=True`.
- Material names are runtime slots remapped in `merch.js` (`SLOT`/`TINTABLE`) — keep slot names or update the maps together.
- Run `node --test` after every logic task; keep it green. Commit each task.

---

## Phase A — Interaction logic (sim + live renderer)

### Task A0: Remove dead swipe/scan renderer

**Files:**
- Delete: `src/render3d/clubhouse/registerMode.js`, `src/sim/cardSwipe.js`
- Check: every `tests/*.js`, `src/**` for imports of those two modules

- [ ] **Step 1:** `grep -rn "registerMode\|cardSwipe\|judgeSwipe" src tests tools` — confirm only the dead files + dead-only tests reference them. If `tests/register-scanzone.test.js` imports `segmentHitsBox`, confirm it comes from `register.js` (keep) not `registerMode.js`.
- [ ] **Step 2:** Delete the two files. Delete/trim any test that only covers the dead swipe path (`register-scanzone.test.js` only if its imports die with the files).
- [ ] **Step 3:** `node --test` → expect all green (no import errors).
- [ ] **Step 4:** Commit: `chore(checkout): remove dead swipe renderer + cardSwipe`.

### Task A1: Card always approves in gameplay (keep decline tests valid)

**Files:**
- Modify: `src/sim/register.js` (`runCard`, ~line 317)
- Test: `tests/register-payment.test.js` (existing decline test must stay green), add `tests/register-card-always.test.js`

**Interfaces:**
- Produces: `runCard(tx, { timeout=false, force=null })` — `force:'approved'` forces approve, `force:'declined'` forces decline, otherwise rng-driven (unchanged default).

- [ ] **Step 1 (test):** In `tests/register-card-always.test.js`, drive a card tx to `card-busy`, then `runCard(tx, { force: 'approved' })`, assert `result==='approved'` and `tx.stage==='receipt'` even with an rng that would otherwise decline (`tx.rng = () => 0`).
- [ ] **Step 2:** Run it → FAIL (`force` ignored).
- [ ] **Step 3 (impl):** Add near the top of `runCard`, after the `timeout` block:
```js
  if (force === 'approved') { tx.cardResult = 'approved'; tx.stage = 'receipt'; return { ok: true, result: 'approved' }; }
  if (force === 'declined') { tx.cardResult = 'declined'; tx.stage = 'card-declined'; return { ok: true, result: 'declined' }; }
```
  and change the signature to `runCard(tx, { timeout = false, force = null } = {})`.
- [ ] **Step 4:** Run `tests/register-card-always.test.js` + `tests/register-payment.test.js` → PASS (decline test still rng-driven, still passes).
- [ ] **Step 5:** Commit: `feat(register): runCard force option for guaranteed-approve gameplay`.

### Task A2: Live renderer — auto-insert + force-approve card

**Files:**
- Modify: `src/render3d/clubhouse/simplifiedRegisterMode.js` (card workspace: `startInsert`/`feedInsert`/`endInsert` ~1938-1976; the `runCard` call after `CARD_TIME`)
- Test: `tests/card-insert.test.js` (update: assert live renderer auto-inserts + never declines; keep the "no swipe" source assertion)

- [ ] **Step 1:** Replace the click-drag insert (`startInsert`/`feedInsert`/`endInsert`) with an automatic slide: on entering `card` workspace with a presented card, ease the card mesh from `ANCHOR_CardReady` to `ANCHOR_CardInserted` over ~0.5s, then call `insertCard(tx)` (→ `card-entry`) with no pointer input required. Keep the keypad type-the-total as the only card action.
- [ ] **Step 2:** Change the post-`CARD_TIME` `runCard(tx)` call to `runCard(tx, { force: 'approved' })`.
- [ ] **Step 3:** Update `tests/card-insert.test.js`: keep source-text assertion that the renderer contains no `judgeSwipe|SWIPE_*|startSwipe`; add/adjust to assert it drives `insertCard` automatically and `runCard(..., { force: 'approved' })`. (Source-text level, matching the existing test style.)
- [ ] **Step 4:** `node --test` → green.
- [ ] **Step 5:** In-game verify (Phase H harness or manual serve): card path auto-inserts, type total, approves. Screenshot.
- [ ] **Step 6:** Commit: `feat(checkout): card auto-inserts and always approves`.

### Task A3: Live renderer — click-to-bag (rings + bags in one action)

**Files:**
- Modify: `src/render3d/clubhouse/simplifiedRegisterMode.js` (scan workspace → bagging: `selectProduct`/`beginScanDrag`/`moveScanDrag`/`completeProductScan` ~1764-1829; the post-payment finish path)
- Modify: `src/render3d/clubhouse/frontDeskMonitorUi.js` if the checkout tab needs the ring-up to reflect immediately (it reads the tx model, so likely no change)
- Test: extend `tests/register-scan.test.js` / add a renderer contract test as feasible

- [ ] **Step 1:** Replace drag-across-scanner with **single click**: clicking a product on the counter calls `scanItem(tx, uid)` and starts a short arc animation of that product's mesh into the bag. POS checkout list updates from the tx model automatically (subtotal counts scanned).
- [ ] **Step 2:** Remove the scanner-crossing threshold logic + scanner beam usage from the live path (no scanner in the new flow).
- [ ] **Step 3:** After payment completes (tx reaches `receipt`), auto-sequence with brief timing (no player clicks): `printReceipt` → `takeReceipt` → for each item `bagItem` → `packReceipt` → `handOverGoods` → then the existing `finalizeTransaction()` (which calls `completeSale`). Items are already visually in the bag; this just formalizes bagged flags + banks once.
- [ ] **Step 4:** Verify `finalizeTransaction` still gates on `canComplete` and banks exactly once (unchanged authority). `node --test` green (checkout.test.js exactly-once must stay green).
- [ ] **Step 5:** In-game verify: click 3 products → each flies to bag + appears on POS → pay → bag hands over → banks once. Screenshot.
- [ ] **Step 6:** Commit: `feat(checkout): click-to-bag replaces drag-scan; auto-finish after payment`.

### Task A4: Live renderer — cash auto-open + auto-deposit

**Files:**
- Modify: `src/render3d/clubhouse/simplifiedRegisterMode.js` (cash workspace: after `acceptCash`, currently manual `openDrawer`/deposit)
- Test: `tests/register-payment.test.js` stays green (deposit-before-close invariant preserved)

- [ ] **Step 1:** On taking the tender (single click), call `acceptCash(tx)` → then automatically `openDrawer(tx)` + `depositTendered(tx, drawer)` and play the drawer-open animation. The only remaining cash action is clicking change denominations (`takeFromDrawer` builds `tx.hand`) and Done (`handOverChange`).
- [ ] **Step 2:** Ensure "Giving" (from `handTotal`) turns green exactly at `changeDue`; Done is enabled only when `handTotal === changeDue` (Relaxed already refuses miscounts).
- [ ] **Step 3:** `node --test` → green.
- [ ] **Step 4:** In-game verify: cash path — take cash, drawer auto-opens, panel shows Received/Total/Change, click denominations to green, Done, change handed, drawer closes, banks once. Screenshot.
- [ ] **Step 5:** Commit: `feat(checkout): cash drawer auto-opens and auto-deposits tender`.

---

## Phase B — Hero assets (Blender; one at a time; in-game verified)

For each: edit the builder → `build_checkout_assets.py -- <id>` → `validate_checkout_assets.py -- <id>` → `render_checkout_assets.py` preview → view PNG → iterate → integrate → `npm run serve` + screenshot in the actual cashier camera → compare to `Final/` frames → commit.

### Task B1: POS monitor (new asset)

**Files:**
- Modify: `tools/blender/build_checkout_assets.py` (add `build_pos_monitor()` + register id `checkout_pos_monitor`)
- Modify: `src/render3d/clubhouse/merch.js` (`FILES` list — add `checkout_pos_monitor`), `src/render3d/clubhouse/fixtures.js` (`buildCheckout` — replace `RAW_PROP kiosk` with the new asset), `tools/blender/measure_screens.py` if screen plane pose needs re-measuring
- Export: `vendor/models/clubhouse/checkout_pos_monitor.glb`

- [ ] **Step 1:** Author a tilted POS: charcoal bezel + screen glass (named `ANCHOR_Screen` / screen face for the canvas plane), stand/base, brass Pinehollow tee mark; real dims (~0.34 m screen). Screen normal faces the cashier (`-Y` front). `COL_*` proxy + applied transforms + bevels.
- [ ] **Step 2:** Build + validate + preview-render; view PNG; iterate until clean.
- [ ] **Step 3:** Add to `merch.js FILES`; in `fixtures.js` swap the raw `kiosk` placement for `merch.instantiate('checkout_pos_monitor')` at `REGISTER` monitor pose; re-measure/adjust the `attachScreen` plane so the canvas lands on the glass.
- [ ] **Step 4:** `npm run serve`, screenshot the cashier view; the "Checkout" canvas must be crisp and legible. Compare to `Final/` POS. Iterate.
- [ ] **Step 5:** Commit: `feat(assets): new POS monitor replaces raw kiosk`.

### Task B2: Counter rebuild

**Files:**
- Modify: `tools/blender/build_checkout_assets.py` (`build_counter`, ~862-903)
- Verify: `src/render3d/clubhouse/fixtures.js:889` scale (`COUNTER.len/3.10`) still holds; `tests/checkout-space.test.js` reachability

- [ ] **Step 1:** Rebuild as a straight retail counter: matte charcoal-black top, cream body with a **lit lower shelf** (emissive cream strip), thin walnut trim + brass toe rail. Keep root footprint (~3.10 m), all `ANCHOR_*`, and `COL_*`.
- [ ] **Step 2:** Build/validate/preview; view; iterate to the clean look.
- [ ] **Step 3:** In-game screenshot cashier view; confirm black top + white lit shelf reads like `Final/`. `node --test` (checkout-space) green.
- [ ] **Step 4:** Commit: `feat(assets): clean black-top counter with lit lower shelf`.

### Task B3: Cash drawer rebuild

**Files:**
- Modify: `tools/blender/build_checkout_assets.py` (`build_drawer`, ~461-657)
- Verify: `simplifiedRegisterMode.js` drawer `SLOT` positions + `DrawerSlide` animation still align

- [ ] **Step 1:** Rebuild: 5 bill wells labeled $1/$5/$10/$20/$50 + 5 coin wells labeled 1¢/5¢/10¢/25¢/50¢, stacked original Pinehollow notes/coins. Keep `DrawerSlide` pivot + `DrawerSlide_OpenHoldClose` action. Align to sit under the monitor as one register unit.
- [ ] **Step 2:** Build/validate/preview (`_open` + `_labels_closeup`); view; iterate.
- [ ] **Step 3:** Update `SLOT` well positions in `simplifiedRegisterMode.js` to match the rebuilt geometry (10 wells). In-game: cash mode, drawer open, denominations clickable + readable. Compare to `Final/` drawer. `node --test` green.
- [ ] **Step 4:** Commit: `feat(assets): denominated cash drawer (5 bill + 5 coin wells)`.

### Task B4: Card terminal rebuild

**Files:**
- Modify: `tools/blender/build_checkout_assets.py` (`build_card_reader`, ~693-734)

- [ ] **Step 1:** Clean charcoal handheld terminal (keypad screen face for `drawTerm` canvas; card-insert slot at base with `ANCHOR_CardReady`/`ANCHOR_CardInserted`) + a small static pinpad dressing for the lit shelf.
- [ ] **Step 2:** Build/validate/preview; view; iterate.
- [ ] **Step 3:** In-game: card mode shows the keypad panel on the terminal; card visibly inserted at base. Compare to `Final/` card frames. Commit: `feat(assets): clean handheld card terminal`.

### Task B5: Shopping bag rebuild

**Files:**
- Modify: `tools/blender/build_checkout_assets.py` (`build_bag`, ~799-859)

- [ ] **Step 1:** Clean kraft bag, open top, folded sides, handle; subtle logo stamp; `ANCHOR_BagHandleFront/Back` retained (runtime reads them).
- [ ] **Step 2:** Build/validate/preview; view; iterate.
- [ ] **Step 3:** In-game: bag at counter-left; products animate in; compare to `Final/`. Commit: `feat(assets): clean kraft shopping bag`.

---

## Phase C — Diegetic UI restyle (canvas)

### Task C1: Checkout screen

**Files:**
- Modify: `src/render3d/clubhouse/frontDeskMonitorUi.js` (checkout app draw path)
- Test: `tests/front-desk-monitor-ui.test.js` (stays green: fixed 1024×640, hotspots rebuilt per draw, renderer stays pure)

- [ ] **Step 1:** Restyle the checkout tab to the reference: cream "Checkout" header bar; columns **Product | Price | Unit | Total**; item rows; large **Total $X.XX** block bottom-right on a dark accent panel; light body. Golf identity via header mark + type.
- [ ] **Step 2:** Keep `draw(model)` pure (no state mutation) and hotspot rebuild each draw. `node --test` (front-desk-monitor-ui) green.
- [ ] **Step 3:** In-game screenshot; compare columns/total to `Final/`. Commit: `feat(ui): checkout screen matches reference layout`.

### Task C2: Cash panel

**Files:**
- Modify: `src/render3d/clubhouse/simplifiedRegisterMode.js` (`drawCashPanel`)

- [ ] **Step 1:** Orange panel: **Received / Total** (with rule) / **Change** / **Giving** (green when `handTotal === changeDue`, red/neutral otherwise). Match reference proportions + type.
- [ ] **Step 2:** In-game screenshot cash mode; compare to `Final/` cash frames. Commit: `feat(ui): orange Received/Total/Change/Giving cash panel`.

### Task C3: Card terminal keypad panel

**Files:**
- Modify: `src/render3d/clubhouse/simplifiedRegisterMode.js` (`drawTerm`, `CARD_KEY_LABELS`, `cardKeyAtCanvas`)

- [ ] **Step 1:** Restyle to reference: "Payment" header; blue **Total $X.XX**; 4×3 keypad (1–9, X, 0, .) + green **OK**. Hit-test rects stay aligned to the drawn grid.
- [ ] **Step 2:** In-game screenshot card mode; type total, OK; compare to `Final/`. Commit: `feat(ui): card terminal payment keypad matches reference`.

### Task C4: Check-in tab styling

**Files:**
- Modify: `src/render3d/clubhouse/frontDeskMonitorUi.js` (check-in app), `simplifiedRegisterMode.js` (`monitorModel` check-in branch)

- [ ] **Step 1:** Style the golfer list + selected greens-fee line in the same checkout visual language (Greens Fee line, balance due, Total). Keep hotspots + purity.
- [ ] **Step 2:** In-game screenshot check-in; compare. Commit: `feat(ui): styled greens-fee check-in screen`.

---

## Phase D — Camera composition

### Task D1: Retune cashier poses to reference framing

**Files:**
- Modify: `src/render3d/clubhouse/simplifiedRegisterMode.js` (`POSES`, FOVs ~36-49), `cashierPresentation.js` if needed
- Test: `tests/front-desk-live-contract.test.js`, `checkout-space.test.js` stay green

- [ ] **Step 1:** Set the main over-counter pose to the reference framing: customer torso across, products + bag at counter-left, POS lower-right, ~60° FOV. Gentle focus leans for card (terminal) and cash (drawer wells). The old "scan" lean → the bagging view.
- [ ] **Step 2:** In-game screenshots of each mode; compare framing to all six `Final/` frames; iterate. `node --test` green.
- [ ] **Step 3:** Commit: `feat(checkout): cashier camera matches reference composition`.

---

## Phase E — Greens-fee check-in polish

### Task E1: Greens-fee runs the simplified card/cash interaction

**Files:**
- Modify: `src/render3d/clubhouse/simplifiedRegisterMode.js` (reservation payment path shares the same auto-insert/force-approve card + auto-open/auto-deposit cash), `reservationCheckIn.js` untouched (banking authority)
- Test: `tests/reservation-check-in-payment.test.js` stays green (greens fee banks once, no merchandise analytics)

- [ ] **Step 1:** Ensure a selected due reservation drives the same simplified card + cash flows (no bagging step — it's a service; skip the bag/goods portion). Auto-finish after payment calls `finalizeReservationCheckIn`.
- [ ] **Step 2:** `node --test` green. In-game: check in a golfer by card and by cash; both bank to greens fees, no inventory touched. Screenshots.
- [ ] **Step 3:** Commit: `feat(checkout): greens-fee check-in uses the simplified payment flow`.

---

## Phase F — Audio

### Task F1: Re-route cues to the merged flow

**Files:**
- Modify: `src/core/audio.js` / the checkout SFX routing in `simplifiedRegisterMode.js`
- Test: `tests/checkout-audio-routing.test.js` (update expected cue set to the new flow; keep one-shot edges)

- [ ] **Step 1:** Cues: item click → bag rustle; POS ring-up ding; card insert click; keypad beep; approve chime; drawer open; per-piece coin/bill click on give-change; drawer close; bag handoff. Remove scanner-beep cue.
- [ ] **Step 2:** Update `checkout-audio-routing.test.js` to the new cue set. `node --test` green.
- [ ] **Step 3:** Commit: `feat(checkout): audio cues follow the simplified flow`.

---

## Phase G — QA passes + regression

### Task G1: Card + cash + check-in acceptance, screenshot compare, fixes

**Files:**
- Use: `tools/qa/register-acceptance-driver.mjs` / `tools/qa/run-playwright.cjs` (existing harness)
- Output: `qa/cash-register-production/tcg-final/{card,cash,checkin}/`

- [ ] **Step 1:** Drive a full card sale, a full cash sale, and a greens-fee check-in through normal controls; capture staged screenshots + video.
- [ ] **Step 2:** Open every screenshot; compare against `Designs/CashRegister/Final/`; list ≥10 ranked player-visible defects; fix the top ones; re-run.
- [ ] **Step 3:** Confirm exactly-once revenue + inventory, greens-fee isolation, queue advance, drawer atomicity, pointer-lock restore, save/load safe, zero console errors.
- [ ] **Step 4:** `node --test` full suite green; `git diff --check` clean.
- [ ] **Step 5:** Commit: `test(checkout): TCG-style acceptance evidence (card/cash/check-in)`.

---

## Self-review notes

- Spec §4 (behavior) → Phase A. Spec §5 (assets) → Phase B. Spec §6 (UI) → Phase C. Spec §7 (camera) → Phase D. Spec §4.2 (greens fee) → Phase E. Spec §9 (audio) → Phase F. Spec §8 (tests) threaded through every task + Phase G. Spec §3 dead-code removal → Task A0.
- Money-safety invariants (spec §8 "preserve") never edited: `completeSale`, exactly-once, transaction-local drawer, greens-fee isolation, makeChange, monitor-UI purity all stay green.
- No `runCard` global `DECLINE_CHANCE=0` (would break the decline test); realized instead as a `force` option used only by the live renderer — better than the spec's first phrasing, same player outcome.
