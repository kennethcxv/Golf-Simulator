# TCG-Style Checkout — Design Spec

Date: 2026-07-15
Benchmark: TCG Card Shop Simulator (quality/composition/interaction only — no proprietary
assets/UI/fonts/branding copied). Original Pinehollow Golf implementation.
Reference frames: `Designs/CashRegister/Final/*.png` (6 frames).

## 1. Goal

Make the pro-shop checkout look and play like TCG Card Shop Simulator's cashier loop, but in
Golf Flipper's own visual identity: a clean, first-person, over-the-counter transaction where the
player does the **fewest possible physical actions**. Two payment methods (card, cash) plus a
golfer greens-fee (course) payment. It must match the composition, clarity, and simplicity of the
reference frames and be ship-ready.

### Player-visible target (from the reference frames)
- Products sit on a matte black counter; a kraft paper bag sits at counter-left; a tilted POS
  monitor sits at counter-right; the customer's torso is across the counter.
- **Bagging replaces scanning**: click a product → it goes into the bag → the POS "Checkout"
  list gains a Product/Price/Unit/Total row and the Total updates.
- **Card**: card auto-inserts into a handheld terminal (no swipe, no push gesture); a numeric
  keypad shows "Total $0.00"; the player types the amount and presses OK; it always approves.
- **Cash**: POS shows an orange Received / Total / Change / Giving panel; the drawer auto-opens
  with labeled $1–$50 bill wells and 1¢–50¢ coin wells; the player clicks denominations until
  Giving equals Change (turns green); clicks Done; change is handed over.

## 2. Decisions (locked)

1. **Look & feel** — TCG layout/composition/clarity, rendered in Pinehollow identity: palette
   charcoal + cream + walnut + brass + deep-green accents; original branded UI; original
   bill/coin art; golf products. Not a literal pixel copy of TCG art.
2. **Giving change** — player clicks individual denominations; "Giving" counts up and turns green
   at exact change; then Done. (Matches the reference "Giving" field.)
3. **Course payment** — polish the existing reservation Check-In flow (golfer with a booked tee
   time pays their greens fee at the same register, same card/cash interaction). No new walk-up
   flow.

## 3. Current architecture (what exists)

### Live vs dead code — critical
- **LIVE renderer:** `src/render3d/clubhouse/simplifiedRegisterMode.js` (imported by
  `clubhouse.js:59` as `createRegisterMode`; its API reports `simplified: true`). This already
  auto-presents the card, has **no swipe**, types the total on a rendered keypad, and shows a
  cash Received/Total/Change/Giving panel. This is the file we edit.
- **DEAD renderer:** `src/render3d/clubhouse/registerMode.js` (3336 lines) — not imported by any
  module or test. Contains the elaborate barcode-scan + mouse card-swipe experience. **Delete.**
- **DEAD module:** `src/sim/cardSwipe.js` (`judgeSwipe`) — imported only by the dead renderer;
  its test was already removed (`tests/card-swipe.test.js` deleted). **Delete.**

### Transaction / money authority (preserve)
- `src/sim/register.js` — transaction state machine + banking. Money in integer cents. Stages:
  `scanning → payment → card-present → card-ready → card-entry → card-busy → (card-declined |
  receipt) → bagging → done`, or `payment → cash-tender → cash-drawer → receipt → bagging → done`.
  Exactly-once banking in `completeSale` guarded by `canComplete(tx)` + `tx.banked`. Cash handled
  against a transaction-local drawer copy so a mid-sale reload/void mutates nothing persistent.
  `DECLINE_CHANCE = 0.12`, `CARD_TIME = 1.15s`.
- `src/sim/checkout.js` — held-unit inventory ledger (`pickFromShelf`/`consumeHeldBatch`/
  `recoverCheckout`) that makes "in a shopper's hands" a save-safe location. (Its legacy
  `checkoutSale`/`giveChange`/`processCard` cluster is vestigial/unused — leave alone.)
- `src/sim/registerFlow.js` — 30-state camera/UI/audio contract both renderers drive; locked by
  `tests/register-flow.test.js`.
- `src/sim/reservationCheckIn.js` + `src/sim/reservations.js` — greens-fee path: builds a
  virtual-line `tx` (`skuId:'service:green-fee'`, `tx.kind='service'`), runs the same card/cash
  rehearsal, banks to `greenFees` revenue via `completeServicePayment`, never touches inventory.

### Diegetic UI (canvas-on-mesh, preserve the technique)
- `src/render3d/clubhouse/frontDeskMonitorUi.js` — pure Canvas-2D POS renderer (1024×640),
  tabs `home` / `check-in` / `checkout`; `draw(model)` paints, `hit(x,y)` returns an action id.
  Presentation-only (does not mutate the model) — locked by `front-desk-monitor-ui.test.js`.
- `simplifiedRegisterMode.js` owns three more canvases: `drawTerm()` (card keypad), `drawCashPanel()`
  (Received/Total/Change/Giving), `drawScanPanel()` (assisted-scan strip — will be repurposed/removed).
  Each is a `CanvasTexture` on a `PlaneGeometry` oriented onto the prop's screen glass via
  `orientPlane()` (the "atlas UVs lie" workaround).

