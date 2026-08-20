# The boot number was wrong, and the reason was not in the game

2026-08-20. Two items: find why my 6.05 s disagrees with his 55 s before
optimising anything, and fix the Tab lag.

## Item A — the 9x

### It was not the profile, and not the dev server

The hypothesis on the table was the GPU disk cache: a QA profile that is warm
against a `npm run dev` profile that is cold or discarded. Tested directly.

- `npm run dev` is `electron . --dev`. There is no dev server; both load the
  same `file://`. Its userData is `%APPDATA%\GOLF EMPIRE` -- the real one, with
  his saves, `logs/`, and a **17.1 MB GPUCache holding 332 entries, written the
  same evening**. Not cold, not discarded, and larger than the QA profile's
  8.3 MB.
- I copied that profile byte for byte to a scratch dir (his own is never
  written by a QA run) and pointed the ledger at it. It carries an 809 KB
  autosave, so the run resumes exactly as he does.

| run | profile | flags | click -> veil |
|---|---|---|---|
| 1 | HIS, copied | `--dev` | **36,994 ms** |
| 2 | HIS, copied | none | 29,167 ms |
| 3 | HIS, copied | `--clubhouse=pine-hills-v2` | 30,293 ms |
| 4 | **mine, the one that measured 6.05 s** | v2 | **34,840 ms** |

Row 4 is the whole answer to "your harness and my launch are doing different
things". They are not. My own profile, my own flags, my own driver, the same
commit, reproduced 34.8 s the next day. The 6.05 s was not a wrong span and not
a wrong profile -- it was a **different machine state**, and nothing in the
report said so.

The variant is not it either (29.2 vs 30.3 with and without the flag). DevTools
is real but small: `--dev` costs about 7.8 s, and it also makes the QA runner's
own menu wait time out about a third of the time -- harness-only, present on
both builds, logged as debt.

### What the state actually is

`tools/qa/boot-frame-clock.js` records three queues concurrently across one
boot. Yesterday it found a blocked main thread. Run again that night, on the
same build, it said the opposite:

```
queue         n     median       max    time in gaps>250ms   gaps>900ms
  raf        47     1003.7    2008.2       37,091 ms (35)        34
  timer    7120        4.0    1897.5        6,917 ms (10)         2
  port   200000        0.0     137.5             0 ms  (0)         0
VERDICT: THROTTLED COMPOSITOR
```

rAF pinned at 1 Hz while timers run at 4 ms. `prewarm()` advances by awaiting
`requestAnimationFrame` between phases, so **every yield cost a second to do
nothing**. 27 yields, 24 of them starved, is 24 seconds of a 30-second boot.

Both display heads reported offline at the time; the machine had been idle for
hours. That state is invisible in every number taken this week, mine included,
and it is uncontrolled: it depends on whether the monitor happened to be awake.

### The fix, and the version of it that was wrong

`src/core/veilFrame.js`: each yield asks for a frame and races it against a
timer. Not permanently -- **armed**. The probe is 900 ms and it takes three
consecutive misses to write the compositor off, after which yields fall through
at 16 ms; one real frame clears the verdict.

The first cut raced against 16 ms and looked excellent:

| | before | after |
|---|---|---|
| prewarm, throttled machine | 30,333 ms | **5,695 ms** |
| whole boot, same state | 37,212 ms | **9,637 ms** |
| his profile, N=3 | 29.2 / 30.3 | **9.8 / 10.7 / 11.2 s** |
| yields carried by the timer | -- | 24 of 27, 832 ms total |

**And it broke the belt press.** The door driver, first press indoors:
213.4 ms / 5 programs on the old build, **565.1 ms / 7** on that one. With the
timer winning most yields the warm draws stopped landing on real frames and two
program variants were left for the player. A 250 ms probe still cost it (223 ms,
7 programs) because during prewarm a frame legitimately takes that long -- these
are the heaviest draws the game does. At 900 ms it is clean:

| door driver | baseline (bare rAF) | shipped (armed race) |
|---|---|---|
| first belt press indoors | 213.4 ms, 5 programs | **209.5 ms, 5 programs** |
| worst block crossing | 32.5 ms | **35.8 ms** |
| programs minted, whole run | 6 | **6** |

The throttled machine still pays at most 2.7 s of patience before it commits,
against the ~24 s it replaces.

`window.__fwVeilTicks` now records frame/timer counts, so his own launch can say
whether it was throttled instead of me inferring it from a QA run.

### Honest limits

- The tool-swap A/B could not be attributed. Both arms threw ~3.5-4 s outliers
  (baseline 2/3 runs, shipped 2/3) while the machine drifted in and out of the
  throttled state; p50 was comparable (16.2-22.5 vs 22.8-24.2 ms). Swallowed
  presses were 1 across three baseline runs and 5 across three shipped runs --
  flagged, not explained, and not claimed clean.
- **His 55 s is still not fully accounted for.** I reproduced 29-37 s. If his
  display is awake, this mechanism is not what he is feeling and the tally will
  say so on his next boot.
- The 44.7 s outlier on an otherwise 7.2-7.8 s profile is unexplained.

## Item B — Tab

Measured with `tools/qa/tab-overview-cost.js`: the toggle attributed across the
`ov-*` marks, programs minted by the press, and a burst of real pointer moves
with main-thread blocks recorded around them. Control: a deliberate 300 ms block,
seen as 301.9.

**The cursor is not heavy.** In the overview it runs p50 8.3 ms against 24.6 in
walk -- smoother, because it draws less. On a fresh world the whole thing is
clean (handler 0.9 ms, nothing minted).

On **his resumed save** it is not:

```
Tab #1 back OUT      max 658.3 ms   >250ms 1
programs: 246 -> 249 (enter minted 3) -> 250 (exit minted 1)
```

Goal 34 gave the ENTRY a same-turn `settleClubhouseCameraVisibility()` so the
first overview frame stops drawing a light census that exists nowhere in the
played day. The EXIT never got it, and had the identical bug in the identical
shape. Added, with `ov-exit-*` marks.

| | before | after |
|---|---|---|
| first Tab back out, worst block | **658.3 ms** (1,104.5 on the watched-fail run) | **32.7 / 35.6 ms** |
| programs minted leaving | 1 | **0** |
| gaps over 100 ms, whole round trip | 1 | **0** |

Watched fail with the settle removed: two named failures, 1,104.5 ms and the
stray program. Green with it back.

The entry still mints 3 programs on the first Tab of a session (49.1 ms, no gap
over 100 ms). Not chased -- the same class as the belt press, and the same
ruling applies.

## Gate

`npm run gate` unpiped: **GATE_EXIT=0**, 3791 tests, 3791 pass, 0 fail, golden
diff over 13 images, and `CONTROL OK: one flipped pixel in bag-packed.png FAILED
the strict diff, as it must.`
