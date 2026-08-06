# O2 — copy rewrite worklist (scoping pass, 2026-08-05)

Scope per the brief: player-visible strings only, never code comments; every
string that a QA driver or test pins moves WITH its pin in the same commit.
The sweep below is the read-only inventory; the rewrite executes after the
VERIFY2 fixes land so it edits settled copy.

The good news first: most of the game's copy already reads like a person
("Hauled a pile of junk out the back.", "Tee sign restored - first
impressions matter."). The rewrite is a surgical pass over the machine-voiced
minority, not a wholesale rewrite.

## Rewrite candidates (machine voice)

| Where | Current | Direction |
|---|---|---|
| register toast | "Exact-change assistance stopped before moving any money." | "Stopped - no money moved." |
| register toast | "Order handoff restarted safely." | "Handing it over again." |
| register toast | "Order handoff restored from the saved checkout progress." | "Picked the sale back up where it left off." |
| register toast | "All received cash is secured. Count the change." | "Cash is in. Count the change." |
| register toast | "Cash restored safely. Press D to reopen the drawer." | Drop "safely"; keycap token must be a [D] token so rebinding reaches it. |
| register toast | "Drawer is still opening. Change is queued." | "The drawer is still opening - one moment." |
| register toast | "Finish the physical customer handoff before banking the sale." | "Hand the customer their bag first." |
| build toast | "Renovation mode finished." | "Back to work." (already used elsewhere - reuse) |
| monitor (walk-in detail) | "Manual same-day slot selection" | "Book a same-day time" |
| monitor (walk-in note) | "Choose one of the next capacity-safe openings." | "Pick one of the next open times." |
| front desk prompt | "Tee desk - [E] arrivals, check-in & walk-ins" | fine, keep ampersand? consider "check-ins and walk-ins" |
| ledger toast | "Carrying the club register. [Z] sets it down." | keep - already human |

## Pinned strings that move with their pins

- `tools/qa/walkin-asked-time.js` pins /could (I|we) get/ on the walk-in
  greeting - greeting edits update the driver in the same commit.
- `tests/dirt-medium-legend.test.js` pins medium labels/verbs.
- The C8 lamp driver reads the gate-ladder prompts verbatim - any prompt edit
  re-runs it, and `Designs/ProShop/LAMP_FIRST_TIME_PATH.md` captures the
  final strings then (deferred capture noted in that doc).
- `tests/walk-key-consumption.test.js` and the rebinding driver pin keycap
  TOKENS, not display letters - [E]-style tokens must survive the rewrite.

## Out of scope

Sim log/event text never rendered to the player; code comments (the brief is
explicit); the NamedGolfers dialogue register (spec-governed, arrives with
that slice).
