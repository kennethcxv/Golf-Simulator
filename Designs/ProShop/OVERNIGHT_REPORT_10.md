# Overnight report — 2026-08-04 (session 10)

**Filename.** `_10`, following `_9`. `OVERNIGHT_REPORT_2.md` is still the S-series
session's own record and overwriting it would destroy that; same call as the last two
sessions, logged rather than asked.

**Suite: 2748 pass / 0 fail.** Working tree clean apart from generated QA artefacts.

---

## 1. RECONCILE THE COUNT

You are right that the numbers do not add up, and the reason is that **I was counting
work items and the queue counts parent task IDs.** They are different units and I mixed
them without saying so. Here is the reconciliation.

### The queue's own arithmetic — which is correct

Tasks are #58–#148 = **91 total**, and that has not changed. At the start of session 9
there were 77 completed and 14 open; at the end, 82 and 9. **Five entries moved**, and
they were:

| # | item | what actually happened |
|---|---|---|
| 133 | D2 hand grip anatomy | genuinely new work, completed |
| 134 | D3 tool-filtered dirt reveal | genuinely new work, completed |
| 65 | S7 the report itself | the report |
| 135 | D4 material interning | **bookkeeping** — delivered in session 8, entry was stale |
| 142 | F1 settings menu | **bookkeeping** — delivered in session 8, entry was stale |

So at parent-task level, session 9 delivered **two** new completed tasks, plus the
report, plus two stale closures. That is the honest number and it is much smaller than
the report's shape implied.

### Where "13 + 1 + 15 = 29" came from

Nothing in the queue. It is what you get by adding up the *narrative* units across the
last two reports: session 8's "six complete, one partial, eleven not started" over its
18-item reading, session 9's six-plus-one, A8's four sub-items counted separately (which
you asked for, correctly), and the five unasked-for fixes in §"Things I fixed that you
did not ask for". Sub-items, letter-coded items, bookkeeping closures and volunteered
fixes were all being called "items" in the same sentence.

**The rule I should have been applying, and will from here:** report the parent-task
number first and unqualified, then break out sub-items underneath it. A8 is one task ID
whatever its sub-item count; closing a stale entry is not delivery.

### Restated at parent-task level

Session 9, in queue terms: **#133, #134 completed. #65 report. #135, #142 closed as
already-delivered. #112 (A8) and #138 (D7) left open** — correctly, as §3 below shows for
A8. Total 77 → 82 of 91.

**This session (10):** #120 reopened and closed again (C2 round 2), **#126 (C8) completed**,
**#140 (E2) completed**, **#138 (D7) advanced** — the constant audit is done and 3 of 11
instances are fixed, so it stays open. #112 (A8) still open on the sleeve sub-item.
Expected end state: **84 of 91**, with 7 open.

---

## 2. C2 RE-VERIFIED VISUALLY — and yes, it read as broken

**Commit `334336e`. Meets the bar: yes, now.**

Your instinct was right and the number was fine. I recorded the pan after the fix
(`VIDEO_DIR` support added to the Electron runner for this — some acceptances are about
motion and the runner could only produce stills) and read it as a flip-book of ten stills
across 0 → +1.35.

**The head number is perfect over the real range**: `headAboveFloor` = 0.600 at every
stop from level to full up-look, total lift **0.000 yd**. That part of C2 holds.

**The frame was wrong.** The hands sit at NDC y **−0.953** at level — one twentieth of the
frame off the bottom edge. So the moment the reach cap began pulling them down they left
the view, while the handle *above* them, being long, did not. At **+1.00 rad the screen
showed a brown stick floating in front of the ceiling with nothing holding it**, and it
did so across roughly 0.30 rad of up-look. Screenshot: `qa/electron/broom-c2/` (the
pre-fix state is `pan-06-p1p00.png` in the first run; the artefacts have since been
overwritten by the fixed run, so the honest record is this description plus the numbers
below).

Precisely: the cap engages at +0.746 rad; at +0.90 the upper hand is at −1.034 (just
outside) while the handle is still on screen; at +1.35 the cap has spent 0.381 yd.

**The fix.** The cap descends only as far as *reach* requires. It now keeps descending
past that, so the handle leaves with the hand — which is what a tool you cannot currently
use should do, and what every first-person game does rather than freezing it. Measured
after:

| pitch | what is on screen |
|---|---|
| ≤ +0.80 | hand and handle together at the bottom edge (`pan-04-p0p80.png`) |
| +0.90 | frame clean — both gone (`pan-05-p0p90.png`) |
| +1.00, +1.35 | frame clean (`pan-06`, `pan-09`) |

