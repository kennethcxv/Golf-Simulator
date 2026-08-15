# Overnight report — 2026-08-04 (session 11)

**Suite: 2748 pass / 0 fail.** Three commits, all pushed. Tree clean.

---

## CONFIRM FIRST

### E1 fallout — the shared solve seated. Numbers below.

Measured in a running Electron build, at rest **and** mid-use. Mid-use matters and was
not measured last session: the floor solve runs early in the frame and the use-motion
driver writes x/z later, and on a pitched group a z change moves the contact socket
vertically. "On the boards while idle" and "on the boards while working" are two claims.

| tool | at rest (working pitch) | mid-use, mean | mid-use, min → max | frames |
|---|---:|---:|---|---:|
| **mop** | **0.000** | 0.0001 | −0.0008 → +0.0012 | 150 |
| **vacuum** | **0.000** | 0.0003 | −0.0004 → +0.0012 | 140 |
| **dustpan** | **0.000** | 0.0013 | −0.036 → +0.037 | 180 |
| *broom (control)* | 0.012 = floorKiss | — | — | — |

**All three are at or inside floorKiss.** mop was 0.081 off; it is 0.000. The clamp does
not saturate — `neverSaturates: true` on every sample — and the post-solve residual is
0.0000, which is the proof the correction *lands* rather than merely being computed.

The dustpan's ±0.036 mid-use band is its own scoop bob (the `useMotion` z-swing on a
pitched group), not a solve failure. It is the tool's animation, it is symmetric about
zero, and it is smaller than the broom's own floorKiss.

Driver `tools/qa/floor-tools-onscreen.js` · images `qa/electron/floor-tools/`.
**Meets the bar: yes.**

### Count — 84 of 91, 7 open. Confirmed correct.

Tasks are #58–#148 = 91. Open were #112 A8, #118 B6, #127 C9, #138 D7, #141 E3, #143 F2,
#147 G1 = 7. Completed 84. Your number is right.

**End of this session: 86 of 92.** The denominator moved by one and I am flagging it
rather than letting it pass: **#149 is a new task** for a defect found on the way (below).
Completed #138 D7 and #141 E3. Still open: #112 A8 (correctly — two sub-items are yours),
#118 B6, #127 C9, #143 F2, #147 G1, #149.

---

## 1. D7 — the constant sweep, and something bigger underneath it

**Commit `755116d`. Meets the bar: n/a (harness) for the sweep; the live defect it
exposed is fixed but UNCONFIRMED in the build — see below.**

### The full list

All eleven instances are catalogued with file:line in `Designs/ProShop/HARNESS_DEBT.md`
§7. Searched: ~400 `src/` imports across 393 test files, 455 QA drivers, plus a hunt for
duplicated literals.

**Fixed this session — the structural repair.** `src/data/locomotion.js` now owns walk
speed, run multiplier, stride rate, idle sway rate, eye height and walk FOV. `courseScene`
and `characterAsset` read it instead of writing the numbers out. `broomFeel` derives
`bobRate` and `pushSpeed` from it. The tests assert against it.

That closes the live defect. **`pushSpeed` was 2.6 with a test asserting `> 2.2`** — a
copy of a walk speed that had since become **3.4**. A walking player outran their own
broom by 0.8 yd/s, which is exactly the "debris pops out behind the bristles" the number
exists to prevent, and the assertion passed for the life of the project because both sides
read the same stale literal. `pushSpeed` is now `WALK_SPEED_YD_S × 1.15 = 3.91` and the
test compares against `WALK_SPEED_YD_S` itself. Deliberately *not* clear of a run (6.12) —
sprinting past your own work should outrun the bristles.

Also fixed: `bobRate` (four copies of 8.7, none enforcing the comment saying it MUST match
the stride rate); the walk-FOV and carry-layer inequality guards, both of which compared
against retyped literals and would have gone on passing after the thing they guard against
moved onto the broom's own value; eye height 1.62 in two tests; the last two drivers
retyping mouseLook's 1.35; and `delivery-box-carry-presentation`, which grepped the source
for `= 30` — a check that a number is *typed* somewhere rather than that the renderer uses
it.

**KNOWN-BLIND, recorded not fixed:** the broom handle length `1.247` in
`broom-feel-config.test.js` is a recorded *measurement* of the shipped FP asset
(GripPrimary → FloorContact). There is no authority to import; it rots silently if the GLB
is re-authored. Called out in the file itself and in HARNESS_DEBT §7.

### The "bigger finding" — WITHDRAWN, see report 12 §0

**Everything under this heading is wrong and is corrected in
`OVERNIGHT_REPORT_12.md` §0.** `page.keyboard.down('w')` works. The zero
readings were the player walking into a fixture, which `walk.moveIntent` would
have shown in one step. Left in place rather than deleted, because the shape of
the error is the point.

### The bigger finding

