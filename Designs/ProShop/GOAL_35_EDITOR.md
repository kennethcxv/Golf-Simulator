# Goal 35 — the course editor

The last surface that still compiled shaders in his hands.

    opening it        7 program arrivals, 2.5 s frame warmed, 6.3 s cold
    a tool inside it  6 arrivals, an 11,850 ms frame — "I clicked FIRST TEE
                      and waited about ten seconds"
    leaving it        9.7 s cold

Route and instrument: `tools/qa/goal34-played-session-tripwire.js`, resumed save,
stamped profile, his twelve surfaces in his order — walk in, tools, ledger, Tab,
laptop, laptop pages, editor, every editor tool, place something, exit, tools
again, out through the door. Every program created after the loading veil lifts
is a row on the tripwire, and every row is a surface some warm missed.

## The result

| surface | before (`base1`) | after (`warm5`) |
|---|---|---|
| 07 editor open | 7 arrivals | **0 arrivals, 0 ms** |
| 08 every editor tool | 6 arrivals, **11,850 ms** | **0 arrivals, 0 ms** |
| 09 editor exit | 0 arrivals, 58 ms | 3 arrivals, 641 ms † |
| 04 Tab | 3 arrivals | **0 arrivals, 0 ms** |
| 05 the laptop | 5 arrivals | **0 arrivals, 0 ms** |
| program arrivals, whole route | 21 | **5** |

† Row 09 is not the same measurement it was. Row 08b — place a tee — is new,
because his route ends with "place something", so leaving now DISCARDS a real
edit and pays a course rebuild. Leaving without editing costs 56–85 ms.

Editor open and every editor tool read 0 arrivals and 0 ms on four independent
runs. Read the ARRIVALS as the exact number and the milliseconds as a floor: the
NVIDIA shader cache is machine-wide and survives a wiped profile, so the same
eight arrivals cost 6,309 ms on one run of a build and 68 ms on the third.

### On a COLD profile, where he measured 6.3 s

A fresh profile, new game, the same route (`qa/goal34/cold35.json`, `failures:
[]`): editor open **0 arrivals, 0 ms**; every editor tool **0 arrivals, 0 ms**.
The same gap sampler on the same run reported **5,113 ms** on the laptop's pages,
**5,383 ms** on the exit-after-an-edit and **6,651 ms** on the next tool press —
so the zeros are not a blind instrument. That is the control this claim needs and
it is inside the same run.

### The tripwire's own row count is a FLOOR, not the number

`cold35` reported `tripwireRows: 0` while the per-surface key-set diffs in the
same run reported **5 arrivals**. `programTripwireScan` returns early unless
`programs.length` grew, so a window where arrivals and departures overlap is
never examined — row 09 arrived 3 and departed 6, a net of −3, and the scan
skipped it and rows 08b and 10 with it. The honest count for this route is 5, not
0, and it is the per-surface diff that says so.

## Why the two earlier attempts missed

Both drew the right pixels from the wrong place.

1. **courseScene's prewarm** already puts the camera at the persisted editor
   pose and draws one frame there. Its own comment records the residual it could
   not close: *"the rest needs the entry state produced by the editor's own
   loop."*
2. **Goal 34's point-light census** hid the scene's lights one at a time and
   drew from the WALK camera. It ran (`drawn:6,5,4,3,2,1,0`) and removed zero
   arrivals, because the materials that need those programs are batched with
   `layers.mask = 0` and no shop-floor camera submits them at all.

The fix is the rule that has now paid four times: **do the thing, not a
resemblance of it.** `warmEditorThroughLiveLoop` in `src/main.js` really calls
`enterEditor()`, really presses every button on the rail through the editor's own
`setTool`, really draws the overlays the cursor carries, and really calls
`exitEditor()` — all under the still-opaque veil, with the production loop
rendering, so it is the editor's own camera in the editor's own state.

## The first tool press: a 2 Hz gate behind an instant camera

`setTool` pulls the rig in on the first non-select press —
`rig.dist = key === 'objects' ? 155 : 260` — and `rig.apply()` is instant. But
clubhouse visibility is a function of camera distance and it settles on a
**half-second clock**: `visClock > 0.5` inside `clubhouse.update`. So for up to
500 ms after the press the frame drew the FAR light census at a NEAR camera, and
when the gate caught up, every physical material in frame wanted a new program.

That is the eleven-second frame. Two changes:

* `setTool` now calls `settleClubhouseCameraVisibility()` in the same turn it
  moves the camera. Goal 32 gave editor entry and exit exactly this treatment;
  the tool rail moves the camera just as far and was missed.
* the warm's hold is TIME-bounded, not frame-counted.

The second is a finding in its own right. The first cut of this warm held four
frames per tool — about 28 ms against a 500 ms gate — so every tool warmed the
camera's old census and minted **nothing**: `terrain+0p paint+0p tee+0p …`
(`qa/goal34/warm1.json`). The tool row cost exactly what it had before, while the
warm reported `done`. A warm's hold has to outlast the slowest gate it waits on,
and it has to report what it minted per stage or a warm that does nothing looks
identical to a warm that works.

