# GOLF EMPIRE — project rules

## The found-false ledger outranks everything else here

`Designs/ProShop/FOUND_FALSE.md` lists every item that has been reported DONE
and then found false by the owner, with what each check measured and why it
passed. Four sessions running have shipped items that passed their own checks
and failed in his hands.

> **An item on the found-false ledger cannot be marked DONE again without a
> CLIP.** Real input, default camera, frames extracted and VIEWED, and the
> report names the frame that proves it by timestamp. A number is not enough for
> these.

**And for anything that MOVES, a clip is the standard whether or not it is on
the ledger** — the ledger open, a set-down, a customer walking past a box, the
mop's stroke. A screenshot cannot show a gesture, and the gesture is what keeps
failing. Record with `VIDEO_DIR=qa/<name> node tools/qa/run-electron.cjs ...`,
extract with the ffmpeg tile pattern in `tools/qa/clip-frames.mjs`, and **look at
the frames**. Never report a number about a clip you have not looked at.

Before claiming a ledger item done, write down what the new check measures and
how that differs from the check that passed last time. If it is a number of the
same kind, it is not a new check.

## The two skills are the law

- **Assets go through `golf-assets`** (`.claude/skills/golf-assets/`): palette
  via ART_BIBLE §7.4.1, material break on a real part boundary, something that
  catches light, silhouette check, build-time overlap assertion, **viewport
  screenshot via blender-mcp BEFORE export** (headless render if the socket is
  wedged), pack `--no-compress`, validator gate, visibility sweep, and a
  player-camera screenshot beside the reference.
- **Probes and checks go through `golf-qa`** (`.claude/skills/golf-qa/`):
  every instrument gets a negative control; a green suite is not evidence; an
  invariant that does not launch the game certifies nothing; check new probes
  against `Designs/ProShop/HARNESS_DEBT.md`; every fix gets a check you have
  watched fail on the unfixed build.

## The regression gate

One command: **`npm run gate`** = lint ratchet (frozen at the owner-reviewed
baseline, shrink-only) → vendor-models build check → full suite (includes the
glTF validation gate over all runtime GLBs) → golden-image capture+diff
(Electron, pine-hills-v2) → the golden one-pixel control. Run it before
declaring any session's work done. Individual pieces: `npm run lint`,
`npm test`, `npm run golden`, `npm run golden:control`,
`node tools/build-vendor-models.mjs --check`, `node tools/validate-gltf.mjs <path>`.

## Working rules

- **The greybox stays**: `pine-hills-v2` is the working clubhouse variant
  (assets 61/62/63 deliberately suppressed to grey volumes). Do not switch
  variants, "fix" the greybox, or raise it.
- **Electron only** for game evidence:
  `node tools/qa/run-electron.cjs <driver> --clubhouse=pine-hills-v2`.
  Visual claims need a screenshot at the DEFAULT player camera.
- **The 45-minute stop rule**: if one item takes more than 45 minutes or
  5 commits, stop, write down what you found, mark it NOT DONE, move on.
  Depth on one thread has repeatedly cost the breadth four other items needed.

## Tooling map (what exists, when to use it)

| Tool | Use |
|---|---|
| blender-mcp (socket 9876) | Viewport screenshots before every export; Poly Haven textures/HDRIs. **Ignore its Hyper3D/Sketchfab generation — not game-ready, and AI-content disclosure would hit the Steam page.** |
| `tools/validate-gltf.mjs` | Khronos spec gate; suite-enforced by `tests/gltf-validation-gate.test.js` (shrink-only whitelist) |
| `tools/gltf-census.mjs` | meshes/materials/textures/tris + what dedup/prune WOULD remove (report-only) |
| `tools/vendor-libs.mjs` | Rebuild vendored ESM bundles (troika-three-text, postprocessing, three-mesh-bvh); `three` stays bare — the import map owns it |
| `tools/build-vendor-models.mjs` | Rebuild the 126 generated vendor/models files from Assets/ (manifest-driven; run after pulling) |
| `tools/golden-diff.mjs` / `tools/qa/golden-capture.js` | Golden-image suite; `npm run golden:accept` to rebaseline after INTENDED visual change |
| `tools/lint-ratchet.mjs` | Gate-mode lint: fails only on NEW debt above `tools/lint-baseline.json` |
| ESLint (`npm run lint`) | Full breakdown; the 333-finding baseline awaits an owner decision — autofix nothing until then |
| git-lfs | Forward-only for glb/blend/hdr/exr/Assets-images (`.gitattributes`); history not rewritten |

## Layout facts that bite

- `vendor/models/` files listed in `tools/vendor-models.manifest.json` are
  GENERATED (gitignored) — edit the Assets/ source, never the vendor copy.
  The other 413 files there are direct Blender exports and ARE tracked.
- The renderer has NO bundler: `index.html`'s import map resolves `three`;
  npm install alone changes nothing at runtime — vendor the ESM build.
- Geometry Nodes (density maps + LODs) is the standing approach for course
  vegetation scatter — see Designs/Course/SLICE_BRIEF.md.
