# GOAL 28 — THE LOAD AND THE FIRST PRESSES

Two things, and they are the whole goal:

    LOAD:   as close to 10 s spawn-to-controllable as this stack allows.
    PRESSES: no first press of anything over 16.7 ms.

You have already established the honest ceiling and I accept it — a first-ever
boot carries unavoidable ANGLE compile that Unity does not, because WebGL cannot
ship precompiled shaders. I am not asking you to beat physics. I am asking you to
take everything that is not physics.

---

## PHASE 0 — BISECT THE AFTERNOON. NOTHING ELSE UNTIL THIS IS DONE.

`attr-cold` measured **30.7 s cold at 12:37 today** on this code. It now measures
64.4 s. Four machine suspects are refuted: co-tenant CPU, occlusion throttling,
reboot, DXCache — and DXCache did not even grow across a boot, so the causal path
never existed.

**A twelve-hour window with a known-good measurement at one end is bisectable.**
That is a mechanical answer, not a fifth theory.

- Check out the tree as it stood at 12:37 and run the same load-breakdown boot.
- If it reads ~30 s, bisect forward through today's commits until the number
  jumps, and name the commit.
- **If it reads ~64 s on the 12:37 tree, the regression is not in the code** —
  say so plainly and stop bisecting. That result is just as valuable and it
  changes what everything else means.

Do not skip this. If a commit from today is inflating every load, you have been
optimising against noise.

---

## PHASE 1 — THE MODULE GRAPH. The cleanest win on the list.

**~2 s of every boot, both tiers, is a 290-module / 8.2 MB unbundled ESM graph
parsed from disk.** Your own attribution, and it is degradation-independent —
byte-similar in the healthy 12:37 boot and every degraded one since.

Bundle it. This is ordinary web tooling, it is low-risk, nobody has tried it, and
it pays on every launch forever.

Report renderer-start → menu-interactive before and after.

---

## PHASE 2 — THE TWO MAIN-THREAD BLOCKS

Also from your own attribution, also machine-independent:

- **~2.3 s** of new-game state build plus previous-scene teardown, before the
  veil's first paint (`main.js:1302-1345`).
- **~1.2 s** of `makeCourseScene` construction.

Both block the main thread outright. Split them so the veil can paint and the
loading state can animate rather than freezing — and so anything that does not
have to exist before I can walk does not.

Report click → scene-object before and after.

---

## PHASE 3 — MENU-TIME OVERLAP

The harness clicks through the menu in 80 ms. **A human reads it for several
seconds, and the game does nothing with them.**

Start the module warm, and if it is safe, scene construction, while the menu is
on screen. Your own note flags this as speculative-scene territory — the teardown
class that has burned prior sessions — so build it behind a guard that abandons
cleanly if the player clicks before it finishes, and prove the abandon path.

---

## PHASE 4 — THE FIRST PRESSES, AGAINST 16.7 ms

Your census found exactly two real stalls, both tier-stable, both
machine-independent:

- **`tab-overview`: 1,490 ms first press** (second press ~14 ms). This is the
  worst single hitch left in the game and I hit it constantly.
- **`register-till`: 215 ms first press** (second ~13 ms).

Fix both. Everything else in the census reads 16–29 ms first with 12–26 ms
second, which the per-surface control says is the ambient floor, not first-press
cost.

**And the tools.** I named the mop specifically — re-measure every belt tool's
first equip against 16.7 ms, not 33, and say which if any are real rather than
ambient.

---

## PHASE 5 — PROGRAMS, IF THERE IS TIME

193 programs at ~70 ms cold is still ~13 s of the cold tier. The remaining spread
is side / alphaTest / vertexColors / geometry-shape driven, which you called
semantic and per-case. Take whichever of those are genuinely mergeable and leave
the ones that are not.

---

## RULES

**Tier every number. Cold and warm, separately, three runs, medians.** Never
report a single run as a result — you measured 8.7 / 21.4 / 27.6 / 47.1 s for one
stage across four runs of near-identical builds.

**Read the inner exit code, never a piped one.** That has cost you twice.

**Every change tied to a number measured before you made it.** You have
permission to restructure anything the attribution points at — bundling,
splitting scene construction, changing what loads when.

**If the machine is still adding 15–35 s of noise after Phase 0, say so and work
only on things verifiable by counts** — programs, module counts, block
attribution — rather than shipping timing claims you cannot stand behind.

Probe-lie count at the top of `GOAL_28_REPORT.md`.