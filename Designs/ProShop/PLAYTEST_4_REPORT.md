# PLAYTEST 4 — WHAT I DID, WHAT I MEASURED, AND WHAT I DID NOT FINISH

## Probe-lie count this round: **6** (running total **37**)

| # | the instrument | what it claimed | what was actually true |
|---|---|---|---|
| 32 | `electron-audition-winners` control | the cue went SILENT when a deleted option was pinned | `audio.sfxPlay` does not exist on that module, so nothing had been asked to play at all |
| 33 | `electron-mop-carry-stillness` | four acts of tip-motion statistics | `walk.setTool` is DEBOUNCED and returns nothing; the mop was never equipped and the run measured a rig nobody was holding |
| 34 | the new item-4 layout test | it graded the layout against a bigger keep-out | it picked goods by `sizeClass === 'compact'`, selected NOTHING, and compared two empty arrays while its own length assertion passed trivially |
| 35 | the same test, next version | modelling the real bag by growing `maxX` | the pose frame is MIRRORED with respect to REGISTER x (the same trap as lie 30), so the far edge grew AWAY from the goods and the leftmost item did not move at all |
| 36 | `electron-player-nudge` staging | a customer was placed inside the player | writing the customer MESH's position does not stick — it is re-driven from the customer's own state every frame — so the first sample read 0.72 yd, which is where they already were |
| 37 | `clip-frames` on the mop clip | I viewed the run's frames | `VIDEO_DIR` held TWO webm files from two runs and the tool takes the first; the tile sheets I read were the menu and the loading screen |

---

## Where each item stands

| item | state |
|---|---|
| 1 — the audition results | **DONE**, and the reason you were not hearing the defaults is fixed |
| 2 — register timing | **DONE**, all three complaints measured before and after |
| 3a — remodel the mop head | **HALF.** Three changes confirmed on the live objects; NOT photographed |
| 3b — stop the strands moving | **DONE**, swept and measured in the running game |
| 4 — items through the bag | **DONE.** Reproduced at 0.1375 yd, fixed to 0.000 |
| 5 — my body blocks them | **PARTIAL.** Predicate re-checked, shove made gentle; separator NOT observed firing |
| 6 — NPCs on the line | **NOT REPRODUCED.** Natural scenario built and run; caught a rung-4 jam of the wrong shape |
| 7a — the rake | **ROOT-CAUSED, NOT FIXED.** There is no rake in the tool registry |
| 7b — `deskAction('exit')` | **DONE**, watched on the driver that found it |
| 7c — the `sale-refused` storm | **DIAGNOSED, NOT FIXED** |
| 7d — the stranger | **NOT STARTED** |
| 7e — the static mesh merge | **NOT STARTED** |

---

## 1. The audition — and why the defaults were never reaching you

Your four winners are applied: **felt tap, wood drawer deep, paper money, book
close.** The 33 losing files are deleted from disk, struck from the recipe AND
struck from the shopping list, with a reason recorded per recording in
`cue-plan.json`'s `_rejected` block. `tests/audio-rejected-options.test.js` reads
that block back and fails if any of them returns to the plan, the recipe, the
manifest or the disk — watched fail on a deliberate re-vendor, restored by file
copy, watched pass.

**But the defaults were decorative.** `normalizePreferences` built `audio.sfx`
from the incoming object alone — the one field in that function with no fallback
to `DEFAULT_PREFERENCES`. Every fresh profile normalised to `{}`, no pin was ever
applied at boot, and each cue drew **at random** across its whole family. Measured
in Electron before the fix: all seven families `current: NONE`, and firing
`drawerOpen` played `drawer-open-2.ogg`. That means the provisional set last
session put in front of you was not what you were hearing either.

After the fix, off the live audio graph, peak computed from the PCM rather than
copied from the manifest:

| cue | file | peak | length |
|---|---|---|---|
| uiTick | `opt-felt-tap-tick.ogg` | −14.01 dB | 0.181 s |
| uiConfirm | `opt-felt-tap-confirm.ogg` | −11.03 dB | 0.181 s |
| uiCancel | `opt-felt-tap-cancel.ogg` | −15.99 dB | 0.181 s |
| drawerOpen | `opt-drawer-wood-deep.ogg` | −7.48 dB | 1.308 s |
| ledgerClose | `opt-close-book.ogg` | −7.01 dB | 1.104 s |
| uiError | `ui-error-warm-1.ogg` | −15.05 dB | 0.263 s |

