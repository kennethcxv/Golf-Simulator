# OVERNIGHT REPORT — 2026-08-04 (session 8)

**Filename.** You asked for `OVERNIGHT_REPORT_2.md`. That file already exists —
it is the S-series session's report, and the name came from task #65's title
(`S7: OVERNIGHT_REPORT_2.md + optional NPC behaviour`), which is stale. Writing
over it would have destroyed that session's record, so this is
`OVERNIGHT_REPORT_8.md`, the next in the sequence. Logged here rather than
decided quietly.

**Verification standard used.** Electron only. Every claim below that says
"confirmed" was seen in a window launched from `node_modules/electron` running
this repo, at the player's camera, with the file named. Nothing is called
complete on a green test.

---

## The 18 open tasks, as I read them

Five were named in the brief. The "13 unnamed pending items" are the rest of the
task list's open entries, listed here first as asked:

| # | item | outcome |
|---|---|---|
| 1 | **C5** desk pass-through gap near the door | **COMPLETE — confirmed** |
| 2 | **C6** buy AND book in one visit, 3 intents | **COMPLETE (mechanism) — 2 of 3 intents confirmed** |
| 3 | **A8** broom: hand pose + tool/surface legibility | **NOT DONE** (its two open parts are D2 and D3 below) |
| 4 | **C8** fixing a lamp teaches itself | **NOT DONE** |
| 5 | **C9** the ledger book on the desk | **NOT DONE** |
| 6 | **D2** hand grip anatomy | **NOT DONE** |
| 7 | **D3** tool-filtered dirt reveal | **NOT DONE** |
| 8 | **D4** material interning for load time | **NOT DONE** |
| 9 | **D7** remaining harness debt | **PARTIAL** — two larger defects found and recorded; the original four-item list untouched |
| 10 | **E2** fix the other tools | **NOT DONE** |
| 11 | **E3** audio per tool | **NOT DONE** |
| 12 | **F1** settings menu | **COMPLETE — confirmed** (it was already built; this is the proof, including persistence) |
| 13 | **F2** full key rebinding | **NOT DONE** |
| 14 | **F3** crash handling | **COMPLETE — confirmed** |
| 15 | **F4** save robustness | **COMPLETE — confirmed** |
| 16 | **G1** twelve-file texture pass | **NOT DONE** — and G1 and B6 are the same item, duplicated in the task list |
| 17 | **B6** 12-file texture pass (last, one block) | **NOT DONE** — including its positioning pre-check |
| 18 | **S7** OVERNIGHT_REPORT_2.md + optional NPC behaviour | **This document** (see the filename note) |

Six complete, one partial, eleven not started. Ranked below by what I would read
first.

---

## 1 · C5 — you could not stand behind your own till. At all.

**~2 h 40 m. Confirmed.**

The brief called this "a desk pass-through gap near the door". Measured, it was
worse than a gap in the wrong place.

A connected-component sweep of the **live collider set** in Electron — every
door leaf excluded, because `doors.js` marks them `collider.door = true`
precisely so nav ignores them — put the staff side of the front desk in its own
**1.01 yd² island**, bounded x 3.00–5.55, z 4.25–4.60. The door and the whole
public floor were region 1 (32.26 yd²). The till was in region 4. There was no
route between them at any length.

The seal, named collider by collider from the running build:

| what | interior-local |
|---|---|
| the desk's own return leg | x 0.903–1.976, z 3.660–**5.249** |
| `corridorWestSeal.returnBackFill` | x 1.000–1.880, z 5.150–5.490 |
| `A_081_OFFICE_CHAIR_SHEET09` | x 1.940–2.660, z 4.040–4.760 |
| `corridorWestSeal.hutchGapFill` | x 1.880–2.400, z 4.890–5.490 |

`tests/checkout-space.test.js` has asserted *"the staff corridor has a way in
from the sales floor"* through every version of this room. It computes that as
`frontLength/2 − backcounter.maxX` — two rectangles subtracted. Rect arithmetic
cannot see a seal fillet or a swivel chair, so it was answering a question
nobody asked. It is still green and still unmodified.