### 3D assets (Blender headless CLI — no MCP)
- Built by `tools/blender/build_checkout_assets.py` (ids: `checkout_counter`, `checkout_cash_drawer`,
  `checkout_scanner`, `checkout_card_reader`, `checkout_receipt_printer`, `checkout_shopping_bag`).
  Products by `build_checkout_products.py` (18 props, already good).
- **The POS monitor is still a raw Tripo `kiosk.glb`** — never brought into the clean pipeline.
- Loader/instancer: `merch.js` (materials are named slots remapped to shared runtime materials).
  Placement: `fixtures.js::buildCheckout`. Interactive pieces: `simplifiedRegisterMode.js`.
- Build: `"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background
  --factory-startup --python tools/blender/build_checkout_assets.py -- <id>`. Validate with
  `validate_checkout_assets.py`, preview with `render_checkout_assets.py`.
- Palette + gotchas (documented): sRGB-encode procedural textures (`lin2srgb`); `inset_region` is
  a silent no-op → use boolean difference; assign material before `modifier_apply` + force
  `material_index=0`; slice-assign `img.pixels[:]`; `COL_*` proxies use alpha-0 material; cylinders
  need `uv=True`. Coordinates: 1 unit = 1 m, Z-up authored → glTF Y-up, `-Y` = player-facing front.
  Counter: `COUNTER {x:2.9, z:4.2, len:3.2}`, `COUNTER_TOP = 1.055` (`shopLayout.js`).

## 4. Target behavior

### 4.1 Shop checkout (hero loop)
1. Customer places products on the counter; player presses **E** near the desk → camera eases to
   the over-counter view; pointer unlocked; `register-mode` CSS active.
2. **Click a product** → it arcs into the bag → `register.scanItem` rings it (Checkout row + Total).
   Clicking rings **and** stages/bags in one action (scanning and bagging are merged).
3. When all items are rung, payment begins on the customer's preferred method:
   - **Card**: card auto-presents and **auto-inserts** (small non-interactive slide) → keypad
     shows Total $0.00 → player types the total (must equal the real total; wrong entry is a gentle
     retry that consumes no attempt) → OK → `card-busy` (~1.15s) → **always approves**.
   - **Cash**: single click to take the tender → tender auto-deposits into the transaction-local
     drawer → drawer **auto-opens** → orange panel shows Received/Total/Change → player clicks
     denominations → Giving counts up, green at exact → Done → change handed → drawer closes.
4. Receipt is auto-included (no player action). Bag hands over; customer leaves. `completeSale`
   banks revenue + inventory **exactly once**.

