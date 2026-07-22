# Save migration summary

- Game-state schema: 16 (`live-golf-day-operations`), minimum supported schema 1.
- Empire/portfolio schema: 3 (`validated-portfolio-authority`).
- Forward-incompatible saves are rejected explicitly instead of being silently rewritten.
- Unknown empire, holding, and state keys are preserved across supported migrations.
- Placement, inventory, customer/reservation, course-editor, course-maintenance, economy/business, property, vehicle, cart-fleet, and live-golf-day domains restore in their canonical authorities.
- Inventory migration gives canonical lots/units precedence and uses legacy totals only when the canonical authority is absent. Repeated loads do not create stock, held units, finance entries, customer identities, or reservation payments.
- Generated booking identities are established before autosave; snapshotting no longer mutates the customer directory.
- Physical reservation payment persists nested payment, check-in, and course-access state alongside compatibility fields and exact transaction provenance.

Evidence:

- `qa/full-integration/save-compatibility-matrix-final.json` — representative saves from six worktrees, with repeated reload, unknown-field preservation, and invariant checks.
- `qa/full-integration/integration-logical-soak-final.json` — 100 placements, boxes, customers, check-ins, maintenance operations, and saves with stable identities and no active-resource deltas.
- `qa/full-integration/route-b-register-save-reload-final-7/latest-result.json` — physical register save/reload route.
- `qa/full-integration/route-f-player-experience-final/result.json` — autosave/manual-slot success, intentional write failure, damaged-copy recovery, newer-version guard, and returning-player Continue state.
- Focused state, reservation, inventory, cart-fleet, and service-payment tests are summarized in `test-results.md`.

The browser fallback has a finite `localStorage` quota: duplicating a fully materialized three-property portfolio into both autosave and a manual slot can exceed Chromium's per-origin budget. Production Electron saves are file-backed. This constraint and its test isolation are recorded in `known-limitations.md`.
