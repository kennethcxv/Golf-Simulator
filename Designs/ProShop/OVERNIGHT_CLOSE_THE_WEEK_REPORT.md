# The night: what landed, what is parked, what I decided without you

Everything below is pushed. `main` is at the merge plus seven commits.

---

## LANDED

### Block 0 — the merge is closed

**274 commits reconciled, one conflict, gate green.** The asset line never
touched `src/`, which is the whole reason it was small. `tests/goldens/tool-mop.png`
was the only file both branches touched.

**tool-mop's 24.4% was the camera, and I did not rebaseline it.** Putting the
baseline beside the capture settled it in one look: the baseline is the shop
wall with the mop in hand, the capture is **two dark beams on a ceiling**, no
mop in frame at all. Three independent facts back it — the merge changed no
`src/`, no `vendor/`, no capture driver; the baseline is byte-identical to
pre-merge main, which measured that pose at 0.2577%; and three later runs read
0.3077, 0.4251 and ok. Accepting it would have written a photograph of the
ceiling into the contract.

**Gate, real exit code, unpiped: `GATE_EXIT=0`** — 3745/3745, ratchet 323,
vendor 138/138, 13 golden poses, one-pixel control fired.

The asset worktree was never actually blocked: it had already pulled the merge
and built one commit on top (`assert_maps` extended to the four hardgoods, which
now fail it 119 times — your Block 5 groundwork). That is merged in.

### Block 0 — the eleven garments are in the game

Wired through the merchandise system: the vendor manifest stages them,
`HERO_GARMENTS` maps SKU to garment line, and the **slot** decides hung vs
folded. Stock and tier still decide what appears.

**They load RAW, not through `instantiate()`** — and that mattered more than it
sounds. Not one v5 material name is in `SLOT` or `TINTABLE`, so every one of the
eleven would have resolved to `mats.charcoal` and the entire v7 bake would have
been discarded at load.

**And the stock baker was deleting the bake.** `merch.bake()` strips attributes
to make its per-material merge legal, and `color` was on the strip list.
Measured on the towel before the fix: `material.vertexColors: true` with
`geometry.color` **absent** — a material asking for a colour stream that no
longer existed.

**The four hardgoods are NOT wired**, exactly as you said: `img 0`, `tex 0`,
`COLOR_0 0`. They have UVs on every primitive, so they are unwrapped and were
never baked. **The front desk stays a grey box** and `pine-hills-v2`'s
suppression of assets 61-63 has NOT been lifted.

Watched failing first: 6 failures, 0/11 prototypes on the unwired build.

### Block 1 — the terrain/paint cursor

Already landed earlier in the session and **re-verified on the merged tree:
9/9 steps, zero failures**. The real bug was that the editor's panels are drawn
over the canvas and a ray goes straight through them, so a pointer on the tool
rail produced a valid, in-bounds, **invisible** stop. Dragging the size slider
left the ring **0% visible**.

### Block 2a — stop geometry, and the ladder A/B

`tools/qa/stop-geometry-audit.mjs` measures the shipped layout with no renderer.
Two of thirteen stop points are illegal: `shelf_balls` browse[0] at **0.107 yd**
from the back counter, `tour_vault` browse[0] at **0.677 yd** from queue slot 5.

`legalStopPoint()` validates a stop **when it is chosen** and nudges or refuses
it. Nothing is moved at arrival.

**Then the A/B, same save, same eight-person crowd, four minutes each:**

| | ladder OFF | ladder ON |
|---|---|---|
| worst no-progress | **227.59 s** | **7.67 s** |
| contact episodes | **0** | 4 |
| frames interpenetrating | **0** | **2** |
| people at 245 s | 8 (none left) | 4 (they went) |
| **stops unreachable** | **0** | **0** |

With the ladder off the crowd is perfect and **nobody completes an errand**.

### Block 3 — the mix

Balanced against the measured floor, not by ear:

| cue | before | after |
|---|---|---|
| ledger open | **12.25x** | 6.91x |
| tool equip | **1.08x** | **2.91x** |
| footsteps | **1.53x** | **2.33x** |

**Spread 11.3:1 -> 3.9:1.** `AUDIO_MANIFEST.md` lists all **86 cues by exact
filename** — 18 recorded, 68 synth. The override loader you asked for already
ships: drop a file, add a manifest entry, no code.

### Block 4 — both halves were already good

4a landed earlier tonight (the laptop open is a **timer**: 1,401 ms of which
14 ms is JS). 4b is an audit, not a fix — see "stale reports" below.

### Block 2b — partly, once the staging existed

Two of the four already existed and I am not claiming them: stops carry
`faceX/faceZ` and the body turns to them, and a 1.5-5 s browse dwell is there.
Shoppers already varied 1.1-1.6 yd/s.

