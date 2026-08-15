# VERIFY2 — queue L, adversarial pass (2026-08-05)

Verifier run against branch `feature/pro-shop-vertical-slice`, in Electron only
(`node tools/qa/run-electron.cjs tools/qa/<file>.js`), NPC work at 1x
(`app.speedIdx = 0`). Every probe forces a NEW game at the menu because
Electron userData persists between runs and a stale Continue would resume the
previous probe's world. Probes (untracked): `tools/qa/verify2-l1-attack-a.js`,
`verify2-l1-attack-b.js`, `verify2-l1-q2-dump.js`, `verify2-l2-attacks.js`,
`verify2-l2-home-leak.js`, `verify2-l3-attacks.js`, `verify2-l3-continue.js`.

Baseline: all three stock drivers re-run clean on this commit first —
`walkin-asked-time.js`, `tee-sheet-grid.js`, `ledger-book.js` all exit 0 with
every check true (`qa/electron/walkin-asked-time-l1/walkin-asked-time.json`,
`qa/electron/tee-sheet-l2/tee-sheet.json`,
`qa/electron/ledger-book-l3/ledger-book.json`).

---

## L1 — walk-in asks · VERDICT: CONFIRMED

**What I ran.** `verify2-l1-attack-a.js` (party-of-4 ask against a
capacity-starved slot; two walk-ins queued at once; 90-real-second ignore
watch), `verify2-l1-attack-b.js` (16:40 ask with zero slots left; Turn Away),
`verify2-l1-q2-dump.js` (raw hotspot table + a real click on the second
walk-in's disabled slot button at its true pixels). JSON:
`qa/electron/verify2-l1a/verify2-l1a.json`, `verify2-l1-q2-dump.json`,
`qa/electron/verify2-l1b/verify2-l1b.json`.

**Party of 4** (ask 12:00 blocked to 1 seat by a 3-party): greeting spoken as
"Hi, could we get 12:00 PM for 4?", row reads `Asks 12:00 PM / Party 4`
(`verify2-l1a/p4-offers.png`), the ask is NOT offered, offers are
nearest-to-ask **that fit four** (11:30 first, then 12:30, then 11:00), the
note says "12:00 PM is not available. The nearest open time is 11:30 AM.",
no button claims the ask, and booking 11:30 through the monitor produces a
partySize-4 reservation paid end to end by card — $128 = 4 × $32, status
checked-in, four member names (`p4-booked-paid.png`).

**Two walk-ins queued**: both list (`q2-two-rows.png` — AT DESK / IN QUEUE),
the second is selectable, and its slot buttons render disabled
(`q2-second-selected.png`). The raw hotspot dump confirms both slot buttons
plus Turn Away are registered `disabled:true`; a real mouse click on the first
button's exact pixels (canvas→screen map validated to 3.3e-11 px on a third
anchor) does nothing — the game's own `debugPickAt` at those pixels returns
`monitorAction:null`, bookings 0→0, no tx (`q2-dump-after-raw-click.png`).
The bridge refuses directly too: `bookWalkIn(second,…)` →
`"Serve the customer at the head of the desk first."` No reservation is ever
created for the second walk-in.

**Evening, nothing left** (clock 16:40, last slot 16:30 gone): row still
states `Asks 4:30 PM`, ask spoken, zero offers, verdict
`"No open tee times remain."`, the only action is the red
NO TIMES AVAILABLE (`verify2-l1b/evening-no-times.png`), a direct
`bookWalkIn` at 16:30 is refused
(`"That walk-in slot is not available."`), and Turn Away removes them from
the desk list (`walk-in-leaving`) and they physically walk out — floor empty
afterwards (`after-turn-away.png`).

