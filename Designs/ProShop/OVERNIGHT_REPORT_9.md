# Overnight report — 2026-08-04 (session 9)

**Filename note, again.** The brief asked for `OVERNIGHT_REPORT_2.md`. That file already
exists — it is the S-series session's report, and the name comes from task #65's stale
title. Overwriting it would destroy that record, so this is `_9`, following `_8` from the
previous session. Logged rather than asked, per the brief's standing instruction.

**Timebox.** Started 22:54 UTC, stopped taking new items at 03:00 UTC (3 h 06 m), report
written and pushed in the remaining window. Six items closed, one partial, the rest
reported below with reasons.

**Suite: 2748 pass / 0 fail** (2741 + 7 new). Working tree clean apart from generated QA
artefacts under `Designs/ProShop/Greybox/data/`, which were already dirty at session start.

---

## 0. The question, answered first

> *In the A8 look-up table, what is the 0.600 measuring, and from what origin? Overnight 5
> reported the broom head at 0.012 yd above the boards (floorKiss). If 0.600 is
> head-above-floor, floorKiss is gone and the fix pinned the head at a constant height
> rather than anchoring it.*

**0.600 IS head-above-floor** — yards from the drawn bristle socket straight down to the
floor beneath it. The origin is the floor surface under the head (`floorY` at the head's
own x/z), not the hands and not the camera.

**But floorKiss has not regressed.** 0.600 is the *carried* end of a blend whose other end
is floorKiss, and the head descends onto the boards as the view pitches down. Measured in
Electron, not read off the source:

| pitch | workBlend | head above floor | blend predicts | Δ |
|---|---|---|---|---|
| **+0.30** | 0.000 | **0.600** | 0.600 | 0 |
| **0** | 0.000 | **0.600** | 0.600 | 0 |
| **−0.30** | 0.741 | **0.164** | 0.164 | 0 |
| −1.00 *(control)* | 1.000 | **0.012** | 0.012 | 0 |

The mechanism is one line in `broomViewmodel.js`:
`hover = carryHover * (1 - workBlend) + floorKiss * workBlend`.

Two things make this an answer rather than an assertion:

1. **The steep control lands on floorKiss to three decimals.** A head *pinned* at a
   constant height — the failure the question describes — would read 0.600 in every row.
   It reads 0.012 where the pose plants.
2. **The measurement is taken off the asset's own bristle socket in world space**, after
   the solve has posed it, and differenced against the floor under it. It is not the
   solve's own intent read back to itself.

And the anchoring holds where it used to fail: world head Y is **−1.345 at level against
−1.346 at +0.30**, so looking up now moves the head by **0.001 yd**. Before A8 it lifted it
0.605 yd. That is the whole defect, and it is closed.

Driver `tools/qa/broom-hover-origin.js` · images `qa/electron/broom-hover-origin/`.

Since floorKiss had not regressed, no re-prioritisation followed; I went to the A8
sub-items as briefed.

---

## 1. The unnamed pending items, listed as asked

At session start the queue held these pending entries with no letter-name in the brief:

| # | Item | Status this session |
|---|---|---|
| 133 | D2 hand grip anatomy | **DONE** (§3) |
| 134 | D3 tool-filtered dirt reveal | **DONE** (§4) |
| 138 | D7 remaining harness debt | **PARTIAL — the big one closed** (§5) |
| 140 | E2 fix the other tools | NOT DONE |
| 141 | E3 audio per tool | NOT DONE |
| 143 | F2 full key rebinding | NOT DONE — does not exist at all |
| 118 / 147 | B6 / G1 twelve-file texture pass | NOT DONE (two entries, one item) |
| 65 | S7 this report | **DONE** |
| 135 | D4 material interning | Was already done as a measured negative in report 8; the
  task entry was stale and is now closed |
| 142 | F1 settings menu | Was already verified in report 8; entry closed |

---

## 2. A8 — 4 of 4 sub-items now closed

The brief named four remaining: **closer, hand pose, sleeves, tool/surface legibility.**

- **closer** — done in round 6 (`gripAnchor` z −0.86 → −0.70). No change needed.
- **sleeves** — done in `6628576`. No change needed. (But see §3: that commit introduced
  a new defect of its own.)
- **hand pose** — done this session, §3.
- **tool/surface legibility** — done this session, §4.

**Meets the twenty-minute bar: yes**, with the caveat that "closer" and "sleeves" are
inherited from earlier rounds and I did not re-litigate them beyond confirming the arms
now reach their hands.

---