**One more synth beep found and killed.** `uiError` never asked the sample bank at
all: `ui-error-warm-1.ogg` was fetched, decoded and shipped while you heard two
triangle oscillators at 260 and 220 Hz. Zero buffer sources on the graph when it
fired. That is the sci-fi character the P0 was about, hiding behind a cue nobody
had checked.

**Ten new candidates** for the two families you rejected — five page turns, five
pickups, all CC0, all in `THIRD_PARTY_ASSETS.md`, all in the picker. Spans chosen
from `describe-slice --events` on each recording, so the slice is the page and not
the cover slamming. Both families ship **unpinned**: you have not heard these, and
picking one for you is the guess the switcher exists to avoid.

**NOT DONE:** the Book Store Simulator reference. I cannot hear it and cannot
obtain it.

**Also found, not fixed:** `ui-open-warm-1.ogg` and `ui-close-warm-1.ogg` have no
call site anywhere in `src`. Two vendored recordings that nothing can play.

---

## 2. The register's timing

Measured on a real cash sale — three items rung up with real clicks, the tender
clicked off the desk, the animation side read from the register's own
`STOWING CASH` status rather than from a stopwatch in the driver.

| | before | after |
|---|---|---|
| drawer slide → first cash | 1.720 s | **0.619 s** |
| drawer unlock → first cash | 2.179 s | **0.971 s** |
| the run outlives the last piece | 0.000 s | 0.000 s |
| the last landing's sound tail | 0.520 s | **0.295 s** |
| clicking change out of the till | **silent** | `change-lift-3.ogg`, −9.7 dB |

**The run was never the problem.** It dies on the same frame as the last piece
lands. What runs past is the per-landing one-shot: `bill-deposit-2` was 0.509 s of
paper starting AT the landing, and the cashLand winner you picked was a full
second. Every landing cue is re-cut to end inside the 0.44 s fly. Your paper-money
*recording* is unchanged — only the span.

`drawerOpenSequence` now returns the **cash entry point** (the slide's attack plus
0.20 s) instead of the moment the drawer finishes speaking. I changed
`electron-drawer-sequence`'s assertion on purpose rather than working around it.

---

## 3. The mop

**3b is done and damping was never going to do it.** Swept against a 140°/s
look-around before touching anything:

```
damping    0.92    0.95    0.97    0.985   0.995   0.999
look (yd)  0.0953  0.0899  0.0890  0.0925  0.1004  0.1023
```

It barely moves, and above 0.985 it gets worse. The swing is not the yarn keeping
velocity — it is the **anchor travelling on an arc** while the tips stay put. So
there is a new mechanism, `rigidity`: the head's frame-to-frame transform applied
to the nodes themselves, both `p` and `q` so no velocity is injected.

```
rigidity   0       0.5     0.8     0.9     0.94    0.97    1.0
walk (yd)  0.0864  0.0549  0.0246  0.0125  0.0076  0.0038  0.0001
look (yd)  0.0953  0.0694  0.0712  0.0338  0.0233  0.0128  0.0001
mopping    0.1402 in EVERY row — ACTIVE_FEEL.rigidity is 0
```

Shipped at **0.97**. Measured in the running game with the mop confirmed equipped:
looking around swings the tips 0.0001 yd, walking 0.0106 yd.

I updated the test rather than working around it, as you asked: *"moved sideways
the yarn trails behind"* now names its mode, and a new test asserts the carried
half at 0.012 yd with mopping still 3× larger.

**3a is half done and I could not photograph it.** Three changes, all confirmed
present on the live objects: the yarn was `0x8f8a80`, a **mid grey**, now
`0xe9e5db` read back off the live material; a hem bead per strand
(`MopVerletTips`, 972 instances, visible) so the strands end in a fold; and a
microfibre pad under the hub closing the hole in the middle. **The mop never
appeared in a single frame of two runs**, while diagnostics reported it equipped —
both runs were sitting on tutorial step 2/19. So the loops/disc reading is **not
confirmed by eye**.