**Ignored walk-in (the patience question).** They never leave. Patience is
re-pinned to PATIENCE_FULL (600) every frame for walk-in-tee customers
(src/render3d/clubhouse.js:10778-10783, same policy as the reservation
branch above it): measured 600→600 over 90 real seconds at 1x for both queued
walk-ins, `preServiceWait` stays 0, and a manually drained `patience = 25`
snaps back to 600 within 4 s (`verify2-l1a/verify2-l1a.json` `wait` block,
`wait-still-standing.png`). The impatient/leave path is unreachable for a
walk-in tee request by construction. No crash, no leak — they stand at the
desk indefinitely. This matches the deliberate reservation-desk policy in
the code, so I do not count it against the claim, but the claim's fiction
("walk-ins with patience") is not what ships: an ignored ask waits forever.

Nits (not blocking): the exact-match button face ellipsizes its flag —
"12:00 PM asked" renders as "12:00 P…" at the standard 4-button width (stock
`walkin-asked-time-l1/a-ask-open-offers.png`); the note line above carries
the meaning. The evening no-slot detail panel still paints
"AMOUNT DUE $32.00" for an ask that cannot be booked.

---

## L2 — tee sheet · VERDICT: CONFIRMED

**What I ran.** `verify2-l2-attacks.js` (13 parties booked into 9 slots via
`bookReservation` — four slots full, one slot holding four separate names,
several very long holder names; pixel row-count with its negative control; a
raw click on a FULL row's true pixels; the walk-in booked from the sheet with
a CASH preference and the tabs probed at every stage), plus
`verify2-l2-home-leak.js` for the one leak found. Near-closing dimming was
photographed at 16:40 inside `verify2-l1-attack-b.js`. JSON:
`qa/electron/verify2-l2/verify2-l2.json`, `verify2-l2-home-leak.json`.

**Crowded day** (`verify2-l2/crowded-sheet.png`): the whole operating day in
two columns — 10+10 dark-band rows counted from the monitor canvas, exactly
(closeMin−openMin)/stepMin = 20, control strip 0. Full slots (11:30, 12:00,
1:00, 2:30) show 4 filled pips and their holder names;
"Anastasia Oberholtzer, Benedict Cumber…" is one row carrying four separate
parties; "Bartholomew Featherstonehaugh-Cholm…" and the other long names
ellipsize inside their half-column without touching the pips or dates. The
ask row (4:00 PM) wears the brass ground, the now-line sits above 10:00 AM,
7:00–9:30 render dim.

**Full rows cannot book.** With the walk-in selected, the hotspot census
lists 10 bookable rows; none of the four full slots is among them. A real
click on the FULL 11:30 row's true pixels (map error 3.6e-11) changes
nothing: bookings 13→13, no transaction (`after-full-row-click.png`).

**Only-while-selected**: re-verified by the stock driver this same day —
with no walk-in selected the sheet exposes zero booking hotspots
(`tee-sheet-l2/tee-sheet.json` `noBookingRowsWithoutWalkIn`). At 16:40 with
every row past, the sheet stays inert even with a walk-in selected at the
desk head: zero hotspots, all rows dim (`verify2-l1b/sheet-near-closing.png`).
(Note: once every slot is past there is no now-line at all — it marks the
first non-past row and nothing else.)

**Cash mid-flight.** Booking the walk-in's ask from the sheet with a cash
preference goes STRAIGHT to `cash-tender` — there is no interlude where the
checkout tabs render with a live transaction. At tender the cash screen owns
the glass (`cash-tender-monitor.png`): no tab row, zero slot hotspots, and
`monitorScreenPoint('tab-tee-sheet')` is null for the whole flight
(`verify2-l2.json` `cash.timeline`). Booking is additionally guarded at both
ends (`bookable = … && !tx`; `select-walkin-slot` handler returns false with
a tx).

