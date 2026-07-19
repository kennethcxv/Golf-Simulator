# Save and migration review

## There is exactly one latest save version

| Source | `SAVE_VERSION` |
|---|---|
| `25fbdce` (integration base) | 6 |
| `course-takeover-claude` | 6 |
| assets 51–100 snapshot `94a1711` | 10 |
| **Integration branch HEAD** | **10** |

No reconciliation was required and no version was clobbered. `course-takeover-claude`
did not touch `src/sim/state.js` at all — the eight commits on that branch are
course geometry, editor performance and input handling. The 6 → 10 bump comes
solely from the cleaning/assets working tree, so there were never two competing
save versions to merge.

This is the one place where a naive merge would *not* have caused damage — but it
was checked rather than assumed, because a silent version collision is exactly the
kind of defect that only surfaces on a player's existing save.

## Migration surface on the integration branch

Migration and healing entry points in `src/sim/state.js`:

- `migrateFeatureCategory`
- `migrateLegacyRetailLayout`
- `healLedger`

Plus the per-subsystem healers that the working tree added for the new state
(tool ownership, debris, wetness, placement), committed as `ddf4ff6`.

## Fields carried by the 6 → 10 range

New persisted state arriving with this integration:

| Domain | State | Committed in |
|---|---|---|
| Tool ownership | which cleaning tools the player owns / has equipped | `ddf4ff6` |
| Debris | debris piles and their positions | `ef4e3fe` + `ddf4ff6` |
| Wetness | floor wetness field and dry-down | `ef4e3fe` + `ddf4ff6` |
| Placement | assets 51–100 socket placement state | `ad44507` + `ddf4ff6` |
| Box placement | delivery box placement coordinates/mode | `d557b90` |
| Clubhouse restoration | restoration progress | `3f80740` |
| Checkout | register/fixture state | `46deabb` |

No unknown field from another workstream was discarded: the working tree was
committed **verbatim**, so every field the originating session wrote is present.
Tree equality against the safety snapshot (`67d0c37`) proves no field was dropped
in transit — the only deltas are the intentional `.gitignore` change and one
deliberately-excluded stray screenshot.

## Automated coverage that ran and passed

All within the 1658-test green suite:

| Test file | Covers |
|---|---|
| `state.test.js` | core save/load, version handling |
| `cleaning-save-persistence.test.js` | tool ownership, debris, wetness round-trip |
| `box-placement-persistence.test.js` | box placement round-trip |
| `clubhouse-restoration-state.test.js` | restoration state |
| `sheet03-state-migration.test.js` | Sheet 03 migration |
| `sheet03-layout-migration.test.js` | layout migration |
| `sheet06-state-lifecycle-contract.test.js` | Sheet 06 lifecycle |
| `simplified-register-save-reload-matrix.test.js` | checkout save/reload matrix |
| `courseCameraState.test.js` | camera state persistence |
| `webgl-state-teardown.test.js` | resource teardown across reload |

## NOT verified

The Phase 12 matrix asks for live save/reload exercises. These were **not**
performed on this branch:

- fresh save
- current save
- older supported save (e.g. a real v6 save migrated to v10)
- save during incomplete cleaning
- save after course edits
- reload from menu
- reload after application restart

Unit and contract coverage for these paths passed, but no live save file was
written, migrated and reloaded during this integration. **A v6 → v10 migration
has not been exercised against a real on-disk save.**

That is the single highest-value gap remaining before this branch merges to main,
because it is the one defect class that would reach players who already have a
save. Recommended: take a pre-existing v6 save, load it on this branch, confirm
the migration populates tool ownership / debris / wetness / placement with sane
defaults, save, and reload after a full application restart.
