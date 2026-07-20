# Active-round save and restore policy

Golf-day state is serialized with the normal game save: party and golfer IDs, reservation link, authoritative round state, hole/stroke progress, completed scorecard rows, practice/starter state, route and transport metadata, cart assignment, delays, satisfaction inputs, congestion, marshal tasks, bounded presentation history, exact-once ledgers, and pool records.

## Stable restore rules

- Practice restores to the persisted practice session or its next safe handoff to the starter.
- A shot saved during `ball-in-play` is reconstructed at address for the same golfer and hole. The transient ball is released, one recovery event is recorded, and no stroke or revenue is invented.
- Stable travel, waiting, starter, mid-hole, riding, and final-hole states retain their route progress, transport, cart ID, completed-hole count, and authoritative position.
- A loaded game remains paused until the player resumes it. Scene assets finish their initial load before the veil is released, preventing an old prewarm from hiding a newer scene.
- Completed round IDs, review IDs, reservation IDs, cart ownership, ball ownership, and metrics are treated as exact-once keys.

## Recovery invariants

The normal-control Route D run at `routes/route-d-recovery-cache/` saved and reloaded five checkpoints through the pause menu and slot UI:

| Checkpoint | Before -> after | Required invariant |
| --- | --- | --- |
| Practice | `practicing` -> `practicing` | same seed/party/reservation/hole/cart and no duplicate effect |
| First-tee flight | `ball-in-play` -> `preparing-shot` | one active flight captured, ball pool reset, exactly one recovery event/counter |
| Mid-hole | `traveling-to-ball` -> same | same route owner, hole, completed score, and cart |
| Riding transition | `traveling-next-hole` -> same | same transport, cart assignment, and completed holes |
| Final hole | `traveling-next-hole` -> same | no premature completion/review and no lost scorecard |

The route finished with exactly one completed round, one experience review, and one recovery metric. It recorded zero page errors, zero console errors, and zero failed requests.

## Explicitly prevented

- Duplicate party or golfer creation from a checked-in reservation.
- Duplicate green-fee revenue, round completion, reputation/review application, or scorecard return.
- Duplicate cart ownership or a permanently assigned returned cart.
- Duplicate or leaked active balls after recovery.
- A half-finished animation frame becoming the authoritative state.
- A loaded party remaining permanently stuck on practice, the first tee, or hole nine.