**One papercut found (the "locked?" answer is: locked, except one corner).**
The header BRAND BLOCK stays a live `home` hotspot on the cash screen —
`monitorHotspots()` at tender = `['home','exit']`. Clicking the club name
mid-count swaps the monitor to the HOME app while the transaction still sits
at `cash-tender` (`homeleak-2-after-brand-click.png`: customer's bill on the
counter, glass showing "CHECK IN / CHECKOUT" cards), and from HOME all three
tabs — Tee Sheet included — are reachable mid-transaction. No booking is
possible anywhere in that state (verified: zero slot hotspots) and clicking
Checkout restores the cash screen (`homeleak-3-recovered.png`), so this is a
display/navigation leak, not a money or booking hole. Repro: book any cash
walk-in, wait for the tender screen, click the "PINE HILLS MUNICIPAL…" brand
text top-left of the glass. Root: `frontDeskMonitorUi.drawHeader` registers
the `home` hotspot before its `app === 'cash'` early-return
(src/render3d/clubhouse/frontDeskMonitorUi.js:290-296), and the `home`
action in simplifiedRegisterMode.js (~6691) does not check `tx`.

Nits: a partially-open row that carries names drops its "N open · book" hint
while remaining clickable (12:30 PM at 3/4 in `crowded-sheet.png`); the
check-in tab's "Full Sheet" button reuses the action id `tab-tee-sheet`,
which makes `monitorActionPoint(id)` ambiguous for harnesses (found when it
mis-mapped my first raw-click instrument).

---

## L3 — ledger book · VERDICT: CONFIRMED — with one presentational defect (mirrored page order)

**What I ran.** `verify2-l3-attacks.js` (21 seeded check-ins + one 90-char
name; real ArrowRight/ArrowLeft keys and a real page-half click; open while a
walk-in waits, then serve them; X-carry OUT the front door, Z-drop on the
grass, carry back; three register abandon/leave cycles; serializer round
trip; Save-and-return) and `verify2-l3-continue.js` (a REAL app relaunch
resuming the quit save). JSON: `qa/electron/verify2-l3/verify2-l3.json`,
`verify2-l3-continue.json`.

**Everything the claim states works.** Prompt at the desk's west front half
(`01-closed-prompt.png`: "Club register - E read · X carry"); E opens in
place with the lean-in pose (`02-spread0-title.png`); 21 entries paginate to
exactly 3 spreads; ArrowRight walks 0→1→2, a fourth press refuses at the
end, a real click on the left page half turns back, ArrowLeft returns to the
title (`verify2-l3.json`). The 90-character name fits by ellipsis
("Maximilian Barth…", no column overlap — `03-spread1-long-name.png`).
Opening the book while a walk-in waits at the desk is allowed, the customer
stays queued and undisturbed, nothing deadlocks, and serving them afterwards
makes roster entry #22 (`05-open-while-customer-waits.png`,
`06-entry22-signed.png`, diag `entries: 22`).

**Moveability, including out of the shop.** X carries (`07-carried.png`);
teleport-walked out past the porch, Z sets it down on the grass ~8 yd from
its desk spot; `state.shop.ledgerSpot` records the outdoor spot exactly; the
prompt follows it outside and E opens it on the ground
(`09-outside-prompt.png`, `10-open-outside.png`). Carried back in and set
down at the desk; spot re-recorded (`11-back-at-desk.png`). Three
abandon/leave register cycles neither move the book nor break the prompt or
E (`cyclesLeaveSpotAlone`, `opensAfterCycles` true).

**Spot persistence, all the way through a real relaunch.**
`serialize → deserializeWithReport` keeps `shop.ledgerSpot` bit-exact.
"Save and return" writes it to disk — verified in the actual save file
(`%APPDATA%/GOLF EMPIRE/saves/autosave.json`, trigger `quit`: ledgerSpot
x −1.1405564586793275, z 1.624380973968771, 22 directory customers, clock
600). A fresh Electron launch recognizes that save on the menu
("Pine Hills Municipal Golf · Day 1, 10:00 AM · $77,532" —
`13-menu-continue.png`), and Continue resumes with the book standing at the
exact moved spot, roster 22, prompt live, E opening to a painted spread
(`14-resumed-book.png`, `15-resumed-open.png`,
`verify2-l3-continue.json` `spotMatchesQuitSave: true`).

