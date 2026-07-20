# Integrated save migration

## Canonical schema

- Empire schema remains version 3.
- Property/game-state schema is version 6.
- `src/sim/state.js` is the only root initializer and migration coordinator.
- Each domain normalizes its own subtree once; renderer objects, meshes, audio nodes, timers, and DOM state are reconstructed and are never serialized.
- Unknown data at empire, holding, and state scope is retained across deserialize/serialize cycles.

## Migration order

1. Normalize latest-main/core property state and preserve unknown keys.
2. Normalize the canonical placement layout, transforms, wall attachments, stored/sold state, monotonic revision, and bounded undo history.
3. Normalize inventory lifecycle lots, orders, shipments, boxes, receiving/reserve/shelf/customer-held/sold/disposed quantities, stable IDs, and processed event identities. Legacy shop counters become compatibility projections rather than competing writable quantities.
4. Normalize physical customer schedules, active lifecycle, queue/product holds, history limits, and stable customer/arrival IDs.
5. Normalize tee times, reservations, payments, cancellations/no-shows, receipts, course-access events, and monotonic finance identities. Reservation state stays separate from physical-customer movement.
6. Restore course-wide turf, then the hero-hole detail grid, masks, moisture/height/treatment state, disease, work orders, and maintenance history.
7. Normalize the immutable economy ledger, processed event keys, reputation, business/progression, upgrades, valuation, offers, completed sales, and recovery snapshots.
8. Normalize tutorials and player preferences through the single UX persistence path. Notifications themselves are presentation events and are regenerated/deduplicated rather than replayed as transactions.

## Exact-once and duplicate prevention

- Inventory lots and boxes have stable IDs; stage totals reconcile after every migration and reload.
- Checkout moves exact customer-held allocations to sold before posting one stable revenue and cost-of-goods event.
- Reservation payment, refund, cancellation/no-show, and course-access identities remain monotonic and are journaled once.
- Economy commands use immutable idempotency keys; processed keys survive load and prevent replay rewards, duplicate sale proceeds, and normalized-ID collisions.
- Property-sale recovery snapshots distinguish pre-sale and post-sale states; accepting an offer alone cannot sell.
- Physical reservation arrivals reference the canonical reservation ID. Fixture reset/cancellation retires those arrivals without creating a second booking record.

## Verified source compatibility

`tools/qa/integration-save-compat.mjs` generated a representative save with the exact committed code in each source worktree, injected opaque future fields, loaded it through the integrated schema, serialized it, loaded it again, and compared canonical identity summaries.

| Source | Source head | Source state | Result |
|---|---|---:|---|
| latest main | `0c5137e5f0efac9627ce2309b9e66936f1eeb769` | 3 | pass |
| furniture | `b271903ce5d99478f026b0000b344dc957fe1255` | 3 | pass |
| inventory | `12600d497cb94a8c3dd4983c6b311f2687c8e7e5` | 4 | pass |
| customer | `3cfbca443adde45b2f8e224e36b4c88f1483fc65` | 4 | pass |
| course | `2a0ab21a735beb2b011a8625b3bd7a17c0a4391a` | 4 | pass |
| golf operations | `52cfe7e12b013fc699382e076fe9bc443e77b815` | 4 | pass |
| economy | `16b757055e8887c6dd4e16cc36f693da8138bcb2` | 4 | pass |
| player experience | `bf072a1e1d26cce631daa19d351525b4d5acf941` | 3 | pass |

All eight sources reached state version 6 and empire version 3. All retained unknown root/holding/state probes, preserved canonical IDs, and produced an identical summary after the second reload. Raw evidence is local at `qa/integration-seven/save-compatibility-matrix.json` and identifies integration product head `a019d8ac8d5c5f73da3b62fabc3ed3328b77c389`; the only later code-head change, `ec88eba401e812cf131a7008f4ec868e575435f6`, changes QA/startup tooling and portable Blender command examples, not save behavior.

## Gameplay save/reload gates

- Placement transform, move/cancel, wall/floor attachment, storage/sale, autosave, and reload: pass.
- Order, shipment, unopened box, partial tape cut, opened contents, reserve, shelf, carried product, recycled empty box, and reorder: pass.
- Customer queue, abandonment return, half-scanned basket, checkout, and two consecutive reloads: pass with no duplicate units or money.
- Reservation schedule, prepaid state, cash/card pending payment, check-in, no-show, cancellation, reopened slot, and course access: pass.
- Hero-hole maintenance, turf masks, all 15 work-order steps, and condition score: pass after autosave/reload.
- Ledger, reputation/business summaries, upgrade commands, valuation offer, pre-sale recovery, and post-sale next-market state: pass.
- Tutorial completion/reset and player settings: pass; save failure and corrupt/missing preference recovery remain player-readable.
- Logical soak: 100 consecutive serialize/deserialize cycles; identities stable, unknown data preserved, final 20 saves varied by one byte, pass.

## Policy and limitations

Unknown root/holding/state data is deliberately preserved rather than discarded. Unknown inner-domain values are preserved where the domain normalizer spreads the existing object; malformed canonical fields may still be repaired to safe defaults. Active renderer interpolation, pointer capture, current audio playback position, and transient animation progress are intentionally reconstructed, not saved. This is a safety policy, not data loss from a competing migration.
