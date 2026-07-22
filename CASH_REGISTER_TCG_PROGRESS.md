# TCG-Style Checkout — Progress & Continuation

Branch: `tcg-checkout` (off `main`). Spec: `docs/superpowers/specs/2026-07-15-tcg-checkout-design.md`.
Plan: `docs/superpowers/plans/2026-07-15-tcg-checkout.md`. All work below is committed; `node --test` = **640 pass / 0 fail**.

## What the rework delivers (the user's ask)

- **Click-to-bag**: click each product on the counter → it arcs into the shopping bag and rings up on the POS. No scanner, no barcode, no drag.
- **Card**: auto-presents + **auto-inserts** (no gesture) → type the total on the keypad → **always approves**.
- **Cash**: drawer **auto-opens** and **auto-deposits** the tender → click drawer denominations until *Giving* matches *Change* → confirm.
- **Auto-finalize**: receipt + bagging + banking happen automatically; the customer leaves. No "Finalize" click.
- Greens-fee **Check-In** flow already exists and runs the same simplified card/cash payment.

## Verified in-game (Playwright, live canvas, real events)

A full **card** transaction was driven end-to-end: 3 items click-bagged (POS updated per item) → payment auto-started → card auto-inserted → total keyed → approved → auto-finalized. Banking was exactly-once: revenue **+$47.95**, units **+3**, transaction history **+1**. The bag is visible at counter-left in the widened cashier frame.
(Note: headless Chrome throttles rAF to ~2 fps, so the auto-timers advance slowly under Playwright — this is a harness artifact, not a game issue.)

## Commits on this branch (newest first)

- `checkout(D/B5)` bag in-frame + wider over-counter framing (FOV 46/48→56/58, centred pose)
- `checkout(C1)` POS checkout screen → Product | Price | Unit | Total + prominent Total
- `checkout(visual)` remove scanner + red laser beam (renderer + fixtures)
- `checkout(A4)` cash drawer auto-opens/deposits; sale auto-finalizes
- `checkout(A3)` click-to-bag replaces drag-across-scanner
- `checkout(A2)` card auto-inserts and always approves
- `checkout` consolidate simplified-register baseline + `runCard` force-approve (A1)
- `checkout` remove dead swipe renderer + cardSwipe (A0)
- spec + plan commits

## Key facts for whoever continues

- **Live renderer:** `src/render3d/clubhouse/simplifiedRegisterMode.js` (the wrapper `clubhouse().register` exposes `enter/leave/getTx/isActive/workspace/monitorScreenPoint/...` but NOT `update`).
- **POS canvas UI:** `src/render3d/clubhouse/frontDeskMonitorUi.js` (pure, tabs home/check-in/checkout). Card keypad = `drawTerm`, cash panel = `drawCashPanel` (both in the renderer).
- **Money authority (do not weaken):** `src/sim/register.js`; held inventory `src/sim/checkout.js`; greens fee `src/sim/reservationCheckIn.js`. Exactly-once banking in `completeSale`.
- **Assets:** headless Blender 5.1.2. Build one: `"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup --python tools/blender/build_checkout_assets.py -- <id>` (ids: `checkout_counter|checkout_cash_drawer|checkout_card_reader|checkout_receipt_printer|checkout_shopping_bag`). Validate: `validate_checkout_assets.py -- <id>`. Preview: `render_checkout_assets.py -- <outdir>`.
- **In-game materials are slot-remapped by `merch.js`** (SLOT/TINTABLE) — the Blender material *name* (e.g. `M_Charcoal`) decides the in-game colour, not the `.py` RGB. Change slots, not colours, and keep slot names or update `merch.js` too.
- **Counter reassessment:** from the cashier's first-person view you see the counter *top* (already dark) + the customer; the ornate customer-facing front faces away and is barely visible. So a full counter rebuild is lower-impact than it looks — a top→`charcoal` slot swap is the cheap win.
- **In-game QA loop:** `node tools/serve.cjs` (PORT 8457) → Playwright → menu "Continue" → `clubhouse().sendToCounter(['balls1','glove1','tees1'],'card')` → wait for `register.hasTx()` → `register.enter()`. Click via synthetic pointer/mouse events on the `<canvas>`; project item world-pos → screen to click products; type card digits via `KeyboardEvent` on **window only** (dispatching on window+document double-registers).

## Remaining work (by impact)

1. **B1 — POS monitor asset.** `fixtures.js:917` still uses raw `kiosk.glb`. Add `build_pos_monitor()` to `build_checkout_assets.py` (tilted charcoal screen on a base, brass Pinehollow mark, screen face for the canvas), register in `merch.js FILES`, swap `RAW_PROP` for it in `fixtures.js`, re-measure the `attachScreen` plane. (Kiosk reads acceptable today, so medium priority.)
2. **B3 — cash drawer.** Confirm `build_drawer` has 5 bill ($1–$50) + 5 coin (1¢–50¢) labelled wells with visible notes/coins to match the reference; align under the POS.
3. **B4 — card terminal** and **B5 — bag mesh**: restyle `build_card_reader` (clean charcoal handheld) and `build_bag` (clean kraft, tidy handles — current handles read as a thin arch).
4. **B2 — counter:** optional; at minimum swap `CounterTop` to the `charcoal` slot in `build_counter` for a matte-black top. Preserve footprint (3.10), `ANCHOR_*`, `COL_*`.
5. **C2/C3 — cash + card panels:** already match the reference (orange Received/Total/Change/Giving; Payment keypad). Fine-tune type/proportions only.
6. **C4 — check-in tab:** style the greens-fee line like the checkout list.
7. **D — camera fine-tune:** the wide pose is in; tighten if the shop background reads too open.
8. **G — QA driver:** `tools/qa/simplified-register-acceptance.mjs` still drives the OLD drag-scan + click-insert + manual-finalize flow — rewrite it for click-to-bag / auto-insert / auto-finalize, then capture the card + cash + check-in acceptance passes and screenshot-compare to `Designs/CashRegister/Final/`.

## Not done / honest gaps

- Hero Blender assets (POS monitor, drawer, card terminal, bag, counter) are **not yet rebuilt** — they still use the pre-existing meshes. The look is substantially closer (bag in frame, wider framing, no scanner, TCG POS columns) but not pixel-matched to the reference.
- The **customer** is the shared stylised barrel-torso character (game-wide, out of checkout scope).
- The QA acceptance driver for the simplified flow needs updating before a full recorded card/cash/check-in evidence pass.