**DEFECT (presentational): the open book reads right-to-left.** The reading
pose stands on the staff side (local −z; ledgerBook.js `readPose`), where
local +x lands on the viewer's LEFT — but the page painters assume the
opposite side. Result: the title page sits on the reader's right (defensible
as a recto), and every later spread shows page N+1 to the LEFT of page N.
Photographed with dated entries in both the stock driver's own accepted
evidence and mine: `ledger-book-l3/04-page-two.png` (D12 on the left page,
D6–D11 on the right), `verify2-l3/03-spread1-long-name.png` (D13–D18 left,
D7–D12 right), `06-entry22-signed.png` (the House Notes closing page lands
viewer-left of the roster tail). Forward turns flip the LEFT leaf rightward
accordingly. Pagination, turn limits, and data are all correct — only the
left/right assignment is mirrored for the actual reader. Repro: 7+ roster
entries, E, ArrowRight, read the FIRST VISIT columns across the spread.
Files: src/render3d/clubhouse/ledgerBook.js (leftFace at x=−0.150 /
rightFace at +0.150 vs `readPose` eye at local −z).

Nit: an outdoor Z-drop seats the book at the interior floor constant
(`y: 0.001`, clubhouse.js:11533). On the front walkway the closed book is
not visibly discernible at its spot — flush with/under the path surface —
although the prompt and E still work and the open spread renders
(`08-dropped-outside.png` vs `10-open-outside.png`).

---

## Environment note: concurrent working-tree drift

A parallel session modified this checkout's working tree DURING the pass
(uncommitted changes to src/render3d/clubhouse/ledgerBook.js — a page-index
refactor plus the House Notes page — simplifiedRegisterMode.js, clubRoster.js,
main.js and the stock tools/qa/ledger-book.js, among others). All probes ran
against the live working tree, so L3's runtime evidence includes the
uncommitted House Notes page (diag `notes: 9`, `06-entry22-signed.png`). The
mirrored-page-order defect is NOT an artifact of that drift: HEAD's committed
geometry places leftFace at x=−0.150 / rightFace at +0.150 with `readPose`
standing at local −z (ledgerBook.js lines 97–103, 332–333 at HEAD), and the
uncommitted diff touches neither the face positions nor the pose. This
verifier changed nothing under src/; its probe files live untracked in
tools/qa/verify2-l*.js.

## Harness findings (not game defects, but they shaped this pass)

- `tools/qa/lib/qa-boot.mjs` `clickThroughMenu` can never detect an enabled
  Continue: it exact-matches `button.textContent === "Continue"`, but the
  menu button contains a label span plus a detail span
  ("ContinuePine Hills Municipal Golf · Day 1"), so `canResume` is always
  false and every driver silently starts a new game. Evidence:
  `verify2-l3/13-menu-continue.png` (enabled, titled) taken while the
  helper's own predicate reported it disabled. Worth fixing before any
  driver ever needs to resume a save.
- During probe development one monitor click (of ~40 across seven boots)
  landed without effect at the register overview pose (screen stayed on the
  HOME app; `qa/electron/diagnostics/runner-failure.png`); it did not
  reproduce under per-attempt diagnostics. All final probes use verified
  clicks with retries. The DOM `.notification-center` cards were made
  click-transparent in later probes as a precaution; diagnostics showed the
  canvas, not a card, under the failing click, so the one miss remains
  unexplained.
- The `saves/` autosave slot in this checkout's userData is QA-churned (every
  Electron run's quit writes it). Probe D's fallback new game overwrote the
  quit save under test; it was restored from the transport's own `.bak`
  rotation for the relaunch probe, which is also incidental proof the
  rotation works.
