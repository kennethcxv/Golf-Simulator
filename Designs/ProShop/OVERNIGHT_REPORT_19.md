# OVERNIGHT REPORT — Full Goal 19

Session start 2026-08-10 ~17:20. Branch `feature/pro-shop-vertical-slice`, HEAD at
start `4678128`. Tree carried the same 19 pre-existing `.blend` re-saves from the
open Blender (left unstaged, as last night) plus the untracked `dev/` stray.
Order worked: V3 stranger FIRST, then A, B, C, D, G, E, F, with the golden
world-Y pin inserted before C, and Phase 4 verification closing every section.

## TOP — VERIFIER DISPROOFS AND HEADLINE FINDINGS

(Filled as verifiers run. Four disproofs arrived with the goal itself — see the
fifth running list at the bottom.)

---

## V3 — THE STRANGER (run first this time)

Launched at session start, before any fix: a subagent playing the CURRENT build
from the main menu through a free-play command bridge
(`tools/qa/electron-freeplay-bridge.js` — file-IO REPL: it appends key/mouse
commands, the bridge screenshots after every command). It has read no code and
no docs; its only knowledge is the screen. Isolated `--user-data-dir` profile,
so it gets the clean-profile menu (Continue disabled). Report lands later in
this section.

**The stranger's report is in** (20+ min, fresh profile, Realistic mode, 134
tool calls, played to a clean end). Fifteen numbered confusions; the ones
that never resolved:
1. **Never got inside the property in 20 minutes** — the door chain (clear
   entrance → wash porch → repair doors) rejected E with the same message and
   nothing taught how to progress it.
2. **The pressure washer gave ZERO feedback on a tap** — no jet, no sound cue
   on screen, no percentage; only a long hold does anything, and nothing says
   so. "Indistinguishable from a broken tool."
