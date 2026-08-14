# OVERNIGHT REPORT 26

## 1. Perception ratio

**7 / 7.** Every fix claimed below was verified by a check that could perceive
the thing it certified — audio-graph voices with measured dBFS on the live master
bus, the gain node itself for the drone, and voice counts per real press for the
menu. None was certified by a source assertion or a call count alone.

The one that matters most: a cue is credited only when the buffer that started
carries `__fwSample`, the tag `sampleBank` puts on a decoded vendored file. A
gate that merely counted `BufferSource` starts would have scored **perfectly on
the oscillator build** — the synth voices being replaced are themselves
filtered-noise buffers — so it would have certified the exact absence it existed
to detect.

## 2. Probe-lie count: **6**

Checks I wrote that scored the same before and after, or measured the wrong
object. All six were caught by looking at a number that disagreed with something
else I knew.

| # | The probe | What it reported | What was actually wrong |
|---|---|---|---|
| 1 | `electron-phase1-audio-gate` run 1 | `sampledCues: []` with 50 files loaded | `measure()` cleared the buffer-start log *after* the cue fired, wiping its own evidence |
| 2 | `electron-startup-noise` | `minuteOfDay: null`, "no drone" | read `state.golfDay.minuteOfDay`; the clock is `state.clock.minutes` (shape 10 — null is indistinguishable from the dawn hour it hunted) |
| 3 | `electron-startup-noise` | no drone after the veil | sampled after `walk.isActive()`, minutes of game time after "on load", with the QA boot standing the player **indoors** where the gate is shut by design (shape 11) |
| 4 | `electron-menu-click-inventory` run 1 | every control silent | spy attached to `qaContext()` on a fixed timer, before the context existed — "not watching" and "silent" produced the same number (shape 10) |
| 5 | `electron-menu-click-inventory` run 2 | every control silent | clicked by raw coordinates on a **devicePixelRatio 1.5** display; the press landed off the button and arrived with target `DIV`, no button ancestor |
| 6 | `electron-menu-press-trace` | `oscs: 0, buffers: 0` | same null-context spy as #4 |

Worth its own line, because it is a new shape and it is now in `FOUND_FALSE.md`:
in #5, `document.elementFromPoint` at the very same coordinates still answered
`BUTTON.menu-action`. It answers **geometrically** and knows nothing about where
the press actually went. The instrument that is supposed to catch "visible but
not painted" manufactured a false negative about a click.

## 3. Phase status

| Phase | Status |
|---|---|
| **1 — Audio** | **GATE PASSED** — see §4 |
| 2 — The walk-up | not started |
| 3 — NPC navigation | not started |
| 4 — Time and bookings | not started |
| 5 — Mop and hands | not started |
| 6 — Ledger UI | not started |
| 7 — Performance | not started |
| 8 — Global Escape | not started |
| 9 — The remainder | not started |
| 10 — Final verification | not started |

## 4. Audio table

**There is now audio in this repository.** 50 files, 24 cues, 891 kB, every one
CC0. Three briefs stalled on a blocker recorded in `Assets/audio/CREDITS.md` as
"Freesound downloads need an API key nobody created". That is true of the
*original* file and false of the *sound*: freesound.org serves its search pages
and CDN previews with no credential, and a preview is a lossy transcode **of the
same work under the same licence**. Under CC0 a derivative carries no
restriction at all.

Measured in Electron on the master bus, post-volume
(`tools/qa/electron-phase1-audio-gate.js`, `qa/electron/phase1-audio/`):