**The fix is one datum.** `PINE_HILLS_V2_LAYOUT.frame` gains `staffReturn:
false`; `deriveFrontDeskFrame` collapses `returnStaffExtent` onto the counter's
own back face; the collider rect, both return renderers and the placement
keep-out all follow from that rather than each learning about a flag. The
pass-through **end** is derived too — whichever counter end lands nearer
`DOOR_MAIN` in world x — so rotating the frame cannot silently invert it.

Two consequential follow-ons, both from measurement rather than taste:

- The desk chair parks at the corridor end furthest from the gap. A 1.19 yd
  corridor and a 0.68 yd chair means a chair anywhere in the middle is a plug.
  **This reverses B8's "the chair stays where it is."**
- The clutter spot at (0.95, 4.90) is deleted. With everything else open it
  pinched the gap to **0.17 yd** — which a 0.05-yd grid sweep threads happily
  and a person with a keyboard does not. Seven spots now, not eight.

**Verified by walking it**, real `keydown`/`keyup`, in the shipping shell:
from just inside the door to **0.17 yd** off the staff stand, where the focus
label reads *"Tee desk — [E] arrivals, check-in & walk-ins"*. Route length
**4.64 yd**, detour factor 1.11 (near-optimal). Before: no route.

- `qa/electron/staff-route/walk-2-in-the-pass-through.png` — standing in the gap
- `qa/electron/staff-route/walk-3-behind-the-till.png` — at the till
- `qa/electron/staff-route/route.json`, `qa/electron/desk-map/{player,solids}.txt`

**Twenty-minute bar: passes.** A stranger walks in, turns right, and is behind
the counter. Nothing on the way reads as broken.

---

## 2 · F3 — there was no crash handling of any kind

**~1 h 10 m. Confirmed.**

Not "thin" — absent. No `uncaughtException`, no `render-process-gone`, no
`window.onerror`, no log file anywhere. A renderer that died took the window
with it and left a blank screen and nothing a player could send anyone.

- `src/electron/crashReport.cjs` — one appended, rotating log under
  `userData/logs/crash.log`, 512 KB then one rotation. Every path guarded: a
  crash handler that throws turns a recoverable fault into a silent exit, so
  every write is wrapped and a failure degrades to `wrote: false`.
- `main.cjs` — `uncaughtException`, `unhandledRejection`, `render-process-gone`,
  `child-process-gone`, plus a **Restart / Quit** dialog. Suppressed under
  `FW_QA=1` so an automated launch can never sit on a modal nobody will click.
- `src/core/faultGuard.js` — the renderer half. `window.onerror` and
  `unhandledrejection` into the **same** log, a panel that says what happened
  and offers a reload, and **per-fault** rate limiting so a per-frame throw
  cannot stack a hundred panels — while a *different* fault still gets through.

Measured in Electron, with the negative control first (no panel before the
fault):

| | result |
|---|---|
| panel present before any fault | **false** — the control |
| after one thrown error | panel + working reload button |
| 20 identical throws | **1** panel, **3** log lines |
| log location | `…\AppData\Roaming\GOLF EMPIRE\logs\crash.log` |

`qa/electron/crash-handling/fault-panel.png` — the panel reads *"The game hit a
problem / Your last save is untouched. Reloading starts again from it."* with the
message and a Reload button. It fills in the log path once the IPC answers.

**Twenty-minute bar: passes**, for the case it covers. What it does **not**
cover, and I would not claim otherwise: per-asset and per-audio fallbacks. A
missing GLB still rejects inside `gltfCache` and is now *logged* rather than
silent, but there is no substitute mesh and no silent-audio path. That is the
rest of F3 and it is not done.

---

## 3 · F4 — five deliberately mangled saves, and the answer is that this was already right

**~55 m. Confirmed.**

Written to disk in the real `userData/saves/`, both the primary and its backup
broken so the backup path could not rescue them, then relaunched:

