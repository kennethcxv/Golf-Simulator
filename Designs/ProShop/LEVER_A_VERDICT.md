# LEVER A — THE PREWARM RE-ASK: REFUSED, WITH THE MEASUREMENT (2026-08-16)

The order allowed two outcomes: landed or refused. This is the refusal, and
the measurement behind it changed the question itself along the way.

## The stage split the order demanded

Every prewarm stage, classified, with the evidence for the classification.
"P" = PROGRAM-ACQUIRING (what a stamp claims is paid), "R" = RESIDENT-MAKING
(geometry uploads, texture init, state build — owed every boot), "S" = state
or bookkeeping with no GPU side.

| stage | class | cost (fresh-stamped warm boot, tonight ×2) | evidence |
|---|---|---|---|
| assets-and-door-visibility-runtimes-ready | R | 1.38 / 1.46 s | awaits GLB loads |
| authoritative-time-weather / ceiling / cash-kit | S | ~0 | state sync only |
| materials-slot-unified | S | 0.66 s | material slot remap, no GL |
| renderer.compile | P | 0.07 / 0.06 s | `compile()` links visible-set programs |
| ledger-first-visibility | P | 0.05 / 0.04 s | reveals the closed book for one compile (A3) |
| hidden-objects-revealed + compile-hidden | **P+R mixed** | **0.77 / 0.75 s** | reveal-all `compile()` + ONE culling-off composer draw; the draw is where ANGLE's deferred compiles land (P) AND where hidden geometry uploads (R — the ledger's +25-geometry first-open lives here if skipped) |
| texture-count / initTexture-batches | R | 0.20 / 0.20 s (351 textures) | `initTexture` uploads only |
| warm-traverse | S | ~4 ms | dedupes one representative per program-ish key |
| warm-composer-render | **P+R mixed** | 0.38 / 0.38 s | the representative culling-off draw; measured 2026-08-03 at 9,741 ms vs 51 ms for its identical repeat — the delta is one-time compile |
| forced-full-draw | S | ~1 ms | key-breakdown diagnostic |
| interior/editor-camera-warm, gesture-overview, restore-pose | P (cheap) | 1–8 ms | camera-state variants |
| three-spin-frames | P (shadow/AO states) | 0.03 / 0.04 s | three real frames; near-free when the machine does not stall inside it |
| gesture-ledger | P+R | 0.33 s | page-turn programs + page geometry |
| gesture-register | P+R | 0.46 s clean (7.6–9.7 s when the intermittent stall strikes it) | enter + 8 ticked composer frames + leave |
| gesture-tools | — | deferred to main.js, off-veil | Goal 27 |

**The whole program-acquiring bucket a stamped skip could remove — compile,
ledger-vis, compile-hidden, warm-composer, spin, camera warms — measured
1.2–1.3 s across two consistent stamped warm boots tonight.**

## Why the premise died

The order's premise: "the 20.4 s monster lives in compile-hidden's forced
mega-draws, which is the PROGRAM-ACQUIRING bucket." Tonight's measurements
say the monster was never mostly program acquisition:

1. On the same machine, same hour, same build: a fresh stamped profile pays
   **0.75–0.77 s** in compile-hidden (two boots, gl-programs 160/161 at
   settle); the long-lived `gfqa-warmprof` profile pays **11.2 s** there and
   13.4 s in the spin — with the stall bailout firing and the program census
   TRUNCATED by it (121 at sample time — the bailout fired mid-warm, so the
   count is the bailout's shadow, not a smaller program population).
2. The giant single rAF gaps (7.6–30 s) strike DIFFERENT stages on
   different boots — compile-hidden on one, three-spin on another, the
   register gesture on a third. A cost that migrates between stages is not
   the cost OF a stage; it is the machine's intermittent stall landing on
   whatever forced-draw work is underway when it hits.
3. What a skip would actually return on a working stamp: ≤1.3 s. What it
   risks: the count-parity failure the order itself named (programs created
   lazily in front of the player), and the first-reveal geometry hitches
   compile-hidden's draw exists to prevent (+25 geometries on the ledger's
   first open, measured when a compile-without-draw warm was last tried).
4. On a NON-paying stamp (whatever `gfqa-warmprof` is doing, where warm
   boots still pay 11 s), a skip is strictly worse: the compiles it skips
   were not cached, so they land as gameplay hitches — the one failure mode
   the order said makes this change wrong regardless of the clock.

Either the stamp pays and the prize is ~1.3 s, or the stamp does not pay
and the skip ships hitches. **REFUSED on that fork**, no code change, so no
golden gate, no count acceptance, and no first-press census were owed.

## What the kit found instead (the fact that matters in the morning)

Same silicon, same minute, same build: the fresh-profile protocol reads
**12.7 s warm spawn→playable on a clean boot** (25.5 s when the stall
strikes once), while `gfqa-warmprof` reads 37.6 s — inside the 36.3–43.6 s
band Phase 0 measured this morning pre-rebake. Three nights of "the machine
is degrading" measurements were all taken through that one long-lived
profile. The stall signature is real and intermittent either way (it struck
2 of 3 fresh-profile boots too), but its EXPRESSION is far heavier through
the old profile. This is reported as a measurement, not a seventh theory —
the cross-machine kit run settles the rest.

Timing targets: the 12.7 s figure is one clean boot on a machine that
still stalls intermittently — **UNVERIFIED-PENDING-CLEAN-MACHINE**, per the
order. No load number is claimed from this machine.

Evidence: `qa/goal-leverA/` (kit summaries + three kit boot JSONs),
`qa/electron/load-breakdown/leverA-postrebake-warmprof-result.json`,
`qa/electron/load-breakdown/leverA-fresh-cold-result.json`, and the kit
itself at `C:\Users\Kenneth\Documents\GitHub\GOLF-MEASUREMENT-KIT`.