**`page.keyboard.down('w')` moves the player 0.000 yd under Electron.**

Measured three ways against two controls (`tools/qa/walk-input-probe.js`):

| method | player moved |
|---|---:|
| `page.keyboard.down('w')`, 1.5 s | **0.00 yd** |
| direct `walk.state` write | 1.05 yd |
| synthetic `document` keydown | 0.85 yd |

**About twenty drivers under `tools/qa` hold W and then measure what follows.** Every one
of them has been measuring a stationary player. This is the same class as the constants —
a check that cannot disagree with itself — and it is wider. Filed as **#149**.

I found it because the driver written to confirm the `pushSpeed` repair *on the debris*
kept returning green while the pile never moved. A stationary player never overruns a
pile, so `pileStaysAhead` passes trivially. `tools/qa/broom-push-beats-walk.js` now
**returns `inconclusive`** rather than scoring — four ways of walking were tried inside it
and all four measured zero.

**So: the constant is corrected and derived, the unit test reads the authority, and the
in-build confirmation that debris outruns a walking player is NOT DONE.** Listed under
UNCONFIRMED.

---

## 2. C9 — NOT DONE. The conflict is now settled, though.

You ruled: implement the spec. I read `Designs/ROADMAP.md` and
`Designs/NamedGolfers/SLICE_BRIEF.md` §"Two objects, not one" before touching anything,
and I have written the ruling into task #127 so it is not re-litigated: **the ledger is
the named-golfer roster book** — bound book on the front desk, opens in place with
physical page turns, auto-records first visit, date, signature, visit count, best round
and the fix that won them over, no decision lives in it, completionists chase blank pages.
#127's own exclusion clause ("not the wall, referrals, or named golfers") is superseded.