| mangle | survived | menu reached | Continue offered | damaged file left intact |
|---|:--:|:--:|:--:|:--:|
| truncated mid-write | ✅ | ✅ | no | ✅ |
| parseable, root is an array | ✅ | ✅ | no | ✅ |
| `empireVersion: 99999` | ✅ | ✅ | no | ✅ |
| raw non-JSON bytes | ✅ | ✅ | no | ✅ |
| `empireVersion: 1` (ancient) | ✅ | ✅ | **yes — migrates** | ✅ |
| *healthy save (the control)* | ✅ | ✅ | **yes** | — |

The menu says *"Continue save is unreadable — Try a manual slot. Starting a new
game will preserve the damaged copy as a backup"*, greys Continue out with
*"Autosave needs attention"*, and never rewrites the broken file.
`qa/electron/save-robustness/truncated.png`.

**Twenty-minute bar: passes.** A stranger whose disk hiccuped gets a clear
sentence and keeps their manual slots.

One cosmetic thing I saw while looking: on the menu, the CURRENT RESTORATION
card's backdrop sits as a translucent grey rectangle across the GOLF EMPIRE
wordmark. Visible in the same screenshot. Not fixed — it is a layering choice,
not a fault, and it was not in scope.

---

## 4 · C6 — a tee-time arrival can now buy something, which was structurally impossible

**~1 h 30 m of build, ~1 h 20 m of 1× measurement. Mechanism confirmed; one of
the three intents is UNCONFIRMED.**

Confirming last session's analysis: the combined share was not low, it was
**zero by construction.** The entire browse-stop builder lived inside
`if (!toCounter && !walkInRequest)`, so anybody here for a tee time never
received a shopping plan and no probability anywhere could change it.

`buildRetailErrand()` is that block lifted out as a pure builder — it returns a
plan and stops and touches no customer — so the same errand can be built at
spawn and handed over later. A golfer who draws one (`COMBINED_VISIT_CHANCE =
0.45`) carries it as `pendingRetail`; `beginPendingRetail()` splices it in at the
desk-release site instead of the exit. They are already off the desk's list by
then, so a shopper mid-errand cannot reappear as a check-in — which was point 4
of last session's analysis, the one that made this look like a session.

`recordCustomerVisit` gains `countsAsVisit` so a combined visit files a check-in
**and** a purchase without counting one person through the door twice.

### The 1× measurement, and what it does and does not say

**First window — organic, 60 game-minutes at 1× from 10:00, shop OPEN:**

> **3 arrivals. All three retail-only. ZERO tee-time arrivals.**

So the acceptance question has no answer on an organic starter: **M = 0.** A
day-1 club has no booked sheet and the walk-in roll is rare. That is a finding
in itself and it is why the number below is a seeded one.

**Second window — 18 game-minutes at 1×, with tee-time arrivals forced** (the
driver calls the shipped `debugSpawn(false, null, { allowWalkInRequest: true })`;
every other beat — the shopping roll, the desk, the splice — is production code):

| | |
|---|---:|
| arrivals | 8 |
| tee-time arrivals (**M**) | **1** |
| …that drew a shopping plan | 1 |
| …that completed their booking at the desk | 1 |
| …that reached the shop floor afterwards | 1 |
| …that reached the till with goods (**N**) | **1** |
| …that paid | 0 — the driver does not play the till |

**1 of 1.** Before this change it was 0 of any M, by construction. It is a
sample of one and I am not going to dress it up as more.

### The intent I still have not seen

The brief's three intents:

1. **buys + asks for an available tee time** (walk-in) — **confirmed**, this is
   the one measured above.
2. **buys + PRE-REGISTERED check-in** — *"the one I never see"* — **UNCONFIRMED.**
   The code path is the same `releaseReservationCustomer` hook, and the walk-in
   case reaches it by converting to a reservation first, so it is exercised in
   substance. But a customer spawned from a **due reservation record** never
   appeared in either window, so I have not watched that specific arrival do it.
3. **only one of the two** — unchanged and still works (7 retail-only arrivals).

### Two caveats that belong to the harness, not the feature

- The driver's `checkInsServed: 123` is a call count, not a distinct count:
  `releaseReservationCustomer` returns `true` for an already-released customer.
  `checkInsCompleted: 1` is the real number.
