---
name: golf-assets
description: The asset build discipline for GOLF EMPIRE. Use this skill EVERY time you create, rebuild, retexture, or export any 3D asset — a GLB, a .blend edit, a Blender build script run, a texture pass, a prop, a tool, a fixture, anything that ends up in vendor/models/ or Assets/. Also use it when reviewing whether an existing asset meets the bar. If a task mentions Blender, a GLB, a mesh, a texture, a model, or an asset number, this skill applies — even for "quick" or "one-off" changes, because every shipped defect in this project's log was a quick change that skipped a step.
---

# golf-assets — how an asset earns its way into the game

Every rule here exists because its absence shipped a visible defect: rake
bristles floating in air, a divider buried inside a solid carcass, a page
block outside its covers, textures that can never render. The numbers looked
fine every time. The discipline is: LOOK at the thing, then gate it.

## The non-negotiable sequence

1. **Author with the palette, not near it.** ART_BIBLE §8 palette; when a CC0
   texture is involved, read `Designs/ProShop/ART_BIBLE.md` §7.4.1 and use
   `tools/blender/cc0_calibrate.py` — the MAP carries variation, the TINT
   carries hue. Never eyeball a tint onto a downloaded map.
2. **Structure the asset so it reads:**
   - a MATERIAL BREAK on a real part boundary (a counter top meets its
     carcass in a different material, not one flood-filled shell)
   - something that CATCHES LIGHT (a metal edge, a varnish, a glass pane —
     one specular event per asset minimum)
   - a SILHOUETTE that reads at viewing distance — check it as a dark shape;
     if the function of the object is not legible from the shape alone,
     re-block it before detailing
3. **Assert overlaps at build time.** The build script must fail when two
   parts interpenetrate beyond tolerance (the divider-in-carcass class).
   Copy the overlap assertion pattern from an existing `tools/blender/build_*.py`
   rather than writing a new one.
4. **LOOK at it before export.** Take a viewport screenshot through
   blender-mcp (`get_viewport_screenshot`) and actually read the image.
   If the MCP socket is down (it wedges when Blender runs for days), do a
   headless render (`bpy.ops.render.render` to PNG) and Read that PNG.
   The rake, the divider and the page block were all VISIBLE in viewport and
   invisible in every numeric check. No screenshot, no export.
5. **Export with known-good settings.** Blender rotation mode QUATERNION
   before keyframing; apply transforms before join (the join-transform
   gotcha); texture colorspace explicitly set (sRGB for color, Non-Color for
   data maps); tints only via ShaderNodeMix (MixRGB tints silently drop on
   export — Designs/ProShop/TEXTURE_MEMORY_POLICY.md).
6. **Pack with `--no-compress`** where the pack step applies (the compress
   path has produced non-reproducible bytes).
7. **Validate: `node tools/validate-gltf.mjs <file>`.** A spec violation
   fails the build — the boolean-cutter-material-slot class has shipped
   twice. The suite's `tests/gltf-validation-gate.test.js` enforces this
   repo-wide; do not add to its whitelist, shrink it.
8. **Regenerate the visibility sweep** when the asset is in its charter
   (assets 51–100): the sweep is hash-gated, so a rebuilt file forces it.
   Run the command named in `tests/proshop-part-visibility.test.js`.
9. **Prove it in the game, not in Blender.** Launch Electron
   (`--clubhouse=pine-hills-v2`), screenshot at the DEFAULT PLAYER CAMERA,
   put it BESIDE the reference image, and say in words what differs. If the
   asset appears in a golden pose, run `npm run golden` — an intended change
   re-baselines with `npm run golden:accept`, an unintended diff is a defect.

## Placement and integration

- New props reach the room via SOCKET_PLACEMENT in the prop placement system,
  not ad-hoc coordinates.
- vendor/models/ files listed in `tools/vendor-models.manifest.json` are
  GENERATED from Assets/ — edit the Assets source and run
  `node tools/build-vendor-models.mjs`, never hand-edit the vendor copy.
- Keep GLB textures at 512² for hero assets (768 texels/yd ceiling measured);
  count texture SOURCES, not instances.

## When done

State plainly which steps ran and show the two screenshots (viewport,
player-camera-beside-reference). "The numbers passed" is not a completion
claim in this repo.