3. **The current task lives nowhere** — objectives complete ("Survey the
   neglected property - done") without ever being shown; the pause menu's
   Overview tab holds no tasks; weeds are tracked ("4 patches left") with no
   way to find the patches.
4. **The Tab overview opens over anonymous forest** — "18 dirty spots
   marked" nowhere in frame, no player marker, no way to find the property
   without dragging blind. The V data view has no legend.
5. **Q's label contradicts itself** — the HUD pill says "Q reveal dirt", the
   Controls page says "Q Previous tool", and the pulse it fires fades before
   it can teach anything.
6. **A QA instruction leaked into player copy**: the maintenance tablet's
   work order lists "Save, reload, and confirm persistence" as a checklist
   item. (Fixed this session — see RUNNING LIST 4.)
7. Unexplained ground colours (near-black lawn, a saturated red strip) read
   as a leaked debug overlay; huge translucent shapes hang at the property
   edge; the tee-time board is invisible on its dark wall and opens onto
   grey blocks (that one IS the greybox — deliberate, recorded).
Also: money never moved in 20 minutes, and the stranger found the
management row (G/C/M/I) only by reading the Controls page 24 minutes in —
the maintenance tablet it revealed was "the single most helpful screen in
the game."
Its three asks, verbatim shape: task-on-HUD with markers; instant washer
feedback on any press; the overview opening centred on the clubhouse with a
legend. Full log preserved in the V3 section of the session transcript;
items 1-5 and 7 go on VERIFIER FINDINGS STILL OPEN.

## GROUND TRUTH — the user's ledger recording, frame by frame

16.03s at 30fps, 2292x1588. Extracted to `qa/ledger-truth/` (6 tiled overview
sheets at 10fps + 132 single frames at 30fps over the three event windows) and
VIEWED. Timeline (t=0 at video start):

- 0.0–0.5s approach; book closed on the desk.
- 0.6–1.7s pickup: book rises CLOSED and holds ~1.2s.
- **1.8–1.9s D1 GLITCH: the display pops from closed-cover directly to a bare
  cream title page standing alone, with the cover coiled into a green cylinder
  at its left. No cover boards behind the page, no hinge swing. ~2 frames at
  10fps.** (`overview-01.png` row 4 tiles 1–2; user's Image 3 is this state.)
- 2.0–3.9s full spread, correct.
- ~3.9s player presses close. 4.0–4.3s the book descends STILL OPEN (title
  page + coiled cover all the way down), shuts on the desk at ~4.3s.
- **4.6–5.3s D3 FIRST CONFIRMATION: after landing, the closed book RISES AGAIN
  to held scale and descends a second time.** (`overview-02.png` rows 3–4.)
- 5.5–6.2s player re-opens: rise, closed hold; **6.3–6.4s the same D1 rolled-
  cover pop**; 6.5s spread. 8.4s+ page turns (turn curls look correct).
- 12.0–13.5s reading The Deed. ~13.6s close pressed.
- **13.7–13.9s D2 GLITCH: the book sits ON THE DESK as a bare title page with
  the coiled-cylinder cover — the open-book presentation persists into the
  set-down.** (user's Image 4 is this state.) Shuts at ~14.0s.
- **14.10s at rest closed (setdown-25). 14.20s still at rest (setdown-28).
  14.30s AIRBORNE AGAIN at held-presentation scale, closed (setdown-31).
  14.40s descending (setdown-34); second landing ~14.5s. D3 CONFIRMED — both
  closes in the video double-play, and the second pass is a re-presentation of
  the closed book ~0.2s after the first landing completes.**

Reading for D: the open/close never hinges the cover — it pops between
closed-board and coiled-roll presentations (D1/D2 are the same defect seen in
both directions), and the set-down is animated twice by what looks like two
systems each moving "the" book once (D3). Code verification when section D
opens; the frames win over any instrument.

## THE FOUR REGRESSION STATEMENTS (what each check measured, why it passed)

Written before changing anything, checked against the two known shapes.

**B4 (ledger open glitch).** The check (`electron-b-ledger-evidence.js`) grabbed
45 rAF frames at 640w around each E press and I judged them by eye for "boards
through the swing." Why it passed: the DoubleSide fix genuinely cured the class
it targeted (the cover's inner face CULLING for the whole swing), and in the
early swing (0–70°) the board IS visible — I generalized from those frames.
The late swing is the part the player sees: the cover crosses 70–140° nearly
edge-on (invisible at video scale), the title page stands "bare" against the
barrel spine, and at swing 0.72 the shell swap pops to the full spread
(`ledgerBook.js` SWAP_POINT). The user's 10fps recording samples land exactly
in that window (1.8–1.9s, 6.3–6.4s). The instrument had no per-frame predicate
— "a cover board must be visible in any frame where a page is" — so a human
eyeball passed a composition the design cannot actually produce. Instrument
shape: eyeball generalization, not two-populations.

**B5 (double set-down).** The check traced ONE object's state machine —
`ledgerBook.diagnostics().state/stateT` every rAF for 3.5s through the close —
and saw `open → closing → lowering → closed`, one clean pass, no repeats, no
stateT rewind. That result was TRUE and is precisely the evidence: the user's
footage shows the second animation starting ~0.2s AFTER `closed` lands
(14.10s at rest → 14.30s airborne again at held scale), INSIDE my trace
window. A bookState re-entry would have been caught; none was. Therefore the
second animation is driven from OUTSIDE the state machine — a second driver
moving the book (the user's own hypothesis: "two objects animating where I
see one" / a re-present at held scale). The instrument watched the right
object with the wrong scope. Shape: two-populations, the animation edition.
Candidates for section D: E key auto-repeat re-triggering `advance()` on the
freshly-closed book plus an auto-close reversing it, or a second driver in
clubhouse.js's ledger wiring. To be settled with a keylog + call-site trace.

**F2 (stuck rule).** The check (`tests/nav-stuck-one-second.test.js`) asserts
the pure `navStuckVerdict()` function on synthetic inputs plus two regex
source contracts (the 0.35s ladder gate, the give-up notification). "Watched
fail" was the pure function failing with the old constant restored. Nothing in
the check launches the game or watches an actor move. Why it passed while NPCs
still grind: customers sliding along a box face can register as MAKING
progress by the verdict's own inputs (moved≈step), actor-vs-actor collisions
produce no verdict at all, and whether the live plumbing even feeds
`noProgressT` for the movement states the player watches was never observed.
Shape: tested code with zero live observation — the same family as
tested-code-with-zero-call-sites. Section B settles what the live ladder
actually receives while a customer walks into a box.

**E1 (broom grip).** The check (`electron-e1-broom-grip.js`) applied four
`frame.yaw` candidates at ONE forced pose and I picked from four screenshots;
`broomDiagnostics()` supplied presence booleans (vmActive/twoHanded). It
measured one degree of freedom (yaw) at one camera pitch, and hand PRESENCE.
The complaints are hand SHAPE (the support hand renders as a fingerless
blob), hand ORIENTATION (upper-hand thumb on the wrong side), residual head
SLANT (a roll/pitch/bake composite that a yaw sweep cannot see), and SHADER
artefacts — none of which any instrument graded. Worse: the golden suite DID
flag the yaw bake as a visual family shift, and I accepted the new baselines
as "the intended change" — the one gate that could have argued was silenced
by my own rebaseline. Shape: instrument measures presence, complaint is about
form.

## A — THE PHONE AND THE EMAIL

### A1 The phone — DONE (seen working, negative control clean)
GTA's shape, built: **T** (routed through the binding table — the key was free,
no collision; it shows in Controls and in the on-screen control line) slides a
phone up from the bottom right and puts it away. **The world keeps running and
the player keeps control — measured, not asserted**: with the phone up, the
driver walked 3.1 units on a real held W and turned 0.063 rad on a real mouse
sweep, pointer lock held throughout (`qa/electron/a-phone/report.json`).
Arrows navigate, Enter opens, Backspace goes back. Home screen with three
apps: **Phone** (call history: booked/declined/missed with day+time),
**Contacts** (everyone who has called, derived from the log, with per-caller
history), **Messages** (texts; booking confirmations arrive here). A ringing
call: real RINGTONE (a double trill distinct from the doorbell, retriggered
while the caller waits), the banner names the caller and what they want when
the phone is down (Y/N still answer from the hip, and the banner now teaches
T), and with the phone up the face becomes the incoming-call screen — caller
ID, **Answer / Offer another time / Decline**. The offer lists the three
nearest open slots; the caller answers deterministically by distance (within
90 min they take it). An unanswered call becomes a MISSED call on the log and
badges the pocket chip until looked at. Answering booked through the one
bookSlot path with `source: 'phone'`, logged the call, and texted a
confirmation — all verified live in one run with screenshots
(`qa/electron/a-phone/*.png`). NEGATIVE CONTROL: no request → no banner, and
the phone opens to home.

**The app surface** (how a new app plugs in): `src/ui/phone.js` holds `APPS`,
one entry per app — `{ id, label(), glyph, badge(state), onOpen(state),
render(state, listEl) }`. The home grid, focus order, badges, back navigation
and the keyboard driver all derive from the array; adding an app is adding an
entry, nothing else. Caught by my own screenshot review: the pocket chip
rendered a literal "null" (native append(null) stringifies) — fixed and
re-photographed.

### A2 The email — DONE (a real client on the laptop, seen working)
A new **Mail** page (the laptop's eighth — the file's "SEVEN PAGES, NO MORE"
doctrine updated with the Goal-19 citation; the brief explicitly ordered "a
real email client, not a card on an existing page"): message list left
(unread dot, sender, subject, time), reading pane right. Booking requests
arrive as real emails the moment they roll, are READ and ANSWERED in the
pane — **Accept / Propose another time (three nearest slots, same 90-minute
rule) / Decline** — and STAY in the inbox with their resolution stamped
("Accepted - it is on the tee sheet", "They passed on the time you offered",
…). The home screen carries the unread count with the newest senders
(`qa/electron/a-mail/01-home-unread.png`); accepting landed the reservation
with `source: 'email'` and kept the stamped row
(`qa/electron/a-mail/04-request-accepted.png`). NEGATIVE CONTROL: a clear
inbox reports itself clear before any injection.

**Notifications moved to mail** (and which stayed): MOVED — supplier order
confirmations (one mail per order at the single commit point every order path
shares, `inventoryLifecycle.submitPurchaseOrders`; the first hook landed in
placeOrder's DEAD legacy body after its return and measured nothing — that
corpse is recorded so nobody hooks it again), and reviews at ≤2★ which now
arrive as complaint letters with their full text (a 4-star review is a fact,
a 2-star review is a letter). STAYED on the bell — the van arriving, the
receiving pad being full, higher-star review notices: real-time facts, not
correspondence. Every mail delivery also files ONE bell line ("New mail from
{from}") pointing at the Mail page — the pointer, never the content.

### A3 One sheet — VERIFIED
All channels land on the same tee sheet through the same `bookSlot`:
walk-ins, the generator, phone (`source:'phone'`), email (`source:'email'`),
desk. The reservation records its channel in `source` (already persisted).
The reservations page's old inbox card carried its own Accept/Decline — a
second answering surface — and is now a pointer into Mail. Headless suite:
`tests/phone-and-mail-channels.test.js` (7 tests: mail-on-roll, missed-call
logging at BOTH expiry sites, channel recording, deterministic alternative
offers, supplier mail, healing, and snapshot survival — **watched the
snapshot test fail with the allowlist lines removed**; `snapshot()` in
state.js is an explicit field list and silently swallows anything not named).

### A4 How a player learns each channel
The phone teaches itself: it RINGS — banner with the caller's name, the
ringtone, and the [T] key printed in the banner; the pocket chip (bottom
right, always present) shows ☎ [T] with a red badge when calls were missed
or texts unread. T is also in the Controls page and the on-screen control
line. The email's reason to open the laptop: every mail files one bell line
on the laptop's own notification bell, the home screen's first card is Mail
with the unread count and newest senders, and the Bookings page points at
Mail whenever requests are waiting. First contact with either channel
happens without reading anything.

### The ratchet fight, recorded
The player-string ratchet (2108 frozen) caught my first draft at +21: the
scanner counts quoted `text:`/`label:` literals and toast templates. Resolved
the honest way — phone prose was already t() (25 keys × 10 locales); the
glyphs and clock template were hoisted as non-prose constants; Mail's prose
went into one `MAIL_COPY` table (the laptop is English by long convention —
the table is the lift-point for F2's translation pass); and the +2 from the
two new `label:` rows was paid for by wrapping three OLD raw reservation
refusals in t() (`noTimeAsked`, `noOpenSlots`, `slotIntervalRange`, × 10
locales) — the ratchet ends BELOW its baseline.

## B — THE QUEUE

### B1 Single file, back from the desk — DONE (photographed)
The line was SIDEWAYS by design: a 2026-07-28 ruling pitched it east along the
desk face to keep the tail out of the door lane. Goal 19 supersedes it,
recorded: `shopLayout.js` v2 queue pitch is now (0.18, −0.66) — each next
person 0.66 BACK from the one ahead with a small eastward drift, head
unchanged (F5's fix keeps), spacing 0.68 in the proven body band. The
overflow pocket sat directly in the new line's corridor and moved east into
the pinch between the line, member_station, the tour vault and the x 5.70
partition (radius caps 0.85 → 0.70 to fit; the audit walks all nine points).
The layout audit test was re-encoded FIRST and watched to fail on the old
geometry ("line slot 1 does not step BACK from the desk"), then the geometry
moved and the full audit passed 21/0 — desk-slab clearance, exit-lane
exclusion, reachability, spacing all held. LIVE:
`qa/electron/b1-single-file/line-default-camera.png` — three walk-ins one
behind another at their slots (measured (3.04,2.30) (3.20,1.72) (3.36,1.14),
sideways spread 0.32, `noneInSlab: true`). The image-5 counter clip class is
side-by-side contention at the face; with the file running back, no actor
stands in the slab (asserted live). NEGATIVE CONTROL: empty queue lists
nobody before the first send.

### B2 "IN QUEUE" tells the truth — DONE (the lie watched first)
NOT the two-populations shape this time — one population with a stale flag
and a dishonest map: `queued` flips true the moment the counter becomes a
walk-in's route STOP (decided from across the room), and the screen printed
`queueIndex === 0 ? 'AT DESK' : 'IN QUEUE'` — so someone still crossing the
floor read AT DESK, and someone who LEFT the line entirely (queueIndex −1)
read IN QUEUE. Both halves of the user's sighting from one mapping.
WATCHED FAIL on the unfixed build: `electron-b2-queue-truth.js` sampled a
real walk-in's whole approach — 15 samples with the actor >1.2 yd from the
slot while the old labels said AT DESK / IN QUEUE (`LIE_CONFIRMED: true`,
`qa/electron/b2-queue-truth/report.json`). The fix: the bridge rows now
carry `atSlot` (body within 0.55 yd of its queue slot, measured per read)
and drop customers whose phase is 'leaving'; the screen maps
AT DESK = head AND at slot, IN QUEUE = at slot, otherwise WALKING UP. Same
driver on the fixed build: `NEW_MAP_HONEST: true` — every far sample maps to
WALKING UP, every arrived sample carries atSlot. If they leave the line, the
row leaves the list (the 'leaving' filter) — the exact sentence of the
instruction.

## GOLDEN GATE — WORLD-Y PIN — DONE (the diagnosis was wrong, the fix is total)

Last night's top open finding said "boot-varying world-Y shifts the camera".
Measured tonight with a two-boot probe: **there is no Y jitter — every
harness boot starts a NEW GAME with a fresh random seed** (Continue is never
enabled on the QA profile; qa-boot then clicks New Game, and main.js draws
`(Math.random()*2^31)|0`). Seeds 97236116 vs 2066143097, interior world-Y
1.6 yd apart: the golden suite was comparing screenshots of two different
planets, and every "noise" number in last night's calibration was
world-vs-world difference.

The pin: `clickThroughMenu(page, { forceNew, pinSeed })` — qa-boot stubs
Math.random around the New Game flow (the menu consumes the seed in an async
continuation, so a 150 ms restore measured a wrong seed; the capture now
restores AFTER the walk rig is active) and golden-capture always boots
`forceNew` + `pinSeed: 0.4242`, recording seed and interiorY in its manifest
(1035912314 / −0.45135, identical every run). Runtime randomness is restored
after boot on purpose — the window's live golfers stay masked.

Result: two-run noise fell from 3.6–5.1% raw to **0.0000–0.0622%** across
all 12 poses (shop-floor and stockroom-wall at literal zero). Budgets
restored from the temporary 6.0 to **0.25** (≈4× the worst measured noise —
the E1-yaw family class at >1% can never hide again), baselines re-accepted
under the pinned world, and the one-pixel control still fails the strict
diff as it must. C1 and E2 now have a gate that can actually fail.

## C — CHECKOUT

### C1 The bag anchor re-authored, one packing rule, a golden pose — DONE
Through golf-assets: `ANCHOR_BagContents` in `build_checkout_kit.py` moved
from a floor-adjacent point the runtime never read to the CENTRE of the
contents volume (BH·0.40), carrying the interior half-extents as authored
props (`interior_half_x/_depth/_mouth`). Rebuilt `shopping_bag.glb`
(preview LOOKED at — visually unchanged, as an anchor move must be),
validated clean, vendor manifest hash updated, staged copy verified.
Runtime: the THREE hand-placed packing sites (scan-slide, drag, restore —
two hardcoded `(0,0.15,0)`, one ad-hoc stack; the restore site computed the
anchor and then never used it) unified into ONE `packMeshIntoBag` rule:
measure the body's bag-frame box, clamp it WHOLE inside the anchored volume,
fill deep-end-first in two columns. The flattened-depth axis overflow pushes
toward the face the bag rests on (the first live run photographed two ball
domes grazing the upper paper — fixed and re-measured). LIVE:
`insideFrac 1` on all three goods, tops 2.8 cm under the rim
(`qa/electron/c1c2-evidence/`); the contract tests re-encoded to pin ONE
authority (exactly one 'packed-in-bag' mark, inside the helper, visible=true
and full-size asserted there, ≥3 call sites). GOLDEN: new `bag-packed` pose —
a staged, pinned-spawn 3-item sale photographed at the cashier's stand —
two-run noise 0.105%, budget 0.35, and the one-pixel control fails it
strictly. Items sticking out of the bag can no longer regress invisibly.

### C2 The card is held flat, pinched, angled toward the cashier — DONE
The Goal-18 fix authored grip-LOCAL constants and trusted the fist bone's
frame — which stands the card up like a sign (image 1). The pose is now
authored in WORLD terms at attach time and converted into the grip frame:
face normal tipped 34° from flat toward the cashier's eye, long edge across,
centre pushed 5 cm out of the fist so the fingers close on the near edge.
MEASURED live: upDot 0.825 (=cos 34°), towardEyeDot 0.565 (=sin 34°) —
exactly the authored numbers — and photographed
(`qa/electron/c23-evidence/c2-card-closeup.png`): flat green face up toward
the till in the outstretched hand. The register also gained `cardNode()`
(forwarded through the narrow facade, whose own comment records what an
unforwarded accessor costs): tonight's hunt-by-name found a scorecard holder
and a pile of wood chips before the handle existed.

### C3 One size from the moment it leaves the hand — DONE (pop measured first)
Mechanism: customer bodies are scaled 0.87–0.99; carried goods inherit that,
and `interior.attach()` at placement start faithfully PRESERVES it — so
goods sat on the counter at the customer's size, and when the LAST one
landed, `begin()` rebuilt them all at authored scale: the pop. WATCHED
FIRST: measured live popRatio 1.089 (world 0.9186 → 1.0). Fix: one line at
the attach — normalize to world-true authored scale as the good leaves the
hand. Re-measured: placing world scale 1.0, register world scale 1.0,
popRatio 1.000.

## D — THE LEDGER

### D3 The double set-down — FOUND AND FIXED (it was the state machine)
The hunt ran four instrumented replays (caller-logging wrapper on every book
verb + per-frame position sampling): single synthetic press, an OS-style
key-repeat train through the close, held tool + live sim speed — every call
came from a legitimate main.js site, no re-entry, no second driver. Then the
instrument's own y-extents gave it up: **`closing` lerped the book ALL THE
WAY DOWN (y 1.493→1.055) and then `lowering` began at stateT 0 and lerped
from the FACE POSE down again (y 1.055→1.491→1.055)** — two full descents,
back to back, in the machine, on every close. The states never repeat, which
is exactly why Goal 18's bookState trace called it "one clean pass": it
watched the right object and the wrong variable. Fix: `closing` now shuts
the cover IN PLACE at the face (no descent; CLOSE_SECONDS re-sized 0.65 →
0.42 for the shut alone) and `lowering` owns the ONE descent. Re-measured:
closing y constant at 1.494, lowering 1.494→1.056, done. Filmed and the
frames VIEWED (`qa/electron/d-ledger-film/`): shut in place with the title
face reading through the swing, one closed descent, stillness after.

### D2 The set-down bare page — FIXED (same fix)
The old `closing` swung the cover WHILE falling, so the open presentation
rode down to the desk — the recording's 13.7 s title-page-on-the-desk
frames. With the shut-in-place phase, nothing open ever descends. Filmed ✓.

### D1 The open glitch — IMPROVED, RESIDUAL RECORDED
Two changes: the shell swap moved from swing 0.72 (cover past vertical, the
closed block showing a bare title page — the recording's 1.8 s frames) to
0.50, the edge-on moment, so the exchange lands exactly when the cover is a
line and the open spread arrives with both boards flat under its pages; and
the swing carries a slight tip (0.14·sin) meant to keep a face of the board
presented mid-swing. Close-range rAF frames after the fix: the bare-page
window shrank from ~8 frames to ~4 (≈70 ms at the 0.34 s swing) — the tip
did not visibly widen the board at the reader's camera (wrong axis for this
rig, or too small). RESIDUAL: a ~70 ms thin-cover flash on OPEN remains;
the honest cure is cover THICKNESS in the GLB (a board with sides cannot
vanish edge-on) — queued for the asset pass, stop rule applied here.

### D4 One key — DONE (filmed)
E opens the shut book, opens the cover, and TURNS THE NEXT PAGE — the same
key the whole way forward (`spread` advanced on film and in diagnostics);
A (or click) turns back, and Esc is the one way down. The HUD chip and the
book's own footer teach the new keys from the live bindings ("E next page ·
A back · Esc put the book away"). E ignores key-repeat (a held key is one
action, not a page-riffle).

## G — PERFORMANCE — measured; the named lever was WRONG, corrected with numbers

**The freeze was never the 8 ms.** Measured live (300 frames indoors,
`electron-g-matrix-share.js`): the ENTIRE scene matrix walk costs
**1.3 ms/frame** across 4,852 scene objects (2,853 in the interior). The
~8 ms CPU submit is dominated by the **2,413 draw calls** (projectObject +
sort + WebGL submission), which no matrix freeze touches. Freezing the
interior would buy ≤1.3 ms at real risk to every animated child (doors, the
ledger, the drawer, restock previews) — declined at these numbers; the
correct daylight project is DRAW-CALL REDUCTION (merge static meshes per
material — the runtime batching pattern already proven on 10 props).

The cap ladder, re-run tonight (two runs; the first run's 60-leg armed
empty and was re-run — recorded):
- **60 cap: HOLDS** — 62.5 achieved, median 16.0 ms, **85.2% on-cadence**.
- **120 cap: does not pace** — 62.9–65.4 achieved, 2.5–5% on-cadence.
- 144 cap: 64.9–66.7 achieved. Uncapped: ~65.
- **The default STAYS 60** — preferences.js's flip-to-120 condition (120
  pacing cleanly) is not met, and the blocker now has its true name.

Action stalls (not reopened, per instruction; whether they still fire):
**the ledger first-open stall FIRED in tonight's own D3 trace** — the frame
sampler gapped 914→5067 ms on the first E press (~4.1 s, the known
compile/visibility stall); first-equip (9.6 s, 16 refuted fixes) untouched.
GPU stands at 5.14 ms (the Goal 18 GTAO re-grade; nothing tonight moved it).
Worst frame in an indoor minute: the ~4.1 s first-ledger-open stall when the
minute contains one; otherwise frames sit at the ~15–16 ms cadence above.

## E — THE MOP AND THE BROOM

### E0 The missing strand handle — RESOLVED: two instrument faults, zero game faults
1. Tonight's probe found the rig LIVE within seconds of equip
   (`MopStrandRig` + three instanced layers in the scene, skirt hidden).
   Last night's 60-second null was the **driver's own path typo**:
   `scene3d.strandRigFor` — the accessor lives on `scene3d.walk`.
   `undefined?.('mop')` is null forever, and "the handle never appears in QA
   boots" went into the record as a game finding. Fixed in the driver with
   the finding named at the wait site.
2. The E4 sampler then measured ZERO motion on flying yarn: the strands are
   INSTANCED — a layer node's matrixWorld never moves; the motion lives in
   `instanceMatrix`. The sampler now reads five instances per layer.
   (Last night's null-handle window was also real for part of the night —
   the KTX2-poisoned mop GLB between the bad pack and the repack could not
   adopt — but the accessor typo would have hidden the recovery regardless.)

### E1 The mop the player actually sees — THE SIXTH FOUND-FALSE, then fixed
Goal 18's "mop head rebuild" (96 fine damp-grey strands, A9A294) edited
`MESH_MopSkirt` in Blender — **a mesh the runtime HIDES**: on adoption the
viewmodel conceals the authored skirt and shows the 480-strand PROCEDURAL
rig, whose yarn stayed pale cream `0xe4dcc6`. "The mop is completely
unchanged" was literally correct — the rebuild changed an invisible mesh,
and the checks graded Blender previews and a golden whose subject was the
unchanged procedural rig. Fifth entry on the found-false list (the fifth and
sixth arrived together tonight: the skirt swap and the driver typo above).
Fix at the VISIBLE layer: the rig's yarn is now waterlogged-cotton grey
`0x8f8a80`, roughness 0.97 — confirmed by eye on the re-captured golden
(`tool-mop` re-baselined as the intended change; the small 0.53% diff is
the head's screen share, not the change's size). Density (480 fine strands)
and pressed-floor SPLAY (splayBase/Grow × contact) already live in the rig.

### E4 Strands move whenever the mop moves — DONE (measured 27×)
The carry channel listened only to the head's swing FAN — a yaw turn slides
the head across the room without fanning it, so the yarn hung dead through
every turn (measured 0.8× idle). The head's world motion, expressed in the
rig's frame and signed along the fan axis, now joins the drive. Re-measured
on the instanced sampler: idle 0.037 (baseline unchanged — the negative
control), walk 1.009 (**27× idle**, was 2.3×), turn 0.099 (3.2× idle, was
0.8×). `strandsLiveWhileCarried: true`.

### E3 The stroke follows the mouse — NOT DONE (scoped, stop rule)
The stroke input is a single scalar (`strokeX`) synthesized by the rig's own
oscillator while the button is held; making it FOLLOW the hand means
routing live pointer deltas through the walk controller into the viewmodel's
stroke state — an input-pipeline feature, not a tuning number. Scoped
tonight, not attempted at the session's edge; the seam is
`broomViewmodel.update`'s strokeX and the walk controller's pointer path.

### E2 The broom's hands and head — NOT DONE (honest scope)
The found-false statement stands (presence was measured, form was not).
The two hand faults are ANATOMY: the support hand is the procedural mitt
mesh (no fingers to read) and the upper hand's thumb side comes from the
grip pose family — both are viewmodel hand-mesh work, not a slider. The
head slant needs a roll/pitch sweep with the E1-Goal-18 method but judged
at the DEFAULT camera against the slant the user photographs (yaw was the
wrong axis — measured last night). Left NOT DONE with this scope rather
than half-tuned at 7 AM; the shader banding on the shaft belongs to the
same asset pass as the ledger cover thickness.

## F — SETTINGS UI

---

## RUNNING LIST 1 — UNCONFIRMED

## RUNNING LIST 2 — NOT DONE

## RUNNING LIST 3 — VERIFIER FINDINGS STILL OPEN

## RUNNING LIST 4 — FIXED BUT NOT ASKED FOR

## RUNNING LIST 5 — REPORTED DONE PREVIOUSLY, FOUND FALSE

| Item | What was reported | What the check measured | Why it passed while broken |
|---|---|---|---|
| B4 ledger open glitch | "full boards through the swing" | 45 rAF frames judged by eye | Early-swing frames show the board; the player-visible late window (cover edge-on + swap pop) had no predicate. Eyeball generalization. |
| B5 double set-down | "CANNOT REPRODUCE, traced per frame" | ONE object's bookState per rAF | The trace is true — the second animation never touches bookState. A second driver moves the book after `closed` lands. Two-populations, animation edition. |
| F2 stuck rule | "watched fail with old threshold restored" | Pure verdict fn + source regex | Never launched the game. Sliding registers as progress; actor-pair collisions produce no verdict; live plumbing unobserved. |
| E1 broom grip | "yaw 0.02 baked, both hands verified" | One DOF at one pose + presence booleans | Complaint is hand shape/orientation, head slant composite, shader artefacts — none instrumented; the golden flag was rebaselined away. |