- The seed did not take. `C6_SEED` is written to `localStorage`, and in Electron
  saves go through the native bridge — see §7.2. The window ran on whatever
  profile was in `userData`, which was a Day 1 starter, so the shape is right;
  the seed number in the JSON is not meaningful.

**Twenty-minute bar: not yet provable.** A stranger playing twenty minutes of a
day-1 club will see **no tee-time customers at all**, so they cannot see this
feature either way. What that says is that the arrival mix, not the combined
share, is the next thing to look at.

---

## 5 · F1 — the settings menu already exists, and now it is proven to persist

**~35 m. Confirmed.**

Everything the brief asks for is already in `src/ui/settingsPanel.js`: master +
effects + ambience + interface volumes, mouse sensitivity, invert-Y, field of
view, windowed/fullscreen, window resolution, a quality preset and render scale.
Reachable from the main menu and grouped Audio / Camera / Display.

What had never been shown is that it works in Electron and survives a restart.
Measured: two sliders moved (Master 0.8 → 0, then 0 → 1 on a second pass),
written to `golfempire:preferences:v1`, and read back at the moved value after a
reload. Defaults are sane (master 0.8, FOV 66).

- `qa/electron/settings/settings-from-menu.png`
- `qa/electron/settings/settings-after-reload.png`

**Twenty-minute bar: passes.**

*(Housekeeping: this run moves real sliders in the real profile. I removed the
preferences key afterwards so your defaults are back.)*

---

## 6 · D7 — partial, and what I found is bigger than the list

**~40 m. Recorded in `HARNESS_DEBT.md` §6.**

The four raw-`Continue` drivers, the stale `New Empire` sweep, `laptop-tour`'s
economy fixture and the five dead feel keys are **exactly as §4 left them.**
Nothing here touched them. What working Electron-only turned up instead:

### 6.1 No function-file driver in `tools/qa/` has ever run in Electron

Every driver that reaches into the app does `await import('/src/…')`. Under
`file://` a leading slash resolves to the **drive root**, so that line throws
`Failed to fetch dynamically imported module: file:///C:/src/data/shopLayout.js`
— every time, in the shipping runtime. The fix is one edit per driver
(`new URL('src/…', document.baseURI).href`).

`tools/qa/run-electron.cjs` (new) runs any existing function-file inside
Electron, shimming `page.goto` and `page.setViewportSize`. Six drivers use the
correct import pattern; **the rest have not been swept** and should be assumed
browser-only until run.

### 6.2 Seeding a profile through `localStorage` is a no-op in Electron

`localStorage.setItem('golfempire:autosave', …)` is the standard fixture. In
Electron `storage.js` prefers `window.fairwayNative`, so the menu reads the
**native** save and `clickThroughMenu` resumes that. Any Electron run of a
seeding driver measures whatever is in `userData`. Two of this session's own
measurements are affected and are labelled as such rather than quietly fixed.

### 6.3 Five instrument defects, all caught by their own controls

Recorded in full in `HARNESS_DEBT.md` §6.3. The two worth naming here:

- `dist` as a **`Float32Array`** silently kills Dijkstra — the popped f64 cost
  exceeds the stored f32 cost for nearly every node, the staleness guard fires
  on live nodes, and the search reports "unreachable" for a point two yards from
  the door. Caught because the negative control (open floor) also came back
  unreachable.
- The save-robustness file picker matched `autosave-meta.json` before
  `autosave.json`, so the first run mangled the **sidecar** and reported four
  perfect passes.

---

## UNCONFIRMED — shipped, not seen working

| item | why |
|---|---|
| **C6, intent 2** — a *pre-registered* guest checking in and then shopping | The code path is the same `releaseReservationCustomer` hook the confirmed walk-in case goes through, and the suite is green, but no customer spawned from a due reservation record appeared in either 1× window. To see it, the next run has to seed the tee sheet **through the native bridge** (§6.2) rather than localStorage. |
| **F3 asset/audio fallbacks** | A missing GLB or a missing sound is now logged rather than silent, but there is no substitute mesh and no silent-audio path. Not built, so not claimed. |