## 3. D2 — the ovoid was the *upper* hand, and its arm never reached it

**Commit `6e0386b`. Meets the bar: yes.**

The reported defect was "lower hand reads as an ovoid with a thumb". Reviewing it required
looking at the hand, which no previous round did: at 1280×720 a hand spans about 90 px and
a knuckle is two of them, so an articulated hand and a lump are the same picture. I drove
the window to 1920×1080 and cropped to each hand using the viewmodel's own projected hand
position.

**Three findings, in order of severity.**

**(a) It is the UPPER hand, not the lower.** The two hands are the same mesh rolled 3.05 rad
apart, so one gripped over the top of the shaft and the other from directly underneath. The
lower hand wrapped the handle and read as a proper fist; the upper — nearest the lens and
largest in frame — presented a bare dorsum. `handRollUpper` 0.10 → −2.70 puts both hands on
the same side of the handle, which is also how a push broom is actually held.

**(b) The left forearm stopped 0.094 yd short of its own hand**, ending in a flat cap
hanging in mid-air. Round 6 scaled the elbow out by up to 1.6× wrist depth so both arms
project the same screen length, but the skin scale still divided by the raw `forearmSpan`
and hit `spanScaleMax` 1.2. The two clamps fought and the skin lost. Measured
`spanYd 0.416` against `drawnYd 0.312`.

This is worth flagging as a class: **every existing arm number reported it as healthy**,
because both endpoints were correct and only the mesh between them was short. `elbowNdc`,
`wristNdc`, `spanYd` and `visibleFrac` are all right in the broken state. I added
`drawnYd`/`reachGapYd` to catch it, and the fix normalises the clamp by the same depthScale
the elbow was placed with, so it is a safety net again rather than the binding constraint.
`reachGapYd` 0.094 → **0** on both poses. The elbow, and with it the cuff and sleeve that
round 6 fixed, does not move.

**(c) The dorsum had no features at all.** The palm was an ellipsoid with the knuckle bumps
buried inside it — arithmetic on the old scales puts the middle knuckle 0.003 yd proud of
the surface, i.e. three pixels. Flattened the palm to a slab, gave the knuckle row its real
arc, added four metacarpal ridges, and put back the hypothenar, which was simply missing.

**Verification:** `qa/electron/broom-hands/` — `carry-*`/`work-*`, full frames plus 420 px
and 230 px crops centred on each hand. The register was re-shot
(`qa/cash-register-production/simplified-rebuild/checkout-round7/`) because `fpHands.js` is
shared by the checkout; no regression.

---

## 4. D3 — the reveal answers the tool in your hands

**Commit `40438cd`. Meets the bar: yes.**

The hold-to-reveal overlay lit the loose debris clusters, for every tool equally, and never
showed grime at all. So a mop showed you piles it cannot lift; a broom told you nothing
about the larger half of a filthy floor; and grime had no tell anywhere in the game except
the condition number.

Markers are now per-**medium** and filtered to what the held tool can shift, using a routing
map lifted out of the cleaning gate's own `TOOL_CLASS` switch so the two cannot drift
(`tests/dirt-media-routing.test.js`, 7 tests, pins them together). Debris keeps the
established cyan; grime is a flat ochre stain on the boards, because it is *in* the floor
rather than sitting on it. Bare hands show everything — that is the overview's "which way
do I go" case.

**The input conflict, found on the way.** `q` is bound twice: `courseScene` reads it **held**
for the dirt sense, and `main.js` swapped to the previous tool on its **keydown**. So doing
exactly what the HUD says — *"Q reveal dirt"* — silently changed the tool in your hands,
and after this change would also have filtered the reveal for a tool you were no longer
holding. Q is now tap-to-swap / hold-to-reveal with a 220 ms split.

That one is worth dwelling on: it was found because a control disagreed. The driver's
`filterIsNotANoOp` check failed, I probed the tool before and during the hold, and got
different answers. Without the control I would have shipped a tool filter keyed to a tool
the key itself was changing.

**Grime is capped to the 20 worst cells.** Unfiltered, a day-one floor puts all 104 over
threshold and the reveal became a wall of orange spheres you could not see the room
through — true, and useless, since "the whole floor is dirty" is what the condition number
already says. Capping turns it into a to-do list that shortens as you work.

**Verification:** Electron, through the real key, four tool states, screenshot each —
`qa/electron/dirt-reveal/`. The pass condition is a **divergence** across those states, so
neither a no-op filter nor an over-eager one can satisfy it.

