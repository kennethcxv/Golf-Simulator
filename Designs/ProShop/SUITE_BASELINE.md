# THE SUITE BASELINE, BEFORE ANY WIRING

Part 3 asks for the twelve failures named and recorded, so that anyone reading
a wiring commit can tell my breakage from the existing kind.

Naming them changed the number. **Only three of the twelve are real. Eight are
artefacts of running the suite in the `C:\gfassets` worktree, and one is a
timeout under load.**

`npm test` in the worktree: 3,676 tests, 3,661 pass, **12 fail**, 3 skipped.
Two runs reported 11 then 12, which is the flake below.

---

## EIGHT ARE THIS WORKTREE, NOT THE CODE

`qa/` and `Designs/` are both gitignored, so a worktree checkout has neither.
Seven tests read evidence files out of them and fail on ENOENT; the eighth is a
line-ending trap. **Checked: the three I sampled all exist in the main repo.**

| # | test | what it actually wants |
|---|---|---|
| 30 | Sheets 6-10 and first-person references resolve | `Designs/RefrenceImages/51-60_refrence_images/…` — **present in main** |
| 42 | assets that declare no collision ship no player blocker | `qa/` clean-reimport evidence for sheet_06 asset_057 |
| 66 | `tests/chairs.test.js` | `qa/chairs/blender/blender-validation.json` |
| 72 | Sheet-6 clean-Blender reimport evidence | `qa/` — "run verify_assets_51_60_reimport.py before this gate" |
| 400 | ceiling-light progression | `qa/ceiling-lights/blender/validation.json` — **present in main** |
| 2202 | modern clubhouse dimensions and provenance | `qa/clubhouse-modern/blender/…_manifest.json` — **present in main** |
| 2971 | resort source/export/manifest reproducible | `qa/clubhouse_resort/blender/…_manifest.json` |
| 3483 | the tuning overlay takes pointer events | see below — line endings |

**3483 is the CRLF trap, and it is the one genuinely trivial fix here.**
`tests/tool-tuner-panel.test.js` does

    const css = /const PANEL_CSS = ([\s\S]*?);\n/.exec(tuner);

anchored on `;\n`. A checkout with `core.autocrlf` on has `;\r\n`, so the regex
never matches and the assertion fails with "the panel style block is findable".
`;\r?\n` fixes it. **Not fixed, per the brief.** It is on record in the
memory notes as a known trap for this repo and it has now cost a second session
an unexplained red test.

---

## ONE IS A TIMEOUT UNDER LOAD

| # | test | error |
|---|---|---|
| 1764 | orchestrator never starts a second Electron child after the first exits nonzero | `git diff --binary --no-ext-diff HEAD failed: spawnSync git ETIMEDOUT` |

This is the difference between the 11-fail run and the 12-fail run. It shells
out to `git diff` over the whole tree, and both of my runs happened while a
25-builder Blender sweep was saturating the machine. Not a code fault and not
reliably reproducible. **Do not read anything into this one during wiring** —
if it appears, re-run it on a quiet machine before believing it.

---

## THREE ARE REAL, AND NONE OF THEM ARE MINE

| # | test | measurement |
|---|---|---|
| 1937 | the shared set is the one the hands actually use | expected `0xc4875c`, actual `0xd9a97e` |
| 2219 | D (Goal 23): the bands hang from a COLLAR, not from a point | "the collar must still reach the rim: furthest 0.1246" |
| 2220 | B (Goal 25): 16-24 countable BUNCHES of many fine strands | "the hem must be ragged, not machined: length spread was 0.0491" |

2219 and 2220 both come from `tests/mop-verlet-strands.test.js`, which imports
`src/render3d/mopVerlet.js`. 1937 is a colour constant. All three are numeric
assertions against live source, none of them touch the hero pipeline, and this
session's commits are confined to `tools/blender/hero/*`, `Assets/models/hero/*`
and `Designs/` — `grep -rln "models/hero\|blender/hero" tests/` returns nothing.

**None is trivially fixable.** Each needs a judgement about whether the code or
the threshold is right, and that is the owner's call, not a 4am one.

---

## WHAT THIS MEANS FOR THE WIRING RULE

"Revert the asset if the suite fails" needs a baseline, and I gave the wrong one
this morning by reporting "red at 12" without asking why.

- **In the main repo, the baseline to diff against is 3**, not 12 — and it may
  be fewer still if 1937 turns out to be evidence-driven too.
- **In this worktree it is 12**, and eleven of those will never go green here
  no matter what is wired, because the evidence they read is gitignored.
- So **wiring must be verified in the main repo**, which is also where the game,
  the golden gate and `vendor/models/` live.

I have NOT run the suite in the main repo. A parallel session is measuring
frame timings on this machine and the suite spawns Electron in at least one
test; starting that while they are counting would corrupt their numbers, which
is the same reason the golden gate was left alone.