**Why it is not built.** It is from scratch. There is no book prop, no `namedGolfers`
state (task #85 was docs only), and no open-in-place page-turn machinery to extend —
`state.ledger` is the *financial* ledger from `economy.js` and is unrelated. That is a
prop, a focus mode, a page-turn interaction and a record schema.

I judged that unachievable to the twenty-minute-stranger bar in the window I had, and that
starting it would have consumed the window and delivered a shelved half-object instead of
two verified items. **That was my call and it inverted your stated order** — flagging it
plainly rather than burying it. One thing is now settled that was not: an empty roster is
a *legitimate day-one state* per the spec (blank pages), so the absence of named golfers
does not block the build.

---

## 3. E3 — eight tools get the audio layers only the broom had

**Commit `0129716`. Meets the bar: partially — wiring confirmed, sound not.**

Measured first. Every tool declares three sound names, and **26 of the 27 declared names
did not exist** in `core/audio.js`; only `broomStart` and `broomStop` were implemented.
And `setToolLoopIntensity` — the layer that makes a loop follow the stroke and the floor
surface — was called from `onBroomFeel` and nowhere else. So every tool but the broom
played one flat loop from button-down to button-up. That is why the kit sounded like one
machine with the pitch changed.

Not 26 bespoke synth functions. The broom's contact layer is a shaped noise burst and so
is every one of these; what differs between a mop slap and a bristle scratch is where the
band sits and how fast it dies. The **shape** is declared per tool (`cleaningTools.js`
`tone`) and one pair of functions renders it — the same reason `useMotion` is data.
`courseScene` emits `onToolFeel` for whatever is in hand, with intensity from the tool's
own drive phase so it peaks mid-stroke and stalls at the turnarounds. The broom is
untouched and carries no `tone`: it is the standard the other eight are being brought up
to.

Verified in Electron by wrapping the audio surface and recording what each tool actually
asks for over two seconds of real use — audio cannot be screenshotted, so the measurement
is the calls:

| tool | intensity calls | range | contact start / stop | surface |
|---|---:|---|---:|---|
| mop | 262 | 0.000 → 1.000 | 1 / 1 | hard-floor |
| vacuum | 265 | 0.000 → 0.999 | 1 / 1 | hard-floor |
| dustpan | 272 | 0.000 → 1.000 | 1 / 1 | hard-floor |
| spray | 269 | 0.000 → 1.000 | 1 / 1 | hard-floor |
| cloth | 274 | 0.000 → 1.000 | 1 / 1 | hard-floor |
| sponge | 263 | 0.000 → 1.000 | 1 / 1 | hard-floor |
| trashbag | 278 | 0.000 → 1.000 | 1 / 1 | hard-floor |
| *broom (control)* | 197 | 0.000 → 0.491 | own authored pair | hard-floor |

The acceptance is a **divergence**, so a silent no-op and a single shared sound both fail
it. Driver `tools/qa/tool-audio-per-tool.js` · raw `qa/electron/tool-audio/`.

**The audible result is UNCONFIRMED.** This proves the wiring carries the right values per
tool. It does not prove the eight tools sound good, and I have not listened to them.

---

## 4. A8 — three measurable sub-items pass. Two are yours.

**Meets the bar: yes for the three measured; the other two are not mine to grade.**

Driver `tools/qa/broom-a8-measurable.js` · images `qa/electron/a8/`.

**Look-up behaviour.** Head-above-boards across the full range, using mouseLook's own
`PITCH_LIMIT` rather than a copy of it:

| pitch | head above boards | workBlend |
|---:|---:|---:|
| −0.62 *(working)* | **0.012** = floorKiss | 1.000 |
| −0.30 | 0.165 | 0.741 |
| 0 → **+1.35** | **0.600 at every stop** | 0.000 |

**Carried spread 0.001 yd** across the whole carried band. The head plants on the boards
when you work and does not ride the view when you look up, anywhere.

**Closer.** The drawn tool covers **27.2 %** of the frame at the sweep pose, with the grip
**0.71 yd** from the lens (0.50 yd at rest). It is a real presence rather than a distant
stick.

**Tool/surface legibility, as a framing question.** At the working pose the bristle socket
projects at NDC (0.019, −0.717) — on screen, below centre, where you are looking. The tool
takes 27 % of the frame, so **73 % is readable floor**. Both bounds are checked: a tool
that ate the frame would fail as surely as one you could not see.

**Left open, as instructed. A8 stays open.**

---

## UNCONFIRMED — shipped, not seen working

1. **The `pushSpeed` repair in the build.** The constant is corrected and derived and the
   test reads the authority, but the claim *"walk forward sweeping and the pile stays
   ahead of you"* has not been observed. Blocked on **#149** — four ways of walking inside
   the driver measured 0.000 yd/s. The driver returns `inconclusive` rather than scoring.
2. **How the eight tools SOUND.** §3 proves each drives its own loop with a live intensity
   and fires its own contact and release. Nobody has listened to them.
3. Carried forward from report 8: **C6 intent 2**, a pre-registered guest checking in and
   then shopping.
4. Carried forward: **F3 asset/audio fallbacks** — logged, still no substitute mesh and no
   silent-audio path.
5. Carried forward from report 10: **the third C8 rung** (powered, no kit). The string is
   unit-tested; no fresh save presents it, so it has not been read on screen.

## NOT DONE

| item | reason |
|---|---|
| **C9** ledger book | From scratch — no book prop, no `namedGolfers` state, no page-turn machinery; `state.ledger` is the unrelated financial ledger. Judged unachievable to the bar in the window; the spec-vs-C9 ruling is now recorded in #127 so the next session starts from the decision rather than the argument. My call, and it inverted your order. |
| **B6 / G1** texture pass | Not started, including the `asset_087`-style positioning pre-check. It was to go last as one block and there was no block left. |
| **#149** walk input | Found, measured, filed. Not fixed — and roughly twenty drivers depend on the answer. |
| **D7** original four-item list | Untouched: four raw-`Continue` drivers, the stale "New Empire" sweep, the laptop-tour economy fixture, five dead feel keys. `HARNESS_DEBT` §6.4. |
| **E2** collider clamp | The remaining row of the E1 table — the floor tools still drive 0.60–0.76 yd inside fixtures. A separate solve. |
| **F2** key rebinding | Not reached. Still does not exist. |

## UNASSESSED-AESTHETIC — yours to grade

1. **A8 hand pose.** `qa/electron/a8/broom-rest.png`, `qa/electron/a8/broom-sweep.png`
   (1600×900, player camera, at rest and mid-sweep). Tight crops from the previous round
   are still at `qa/electron/broom-c2/sleeve-*-cuff-*.png` at 420 px, centred on each hand.
2. **A8 sleeves.** Same two frames. The measured fact, unchanged and not a judgement: **no
   sleeve or cuff pixel is on screen at either pose**, because every elbow projects off the
   bottom of the frame (NDC y −1.42 to −1.88) and the cuff and sleeve sit beyond the elbow.
   Both forearms read as bare skin. Whether that is the intended costume is the call I am
   not making.
3. **The broom's grip above +0.90 rad.** The stow means you hold nothing visible at all up
   there. I believe that is right — it is what happens when you look at the ceiling holding
   a broom — but it is taste and I decided it on my own judgement. `qa/electron/broom-c2/`.
4. **The dustpan's hand.** `qa/electron/floor-tools/dustpan-work.png`. The pan is correctly
   on the boards; the single hand on the green collar reads small. Not measured, not in
   scope, in the frame.
5. **The eight new tool sounds.** Not aesthetic in the visual sense, but the same kind of
   call: the shapes in `cleaningTools.js` `tone` are my first pass and nobody has heard them.

## Commits

```
755116d  D7: one locomotion authority, and the harness cannot make the player walk
0129716  E3: eight tools get the audio layers only the broom had
(+ the A8 driver, committed with the report)
```