Method, since you asked: the head is **not** a GLB. It is generated at runtime and
simulated per frame, so a Blender mesh could not be the thing that moves. It is
generated directly, in `src/render3d/mopVerlet.js`.

---

## 4. Items through the bag — you were right

**Reproduced first**, on real geometry, with a real customer:

```
FrontDeskShoppingBag  vs  CheckoutProduct_tees1
penetration 0.1375 yd, on every one of 160 samples
isTransactionItem: true, hasPlacedAt: true
```

**Why the check passed and the game did not.** The layout was keeping out of
`REGISTER.bagging` and doing it correctly: `tees1` landed at local x 2.5687 with a
half-width of 0.0687, so its near edge sat at 2.500 against the rect's maxX of
2.48 — clear by exactly the 0.02 it was given. **The rect is the handoff zone, not
the bag:**

| | |
|---|---|
| `FrontDeskShoppingBag` | **0.54 × 0.45 yd** |
| `REGISTER.bagging` | 0.40 × 0.24 yd |

35% too narrow and 86% too shallow. Playtest 3's check compared the layout's poses
against the same rect the layout had just been handed, so it could only ever
confirm the layout agreed with itself.

**The fix is read off the bag**, not a bigger constant: the register measures its
own bag group (all eight corners transformed) and both set-down paths use it.
A second, smaller error underneath: with the keep-out finally correct there was
still 0.0104 yd, because the packer reserves `footprintW` and the renderer draws
about 0.030 yd wider. `BAG_CLEARANCE` 0.02 → 0.06.

```
0.1375 yd  ->  0.0104 yd  ->  0.000 yd
203 consecutive samples with ZERO intersections, detector proved on the same run
```

---

## 5. Being walked into

**The predicate has not regressed.** `playerBlocksCustomers()` is derived every
frame, not latched, and returns false in exactly four states: register active,
ledger carried, ledger open, laptop or desk screen open. Ordinary walking is TRUE,
and all three enforcement points ask the same one predicate.

**What I did find** is the new half of your report. The settle clamp placed a
customer at 0.72 yd **in one frame** — "nobody stays inside anybody" satisfied by a
snap, which is the teleport you ruled out seen from the other side of the camera,
and it gets there before anything gentler can contribute. Both are changed: the
clamp keeps its target and caps the rate at 0.028 yd/frame (~1.7 yd/s), and the
player gets their own gentle separation at 0.62 yd clearance and 1.1 yd/s, refused
if the step would push the body through the shell.

**Not proven:** the separator firing. The fixture customer stops 1.96 yd away and
never comes closer, and staging the overlap by writing the customer mesh's
position does not stick. Verified **quiet** when nobody is inside the player
(0 nudge frames across 4 s); **not verified** firing.

---

## 6. The queue jam, from ordinary play

Nothing was sent anywhere: shop opened, organic walk-ins ON, clock at the game's
own fast-forward, player parked well away from the counter, six wall-clock minutes.
A jam is defined from the game's own stuck ladder, and each stuck event records how
many queued bodies lie in the corridor between the walker and its target.

| | |
|---|---|
| customers seen | 3 |
| peak queue | 3 |
| stuck events | 1 |
| highest escalation | **4** (the game admitting it could not get there) |
| abandonments (rung 5+) | 0 |
| **jams behind the queue** | **0** |

The one jam: `q2`, moving 0.0125 yd/s with 6.776 yd to go, on rung 4, with nobody
queued between it and its stop. **Not the shape you are reporting.** With three
shoppers the "target behind the line" geometry never arose. The instrument
discriminates: the naive rule "body did not move" fires 734 times across the same
286 samples against this rule's 1.