What did not: a **desk errand was a flat 1.15 for every arrival**, so four people
queueing moved as one object; and standing at a shelf a person **stared at a
single point** for the whole dwell. Both fixed — the gaze now travels along the
face of the display, phase and rate fixed per customer at spawn.

Clip watched, 693 frames at 4 fps. **What it does not show, and I am not
claiming: no shelf-browse beat** (the framing is bunched at the entrance), and
**natural entrance/exit pacing is not done.**


---

## PARKED, WITH THE REASON

**The ladder is not deleted.** Deleting it costs errand completion outright: a
walker held 227 seconds and a population that never drops. That is worse than
what you have.

**And your hypothesis for it is wrong, which is the useful part.**
`stopsUnreachable` is **0 in both runs** — nothing is issuing impossible stops.
The remaining stall class is in the `infeasible` column, which **freezes at 691**
while stalls climb: the same walkers, permanently unsolvable. That is mutual
deadlock, not stop legality.

**Except my own fix has a coverage gap**, and it is the likely home of those
walkers: it is wired at `fixtureBrowsePose`, so it validates **browse points and
nothing else** — not queue slots, not the overflow pocket the deep line falls
into, not experience sockets, not the desk stand or the exit. That run staged
four customers straight to the desk.

Not done tonight on purpose: a queue slot cannot be nudged the way a browse
point can. Moving slot 3 breaks single file and there is a suite pinned to that
geometry. It is a floor-plan decision.

**Block 2b is half done.** Pace and gaze landed; "approach, pause, consider,
pick up or move on" and door pacing did not.

**Block 5 (bake the four) and Block 6 (backlog) — not started.**

**Ducking and distance attenuation — named in the manifest, not built.** Neither
is verifiable at the master bus the way the level trim is, and the rule you set
was to work from the measurement.

---

## STALE REPORTS I CORRECTED RATHER THAN "FIXED"

Three items on the brief describe a game that has moved:

1. **"member_station's browse point sits ~0.98 yd from queue slot 0."** It does
   not: **1.222 yd**, which clears the 0.92 a standing pair needs. B1 re-pitched
   the line south and lengthened it to six. The fixture that now collides with
   the tail is **`tour_vault`**. I moved nothing on the old number.
2. **"The laptop UI squeezes 32 items into 3 buttons."** It has **8 sections,
   22 destinations and a 325-entry search**. Confirmed against a real frame.
3. **"`LegacyClubApproachSign` is registered with nothing."** It is the club
   **name** board — "PINE HILLS GOLF CLUB" — not a status board, so it is
   correctly not registered. The outdoor open/closed board is
   `LegacyBusinessHoursSign` and it **is** registered and repainted. My earlier
   note conflated the two.

---

## DECISIONS I MADE WITHOUT YOU

- **Resolved the golden conflict to main's baseline**, on the grounds that
  `mop_head.glb` is referenced by nothing in `src/` and the mop rework predates
  the shared base.
- **Merged with the LFS clean filter bypassed**, after verifying all 32 wedged
  GLBs byte-identical to HEAD by sha256. The incoming 101 objects then landed as
  132-byte pointer stubs and `git lfs checkout` silently no-opped, so they were
  copied by oid and re-verified: 76 of 76 carry a real glTF header.
- **Did not tint the v5 garments.** The bake is the garment; a palette tint is
  what the bake replaced. So polo1 and polo2 now look alike, and `shorts1` keeps
  the old tinted model because there is no shorts garment in v5.
- **Photographed the garments in the STOCKROOM.** Every retail fixture on
  `pine-hills-v2` has its anchor hidden behind an opaque grey volume, so a
  garment on that shop floor is photographed from inside a grey box.
  `GREYBOX_ZONES_EXCLUDED` is `['stockroom','office']`.
- **Two trim passes on the mix, not one.** The first collapsed the spread to
  5.8:1 but flattened the ledger to 2.39x — a hero interaction at the same level
  as a footstep.

---

## THE MISTAKES, WHICH YOU ASKED ME NOT TO TIDY OUT

- **Five Electron runs measuring an empty room.** `people=0` for five minutes,
  three times, before I understood the staged save is the *start* of the
  campaign. The driver's own guards caught every one; I did not read them until
  the third.
- **The nav watch walked in with six blind legs of held W** — the exact method
  goal 35 proved does not work. I wrote goal 35.
- **My apparel check demanded a hung polo twice.** When it failed I moved the
  polos onto a rail and it failed again — slots are keyed by SKU, not fixture.
  The check was wrong twice before the wiring was.
- **My stop-legality test hard-coded two coordinates and got both backwards.**
  It now finds its own samples by asking the geometry.
- **A shell-quoting slip mangled a memory file** into unreadable fragments; it
  had to be rewritten from scratch.
- **I published a passing frame that showed a brush ring hidden behind a
  panel** — `present=true onScreen=true` on a ring the player could not see. In
  frustum is not visible.