| state | tool | media | debris markers | grime markers |
|---|---|---|---|---|
| bare hands | — | debris + grime | 18 | 20 |
| broom | broom | debris | 18 | **0** |
| mop | mop | grime | **0** | 20 |
| vacuum | vacuum | debris + grime | 18 | 20 |

**One part of the ask does not exist and I did not invent it.** The brief says "wet spill
moppable". There is no wet-spill mess in the sim: `cleaningWet.js` models water as a
*consequence* of mopping that dries in ~62 s, and `DIRT.SMEAR` is a glass/counter surface
class, not a floor medium. Building a third medium would have been a new sim feature, not a
legibility fix. Two real media are implemented; the third is reported, not faked.

---

## 5. D7 — 790 QA imports that could never have resolved in Electron

**Commit `934f584`. Meets the bar: n/a (harness).**

Report 8 §6.1 flagged that no function-file driver had ever run in Electron. This session
found the mechanical reason and fixed it wholesale.

Every driver reached its modules with `import('/src/…')`. A leading slash resolves against
the **origin**: under `npm run serve` that is `http://localhost:8457/` and it works, but the
shipping shell is `file:///…/index.html`, so the origin is the **drive root** and it becomes
`file:///C:/src/…`, which does not exist.

**790 call sites across 219 files** now resolve against `document.baseURI`, which is correct
in both runtimes. The safety argument for applying it blind: a Node-side `import('/src/…')`
resolves to the filesystem root and is *already* broken today, so every occurrence that
currently works is page-side — and page-side is exactly where the replacement is valid.
`tools/qa/archive` left alone.

**Proof rather than assertion:** `tools/qa/checkout-round7-renders.js` failed on this exact
error at the top of this session and now completes a full nine-shot register run in
Electron. All 219 touched files pass `node --check`.

**What this does not fix:** the drivers still have to *point at the right thing* once they
load — see §6, where my own new driver loaded fine and then aimed at bare ceiling. Getting
them to import is necessary, not sufficient. D7's original four-item list (four raw-Continue
drivers, the stale "New Empire" sweep, the laptop-tour economy fixture, five dead feel keys)
is still untouched.

---

## 6. C8 — NOT DONE, with what I learned

**Commit `fd8d9e4` (driver only). Meets the bar: no — not attempted in the build.**

I audited the chain from source and got as far as a clear picture, then ran out of timebox
before I could verify it in a running build. Reporting both halves honestly:

**From source**, the ceiling-panel repair already answers three of C8's four questions
through `ceilingPanelPromptLabel`, which gates the prompt so it never offers `[E]` unless
pressing it would change the room:

- *what is broken* — "Dark ceiling panel" / "Flickering ceiling panel" / "Dead ceiling panel"
- *what it needs* — "…the ceiling circuit is dead" / "…repair kit required"
- *what to do* — "…[E] repair with clubhouse kit"
- *where that comes from* — **unanswered.** The prompt says a kit is required and the toast
  says "Bring the inherited clubhouse repair kit", but nothing anywhere says *where the kit
  is*. That is the gap C8 names, and it is real.

**In the build:** not verified. My driver reads panel stations from shopLayout's
`CEILING_PANEL_RIG`, which describes **pine-hills-v2**; I launched without the variant flag,
so it aimed at bare ceiling in a different room and captured no prompt.

The first version of that driver scored all four questions `false` in that case — which
reads as *"the lamp teaches the player nothing"*, a confident and completely wrong finding
of exactly the kind this harness exists to catch. I changed it to return `inconclusive`
with the three candidate causes ranked, rather than leave a misleading instrument behind.
**Nothing about C8's status should be inferred from that driver's output.**

The second half of C8's deliverable — "write the shortest first-time path step by step and
how each step is learned" — was not written, because writing it from source rather than
from play would be exactly the fabrication the brief forbids.

---

## 7. C9 — the ledger: C9 as written DOES conflict with the spec

**NOT DONE (implementation). The conflict is the deliverable, as instructed.**

I read `Designs/ROADMAP.md` and `Designs/NamedGolfers/SLICE_BRIEF.md` before touching
anything, as the brief required.

**They agree on the object**: a bound book on the front desk, opening in place with physical
page turns, a prop rather than a stat screen, auto-recording, and — emphatically in both —
**no decision lives in the ledger**.

**They conflict on the contents.** Task #127 says the ledger records *days traded, sales,
repairs, restoration milestones*, and explicitly excludes *"the wall, referrals, or named
golfers"*. The spec (§"Two objects, not one") says the ledger's content **is** the named
golfers: *"every named golfer's first visit, the date, their signature, visit count, best
round, and the fix that won them over… It is the roster browser, the progress record, and
the loss record. Completionists chase blank pages."*