**The tool question.** Recast is *already* the production router —
`src/render3d/clubhouse/recastNav.js` bakes the interior during loading and serves
customer paths with a fail-soft fallback. The gap is what that file's own header
says it deliberately does not do: standing queue bodies are **dynamic** obstacles
and the static navmesh knows nothing about them, so a shopper's path is planned
straight through the line. My recommendation is **Detour's crowd/obstacle-avoidance
layer on the bake that already exists**, not a replacement — the bake, the query
surface and the fallback are built and proven, and a second library would mean a
second bake of the same geometry. I have not started it, because building crowd
avoidance against a jam I cannot reproduce is how the last two rounds of this item
were closed wrongly.

---

## 7. The leftovers

**7b — DONE.** Two faults stacked: `leave()` returns early when the register is
already inactive and `handleMonitorAction` returned true regardless; and the desk
screen's hotspot list **survives the register closing**, so with the player nowhere
near the desk every row still read as hit-testable. Watched on the driver that
found it: `{"id":"exit","ok":true}` ×25 became
`{"id":"exit","ok":false,"reason":"register-not-active"}`.

**7c — DIAGNOSED, NOT FIXED.** The storm is named exactly. From your live
`crash.log`, 18 occurrences, repeating every ~0.6 s:

```
renderer:checkout.refused.sale-refused
  Error: The pending checkout reservation target disagrees with its ticket.
    at reportRefusal        simplifiedRegisterMode.js:8253
    at finalizeTransaction  simplifiedRegisterMode.js:8326
    at Object.update        simplifiedRegisterMode.js:10127   <- PER FRAME
```

`finalizeTransaction` is attempted from the register's per-frame `update()`, the
settlement refuses at `reservationTargetMatchesTicket`, and nothing clears the
pending state — so it retries forever. That is a sale that can never complete, and
it is the same family as the checkout refusals you have reported before. The
codebase already has `lastReservationTargetMismatchClause()` to name *which* clause
disagrees; the entries in your log predate it, so the next step is one run with a
build that emits the clause.

**7a — NOT FIXED, but the hunt moved a long way.** Two items stalled on "the tool
does not appear in the picture", so I asked the scene instead of guessing
(`tools/qa/electron-tool-draws-at-all.js`). It splits the four candidate causes —
a group left invisible, a group visible but parked elsewhere, a rig that never
built, and a camera pointed the wrong way:

| tool | in scene | visible | hidden ancestor | child meshes | distance to camera |
|---|---|---|---|---|---|
| mop | yes | true | none | 92 | 0.67 yd |
| broom | yes | true | none | 89 | 1.51 yd |
| rake | **no `Tool_rake`** | — | — | — | — |

So the mop was **never suppressed**: it is in the graph, visible, unhidden, with 92
meshes two feet from the camera. My screenshots simply did not have it in frame,
and blaming the tutorial would have been wrong.

The rake is the interesting one, and the diagnosis is now specific:

- **There is no `rake` in `CLEANING_TOOLS` at all.** The registry holds washer,
  vacuum, mop, broom, dustpan, spray, cloth, sponge, trashbag. So no `Tool_rake`
  group is ever built by `buildToolViewmodels`, which is why `walk.setTool('rake')`
  reports success for a tool the viewmodel system has never heard of.
- Its held group exists anyway: `courseScene` hand-creates
  `heldGroups.rake = new THREE.Group()` alongside hose, divot and washer, and only
  the washer is given a name. So "no `Tool_rake` in the scene" is true AND the rake
  still has a group — a distinction worth stating, because the probe could
  otherwise read as "the rake does not exist".
- `GRIPS.rake` DOES exist in `fpHands` (a grip and a **support** hand, both
  `wrap`), so both hands are placed. But `toolViewmodels.gripsFor('rake')` returns
  nothing (no registry entry), so the authored sockets are null and the hands fall
  back to offsets authored in a different frame, while the rake's model sits at
  `[0.42, -0.6, -0.95]` with its own rotation.

**That is the shape of the photograph**: one hand gripping the shaft correctly and
one hand floating, because only one of the two is being placed against geometry
that is where its offsets expect. The next step is to give the rake a registry
entry with real sockets, not to move the model.

**7d, 7e — NOT STARTED.** No work was done on them and I am not going to imply
otherwise.

---

## Gate state

Suite **3679 / 0**. Lint ratchet **323**, unchanged. Every item pushed as its own
commit.