| cue | peak dBFS | file played | source | licence |
|---|---|---|---|---|
| `drawerUnlock` | −17.6 | `drawer-unlock-2.ogg` | freesound 452572 (kyles) | CC0-1.0 |
| `drawerOpen` | −11.8 | `drawer-open-2.ogg` | freesound 217173 (lolamadeus) | CC0-1.0 |
| `billDeposit` first note | −16.8 | `bill-deposit-1.ogg` | freesound 379888 (13GPanska_Markova_Lucie) | CC0-1.0 |
| `billDeposit` deep pile | −19.7 | `bill-deposit-2.ogg` | freesound 461890 (15FPanska_KristynaHaupt) | CC0-1.0 |
| `coinDeposit` empty well | −13.0 | `coin-empty-1.ogg` | freesound 391951 (ssierra1202) | CC0-1.0 |
| `coinDeposit` deep pile | −15.1 | `coin-pile-1.ogg` | freesound 788073 (Mediasaur) | CC0-1.0 |
| `coinSettle` | −21.9 | `coin-settle-1.ogg` | freesound 391818 (Alexbuk) | CC0-1.0 |
| `drawerClose` | −11.0 | `drawer-close-1.ogg` | freesound 217173 (lolamadeus) | CC0-1.0 |
| **`cashRun` (looping)** | **−17.9** | `cash-run-1.ogg` | freesound 861806 (mcbabayaro_57) | CC0-1.0 |
| `ledgerOpen` | −14.0 | `ledger-open-2.ogg` | freesound 263120 (MrRadtastic) | CC0-1.0 |
| `ledgerTurn` | −14.6 | `ledger-turn-4.ogg` | freesound 856497 (xkeril) | CC0-1.0 |
| `ledgerClose` | −11.4 | `ledger-close-1.ogg` | freesound 862315 (qubodup) | CC0-1.0 |
| `uiTick` | −15.6 | `ui-tick-1.ogg` | kenney.nl Interface Sounds | CC0-1.0 |
| `uiConfirm` | −15.8 | `ui-confirm-2.ogg` | kenney.nl Interface Sounds | CC0-1.0 |
| `uiCancel` | (one voice) | `ui-cancel-1.ogg` | kenney.nl Interface Sounds | CC0-1.0 |
| **CONTROL** silence | −37.8 | — | **0 starts** | — |
| **CONTROL** synth doorbell | −28.5 | — | audible, **0 sampled** | — |

Full provenance for all 50 files — title, creator, source page, date obtained,
conversions performed — is in **`THIRD_PARTY_ASSETS.md`** and
`Assets/audio/CREDITS.md`, both **generated from the manifest** so they cannot
drift from the files. `tests/audio-sample-licences.test.js` fails the build on a
sample missing a licence, a source, or a required attribution.

The silence floor reads −37.8 dBFS rather than true silence because the music
loop is playing underneath, which is what 1.5 asks for. On the earlier run,
before music existed, that control read exactly 0.

### The licence gate fails closed

`tools/audio/freesound-fetch.mjs` does **not** trust the search facet — a query
parameter is not evidence, and the brief's refusal list names "a preview file
whose download carries a different licence". It fetches each sound's **own page**
and parses its licence link, refuses NonCommercial / ShareAlike / Sampling+ **by
name**, and refuses a sound whose page will not load, because "I could not read
it" must never resolve to "it is fine". 25/25 came back CC0-1.0.

## 5. Performance table

Not measured this session — Phase 7 has not started. The audio work adds 891 kB
of vendored OGG decoded once at context creation (menu time, off the first user
gesture, before any gameplay frame exists), which is what keeps 1.7's "no
synchronous fetch or decode during a door crossing, a page turn, a payment or a
menu click" true without a special case.

---

# PHASE 1 — ITEMS

## 1.0 Source the files — **DONE**

**Files changed:** `tools/audio/freesound-fetch.mjs`, `slice-events.mjs`,
`describe-slice.mjs`, `build-audio.mjs`, `write-credits.mjs`, `ffmpeg-path.mjs`,
`cue-plan.json`, `recipe.json`, `Assets/audio/*` (50 files + manifest + credits),
`THIRD_PARTY_ASSETS.md`.

**I cannot hear these files**, so nothing was assigned by assumption. The best
drawer recordings are compilations — "cash register old antique open close drawer
with bell ring various" is 2m36s holding ~30 separate actions — and a compilation
gives up its events but not their names. `describe-slice.mjs` measures each
candidate span's peak, attack, decay, sustain fraction and spectral centroid,
which separates a bell from a thud from a slide:

- The **drawer** picks are the loud ~0 dB spans of the metal till recording,
  whose ~500 ms swell into a hard transient is the drawer running out to the end
  of its travel. The quieter, brighter spans either side are it being pushed back
  in.
- The **first-coin** picks have a 12–20 ms attack and a ~500 ms decay over wood —
  a coin into an empty well. `coin-drop-with-coins` is a coin landing on coins.

Every slice is trimmed to its onset, peak-normalised to a stated target, given
fades short enough not to soften the transient, and encoded once. **The peak in
the manifest is measured off the shipped file**, so it cannot drift from what
plays.

**Commit:** `64e2d5f` · pushed.

## 1.2 The money — **DONE**

