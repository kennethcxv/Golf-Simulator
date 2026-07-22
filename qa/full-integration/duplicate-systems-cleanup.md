# Duplicate systems cleanup

The integrated runtime now has one accepted authority at each boundary:

| Domain | Canonical owner | Removed or adapted competitor |
|---|---|---|
| Placement and furniture | `src/sim/layout.js` plus the live clubhouse build-mode integration | Branch-local generated-room and catalog placement assumptions were migrated to stable fixture IDs and stored ownership. |
| Inventory | Lot/unit lifecycle and held-unit ledger | Legacy aggregate totals are migration inputs, never a second post-migration stock authority. |
| Reservations | `src/sim/reservations.js` | The physical register adapter no longer completes only its legacy flat fields. Both UI and register use `finalizeReservationCheckInState`. |
| Physical golfer presentation | Live `makeClubhouse` customer actors bound to reservation IDs | Reservation simulation no longer advances invisibly without spawning/releasing the matching actor. |
| Checkout | Shared physical register transaction and fulfillment state machine | Dormant front-desk DOM assumptions and obsolete duplicate card/receipt gestures are not used by the player route. |
| Economy | Canonical ledger IDs and service-payment tickets | Checkout, deposits, green fees, COGS, refunds, and reversals use exact-once keys instead of branch-local cash mutations. |
| Save/load | State schema 16 and empire schema 3 migrators | Competing branch version claims were serialized into one ordered migration chain with unknown-field preservation. |
| Player mode ownership | `presentationMode()` plus the live walk/register/laptop/build/editor controllers | Pause, tool-wheel, laptop, register, overview, and editor transitions no longer depend on stale coordinates or a second invisible input surface. |

The final browser pass found the most consequential duplicate late in QA: the physical register's `reservationCheckIn.js` wrote `status`, `checkInStatus`, and payment provenance, while golf-day scheduling consumed nested `checkIn` and `courseAccess`. The shared finalizer now updates both representations atomically and emits the one canonical course-ready outcome.
