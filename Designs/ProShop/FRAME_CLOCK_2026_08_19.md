# The 1 Hz measurement floor was never a measurement floor

Item 1 of the goal. Evidence: `qa/frame-clock/forensics.json`,
`qa/frame-clock/boot-clock.json`. Instruments:
`tools/qa/frame-clock-forensics.js`, `tools/qa/boot-frame-clock.js`.

## The finding

**rAF is not throttled on this machine, at any page state.**

| state | rAF median | what that is |
|---|---|---|
| menu, no 3D | **4.2 ms** | 238 Hz — the panel's real 240 |
| in play, game loop live | **9.8 ms** | 102 fps |

The rAF *timestamp argument*, differenced independently of `performance.now()`,
agrees (4.2 / 8.4 ms), so the clock is not the fault either.

## How it was told apart

Four queues recorded **concurrently over the same wall time**, so no reading can
be blamed on the moment it was taken:

- `raf` — waits on the compositor
- `timer` — `setTimeout(0)`, does **not** wait on the compositor
- `port` — `MessageChannel`, waits on nothing at all
- `slow` — `setTimeout(1000)`, a **known** 1 Hz series

The last two are the negative control, one at each end of the range. On the
settled page they read **15 ms** and **1022.5 ms** — the instrument can separate
a fast queue from a 1 Hz one, which is exactly the discrimination the verdict
rests on.

If the compositor were throttling, `raf` would be starved and `timer`/`port`
would not. Measured across a **stamped** boot:

| queue | time lost to gaps > 250 ms |
|---|---|
| raf | 86,650 ms |
| timer | 87,796 ms |
| **port** | **87,654 ms** |

Ratio timer/raf = **1.01**. A queue that waits on nothing lost the same 87
seconds. **The main thread is blocked**, in stretches up to 19–21 seconds at a
time. That is not throttling and no switch can turn it off.

## What the 1005 ms number actually was

`window.__fwBoot.stages[].msPerFrame` is `stage wall time / rAF callbacks during
the stage`. During a stage that blocks the thread, that is **wall time per
yield**, not a presentation rate. Same field on this stamped boot:

    prewarm       58,946.6 ms   frames  null
    belt           6,597.3 ms   frames    36   msPerFrame   183.3
    laptop-view    4,493.3 ms   frames   114   msPerFrame    39.4
    editor        12,033.7 ms   frames     4   msPerFrame  3008.4
    overview       5,006.4 ms   frames    35   msPerFrame   143.0

The editor stage reads 3,008 ms/frame. It is not running at a third of a hertz;
it yielded four times and blocked between them. A metronomic ~1005 ms across
four stages was four stages each blocking for about a second per yield, and the
name `msPerFrame` invited the throttling reading.

`main.cjs` carries a long comment asserting the throttling theory, and the two
switches it added (`disable-backgrounding-occluded-windows`,
`disable-renderer-backgrounding`) are still in force. They are harmless and
correct for an occluded QA window, but they were **not** what was wrong, and the
comment is corrected in place rather than deleted.

## What this unblocks

Frame time is measurable on this box. In play it is **9.8 ms median, 11.6 p95,
16.7 max**. The outdoor-lag question and the ground-cost question can now be
asked with real numbers, which is what items 2 and 3 need.

One caveat carried forward: `minted` counts three.js program objects, which are
created whether or not ANGLE served the binary from disk cache. A stamped boot
minting 242 is not proof that 242 shaders were *compiled*.
