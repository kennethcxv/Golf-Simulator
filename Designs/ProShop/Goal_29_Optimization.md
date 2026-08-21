# GOAL 29 — OPTIMIZE THIS GAME PROPERLY

I want this game genuinely well-optimized, not incrementally less slow. Take as
long as it takes — there is no budget on time or credits. The budget is on
honesty, and it is the one from every previous goal: every change tied to a
number you measured first, tiers reported separately, inner exit codes read
directly, probe-lie count at the top of the report.

The targets:

    LOAD:     under 10 s warm. Under 15 s on a true first boot, behind the
              compile screen.
    FRAMES:   no frame over 16.7 ms in normal play, on a mid-range machine.
    DRAWS:    under 400 standing. It is 1,443.
    PROGRAMS: under 120. It is 193.

If a target is unreachable, say so with the measurement behind it. I would rather
hear "this costs X, here is why" than watch one get quietly missed.

---

## PHASE 0 — MEASURE THE MACHINE. Every session, before any timing claim.

This machine went from 30.7 s to 91.5 s in one day on identical code, and six
causes were eliminated by measurement. One baseline boot, compared against the
healthy-era reference, before you believe anything.

**If it reads degraded, say so and work on count-verifiable things only** —
draws, programs, object counts, bytes — rather than shipping timing claims you
cannot stand behind. Phases 2, 4 and 7 are all count-verifiable and do not need a
healthy machine.

---

## PHASE 1 — THE PREWARM, RE-ASKED. The biggest lever, and it is new.

The first-run compile screen means **shader compiles are now paid once per
machine and persisted to disk.** The prewarm exists to pre-pay those compiles. So
ask the question that has never been asked, because the screen only landed
yesterday:

**On a boot where the compile stamp exists, what does the prewarm still NEED to
do?**

- Attribute every stage into two buckets: stages that acquire PROGRAMS (paid,
  cached, free on a stamped boot) and stages that upload GEOMETRY or TEXTURES or
  build state (still needed every boot).
- Skip the first bucket on a stamped boot. Measure what falls out.
- Red-green: stamped vs unstamped, same profile, three runs each.
- **Then run the first-press census** — regressing a load saving into a gameplay
  hitch is the one thing that would make this change wrong.

Warm prewarm is 16-17 s. Much of it may now be dead work. Plausibly ten seconds.

---

## PHASE 2 — DRAW CALLS. 1,443 standing in one room.

You measured this and never acted: 1,037 mergeable objects over 349 materials,
and an honest bit-stability census found **930 truly-static candidates** once
articulated props were excluded.

- Merge the static set by material.
- Use the honest classifier — the first one was blind to pivot articulation
  (delivery casters, checkout reader, shop-stock).
- Close the propPlacement entry-flag mirroring gap you named as the one thing
  standing between you and a safe merge.
- **Golden gate after every batch.** A merge that moves a pixel is a bug.

Report draws standing, shop and outdoors, before and after.

---

## PHASE 3 — THE CLUBHOUSE SUBTREE. The named CPU lever nobody pulled.

Your low-end matrix named it: a **2,208-object subtree churning matrix and
visibility updates every frame** — roughly 7 ms of main-thread work per standing
frame. Under a 6.63x CPU throttle everything failed.

Freeze it. Static objects do not need world matrices recomputed each frame;
objects that cannot become visible do not need visibility tested.

**The acceptance is the throttled matrix, not the fast machine.** Re-run it at
6.63x and report per-frame main-thread cost before and after.

---

## PHASE 4 — PROGRAMS, TO THE FLOOR.

193 now, 107 of one shader family. Your own analysis: the spread is side /
alphaTest / vertexColors / geometry-shape.

- **vertexColors** is the mechanically mergeable axis you identified. Build the
  value-matched field map (the twin-diff census extension you named) and take it.
- double-sided and alphaTest are semantic — case by case, leave the genuine ones.
- The **32 UV-less untextured materials** need a geometry audit before they can
  join the unified slot shape. Do the audit; take them if safe.

Every round proven by count AND goldens at zero pixel diff, like the first two.

---

## PHASE 5 — THE REMAINING LOAD SLICES.

After Phase 1, re-attribute and take the biggest piece, whatever it turns out to
be. Currently:

- **~1.05 s app init** after the module graph evaluates. Never investigated.
- **~1.2 s makeCourseScene** construction. One synchronous block.
- **Asset load — NEVER MEASURED.** 127 GLBs and their textures. The
  resource-timing buffer overflowed the one time it was tried, and Electron
  `file://` emits no resource-timing entries at all. **Instrument at the loader
  instead.** This becomes your floor once compile is gone and nobody knows how
  big it is.

---

## PHASE 6 — MEMORY AND PAYLOAD. Zero instrumentation exists for any of this.

- **VRAM in use**, standing, shop and outdoors.
- **Texture memory total**, and the largest offenders by size.
- **Total GLB bytes** loaded per boot, and which models dominate.
- **Triangles in view vs in scene.** The outdoor set measured 7.7M and was
  flagged as a risk two sessions ago; nobody has looked since.

Then take what is obviously wrong: a 4K texture on something seen at three
metres, a 20k-triangle model that should be 2k. **On weak machines this matters
more than draw calls** and it is the one category with no numbers at all.

---

## PHASE 7 — THE THINGS STILL OPEN

- `register-till` first press: 215 ms, tier-stable, machine-independent. Its warm
  runs and does not help; you named the next instrument — build it.
- The editor's residual arrivals, now the stall bailout should not fire.
- Ambient p95 at 4K is 14.4 ms but max touches 18.6. Find the max.

---

## STANDING RULES

**Tiers always separate. Three runs, medians.** Never a single run as a result.

**Every instrument gets a negative control**, and every assertion is watched
failing before it is trusted. Four instruments were wrong last time; each was
caught only because the broken variant ran first.

**Golden gate after every rendering change.** A pixel that moves is a bug until
proven otherwise — that is how the worker's floor-grime drift was caught, and
that bug was serialize-equal and value-different.

**If a change does not pay, revert it and say so.** The bundling experiment was
the right outcome: 272 modules to one file, 60 ms saved, reverted. That is a
success.

**Do not chase 16.7 ms on surfaces where first press equals second press.** The
per-surface control already proved most of those are the ambient floor, not
first-press cost. Fix the real ones; leave the noise.

Report in `GOAL_29_REPORT.md`: probe-lie count at the top, before/after per phase,
and a plain statement at the end of which targets were hit and which were not, in
each case with the measurement behind it.