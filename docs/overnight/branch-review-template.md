# Overnight branch review template

## Candidate identity

| Field | Value |
| --- | --- |
| Candidate branch | |
| Candidate SHA | |
| Author/owner | |
| Immutable base ref | |
| Immutable base SHA | |
| Merge base SHA | |
| Worktree path | |
| Reviewer | |
| Review timestamp/time zone | |
| Evidence root/archive URL | |

Run and attach:

```powershell
node tools/qa/compare-integration-branch.mjs `
  --base <immutable-base-sha> `
  --head <candidate-sha> `
  --expected-branch <candidate-branch> `
  --out qa/overnight/branch-review.json
```
For a QA-only branch add `--qa-only`; any runtime-path edit then fails closed.

## Isolation and history

- [ ] Base and head both resolve to commits.
- [ ] Base is an ancestor of head.
- [ ] Candidate was not rebased onto an unreviewed moving base.
- [ ] Worktree is clean.
- [ ] No unrelated user changes were included.
- [ ] Commit list is focused and reviewable.
- [ ] Changed-file inventory matches the stated scope.
- [ ] Generated caches, browser profiles, and unapproved large evidence files are absent.
- [ ] External assets, if any, have explicit approval plus source/license records.

### Commits

| SHA | Subject | Scope/risk | Reviewed |
| --- | --- | --- | --- |
| | | | |

### Changed files by risk domain

| Domain | Files | Expected? | Required gates |
| --- | --- | --- | --- |
| Runtime/gameplay | | | boot, console, runtime paths, performance, resolution/FOV |
| Checkout | | | strict card, strict cash, save/reload |
| Save/persistence | | | save/reload, full tests |
| Shaders/rendering | | | shader boot, performance, visual QA |
| Assets/GLBs | | | manifests, clean reimport, runtime paths, performance |
| Cleaning | | | sockets, occlusion, wetness, debris, save/reload |
| Editor | | | editor tools, editor performance, resource stabilization |
| QA/tests/docs only | | | full tests, branch isolation |

## Mandatory gate matrix

Use `PASS`, `FAIL`, `BLOCKED`, or `WAIVED`. A waiver requires the completed section below.

| Gate | Status | Command/report | Reviewer note |
| --- | --- | --- | --- |
| Boot | | | |
| Console errors | | | |
| Shaders | | | |
| Editor tools | | | |
| Editor performance | | | |
| Checkout card — strict physical | | | |
| Checkout cash — strict physical | | | |
| Assets 1–50 | | | |
| Assets 51–100 | | | |
| Clean GLB reimport | | | |
| Runtime asset paths | | | |
| Cleaning sockets | | | |
| Cleaning occlusion | | | |
| Cleaning wetness | | | |
| Cleaning debris | | | |
| Cleaning runtime smoke | | | |
| Save/reload | | | |
| Resource stabilization | | | |
| Resolution/FOV functional | | | |
| Absolute performance | | | |
| Performance comparison to immutable base | | | |
| Full serial Node suite | | | |
| Dependency audit | | | |
| Branch isolation | | | |

## Player-facing evidence review

- [ ] Normal controls were used for the acceptance route.
- [ ] Before and after screenshots use the documented fixed camera/viewport.
- [ ] Card and cash each have screenshots and audio-bearing video.
- [ ] Editor comprehensive run has headed video.
- [ ] Console, page-error, request-failure, and HTTP-error collections were reviewed.
- [ ] Four visual iterations were completed for changed visual behavior.
- [ ] At least 10 visible weaknesses were logged per iteration.
- [ ] Visible weaknesses were resolved or carried as named defects; none were silently omitted.
- [ ] Save/load was tested after the player-facing state change.
- [ ] Performance was measured before and after on the same fixture/environment.

### Visual review summary

| Iteration | Evidence | Ten-plus weaknesses logged? | Fix/revision | Remaining defect IDs |
| --- | --- | --- | --- | --- |
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |

## Persistence and accounting review

- [ ] No transaction can bank twice.
- [ ] Inventory and held-unit counts change exactly once.
- [ ] Customer leaves the queue exactly once after successful handoff.
- [ ] Interrupted card/cash states recover or abandon safely.
- [ ] Save/reload preserves the required transaction stage and physical props.
- [ ] Cleaning wetness, solution, debris, pan, and bag state serialize safely.
- [ ] Native Electron save behavior is current and separately validated, or explicitly not claimed.

## Performance and resource review

| Metric | Base | Candidate | Delta | Threshold | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Average FPS | | | | ≥30 absolute; relative rule | |
| 1% low FPS | | | | ≥12 absolute; relative rule | |
| Worst frame (ms) | | | | ≤100 absolute; relative rule | |
| Draw calls | | | | max(+5, +5%) | |
| Triangles | | | | max(+1,000, +5%) | |
| Unique materials | | | | +2 | |
| Estimated mip texture bytes | | | | +4 MiB | |
| JS heap bytes | | | | +20 MiB | |
| Active event listeners | | | | +2 | |
| Renderer geometries after stabilization | | | | branch-specific bound | |
| Renderer textures after stabilization | | | | branch-specific bound | |

- [ ] Base and candidate environment metadata match.
- [ ] Base and candidate fixture/camera/DPR/sample duration match.
- [ ] All assets were behind the readiness barrier before sampling.
- [ ] Organic walk-ins and other random scene mutations were disabled.
- [ ] Broad variance on unchanged production was treated as a failed repeatability gate.

## Defects and waivers

### Open defects

| Defect ID | Severity | Owner | Integration impact | Exit condition |
| --- | --- | --- | --- | --- |
| | | | | |

### Waiver

| Field | Value |
| --- | --- |
| Gate | |
| Defect ID | |
| Reason integration must proceed | |
| User-visible/data-loss/security risk | |
| Evidence reviewed | |
| Owner | |
| Expiry date or commit | |
| Rollback trigger | |
| Approver | |

## Decision

Choose one:

- [ ] **APPROVE** — every mandatory gate is green; no unapproved risk remains.
- [ ] **APPROVE WITH WAIVER** — every red gate has a complete, approved, unexpired waiver.
- [ ] **REJECT / HOLD** — one or more mandatory gates are red, blocked, missing evidence, or improperly waived.

Decision rationale:

```text

```

Reviewer signature/date:

```text

```