Nothing at or below +0.746 rad moves at all — the entire working range is bit-identical.
`headAboveFloor` is still 0.600 across the whole sweep, so the fix costs nothing it was
bought with.

**Screenshot at +1.0 rad as asked:** `qa/electron/broom-c2/pan-06-p1p00.png`.

**Answering the question you actually asked** — do the hands read as detached? No, and it
turns out that was not the failure mode. The hands leave the frame, which is correct
(you cannot see your own hands while craning at the ceiling) and happens partly for
reasons the cap has nothing to do with: the *lower* hand is seated along the shaft and
swings out of frame from +0.2 rad, cap or no cap. The bug was the opposite of detachment
— it was an *object left behind* by the hand that should have taken it.

---

## 3. THE SLEEVE CLAIM — RETRACTED

**A8 sub-item: UNASSESSED-AESTHETIC. Meets the bar: no.**

I wrote that hands and sleeves need nothing. You are right that an audit table cannot
conclude that, and the audit's actual claim was narrower than mine: it counted *4
sleeve/cuff meshes per tool*, which is true and says nothing about whether any of them
are on screen.

Screenshots at the player camera, both poses a player holds:
`qa/electron/broom-c2/sleeve-work-full.png`, `sleeve-level-full.png`, plus 560 px crops
centred on each forearm's elbow→wrist midpoint.

**What the picture shows: no sleeve, on either arm, at either pose.** Both forearms read
as bare skin from the wrist to the bottom edge of the frame.

And the geometry says why, decisively. The rig runs wrist → forearm → **elbow** → rolled
cuff → sleeve → off-frame shoulder, so the cuff and the entire sleeve sit *beyond* the
elbow. Measured elbow positions:

| pose | arm | elbow NDC y | on screen | forearm visible |
|---|---|---|:--:|---:|
| level | right | **−1.878** | no | 4.7 % |
| level | left | **−1.462** | no | 30.1 % |
| work | right | **−1.865** | no | 5.7 % |
| work | left | **−1.424** | no | 34.5 % |

Every elbow is off the bottom of the frame, so **no sleeve or cuff pixel can be on screen
at either pose.** The commit I cited (`6628576`) fixed a real thing — the arms are now
symmetric, where one used to be sleeved and one bare — but symmetric-and-invisible is not
"looks right", and I had no business saying it did.

Whether bare forearms are correct is an art-direction call about what the character is
wearing, not a defect, so I am leaving it to you rather than guessing. **A8 stays open at
3 of 4.**

---

## 4. E1 FALLOUT — the highest-value item, and the audit that sent me there was wrong

**Commit `c333566`. Meets the bar: yes.**

You asked me to fix the shared solve so the clamp cannot saturate on frame one. I did
that, re-ran the audit, and **the numbers did not move.** That is the failure mode you
told me to assume, so I instrumented the solve instead of theorising about it — and the
premise was false.

**The ±0.06 clamp was never the constraint.** Measured from inside the solve
(`walk.floorAnchorDiagnostics`, added for this): it ran every frame, never saturated, and
computed exactly the right correction — **−0.28 yd for the mop, −0.99 for the vacuum,
−1.00 for the dustpan.** Then `group.position.copy(rest)` in the idle rest-pose reset, a
few hundred lines further down the same function, restored y along with everything else
and threw the whole thing away.

That reset **already carries an exception for the broom**, added in Phase 6 with a comment
describing this exact failure. It was written once, for one tool, and the other three
kept the bug.

This is the part worth keeping: *from outside, "corrected as far as it could and fell
short" and "corrected fully and was discarded" are the same picture.* Every number in the
E1 table is consistent with both. Only the solve's own inputs could tell them apart, and
no instrument reported them. I have corrected `TOOL_STANDARD_AUDIT.md` in place rather
than leaving the wrong diagnosis in the record.

Two more faults had to be fixed before anything moved:

* **The guard belongs on the input.** A stray sample is a bad *floor height*, so the
  accepted floor height may travel 1.6 yd/s and the pose then applies the whole remaining
  correction at once. It cannot saturate, and it still answers a fast look at full speed —
  a rate-limited *pose* would have lagged during a whip-pan and put the C2 symptom back.
* **The correction is a world-Y move and the group is a child of the camera.** Writing
  `position.y += need` delivers only cos(pitch) of it — exact at the horizon, 22 % at the
  top of the look range, which is precisely the shape of *"anchored while you work, rides
  the view when you look up"*. It is decomposed into the group's own frame now, and
  re-sampled afterwards so a `residual` proves the correction landed rather than merely
  having been computed.

