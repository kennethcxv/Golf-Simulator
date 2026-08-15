# Overnight report — 2026-08-04 (session 12)

**Suite: 2748 pass / 0 fail.** Two commits, pushed. Tree clean.

---

## 0. A CORRECTION FIRST — I published a wrong finding and I am withdrawing it

Last session I reported that **`page.keyboard.down('w')` moves the player 0.000 yd under
Electron**, and that roughly twenty QA drivers holding W had therefore been measuring a
stationary player. I filed it as #149 and called it "the bigger finding".

**It is wrong.** `page.keyboard.down('w')` works. In an open lane it moves the player
**0.935 yd**.

What the zero readings actually were: the player walking into a fixture. `walk.moveIntent`
— a seam that already existed in `courseScene`, whose own comment says position delta
*"reads identically for 'the key never arrived' and 'the key arrived and a wall was in the
way'"* — records **130 frames of forward intent** during those zero readings. The key
arrived, landed in `walkHeld`, and the movement block acted on it on every single frame.

| what | player moved | forward-intent frames |
|---|---:|---:|
| hold W, facing −z from the start pose | 0.000 yd | 130 |
| hold W, facing the open lane | **0.935 yd** | 118 |

So: **no driver needs re-running on this account**, and nothing in the harness is broken
here. The instrument that would have settled it in one step existed before I started, and
I reached a conclusion from a position delta instead — which is the same mistake as
reading a constant from a copy of itself, one layer up. #149 is closed as withdrawn.

Corrections written into `HARNESS_DEBT.md` §7 and `OVERNIGHT_REPORT_11.md` in place,
rather than quietly deleted. `walk-input-probe.js` now tries four facings as a control and
reports intent alongside position, so the two causes cannot be conflated again.

**Commit `3001ee2`. Meets the bar: yes — the correction is measured, not asserted.**

---

## 1. B6 pre-check — no positioning defects. Nothing to fix before texturing.

**Commit `5936d84`. Meets the bar: yes.**

Your gate before any texture work: *`asset_087` was authored correctly and placed where no
camera sees it. Fix placement first. Do not texture a broken asset.*

Answered empirically rather than from the placement registry, because the registry is what
put the clock behind the wall. For each of `PROP_PLACEMENTS`' forty records the driver
samples the walkable floor, puts an eye at every reachable standing spot, and raycasts at
the drawn geometry sitting on that placement.

**Result: all forty are drawn, and every one is visible from a reachable standing position
between 0.41 and 0.84 yd away.** No `asset_087`-class defect anywhere in the set. That is a
clean negative and it clears the gate.

Scope is all forty rather than B6's twenty, because **asset_087 is sheet_09** — a check
scoped to 61–80 could not have caught the case it was written for.

Driver `tools/qa/asset-visibility-audit.js` · raw `qa/electron/asset-visibility/`.

**Two earlier versions of this driver were wrong, and both were caught by their own
controls.** Worth recording because it is the same lesson as §0:

1. The first matched scene objects by an `asset_0NN` in their names and found **zero of
   twenty**. Loaded GLB roots are named after the node inside the file, not the file.
2. The second sampled the floor from the interior's **bounding box**. `propPlacement`
   parks hidden props at **y = −256**, so that box is ~256 yd tall and its `min.y` is
   nowhere near the boards: every sampled eye sat 256 yd under the floor and all twenty
   assets reported invisible.

Twenty of twenty invisible is a broken instrument, not a room — which is exactly what
`someAssetsAreVisible` is in the check list to say. Both controls are permanent.

---

## 2. What I did NOT finish, and what each one actually needs

You asked me to finish everything remaining. I have not, and I would rather be exact about
why than deliver three half-features. All three are from-scratch builds, and each has a
first decision that is yours rather than mine.

### B6 / G1 — the texture pass itself

**The gate is now clear** (§1), which was the blocker. What remains is the pass: per asset
*source → UV → map → calibrate → verify the `baseColorFactor` → screenshot*, plus the
texture-memory measurement before and after against the 150 MB threshold.

Two things I established that change the shape of it:

- **The untextured set is 19, not 12.** sheet_07 has nine untextured (065 is already done)
  and sheet_08 has ten. I could not find a document that names a particular twelve, so
  *which* twelve is a decision, not a lookup. If "the twelve" was meant to be sheet_07's
  nine plus three of sheet_08, say which three; otherwise the honest scope is 19 or the
  ten cleaning tools.
- **The local CC0 library is three material families** (Metal032, Wood051, Wood062).
  Nineteen assets sharing three sources is fine for memory — texture memory counts sources,
  not instances — but it means the pass is a palette exercise, not a sourcing one.

