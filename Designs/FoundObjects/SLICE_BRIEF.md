# Found Objects — Slice Brief

**STATUS: SPEC ONLY.** Nothing in this document authorizes implementation. No code, no
assets, no data files. A slice may only be executed when the owner explicitly names it.

> **Provenance note (2026-07-30):** the owner's working copy of this brief was referenced in
> direction ("FoundObjects §2 / §4 / §5") but was not present in the repository. This file
> reconstructs those sections from the owner's dictated fragments so the NamedGolfers
> cross-reference and the amendments below have a durable home. If an original lives outside
> the repo, merge it over this skeleton — the **Amendments**, **Open Questions**, and
> **First Slice** sections below are the new, authored content and must survive that merge.

---

## The load-bearing rule

Found objects come out of the restoration the player is already doing — lockers, attics,
crawl spaces, the office safe. **Finding is a by-product of restoring, never a separate
minigame**, and nothing found may grant stats or shortcut a repair.

## §1 — The system (reconstructed summary)

Restoration work occasionally surfaces objects with history: a battered old club, signed
balls, tournament memorabilia, photographs. Each is a small physical thing the player can
hold, examine, and decide about.

## §2 — Physical verbs (reconstructed summary)

Interacting with a found object uses the game's physical grammar — pick it up, turn it over,
carry it — never a menu that resolves the object from a distance. A menu with a timer
violates this section's spirit as much as an outcome roll would.

## §3 — Where objects come from (reconstructed summary)

Objects are seeded by location during restoration. WHERE something was found is real data
(see Open Question 1 below — it is also the cheapest appraisal signal).

## §4 — What was already cut (reconstructed summary)

Randomized stat buffs from found objects were cut explicitly: they make the sim's numbers
illegible. An object's value is money, history, or display — never a hidden multiplier.
(NamedGolfers inherits this as its tier-reward rule.)

## §5 — Value and the appraisal fork (reconstructed, then amended)

A found object can be **quick-sold** for a safe small price or **appraised** for a fee that
reveals its true value. A wide value range between junk and treasure is what makes the fork
a decision. ~~Display it in the clubhouse.~~

**AMENDED 2026-07-30 — display is deferred to NamedGolfers.** The clubhouse wall with its
scarce frame slots (Designs/NamedGolfers/SLICE_BRIEF.md, "Two objects, not one") owns
display. Scarcity is what makes displaying a decision; a FoundObjects display verb with
unlimited shelf space would be the same feature written twice, minus the decision. A
restored find in a frame slot is both a FoundObjects outcome and a NamedGolfers eligibility
signal — one wall, one scarcity, two systems reading it.

---

## OPEN QUESTIONS — recorded, deliberately unanswered

1. **The appraisal fork is under-specified.** Quick-sell vs pay-to-appraise is only
   interesting if the player can form a *belief* about which is right. That requires visible
   signals that correlate imperfectly with true value — a battered old club might be a
   worthless reproduction or a genuine persimmon, and the battering alone must not settle
   it. §5's "optionally a wide value range" is not optional; **it is the mechanic.** The
   cheapest signal source is already in the data: **WHERE it was found.** Signed balls in a
   staff locker are usually fake; in the office safe, usually not.

2. **"Restore it" is listed as a player choice and never defined.** Existing cleaning tools
   on a small object, or new tooling? A menu with a timer violates §2's spirit as much as an
   outcome roll would — but a full miniature-restoration toolset is a slice of its own.
   Undefined until someone argues a scope.

---

## First slice — proposed

(NamedGolfers has a first slice; this brief previously had none. Proposal:)

**One category, three objects, the fork, nothing else.**

- One category: old clubs.
- Three hand-authored objects spanning the value range — a reproduction, a decent club, a
  genuine persimmon — with visible signals that only imperfectly separate them.
- Found in existing restoration locations; picked up with existing carry verbs.
- The quick-sell / pay-to-appraise fork, with the fee and both payouts real money.
- NO display (the wall belongs to NamedGolfers), NO restoration verb (Open Question 2), NO
  additional categories.

The slice proves the only thing that needs proving: that the player forms a belief before
the fork and feels the result as their own judgment.

---

## Cross-references

- Scope and status: **Designs/ROADMAP.md**.
- Display: **Designs/NamedGolfers/SLICE_BRIEF.md** — the wall owns it (see §5 amendment).
  **Re-confirmed 2026-08-02:** the collision is still resolved this way; the wall owns
  display, this brief defers.
- Tier rewards over there inherit §4's cut here: access, never stats.
- §2's physical-verb rule is inherited by **Designs/Course/SLICE_BRIEF.md** — a course
  feature resolved from a screen is a worse version of the same feature.