### Result, measured by the same driver in Electron

| tool | reach before → after | carried spread before → after | floor-ref |
|---|---|---|:--:|
| **broom** *(control)* | 0.012 | 0.007 | yes |
| mop | 0.081 → **0.000** | 0.631 → **0.000** | **yes** |
| vacuum | 0.265 → **0.000** | 0.612 → **0.000** | **yes** |
| dustpan | 0.235 → **0.000** | 0.640 → **0.000** | **yes** |

All three now hold the boards better than the tool the standard was set on, because they
are solved exactly each frame where the broom's is a blend.

**Pictures:** `qa/electron/floor-tools/` — each tool at the work pose, level, and up-look.
`dustpan-work.png` is the clearest: the pan's lip is flat on the boards.

### The four static tools

Also closed. `dustpan`, `spray`, `washer` and `trashbag` each returned **one** distinct
transform across two seconds of held use, because the cleaning block dispatches on
`toolClass` and scoop, jet and carry had no branch — and the washer never reaches that
block at all, being `external`. Rather than add three more branches, motion is now
declared on the tool (`cleaningTools.js` `useMotion`) and driven above every one of those
forks. **All nine tools animate:** dustpan 1 → 165, washer 1 → 124, trashbag 1 → 133,
spray 1 → 17 (a discrete pump, so a modest count is correct — the bottle now recoils on
each squeeze instead of only the hands doing so).

**Not done from E2's list:** the collider clamp (audit §4 — the floor tools still drive
through fixtures). It is a separate solve and I did not want to start it against the clock.

---

## 5. D7 — the shared-constant audit

**Full table in `Designs/ProShop/HARNESS_DEBT.md` §7.** Eleven instances across ~400
`src/` imports in 393 test files and 455 QA drivers. Three are load-bearing; three are
fixed.

**The one that matters most is firing right now.** `BROOM_FEEL.dirt.pushSpeed` = 2.6 is
guarded by `assert.ok(pushSpeed > 2.2, 'must beat the 2.2 yd/s walk')`. **The player walks
at 3.4 yd/s** (`courseScene.js:5758`, ×1.8 running). So the invariant the test exists to
protect — *"a push slower than the walk walks over its own pile; the round-1 dirt lag
lived in this number"* — is false today, and the test is green because it compares against
a `2.2` that no longer exists anywhere authoritative. Production carries the same stale
copy at `courseScene.js:8419`.

**I have not fixed it.** The repair is a feel-tuning change and I could not playtest
sweeping to confirm a new value inside the timebox. Guessing a number here is exactly the
manufactured fix the brief forbids. It is written up with the file:line evidence.

**Fixed:** `broom-hover-origin.js` — the surviving copy of the original C2 incident — now
reads `PITCH_LIMIT` from `mouseLook.js` and sweeps to it instead of stopping at
`BROOM_FEEL.pitch.maxPitch` (0.30). Confirmed: `headAboveFloor` holds at 0.600 from +1.35
down to level, a band the old ceiling could never have shown. `broom-lookup-clip.js` and
`broom-c2-reverify.js` now import the limit instead of retyping `1.35`.

**Still retyped:** `broom-lookup-float.js:53`, `tool-standard-audit.js:97`.
**Still unenforced:** `bobRate` 8.7, which four separate files claim independently and
which the config's own comment says *"MUST match"* the character stride rate.

---

## 6. C8 — done, and it took five wrong things to get there

**Commit `3047f88`. Meets the bar: yes.**

Last session left this NOT DONE with the driver aimed at bare ceiling. Three separate
faults were in that driver, each sufficient on its own to produce a confident wrong
answer:

1. launched without `--clubhouse=pine-hills-v2`, so `CEILING_PANEL_RIG` described a
   different room;
2. it guessed five prompt class names, none of which the build uses — the shipping prompt
   is `.shop-prompt`;
3. it faced `yaw = PI`, which points *away* from a panel you are standing south of. Its
   one capture was the door sign's prompt from across the room, pooled into the same
   string that scored the four questions — which scored *"where does it come from"* TRUE
   off the words "Tee desk".

Two more surfaced once it was reading the right element, and both are worth knowing:

4. the prompt renders `[E]` as a `<kbd>` keycap, so a `/\[E\]/` test on `innerText` scores
   *what to do* FALSE on a prompt that is showing the player a key;
5. **main.js fades the prompt in by opacity and leaves the text in place.** Without pointer
   lock the driver read a perfect answer off a blank screen — every screenshot from the
   first "passing" run was of an empty frame. The driver now refuses to count a prompt it
   cannot measure at opacity > 0.6.

