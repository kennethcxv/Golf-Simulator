# TWO REGRESSIONS, MEASURED

2026-08-19. Wear is not started. Both regressions were instrumented before
anything was changed, and one of the two fixes was built, measured, and then
**withdrawn** — the reason is below and it is the owner's call, not mine.

---

## Read this first: every wall-clock load number I can take here is wrong

The machine this ran on **presents WebGL frames at 1 Hz**. Measured directly,
in one window, in one boot (`qa/boot/cadence.json`):

| where | frames in 4 s | median gap | visibilityState | hasFocus |
|---|--:|--:|---|---|
| menu, no 3D scene yet | 276 | **14.6 ms** | visible | true |
| scene alive, veil up | 4 | **1009.9 ms** | visible | true |
| **in play, veil gone** | 4 | **1003.0 ms** | visible | true |

The menu runs at 68 Hz in the same window. The moment a WebGL surface exists the
cadence collapses to exactly 1 Hz, and it **stays there in play**. So this is not
occlusion of the window and not the app's own loop — it is the compositor
declining to drive a GPU surface on a machine with nothing to present to.

`document.visibilityState` says `visible` throughout, which is precisely why
this has gone unnoticed: **the honest-looking signal lies.**

Consequences, stated plainly:

- Every millisecond in this report is 60× inflated against a machine that
  presents frames. Program counts, texture counts and light censuses are NOT
  affected — those are what I have leaned on for conclusions.
- **The Goal 27 QA exemption does not work.** `backgroundThrottling: false` plus
  `setAlwaysOnTop` were both in force and the cadence was still 1 Hz. I added
  `disable-backgrounding-occluded-windows` and `disable-renderer-backgrounding`
  (QA only) and it made **no difference** — kept, because they are correct and
  free, but they are not the answer.
- I could not reproduce the owner's machine, and I am not going to claim I
  measured his boot. What I can say is what the boot is *made of*.

---

## 1. Loading is slow again

### The hypothesis was right about the structure and wrong about the remedy

> "the compile SCREEN is gated on the stamp, but the WARMS THEMSELVES ARE NOT"

**True.** `startCompileScreen` decides whether to *show* the screen from the
stamp; `prewarm`, belt, laptop-view, editor and overview then run unconditionally.

> "If a stage mints zero programs on a stamped boot, it does not need to run."

**No stage mints zero.** On a stamped boot, measured
(`qa/boot/cold.json` vs `qa/boot/warm.json`):

| stage | cold ms | warm ms | cold minted | warm minted |
|---|--:|--:|--:|--:|
| prewarm | 31,440 | 20,126 | 238 | 238 |
| belt | 36,117 | 6,202 | 9 | 9 |
| laptop-view | 54,216 | 2,041 | 0 | 6 |
| editor | 39,179 | 6,493 | 6 | 13 |
| overview | 8,028 | 2,432 | 1 | 9 |
| **total** | **168,980** | **37,295** | 254 | **275** |

A stamped boot mints *more* than a cold one, not fewer. The reason is that
`renderer.info.programs` counts **three.js program objects, which are rebuilt
every session**; the stamp tracks the **driver's binary cache**, which makes each
one cheap. Gating the warms on the stamp would push all 275 into the player's
hands. So that door stays shut, and the ledger is what says so.

### What the boot is actually made of

The warm stages are **frame counts**, not time budgets:

| stage | frames | ms/frame on this box |
|---|--:|--:|
| belt | 36 | 1005.1 |
| laptop-view | 54 | 1005.7 |
| editor | 39 | 1007.3 |
| overview | 8 | 1003.0 |
| **total** | **137** | — |

**137 frames.** At 60 Hz that is 2.3 s. At 1 Hz it is 137 seconds — and it was:
the same stamped build measured 40.7 s on one run and 177.2 s on another, with
the slow run reproducing the **cold** boot stage-for-stage to within 1%. Numbers
that reproduce that tightly across a cold and a warm boot are not compiles.

**That is the mechanism behind "slow again, even after the first boot", and it
does not need an unattended machine to bite** — anything that costs frames
(another app on the GPU, a fullscreen window in front, a driver hiccup) multiplies
the boot by the same ratio, silently, while every stage still reports `done`.

### Shipped: a per-stage budget

Each warm stage now gets a deadline, checked **cooperatively** at the top of its
loops beside the existing generation guards, so a stage that runs out still
leaves through its own `finally` and restores the lid, the camera and the mode.
Budgets: belt / laptop / editor 10 s, overview 5 s — well above what a healthy
machine measured (6.2 / 2.0 / 6.5 / 2.4 s), so on hardware that is not in trouble
**nothing changes at all**.

A/B on the 1 Hz box, which is a perfect negative control for this:

| | veil lifted | warm chain | programs |
|---|--:|--:|--:|
| before | 170,579 ms | 168,566 ms | 274 |
| **after** | **78,014 ms** | **76,024 ms** | **270** |

