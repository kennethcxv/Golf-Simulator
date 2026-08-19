# The belt warm, reinstated — and what the working clock then said

Item 2. Evidence: `qa/outdoor/red2.json`, `green2.json`, `RED-warm.json`,
`GREEN-cold.json`, `GREEN-warm.json`, `ledger3.json`.

## Reinstated, as instructed, and built a different way

`warmBeltUnderCourseLights` in `src/main.js`, a `belt-outdoor` warm stage after
`belt`. It does **not** teleport the player. All four late program arrivals
differ from their nearest twin in exactly one field — **36, the light count** —
wanting 1 where the warm produced 4 and 7. So the warm masks the scene's point
lights down to the course's count, runs the same belt through the same live
loop, and puts every mask back.

No camera move, no `settleClubhouseCameraVisibility()` — that call is what
poisoned the previous attempt, because it re-gates materials and programs
release on material dispose. Nothing here disposes anything.

**One implementation note that cost a run.** The first cut set `visible = false`
and the census never moved: the interior's per-lamp budget gate **writes
`o.visible` on its own tick** and undid the hide within a frame, so nine tools
were warmed under the census they were already warmed under. The layer mask is
not re-asserted by anything. The warm now refuses to run at all if the census
did not change, rather than reporting "warmed 9/9" while warming nothing new.

## The withdrawal reason was an artifact, and the census table was inverted

With the settled-census reader (sample until four consecutive identical reads
spanning more than two 2 Hz gate periods):

| | settled census |
|---|---|
| indoor | `PointLight:**4**` |
| outdoor | `PointLight:**1**` |

**That is the opposite of the previous report.** The settle history shows why:
the outdoor station reads a stale `PointLight:4` for its first ~305 ms before the
gate catches up. The old fixed 1.6 s wait recorded the previous station's value.

So the interior never relit. Indoors was always 4. The reason the fix was
withdrawn did not exist.

## The inside is not broken — and this is the part that IS proven

- `lightsRestored: true` on every run, census in == census out.
- indoor presses mint **none** with the fix, in every fixed run.
- indoor walking frame time **4.2 ms median** with and without, unchanged.

## But the fix is NOT PROVEN, and the working clock is why

The old driver reported `worstMs: null` for the presses that stalled — a press
that blocks the thread for most of its window produces too few rAF callbacks to
have any gaps, so the biggest stalls erased their own evidence. Measured on the
timer queue instead, the outdoor washer's first press has now read, across six
runs on **both** builds:

    17.8   44.2   128.2   933.9   3,539.4   5,043.6   ms

The worst reading of all six is on the FIXED build. The run-to-run variance is
roughly three hundred times any effect I could claim, so **I cannot say this fix
helps**, and I am not going to say it does because it was called for.

What separates the fast runs from the slow ones is not the build, it is whether
the driver's own shader cache has seen those programs before. `minted` counts
three.js program objects, which are created whether or not ANGLE served the
binary from disk — so "4 programs minted" is true in the fast runs too.

**The change is kept**, because it is measurably harmless and it is the owner's
call. It is labelled NOT PROVEN in the code as well as here.

## The real lead, found on the way: the belt warm does 1 of 9

    warmSummary.belt = "1/9"     on a WARM, stamped boot

The original belt warm — in the tree for weeks, and the thing that is supposed to
make tool switching free anywhere — completes **one tool out of nine**. Its 10 s
stage budget is consumed by the first equip. `belt-outdoor` reaches 9/9 only
because each stage gets its own budget, which means the new stage is currently
doing most of the belt warming that the old one was meant to do.

That is a bigger and cheaper win than anything above, and raising the budget
trades directly against the boot time of regression 1. **Not fixed here** — it
needs the boot-cost A/B that item 1's instruments can now actually run.

## Outdoors is not slower than indoors

Walking, sim live, every run, both builds:

| | median | p95 | worst | frames over 33 ms |
|---|---|---|---|---|
| indoor | 4.2 ms | 4.3–8.4 | 12.5–16.7 | **0** |
| outdoor | 4.2 ms | 4.3–8.4 | 8.4–20.8 | **0** |

**The ground work does not cost frames.** That question has been open since it
landed and it is now closed with a number, on a clock that works.
