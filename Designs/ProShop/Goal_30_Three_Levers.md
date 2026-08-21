# GOAL 30 — THE THREE LEVERS THAT ACTUALLY MOVE THIS

Goal 29 closed two targets as measured-unreachable and priced three levers it did
not pull. This goal pulls all three. They are the whole distance between where
this game is and where it should be.

    LEVER A — the prewarm re-ask. Warm load 31 s -> under 15 s.
    LEVER B — the matrix freeze. 9,143 updateMatrix per standing frame -> under
              4,000, which is what fixes weak machines.
    LEVER C — the texture rebake. 336 MB of 544 MB is 27 scan maps at 2048 on
              shelf items seen from a metre.

Nothing else. Do not go looking for a fourth. The draws and programs levers are
closed with arithmetic and I accept both verdicts.

---

## PHASE 0 — THE MACHINE. Every session, before any timing claim.

One baseline boot against the 31.9 s healthy reference. This has read degraded
two nights running and it is the only thing standing between this game and a
finished optimization pass.

**If it reads healthy: Lever A first, it is the biggest and it needs timing.**

**If it reads degraded: Lever C first** (count-verifiable, needs no timing at
all), then Lever B's count side, and say plainly in the report that A is blocked
again.

---

## LEVER A — THE PREWARM RE-ASK. The biggest single number in the game.

The first-run compile screen pays shader compiles once per machine and persists
them. **The prewarm exists to pre-pay those compiles.** Nobody has asked what it
still needs to do on a boot where the stamp exists.

Your own Goal 29 evidence: `renderer.compile` itself is 158 ms warm, and the
20.4 s monster lives in `compile-hidden`'s forced mega-draws — **the
program-acquiring bucket, which is exactly what the stamp says is already paid.**

- Split every prewarm stage into two buckets: **PROGRAM-ACQUIRING** (paid,
  cached, skippable on a stamped boot) and **RESIDENT-MAKING** (geometry uploads,
  texture init, state build — still needed every boot).
- Skip the first bucket when the stamp is present. Keep it entirely on an
  unstamped boot.
- Red-green: stamped vs unstamped, same profile, three runs each, medians.
- **Then the first-press census, mandatory.** Trading a load win for a gameplay
  hitch is the one way this change is wrong, and the prewarm's whole job is
  preventing those hitches.
- And the golden gate — a skipped warm that changes a pixel is a bug.

Warm prewarm is 16-17 s of a 31 s load. Most of it may now be dead work.

---

## LEVER B — THE MATRIX FREEZE. What fixes weak machines.

Your before-ledger: **9,143 `updateMatrix` calls per standing frame** with sim
speed 0 and nothing moving — 4,571 objects across two composer passes. The
interior alone is 2,846 objects, 2,604 with `matrixAutoUpdate` on. Plus 186
layer-suppressed batch sources that never draw and still tick.

Freeze the static set: `matrixAutoUpdate = false` after a final
`updateMatrixWorld`, for everything the honest census already proved
bit-stable — and the batch-suppressed sources first, since they are provably
invisible.

- **The 186 suppressed sources are the free win.** They cannot draw. They should
  not compute.
- Then the interior's truly-static set, using the same exclusion contracts the
  batcher uses — movable fixtures, doors, progression visuals, sim items.
- **Anything frozen must be un-freezable.** If a restoration verb or a relay
  moves it, it needs `matrixAutoUpdate` back on for that frame. Prove the
  un-freeze with a watched-fail: freeze something that moves, confirm it visibly
  stops moving, then wire the un-freeze and confirm it moves again.
- Report `updateMatrix` per standing frame before and after, on the same
  instrument with its planted ±10 control.
- **The acceptance is the 6.63x throttled matrix**, not the fast machine. That
  test is where everything currently fails.

---

## LEVER C — THE TEXTURE REBAKE. 336 MB, and no timing needed.

27 Tripo hero-product scan maps at 2048x2048 raw, 21.33 MB apiece, three maps per
product — **62% of all texture memory in the game**, on shelf items the player
sees from one to three metres.

- **1024 is almost certainly enough at that distance; 512 may be.** Test it: rebake
  one product at each size, render it at the real shelf distance and camera FOV,
  and look at the three side by side before deciding.
- Then take the whole set at whichever size holds up.
- Basis/KTX2 compression is the bigger win if the pipeline supports it — check,
  and say what it would cost.
- **This is an intended visual change**, so the goldens will move. Re-accept them
  deliberately, with the before/after in the report, rather than treating the
  diff as a regression.
- Report texture memory total, largest offenders, and JS heap before and after.

While you are there: the **first-person tool GLBs double-load their world twins**
(mop 3.99 MB twice, dustpan 2.46 twice, trash bag 2.47 twice) — roughly 15-20 MB
of the 141 MB per-boot payload. If they are genuinely the same asset, load once.

---

## STANDING RULES

**Every instrument gets a negative control before you believe it.** Last night
found three new traps — the Sky constructor that ignores its arguments, phantom
programs from instrument-time compiles, own-flag visibility counting geometry
that never draws. Assume there is a fourth.

**Tiers separate, three runs, medians.** Never a single run as a result.

**Golden gate after every rendering change**, and the one-pixel control with it.

**If a lever does not pay, revert it and say so.** The vertexColors fold was the
right call: built, priced at -6 programs for tens of MB, reverted the same hour.

**Do not edit files while the suite is running.** That caused a fingerprint
failure last night.

Report in `GOAL_30_REPORT.md`: probe-lie count at the top, before/after per
lever, and at the end a plain statement of where warm load, standing frame cost,
and texture memory landed — each with the measurement behind it.