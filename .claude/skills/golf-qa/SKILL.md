---
name: golf-qa
description: The instrument discipline for GOLF EMPIRE QA. Use this skill EVERY time you write, run, or interpret any check — a new QA driver, a probe, an invariant, a perf measurement, a test that claims something about the running game, or a verification that a fix worked. If a task involves proving, measuring, verifying, screenshotting, or watching the game do something, this skill applies — especially when you feel sure the check is simple, because 102 instrument faults are on record and most of them felt simple.
---

# golf-qa — what counts as evidence here

102 instrument faults are logged. The pattern behind most of them: the check
measured something adjacent to the claim, passed, and the claim was false.
These rules are the distillation. Follow them not as ceremony but because
each one has already voided at least one real run.

## The five laws

1. **Every instrument gets a NEGATIVE CONTROL.** Before trusting a probe,
   make it fail on purpose: feed it the broken shape (a missing file, a
   silent frame, a flipped pixel, dead space where a click lands) and watch
   it report failure. A probe that cannot fail is measuring nothing. Ship the
   control WITH the instrument (see `tools/golden-control.mjs` for the shape).
2. **A green suite is not evidence.** `npm test` passing says the headless
   contracts hold. It says nothing about pixels, sounds, feel, or the
   running game. Never cite the suite as proof of a visual or interactive
   claim.
3. **An invariant that does not launch the game certifies nothing.** A check
   of game behaviour runs in Electron via
   `node tools/qa/run-electron.cjs <driver> --clubhouse=pine-hills-v2`,
   boots through `tools/qa/lib/qa-boot.mjs`, and reads the LIVE app
   (`window.__fw`). Asserting over source text or saved state is not
   verification of behaviour.
4. **Check every new probe against `Designs/ProShop/HARNESS_DEBT.md`.** The
   debt file lists the ways instruments here have lied before. If your new
   probe matches a listed shape, it inherits the listed fix, not a new
   variation.
5. **Every fix gets a check you have WATCHED FAIL on the unfixed build.**
   Red-green on the actual defect: run the check before the fix (it must
   fail), apply the fix, run it again (it must pass). A check born green
   proves only that it passes.

## Repo-specific instrument gotchas (each has voided a run)

- **Ask the API, not the scene graph**: batched props draw via layers.mask,
  so a scene-graph probe measures geometry that never draws. Prove a mesh is
  DRAWN with the pixel-probe recipe: paint it flat, kill ACES+composer for
  the frame, count pixels in a real screenshot (sharp).
- **matrixWorld, not local transforms**, when measuring world positions; GLB
  sockets are ANIMATED — never cache them.
- **Capture the pointer** before synthetic mouse input; under pointer lock a
  click at coordinates never reaches the element (elementFromPoint still
  answers geometrically — that lie is on record).
- **Match the sample rate** of what you measure (audio at the Web Audio
  graph, frames at rAF, not module method names).
- **Player pose comes from the live interior origin**
  (`app.scene3d.clubhouse().interior.position`), never stale constants.
- **speedIdx 0 + day-preserving clock pin** for deterministic captures; the
  loose-box landing spot and the window's outdoor view vary per boot — mask
  or stage them, and MEASURE the two-run noise floor before trusting any
  pixel threshold (`tools/golden-diff.mjs` pattern).
- **Strict drivers pin removed contracts**: when an old driver fails, diff it
  against the live API before debugging production code.
- **Menu Continue renders DISABLED on clean profiles** — boot through
  qa-boot, not hand-rolled menu clicks.

## Screenshots and acceptance

Visual claims need a screenshot at the DEFAULT PLAYER CAMERA in Electron on
pine-hills-v2, at owner resolution where the claim is about legibility
(`ownerResolution` in qa-boot). A cropped or staged angle is a supporting
exhibit, not the acceptance.

## Reporting

State what was measured, the control that proves the instrument works, and
where the evidence file lives (qa/...). A claim without its control is
UNCONFIRMED and must be labeled so.