---

## NOT DONE — with the reason

| item | reason |
|---|---|
| **A8** (its two open parts) | These are D2 and D3 below; A8 has nothing else outstanding. |
| **D2** hand grip anatomy | A modelling job against reference footage — knuckle line, wrist angle, thumb opposition — on `characterAsset.js`'s procedural hand. It needs an art pass, not a fix, and it needs to be looked at repeatedly at 1.85× crop. Not startable in the time left after C5. |
| **D3** tool-filtered dirt reveal | A feature: dirt has to read as three distinct TYPES in world before a tool can filter them. That is its own art pass plus a reveal mode. |
| **C8** lamp teaches itself | A teaching design, not a fix. It wants the F5 list in hand — three of those ten items are the same problem — and a diegetic vocabulary this build does not have yet. |
| **C9** the ledger book | A new physical object, a book UI that opens in place, an event feed and achievement migration off toasts. A session on its own. |
| **D4** material interning | Approved and costed in report 7, still unbuilt. It is a real measurable win (the load is 132 shader compiles) and it is the cheapest of the remaining items. |
| **E2** fix the other tools | One shared extraction (the broom's floor anchor + collider clamp) plus four wirings. Report 7 §3 is the table that says exactly what. |
| **E3** audio per tool | Nine tools × start transient / intensity loop / stop tail / pitch variation, plus surface-responsive contact particles. |
| **F2** key rebinding | **Does not exist at all** — there is no binding table in the codebase, only literal key checks. It is a real feature: a binding registry, a capture UI, conflict resolution, and the `preventDefault` walk verbs that made S1 necessary. |
| **B6 / G1** twelve-file texture pass | Two task entries for one item. Not begun, and neither was its positioning pre-check. Your instruction was that it goes last with a clear run; there was no clear run, and starting a twelve-or-zero block with no time to finish it would have left the tree half-textured. |

---

## Fixed without being asked

1. **`tools/qa/run-electron.cjs`** — the Electron runner for existing QA
   function-files. Without it "Electron only" meant rewriting every driver.
2. **`proshop-greybox-customer-day.js` crash.** C5 deleted
   `corridorWestSeal.returnBackFill`; the day driver dereferenced it for its
   customer-forbidden zones and would have thrown on first use. Re-pointed at
   `hutchGapFill`, with the reason in the comment.
3. **`pineHillsV2Interior.js` west-seal loop** now iterates the layout's own key
   set instead of a hand-listed three, so deleting a fillet takes its geometry
   with it instead of throwing `Cannot read properties of undefined`. That crash
   is how I found out my C5 change had not taken effect — and that I had been
   reading a **stale JSON file** because I suppressed the driver's output.
4. **`recordCustomerVisit({ countsAsVisit })`** — so a combined visit files two
   outcomes without counting two visits.
5. **`clubhouse.frontDeskBridge()`** exposed read-only. Playing the desk is a
   player action and an acceptance run had no way to perform it.
6. **Your audio preferences restored** after the F1 run moved them.

---

## Commits

| | |
|---|---|
| `8fd570b` | C5: you could not stand behind your own till, and now you can |
| `56dad47` | C6: a tee-time arrival can now buy something, which was structurally impossible |
| `1163fc1` | F3 + F4: a crash now goes somewhere, and a mangled save was already safe |

Suite: **2741 pass / 0 fail** at each commit (2729 at session start; +12 new).

---

## What I would take next, in order

1. **D4 material interning.** Approved, costed, unbuilt, and measurable in an
   hour. It is the only remaining item with a number attached to it.
2. **E2 items 1–3.** One extraction, four tools, and it removes the two worst
   rows of report 7 §3's table.
3. **The Electron driver sweep** (§6.1). One edit per file, and until it is done
   every "verified" in reports 4–7 means "verified in Chrome".
4. **F2 key rebinding.** The largest genuinely-missing player-facing feature in
   the queue, and the only one in Queue F that a stranger will actively look for.