### The product change

Two prompt strings:

* `"Dark ceiling panel — the ceiling circuit is dead"` → **`"…; repair the ceiling first"`**
* `"Dead ceiling panel — repair kit required"` → **`"…, from the back room shelves"`**

The first gate named which gate was shut and nothing about what to do, so the only way to
learn the next step was to press E and read the *refusal toast*. A prompt you have to
disobey to learn from is not teaching diegetically — it is a hint hidden behind a wrong
answer. The second is the one rung where "where does it come from" is the player's actual
question, and it was the one rung that did not answer it.

### Verified in the build, both rungs, prompt visible on screen

| rung | prompt as read on screen | broken? | needs? | where next? | what to do? |
|---|---|:--:|:--:|:--:|:--:|
| circuit dead | *Dark ceiling panel — the ceiling circuit is dead; repair the ceiling first* | ✓ | ✓ | ✓ | — (correctly: pressing E would do nothing) |
| powered | *Flickering ceiling panel — `E` repair with clubhouse kit* | ✓ | ✓ | — | ✓ |

Images: `qa/electron/lamp-teaches/unpowered-*.png`, `powered-*.png`.
The third rung (powered, no kit) is covered by unit test only — a fresh save has a kit, so
the build does not present it.

---

## 7. What I did not get to

**C9 (the ledger)** — not started this session. The conflict between task #127 and the
NamedGolfers spec is unchanged and still needs your decision; report 9 §7 has the
recommendation and it stands. It is a design call about what the object is *for*, and
making it silently would be worse than leaving it.

**B6 / G1 (the twelve-file texture pass)** — not started. It was to go last as one block
after a positioning pre-check, and there was no block of time left. Unchanged.

**E2's collider clamp** — the floor tools still drive 0.60–0.76 yd inside fixtures. It is
the remaining item from the E1 table and is a genuinely separate solve.

---

## UNCONFIRMED — shipped, not seen working

1. **The third C8 rung** (powered, no kit) — the string is unit-tested; no fresh save
   presents it, so it has not been read on screen.
2. Carried forward from report 8: **C6 intent 2**, a pre-registered guest checking in and
   then shopping.
3. Carried forward: **F3 asset/audio fallbacks** — logged, but still no substitute mesh
   and no silent-audio path.

## NOT DONE

| item | reason |
|---|---|
| **C9** ledger book | Not started. The spec conflict is a design decision, not a coding one. |
| **B6 / G1** texture pass | Not started, including the `asset_087`-style positioning pre-check. |
| **E2** collider clamp | The remaining row of the E1 table. Separate solve; not begun against the clock. |
| **D7** `pushSpeed` | Confirmed live defect, evidence recorded, **deliberately not fixed** — the repair is a feel tuning I could not playtest. |
| **D7** `bobRate` | Same class, four unenforced copies. Recorded, not fixed. |
| **D7** remainder | Two drivers still retype `1.35`; the original four-item list (raw-`Continue` drivers, the "New Empire" sweep, the laptop-tour fixture, five dead feel keys) is untouched. |
| **E3** audio per tool | Not reached. |
| **F2** key rebinding | Not reached. Still does not exist. |

## UNASSESSED-AESTHETIC

1. **A8 sleeves** — retracted, evidence above. No sleeve is visible at either pose because
   the elbow is off-frame; whether bare forearms are the right look is your call.
2. **The broom's grip at up-look.** The stow means that above +0.90 rad you hold nothing
   visible at all. I think that is correct — it is what happens when you look at the
   ceiling holding a broom — but it is a taste call and I made it on my own judgement.
3. **The dustpan's hand.** In `qa/electron/floor-tools/dustpan-work.png` the pan is
   correctly on the boards, but the single hand on the green collar reads small. Not
   measured, not in scope, flagging because it is in the frame.

## Things I fixed that you did not ask for

1. **`VIDEO_DIR` on the Electron runner** — needed to answer §2 at all. Some acceptances
   are about motion and the runner could only produce stills.
2. **Two new instruments**: `gripCapYd`/`gripStowYd` on the broom (so the cap's magnitude
   is measurable rather than inferred), and `walk.floorAnchorDiagnostics()` (which is the
   only reason §4's real cause was found).
3. **The C8 driver's opacity check** — it now refuses to count a prompt the player cannot
   see. That fault would have passed any text-based check forever.

## Commits

```
334336e  C2 round 2: the cap left a stick with no hand on it
c333566  E2: the floor solve ran, produced the right number, and was thrown away
3047f88  C8: the lamp prompt names the next object, and is now READ in the build
```