With the hold corrected the same sweep reports
`entry+7p terrain+6p … overlays+5p exit+0p` — 7, then 6, then 5, which is exactly
the 7 + 6 + 5 that used to arrive in his hands.

## Goal 27's nine-and-a-half-second aftermath: measured, gone

Goal 27 tried an under-veil editor round trip, measured the player's next real
entry at 9.5 s, and the ban stood for two goals on the theory that `exitEditor`
invalidates warmed state. It was re-measured on this build before anything was
designed around it:

* Goal 34's deletion detector, with a proven negative control, found **zero**
  deletions across three round trips — programs only ever grow
  (`qa/goal34/rt*.json`, `cold1.json`).
* three.js says why: `releaseProgram` is reachable from exactly one place,
  `deallocateMaterial`. A material keeps a Map of every program variant it has
  used, and changing light counts releases nothing.
* And directly: with the round trip shipped under the veil, the real first entry
  costs **0 arrivals and 0 ms** on four runs.

The ban is retired, and the comment in `main.js` that carried it now carries this.

## The light-count reading was never the editor's light count

Two goals of work were aimed at "the editor's arrivals are one step off on the
point-light field, 4 → 0". The tripwire now samples the census at the PEAK of
each gesture rather than on either side of it, and the editor's own census is:

    07 editor open   AmbientLight:1|DirectionalLight:1|HemisphereLight:1
    08 editor tools  AmbientLight:1|DirectionalLight:1|HemisphereLight:1

No point lights at all, in either state. Those labels were never describing the
editor; they were naming the nearest key that happened to exist. The same thing
then ran in reverse: once this warm minted the 0-light programs, the laptop's
five unchanged arrivals re-labelled themselves from texture-slot and colorspace
differences to "0 → 4", and Tab's from "4 → 1" to "0 → 1", without a line of
laptop or Tab code changing. `nearestTwinDiffs` points at the nearest neighbour
in the current key set. It is a hint about where to look, never a claim about
what a program is for.

## Tab: the census was identical, so it was the framing

The overview warm draws at `PointLight:1`. The player's real Tab press, sampled
at its peak, is also `PointLight:1` — the same census, and the warm still left
six arrivals behind. That ruled out the explanation every other row on this route
had, and left framing: `toggleCourseMode` does not frame the course, it exits
walk and keeps the SHARED orbit rig where it was, and the editor's `hide()` ends
on `frameCourse()`. So an overview warm running before the editor warm frames the
course from a different place than the player's Tab will.

Ordering the overview warm after the editor warm took Tab from 6 arrivals to 0.

## What is left, and why

Five rows survive, and all five are downstream of the placement:

* **08b place a tee — 1 arrival, 129 ms.** Placing builds new course geometry and
  its shadow pass compiles a `depth` variant for it. Warming that means editing
  the course under the veil, which a boot warm must not do.
* **09 exit — 3 arrivals, 4 departures, 641 ms.** Leaving after an edit discards
  it, and `discardPendingWork`'s course rebuild DISPOSES the water materials and
  makes them again. Disposal is the one thing that does release a program, so
  this cannot be warmed at all. It is fixable — build the replacement material
  before disposing the old one and `usedTimes` never reaches zero — but that is a
  change to the course rebuild, not to the editor.
* **10 tools after the editor — 1 arrival, 0 ms.** One `depth` program, no
  measurable frame.
* **the object placement ghost** is deliberately not warmed, for the same reason:
  its materials are cloned per object type and disposed on the next, so its
  program dies with them. The brush ring, the shaped-feature outline and its fill
  ARE retained across pointer moves, which is what makes them warmable, and they
  are warmed.

One row that is not a compile at all and is worth a separate look: **06 laptop
pages, 541 ms with zero arrivals, zero geometries, zero textures.** Whatever that
is, it is not shader work.

## The route itself needed fixing three times

The walk-in leg is not incidental — while it failed, every indoor row below it
was recorded outdoors and the driver said so. Three cuts before it worked:

1. six blind legs of held W (walks into a hillside);
2. aim at the interior's world centre — a heading into a wall from outside:
   14 legs, 7.6 yd, never in;
3. aim at the node whose name matches the main entrance — which found
   `ProceduralMainEntranceFallback`, the HIDDEN stand-in that only appears when
   the authored door fails to bind, sitting at the group origin. The same wrong
   heading with a better name on it.

The per-leg distances are what gave it away: 5.13, 2.52, 0.18, 0.85, 0.40 … is a
body leaning on a collider, not a bad heading. The working version prefers a
VISIBLE door node (`SOCKET_MainEntrance`), follows the wall consistently in one
direction when a leg makes no ground, and **presses E when it is blocked within
4.5 yd of the door** — because a shut door is not a wall. Twenty-six legs and
outside became four legs and inside.