So C9's exclusion clause contradicts the spec's core purpose for the same object.

**The resolution I would implement**, and did not have time to build:

The two are not structurally incompatible — both describe a no-decision auto-record. Build
**one** ledger surface (satisfying "do not create a third logging surface"): the bound book
on the desk, opening in place, with an extensible page set. Populate it now with the records
that actually exist — days traded, sales, repairs, restoration milestones — and reserve the
named-golfer pages as the spec's designated home for when that system lands.

**Why not simply "implement the spec version" as instructed:** the spec's ledger is a roster
browser for 30 hand-written named golfers, and that roster does not exist in the build —
task #85 delivered the NamedGolfers brief as **docs only**. Implementing the spec version
literally would mean shipping a browser over an empty set. The above is the nearest thing
that honours the spec's ownership claim without inventing its content. Flagging it rather
than deciding it, since it changes what the object is for.

---

## UNCONFIRMED — shipped, but not seen working

1. **Nothing new this session.** Every change in §3 and §4 was observed in a running
   Electron build with a screenshot before it was committed.
2. Carried forward from report 8, still unconfirmed: **C6 intent 2** — a pre-registered
   guest checking in and then shopping. Same code path as the confirmed walk-in, but never
   observed from a due-reservation spawn.
3. Carried forward: **F3 asset/audio fallbacks** — logged, but there is still no substitute
   mesh and no silent-audio path.

## NOT DONE — with reasons

| Item | Reason |
|---|---|
| **C8** lamp teaches itself | Audited from source (gap identified: nothing says where the kit is). Not verified in a running build and not fixed — driver aimed at the wrong room's rig and the timebox expired. The written first-time path was not produced because writing it from source would be fabrication. |
| **C9** ledger book | Read both specs and reported the conflict, which was the instructed fallback. Not implemented: the spec version is a browser over a roster that does not exist yet, and choosing the substitute content is a design decision, not a coding one. |
| **B6 / G1** twelve-file texture pass | Was to go last as one block with a clear run, and there was no clear run. The `asset_087`-style positioning pre-check across the 12 files was also not started — that check is most of the work and cannot be split off usefully in the time left. |
| **E2** fix the other tools | Not reached. Still the item that removes the two worst rows of report 7 §3's table. |
| **E3** audio per tool | Not reached. |
| **F2** key rebinding | Not reached. Still does not exist at all — there is no binding table in the codebase. Note this session made `q` carry two verbs, which raises the value of F2 slightly. |
| **D7** remainder | The import class is fixed (§5); the original four-item list is untouched. |

## Things I fixed that you did not ask for

1. **The forearm reach gap** (§3b) — a limb ending in mid-air, introduced by the commit that
   fixed the sleeve asymmetry. Would have been invisible to every existing arm metric.
2. **The `q` double-binding** (§4) — holding the advertised reveal key silently swapped your
   tool. Pre-existing, and a direct 20-minute-stranger defect on its own.
3. **The 790-site import sweep** (§5) — necessary to verify anything else in Electron this
   session, and it retroactively makes the checkout drivers runnable in the shipping shell
   for the first time.
4. **Two new instruments**: `handNdcUpper`/`handNdcLower` on the broom diagnostics (so hands
   can be cropped to rather than eyeballed), and `drawnYd`/`reachGapYd` (so a short limb is
   detectable at all).
5. **Closed two stale task entries** — D4 and F1 were both delivered in report 8 but still
   marked pending.

## Commits

```
6e0386b  D2: the ovoid was the upper hand, and its arm never reached it
934f584  D7: 790 QA imports that could never have resolved in Electron
40438cd  D3: the reveal answers the tool in your hands — and Q stopped stealing it
fd8d9e4  C8 (partial): a lamp-legibility driver that refuses to answer when it saw nothing
```

## What I would take next

1. **C8, properly** — run the driver with `--clubhouse=pine-hills-v2`, confirm the prompt
   ladder from the player's eye, and answer "where does the kit come from" in the prompt
   itself. It is close: the hard part (the gated prompt) is already built.
2. **C9's design call** — decide whether the desk ledger carries shop records, named
   golfers, or both, then build the one book. §7 has the recommendation.
3. **The 200-program regression** (report 8 §7) — still 68 programs above what B9 measured,
   still worth more than material interning, still hours rather than days.
4. **E2 items 1–3** — one extraction, four tools.