**Symptom:** the drawer was silent and the money "sounded like nothing".

**Root causes, three of them:**

1. Every cue in `audio.js` was a one-shot, so eight notes into a drawer fired
   eight impacts with silence between them. There was no continuous run at all.
2. The pile-depth effect was a `playbackRate` tweak, which **cannot** produce it:
   rate moves pitch and drags duration with it, while a coin on bare wood and a
   coin on a heap differ in decay and across the whole upper spectrum.
3. **The auto-deposit path was entirely silent.** The only deposit sound in the
   build was on the hand-dragged route through `settleTenderDrag`. Taking a
   customer's cash normally goes through the animated path, so the commonest way
   money enters the drawer had no landing sound.

**The run** is one sustained looping voice whose lifetime the caller owns, and it
is **derived from the animation every frame** in `updateCashMotions` — "is a
piece actually in the air right now?" — rather than started and stopped at call
sites. That choice *is* the cancellation story: a start/stop pair spread across
the accept, cancel, reset and leave paths is how a looping voice outlives its
transaction and sticks on, whereas the motion list has one answer and every
interruption already clears it. Pieces still waiting out their stagger delay do
not count, so the run starts when money is actually moving. It loops **inside**
the recording (a tenth trimmed off each end) because the head and tail of a
riffle are the hand arriving and leaving.

**Verified stopping, not just starting:** `cashRunActive` true while up, false
after stop, and the window after the stop reads 0 buffer starts.

**Files changed:** `src/core/audio.js`, `src/core/sampleBank.js`,
`src/render3d/clubhouse/simplifiedRegisterMode.js`.
**Commit:** `f645e7d` · pushed. Suite 3637/3637.

**Caveat:** the cues above were fired through the production audio surface. A
full customer transaction driving them end-to-end is Phase 2 verification work
and has not been run.

## 1.3 The ledger — **DONE (sounds), see caveat**

`ledgerOpen`, `ledgerTurn` (6 variants), `ledgerClose`, `ledgerPickup` all play
real hardback-book recordings at −11 to −14 dBFS. Variants are round-robined with
bounded pitch and gain jitter, and all are decoded at load, so first use does not
hitch.

**Caveat:** measured by firing the cue, not by turning a page in the book with a
key press. The gesture-level check belongs with Phase 6's ledger work.

## 1.4 The menu — **DONE**

`tools/qa/electron-menu-one-sound.js`, in Electron, on the live graph:

| press | voices | cue | file |
|---|---|---|---|
| Settings (opens a dialog) | **1** | `uiTick` | `ui-tick-1.ogg` |
| settings tab: Camera | **1** | `uiTick` | `ui-tick-2.ogg` |
| settings tab: Display | **1** | `uiTick` | `ui-tick-2.ogg` |
| settings tab: Camera (**keyboard**) | **1** | `uiTick` | `ui-tick-2.ogg` |
| Done | **1** | `uiTick` | `ui-tick-3.ogg` |
| Credits (opens a dialog) | **1** | `uiTick` | `ui-tick-3.ogg` |
| Back out of Credits | **1** | **`uiCancel`** | `ui-cancel-1.ogg` |
| **DISABLED** "Continue" | **0** | — | — |
| **idle control** | **0** | — | — |

**The defect underneath was two populations.** `window.__fwUiClick` was installed
inside `startGameNow()`, so at the menu it **did not exist** — measured,
`sinkExists: false`. Menu presses were served by a second, independent handler in
`menu.js`. The trace showed the cost: the first press of a session called
`uiTick` once and **the second press called it zero times**, because `menu.js`'s
listener is removed and re-added around visibility changes and the global sink
that should have covered the gap was not there yet.

The sink is now installed at UI construction, idempotently, so one rule covers
the menu, every dialog and the game. Then the two populations *fought*:
`menu.js` also spoke, called `uiTick` first, and the sink's `uiCancel` lost the
120 ms press window — "Back out of Credits" reported `cancelCalls: 1` and still
played the plain tick. `menu.js` now delegates the sound and keeps only
`audio.init()`, which must stay first because a context can only be created from
a user gesture and that press is the first one.

**I also weakened this myself and caught it.** Adopting samples put `sampled()`
at the *top* of `uiTick`, so the recorded click returned **before** the 120 ms
guard and fell back on the bank's 20 ms gap — short enough for one press to speak
twice. The guard now runs first.

