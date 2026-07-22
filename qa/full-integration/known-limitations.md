# Known limitations and release blockers

1. **Performance/resource regression:** the latest comparator fails average FPS, 1% low, final heap, triangles, materials, and visible textures. Functional integration is stable, but release performance is not accepted.
2. **Distribution size:** `npm pack --dry-run` produces a 1.9 GB archive (2.0 GB unpacked, 4,048 files). A production package allowlist/compression pass is still required.
3. **Browser portfolio quota:** Chromium `localStorage` can reject a second full copy when a three-property materialized portfolio exists in both autosave and a manual slot. Electron production storage is file-backed; the browser cross-mode soak intentionally retains one equipped active holding, while dedicated property and migration routes cover multi-property state.
4. **Performance comparator provenance:** `scenarioMatch` is false because baseline and final scenario descriptions differ even though both use the fixed exterior camera. This does not explain the resource-count failures and should be corrected before the next comparison.
5. **Cleaning aggregate result:** normal cleaning/restoration behavior passes 62/64 assertions; the two failures are the route's resource-budget and post-GC heap/listener checks.
6. **Reload teardown diagnostics:** furniture/property scene replacement can emit detached-texture, zero-dimension/mipmap, and expected aborted-GLB warnings during teardown. Post-reset diagnostics are clean, but teardown noise should be removed.
7. **Golf stress presentation:** the Course Live overlay is low contrast in stress screenshots, and scripted UI speed clicks can leave the browser's “Click to resume looking” veil in evidence frames. Gameplay outcomes and diagnostics pass.
8. **No remote publication:** no Git remote is configured, GitHub CLI is unavailable, and the connected GitHub app exposes no matching repository. Remote refs, open PRs, push, and PR creation cannot be completed from this checkout.
9. **No dedicated type/lint/build scripts:** validation relies on the production syntax sweep, Node suite, package dry-run, real browser routes, and Electron smoke.

These limitations do not justify discarding integrated branch work. They do prevent an unconditional production-release claim.