Half the boot back for **four programs**, and every clip is declared:
`budgetHit: true` per stage and `belt: "3/9"` in the warm summary. No silent caps.

### What I did not do

The remaining 78 s is dominated by **prewarm at 30-38 s**, which mostly does not
yield through rAF and is therefore real work. I did not touch it. The biggest
named phases on a stamped boot were `initTexture-batches` 15.0 s,
`gesture-overview-flora-instances` 5.8 s, `three-spin-frames` 3.8 s.

"Warming the day" — the owner's specific suspicion — is **not the problem**: it
probes 1440 minutes but finds only **2 distinct light states beyond the boot
state**, and cost 513 ms on the last stamped run.

---

## 2. Outside, and switching items out there

### The fault is real, it has a number, and the guessed cause was right

The belt pressed indoors and on hole 1, **in one boot**, twice — the second time
with the route order **reversed**, so "whichever ran first is free" is ruled out.
Both runs agreed exactly (`qa/outdoor/switch.json`, `qa/outdoor/reversed.json`):

| | light census | washer | vacuum | mop | rest |
|---|---|--:|--:|--:|--:|
| indoor | `Ambient:1｜Directional:1｜Hemisphere:1｜**PointLight:1**` | 0 | 0 | 0 | 0 |
| outdoor | `Ambient:1｜Directional:1｜Hemisphere:1｜**PointLight:4**` | **+1** | **+1** | **+2** | 0 |

**Four programs that only ever arrive in the player's hands, outdoors.** Three
keys a program on the light COUNT; the course shows four point lights where the
shop floor shows one; and the belt warm only ever equips tools under the spawn
census. The owner's reading — *"the belt warm is warming the wrong lighting"* —
is measured correct.

### The fix worked. I withdrew it anyway.

A second belt pass at a real point on hole 1, position saved and restored, took
the outdoor first-press cost from **4 programs to 0**, with indoor still at 0
(`qa/outdoor/fixed.json`).

But in that verification run the **indoor** census read `PointLight:4` where
every pre-fix run read `PointLight:1`. The interior's draw-distance and per-lamp
budget settle on a **2 Hz gate**, and on a box presenting at 1 Hz a 2 Hz gate
cannot settle between the teleport and the reading — so *"the inside changed"*
and *"the gate had not caught up"* are indistinguishable from here.

Adding `settleClubhouseCameraVisibility()` after the restore did not resolve it:
the census still read 4 **and the outdoor cost came back to 4**
(`qa/outdoor/fixed2.json`), because that call re-gates materials and programs
release on material dispose.

The instruction was **DO NOT BREAK THE INSIDE**. Shipping a warm that might
relight the clubhouse, on evidence that cannot tell whether it does, is not a
trade to make on the owner's behalf. The code is gone; the measurement, the
numbers and the reasoning are kept as a block comment at the belt warm so the
next attempt starts from here.

**To finish it, one of two things is needed:** a machine that presents frames, or
an instrument that reads the interior census after the gate has *provably*
settled rather than after a fixed wait.

### The viewmodel lead: checked, and it is not true any more

`Tool_*` / `Held*` nodes with no tool held, at the first post-veil frame and
again after both belt routes:

```
atFirstFrame     { held: null, shown: [] }
afterBothRoutes  { held: null, shown: [] }
```

Nothing left visible. That one is closed.

### Frame time indoors vs outdoors: NOT MEASURED

Both read 1004 ms median — the 1 Hz floor, in both places. There is no signal in
that and I am not going to dress it up as one. **Whether the ground work costs
frames outdoors is still an open question**, and it needs a machine that presents
frames to answer.

---

## What is in the tree

| | |
|---|---|
| `window.__fwBoot` | per-stage ms, **frames**, ms/frame, budget, budgetHit, programs minted — diagnostics only, no behaviour |
| warm stage budgets | the one behaviour change; A/B'd above |
| `tools/qa/boot-cost-ledger.js` | the table, cold vs stamped; reads the stamp **before** the boot writes one |
| `tools/qa/raf-cadence-probe.js` | menu vs scene vs play cadence — the probe that found the 1 Hz |
| `tools/qa/outdoor-tool-switch.js` | the belt in both places in one boot, with `FW_REVERSE_ROUTES=1` as the order control |
| main.cjs QA switches | `disable-backgrounding-occluded-windows`, `disable-renderer-backgrounding` |

Two instrument bugs found and fixed on the way, both of which had already
produced a wrong answer: the ledger driver read the compile stamp **after** the
boot had written it (so it labelled a 184 s cold boot "WARM"), and it waited
300 s for a global that a pre-ledger build never defines (so it reported a 304 s
boot that was a 300 s timeout).

**Papercut introduced:** `Assets/MANIFEST.md` records loader line numbers, so any
edit to `src/main.js` makes it stale and fails the gate. One command fixes it —
`npm run assets:manifest` — but it will happen every session until the evidence
column drops the line number.