Your standing rule is all-or-zero, so I did not start it.

### C9 — the ledger book

The design question is settled and recorded in #127 so it cannot be re-litigated: **the
ledger is the named-golfer roster book**, per the spec, and #127's own exclusion clause is
superseded. An empty roster is a legitimate day-one state (blank pages), so the missing
golfers do not block it.

What it needs is a prop, a focus mode, a page-turn interaction and a record schema. There
is no book prop, no `namedGolfers` state, and no open-in-place page-turn machinery to
extend — `state.ledger` is the *financial* ledger and is unrelated. The nearest existing
pattern to copy is the laptop's focus mode (`walkFocusPose`, the eased camera, the DOM
overlay), which is a real head start but still a session.

### F2 — key rebinding

The reason this one is dangerous to half-do: the key literals are compared **in place**,
across `courseScene`'s `walkKeyDown`/`walkKeyUp`, `main.js`'s two window handlers and every
tool/verb site. Rebinding means routing every one of those through a table. A partial
routing leaves some actions rebindable and some not, which is worse than none — the player
rebinds a key, half the game obeys, and the half that does not is the half they hit first.

It needs: a binding table in data, one read path everywhere, a capture-a-key panel in the
existing settings menu, conflict detection, persistence through `uiPrefs`, and a reset.
That is the whole item and it should be done in one piece.

### A8 — deliberately still open

Three sub-items are measured and pass (report 11 §4). **Hand pose and sleeves are yours to
grade** and I have left them alone as instructed.

---

## UNCONFIRMED — shipped, not seen working

1. **The `pushSpeed` repair in the build.** The constant is corrected and derived from
   `WALK_SPEED_YD_S`, and the unit test reads the authority. The claim *"walk forward
   sweeping and the pile stays ahead of you"* is still not observed. The driver
   (`broom-push-beats-walk.js`) now calibrates an open lane, seeds the pile at the tool's
   own contact socket, and reports **which** of the two causes it hit — but sweeping in
   that room yields 0.12 yd/s of travel and the seeded pile is not being swept, so it
   returns `inconclusive` by design rather than scoring.
2. **How the eight new tool sounds SOUND.** Report 11 §3 proves each tool drives its own
   loop with a live intensity and fires its own contact and release. Nobody has listened.
3. Carried forward: **C6 intent 2**, a pre-registered guest checking in and then shopping.
4. Carried forward: **F3 asset/audio fallbacks** — logged, still no substitute mesh and no
   silent-audio path.
5. Carried forward: **the third C8 rung** (powered, no kit). Unit-tested; no fresh save
   presents it, so it has not been read on screen.

## NOT DONE

| item | reason |
|---|---|
| **B6 / G1** texture pass | Gate cleared; the pass itself not begun. All-or-zero, and *which twelve* is an open decision — the untextured set is 19. |
| **C9** ledger book | From scratch: prop, focus mode, page turns, record schema. Design question settled and recorded. |
| **F2** key rebinding | From scratch, and a partial routing is worse than none. |
| **E2** collider clamp | Still the last row of the E1 table — the floor tools drive 0.60–0.76 yd inside fixtures. |
| **D7** original four-item list | Untouched: four raw-`Continue` drivers, the stale "New Empire" sweep, the laptop-tour economy fixture, five dead feel keys. |

## UNASSESSED-AESTHETIC — yours to grade

1. **A8 hand pose** — `qa/electron/a8/broom-rest.png`, `qa/electron/a8/broom-sweep.png`;
   420 px crops at `qa/electron/broom-c2/sleeve-*-cuff-*.png`.
2. **A8 sleeves** — same frames. The measured fact is unchanged: no sleeve or cuff pixel is
   on screen at either pose, because every elbow projects off the bottom edge.
3. **The broom's grip above +0.90 rad** — you hold nothing visible up there. My call, and
   it is taste. `qa/electron/broom-c2/`.
4. **The dustpan's hand** — `qa/electron/floor-tools/dustpan-work.png`; the pan is on the
   boards, the hand reads small.
5. **The eight new tool sounds** — the `tone` shapes in `cleaningTools.js` are a first pass
   and nobody has heard them.

## Count

**87 of 92, 5 open.** #149 closed as withdrawn; the B6 pre-check is delivered but #118/#147
stay open because the texture pass itself is the item. Open: **#112** A8 (two sub-items are
yours), **#118**/**#147** B6/G1 (one item, two entries), **#127** C9, **#143** F2.

## Commits

```
3001ee2  Withdraw the hold-W harness finding: it was a wall, not a dead input
5936d84  B6 pre-check: all forty placed props are reachable by a camera
```