`tickCalls: 3` against `voices: 1` is expected: three handlers legitimately see
one press and the press window collapses them. Both numbers are reported so the
difference is visible rather than assumed — 1.4 asks for one **sound**, not one
call.

**Commit:** `7bb9377` · pushed.

## 1.5 Background music — **DONE**

One voice, created once, started from the single moment the bank finishes
decoding — **outside every screen's lifecycle**, because "not restarting on scene
transitions" is a lifetime requirement and anything started by a *screen*
restarts on every transition. That is the same mistake as the A2 menu bug (a
handler attached inside `setVisible(true)` on a menu born visible).

**Verified as a lifetime claim, not a loudness one:** elapsed **23.31 s → 24.53 s
across a redundant `musicStart()`** — it grew rather than resetting, so the
second start was a no-op and not a restart. A level meter cannot see that.

It rides a dedicated `musicBus` at 0.34 of the ambience slider, which puts it
**under** the effects and UI buses rather than merely quiet in absolute terms;
mute is inherited from the shared master. The loop uses the **whole** buffer,
because the recording is an authored loop — trimming the edges, correct for the
cash run, would cut the musical phrase and put a click where there is none.

## 1.6 Kill the startup noise — **DONE**

**The source:** `audio.js` ran two detuned sawtooths at 92 and 95.5 Hz through a
low-pass, gated on `minuteOfDay >= 300 && <= 420` — the 5–7 AM mowing shift, held
open continuously for the whole two hours. **The boot clock measured 360.45**, so
a new game starts at 06:00, an hour inside that window. Outdoors, the first thing
a new player heard was an unbroken two-hour tone at mower pitch. 1.5 names "mower
timbre" as the thing background audio must never be, and this was that timbre,
running as ambience.

**Watched failing, then passing**, on the gain node the player actually hears:

| build | duty cycle | first audible | reads as drone |
|---|---|---|---|
| unfixed | **1.000** | 0.00 s | yes |
| fixed | **0.247** | 25.25 s | no |

380 samples over 100 s outdoors at 06:00, all 380 inside the mowing window on
both builds, so the two were measured under identical conditions. Revert done by
file copy (never `git stash`) and **asserted to have changed the file** — 17
lines differed.

**The fix is not a volume change, and the numbers say so: max gain is 0.04997 on
both builds, unchanged.** A real mower is not a drone, it is a machine that
passes, so the gate opens for 7–13 s passes separated by 40–90 s gaps, with a
25 s settle so nothing sustained can begin on the load frame. Mowing still
happens on the early shift and is still inaudible indoors.

**Commit:** `3069aca` · pushed.

## 1.7 Audio performance — **DONE**

One shared context (`qaContext()` returns the same object the game plays into —
the gate would have measured a different graph otherwise). Each file decoded
exactly once at context creation: **50 loaded, 0 failed**. Buffers are pooled in
the bank and handed out by reference; variants round-robin. Decoding happens at
menu time off the first user gesture, before any gameplay frame exists.

## 1.8 The paperwork — **DONE**

`THIRD_PARTY_ASSETS.md` (repo root) carries local filename, source page, original
title, creator, licence, required attribution, conversions performed and date
obtained for all 50 files. `Assets/audio/CREDITS.md` carries the same by cue and
by source recording. **Both are generated from the manifest** by
`tools/audio/write-credits.mjs`, because a hand-maintained licence list drifts
the moment a file is re-cut, and a drifted licence list is the one mistake in
this phase that is not fixable after shipping.

Normalise / trim / fades / no clipping: all four are applied in
`build-audio.mjs`, and the report reads them back **off the outputs**. No shipped
file peaks above −1.0 dBFS.

---

# PHASE 1 GATE — RESULT

**PASSED.**

- Every cue plays a **vendored recording**, named by file, at an audible level.
- Every cue fires **exactly once** (`starts=1, sampled=1` throughout).
- **Both controls hold**: an idle window records 0 starts; the synth-only
  doorbell is audible at −28.5 dBFS and credited `sampled=0`, which proves the
  discriminator is discriminating and not just counting noise.
- Bank: **50 loaded, 0 failed.**
- Suite **3637/3637**, lint ratchet **323** (unchanged, shrink-only direction
  respected).

**What the gate does not cover, stated plainly:** the money cues were fired
through the production audio surface rather than by running a customer through a
complete cash transaction. That end-to-end check is Phase 2 work and is listed
there, not claimed here.