### 4.2 Course check-in (greens fee)
Golfer with a due tee-time reservation queues at the desk → player opens the **Check-In** tab →
selects them → `beginReservationPayment` builds the service `tx` for the outstanding balance
(fee − deposit) → same card/cash interaction (no bagging, it's a service) → `finalizeReservationCheckIn`
banks to `greenFees`. Reservation flips to played/paid. No inventory touched.

### 4.3 Flow-contract changes
- Card: insertion is **automatic** (was a manual click-push); auth **always approves**
  (`DECLINE_CHANCE → 0`). Keypad type-the-total stays (the one required card action).
- Bagging happens **during ring-up**, not after payment. Receipt is automatic. The
  `registerFlow.js` state set is updated accordingly (swipe states are already absent).
- Cash: drawer **auto-opens** on tender; received cash **auto-deposits**; the only cash action is
  clicking change denominations + Done.

## 5. Assets to build (Blender, palette-correct, real dimensions)

| Asset | Action | Notes |
|---|---|---|
| POS monitor | **New** (`checkout_pos_monitor`) | Tilted screen on a base; charcoal bezel; brass Pinehollow tee mark; screen = live canvas plane. Replaces raw `kiosk.glb`. Base aligns over the drawer to read as one register unit. |
| Counter | **Rebuild** `checkout_counter` | Straight retail counter: matte charcoal-black top + cream **lit lower shelf**; thin walnut trim + brass toe rail. Keep footprint (len 3.2), `ANCHOR_*`, `COL_*`. |
| Cash drawer | **Rebuild** `checkout_cash_drawer` | 5 bill wells $1/$5/$10/$20/$50 + 5 coin wells 1¢/5¢/10¢/25¢/50¢, labeled, stacked original notes/coins. Keep `DrawerSlide` pivot + open/close animation. |
| Card terminal | **Rebuild** `checkout_card_reader` | Clean charcoal handheld unit (keypad screen = canvas) + small static pinpad dressing on the lit shelf. Card inserts at the base. |
| Shopping bag | **Rebuild/restyle** `checkout_shopping_bag` | Clean kraft bag, open top, subtle logo stamp. Products animate in. |
| Products | Keep | 18 `checkout_product_*` props already good; light polish only if needed. |
| Scanner | Remove from counter | No scanning in the new flow. |
| Receipt printer | De-emphasize | Receipt auto-included; keep as minor dressing or omit from active flow. |

Every asset: applied transforms, clean normals, intentional bevels, correct pivots/origins,
`COL_*` collision proxies, clean UVs, stylized PBR via named material slots, verified **in-game**.

## 6. Diegetic UI restyle (canvas)

- **Checkout screen** (`frontDeskMonitorUi.js` checkout tab): cream "Checkout" header; columns
  Product | Price | Unit | Total; item rows; large Total block bottom-right (dark accent). Light body.
- **Cash panel** (`drawCashPanel`): orange panel — Received / Total (rule) / Change / Giving
  (green when exact, red otherwise).
- **Card terminal** (`drawTerm`): "Payment" header; blue Total; 4×3 numeric keypad (1–9, X, 0, .,
  OK green).
- **Check-In tab**: golfer list → selecting shows the greens-fee line in the checkout style.
- Golf identity via header mark, type, and original bill/coin art; functional colors (orange cash,
  blue accents) kept for legibility per the reference.

## 7. Camera

One main over-counter composition (~60° FOV) matching the reference framing (customer torso across,
products + bag, POS lower-right). Gentle focus leans for **card** (terminal) and **cash** (drawer,
showing the wells). The former "scan" lean becomes the bagging view. Smooth eased entry/exit,
pointer-lock restore on exit, Escape/right-click safe cancel (existing behavior preserved).

## 8. Tests

**Preserve unchanged (money/inventory/safety invariants):**
- `checkout.test.js` — revenue only on `completeSale`; exactly-once; held-unit tracking; save-mid-sale
  returns goods and banks nothing; recovery idempotent; void moves no money.
- `register-integrity.test.js` — cash transaction-local until commit; over/short booking; bad UID rejects.
- `register-money.test.js` — denom ordering, makeChange optimality/exactness, bounded-drawer DP.
- `reservation-check-in-payment.test.js` — greens fee banks once, never touches merchandise analytics.
- `front-desk-monitor-ui.test.js` — canvas size/hotspots; renderer stays presentation-only.
- `register-abandon.test.js`, `register-complete.test.js`, `checkout-space.test.js`,
  `reservations.test.js`, `state.test.js`, `barcode.test.js`.

**Update to the new (simpler) contract — without weakening money-safety assertions:**
- `register-flow.test.js` — bagging concurrent with ring-up; receipt automatic; card auto-insert.
- `card-insert.test.js` — insertion automatic (not manual push); card always approves; keep the
  "no swipe in the live renderer" source assertion.
- `register-payment.test.js` — cash drawer auto-opens; received tender auto-deposits (deposit still
  occurs before close — invariant preserved).
- `checkout-audio-routing.test.js` — re-route cues to the merged click-to-bag path.

**Add:**
- Click-to-bag rings + bags exactly once per item; can't pay with items unbagged; can't double-bag.
- Card always approves after correct keypad total; wrong keypad total consumes no attempt.
- Cash: drawer auto-opens on tender; Giving turns green only at exact change; Done gated on green.

**Remove:** `registerMode.js`, `cardSwipe.js`, and any test that only exists to cover the dead
swipe path (`register-scanzone.test.js` covers pure `segmentHitsBox` in `register.js` — keep the
pure-geometry test only if the function is retained; otherwise remove with the function).

## 9. Audio

Reuse the existing routed cues (kept green by `checkout-audio-routing.test.js`): item click → bag
rustle; POS ring-up ding; card insert click; keypad beep; approve chime; drawer open; per-piece
coin/bill click on give-change; drawer close; bag handoff. No arcade effects.

## 10. Build & QA plan (phased)

1. **Assets** — POS monitor (new) → counter → drawer → card terminal → bag. Build, validate,
   preview-render, integrate, screenshot in-game per asset.
2. **Interaction** — click-to-bag; card auto-insert + always-approve; cash auto-open + auto-deposit.
3. **UI restyle** — checkout / cash / card / check-in canvases.
4. **Camera** — retune poses/FOV to the reference composition.
5. **Check-in polish** — greens-fee POS styling + same payment interaction.
6. **Audio** — re-route cues to the merged flow.
7. **Tests** — update/add/remove per §8; full `node --test` green.
8. **QA passes** — drive card + cash + check-in through normal controls (Playwright), capture
   screenshots/video, compare to `Final/` frames, fix visible defects, re-verify. Save/load safe.

## 11. Out of scope

Course maintenance, deliveries, employees, driving range, parking, the laptop back-office app,
new economy systems — untouched (per AGENTS.md). Only the checkout/register + greens-fee check-in.

## 12. Risks / notes

- Reordering "bag" ahead of payment touches the flow contract + a few tests; the money-safety
  assertions stay intact (revenue only on `completeSale`, exactly-once, transaction-local drawer).
- Rebuilding `checkout_counter` must preserve its footprint, `ANCHOR_*`, and `COL_*` so
  `fixtures.js` placement and `checkout-space.test.js` reachability still hold.
- Material renames change in-game color (runtime slot remap in `merch.js`) — keep slot names or
  update the `SLOT`/`TINTABLE` maps together.
- Verify every rebuilt GLB in-game (screenshot), not just the Blender viewport.
