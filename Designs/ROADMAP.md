# Golf Simulator — Roadmap

**This is the single source of truth for what the game is, what is in Property 1, and
what is explicitly out.** The plan previously lived across `ProShop/SLICE_BRIEF.md`,
`FoundObjects/SLICE_BRIEF.md`, `NamedGolfers/SLICE_BRIEF.md` and a run of session
reports. Where those documents disagree with this one, this one is the plan; where they
go deeper, they own the detail and are linked.

**Every rejection here carries its reason.** A decision recorded without its rationale
gets re-litigated in three weeks, and then the argument is had again from memory instead
of from the record.

Status of this document: **PLANNING RECORD.** It authorizes nothing on its own. Slices
and phases execute only when the owner explicitly names them — see
`ProShop/SLICE_BRIEF.md` §"Document purpose".

---

## What this game is

You buy a failing golf property and restore it — with your hands, on the property,
one object at a time.

Three commitments follow from that sentence, and most decisions below are just these
three applied:

1. **Restoration is the game.** Everything else — the shop, the golfers, the ledger, the
   course — is a lens on restoration progress the player earned. The moment a system
   generates its own content, grants stats, or shortcuts a repair, it has broken the game
   it lives in. (`NamedGolfers/SLICE_BRIEF.md`, "The load-bearing rule".)
2. **Physical verbs, not menus.** You pick a thing up, you carry it, you use a tool on it.
   A menu with a timer is not a cheaper version of a physical verb; it is a different,
   worse game. (`FoundObjects/SLICE_BRIEF.md` §2.)
3. **Property 1 is underfunded and municipal.** Sage panelling, walnut trim, a failing
   public course. Features that only make sense at a rich club belong to a later
   property, not to a stretched budget here.

### Tone — a decision, not a preference

Grounded, dry, deadpan. **Not wacky.** Everything already built reads deliberately
understated, and PowerWash Simulator is completely deadpan for exactly this reason. A
club in the water is funny *because* it is reported flatly:

> "Foursome on 4 says a wedge went in the pond. They'd like it back."

No exclamation marks. No mission titles. No comedy register. This applies to every line
of player-facing text the game will ever ship — call-outs, complaints, acknowledgments,
toasts, laptop copy.

---

## SHIPPED

Working and player-facing today. Recorded here so it is not rebuilt.

| System | Where it lives | Note |
|---|---|---|
| Golf course view and course systems | `src/sim/course*.js`, `src/render3d/courseScene.js` | |
| **Build your own course (course editor)** | `src/sim/courseEditor.js`, `src/ui/courseEditor.js` | One of our strongest systems and a genuine differentiator. Not a candidate for rebuild. |
| Laptop / business management | `src/ui/laptop.js` | 24-page sim-honest back office |
| Checkout and cash/card flow | `src/render3d/clubhouse/simplifiedRegisterMode.js`, `src/sim/register.js` | Rounds 1–8 of play-test polish landed |
| Inventory, deliveries, boxes | `src/sim/shop.js`, `src/sim/deliveries.js` | |
| Cleaning tools + dirt/wetness | `src/data/cleaningTools.js`, `src/sim/cleaning*.js` | Broom rebuilt to House Flipper proportions |
| Customers and NPC foundations | `src/render3d/clubhouse.js` | |
| Save/reload and progression | `src/sim/progression.js`, `src/sim/shopProgression.js` | |
| **Locked content unlocked by playing** | `src/sim/progression.js` (`UPGRADES`, `purchaseUpgrade`), `src/sim/shopProgression.js` (category unlocks), `state.shop.unlockedTier` | Tool unlocks, shop level and upgrades all exist. **Do not build a second lock system.** |

### Open question on what already exists

**Is the progression LEGIBLE to the player?** We have unlocks, tiers and upgrades, but
nothing that answers "what is locked, and what unlocks it?" in one place. Knowing that is
worth more than adding another lock. Unassigned; not a slice yet.

---

## IN PROGRESS

- **Pro-shop vertical slice** — `ProShop/SLICE_BRIEF.md`. Phases 0–4 complete; the
  greybox floor plan is approved and built. Checkout presentation is at round 8
  (`ProShop/OVERNIGHT_REPORT_4.md` and the round-8 commit).
- **Cleaning-feel pass** — the broom is rebuilt; the remaining tools have not had the
  same treatment. This is a **hard prerequisite for NamedGolfers**, argued in that brief:
  a golfer thanking you for a repair that felt like clicking a menu is worse than no
  golfer at all.

---

## ACCEPTED FOR PROPERTY 1

Decided and in scope. Not authorized to execute until named.

### Course call-outs — a second delivery channel for NamedGolfers

**Not a separate system.** Same data, same loop, second channel: one grievance tied to
one real object, delivered by phone or radio instead of spoken at the desk. Folded into
`NamedGolfers/SLICE_BRIEF.md` — see that brief for the rules.

Why it earns its place: it answers one of the two open questions already recorded in that
brief. A complaint spoken in a busy shop gets missed; a call tells the player *where to
go*, which the in-person channel structurally cannot.

Rules, in brief: in-person for clubhouse and pro-shop fixations, calls for course
fixations (the player is rarely standing where a course problem is). Both channels
resolve identically. Two or three calls a day, never queued waiting. Calls **punctuate**
self-directed restoration — if restoration becomes chores between missions, the design
has failed.

### The driving range

A second restoration site with its own neglect: torn mats, a broken ball dispenser,
netting with holes, a picker that does not run.

Why it earns its place: it **earns revenue without a tee time**, it is smaller and
cheaper to build than a hole, and it gives golfers a reason to be on the property while
the course is busy. Strong Property 1 candidate on cost-to-value alone.

### The open/closed sign

**BUILT** — see "Implemented from this document" at the bottom.

---

## ACCEPTED, GATED ON THE COURSE EXISTING

**Nothing on the course has been built.** Everything in this section is unbuildable until
it is. Detail lives in `Course/SLICE_BRIEF.md` (STATUS: SPEC ONLY).

- **The beverage cart** — the only mechanic that puts commerce *on* the course, so the
  course earns continuously instead of only at check-in. Player drives it early,
  delegates later. It is a **maintenance object before it is a revenue stream.**
- **Planting mature trees as course design** — buying and placing grown trees to shape a
  hole. A strategic purchase that changes how golfers play, and it connects to the course
  editor.
- **Maintaining existing trees as restoration work** — dead limbs, storm damage,
  overgrowth swallowing a fairway, roots lifting a cart path. Same complaint → fix →
  acknowledgment loop as everything else, and it needs no growth system.

---

## LATER PROPERTIES

Recorded with reasons. **Do not build.**

| Idea | Reason it is not Property 1 |
|---|---|
| **Cafe or dining room** | A bigger-clubhouse feature. The whole point of Property 1 is that it is underfunded — a municipal course does not have a dining room, and giving it one erases the property's identity. |
| **Hot dog stand** | The cheap version of the same idea, and it would compete with the beverage cart for exactly the same role (food/drink revenue away from the till). One of the two, and the cart is the one that puts commerce on the course. |
| **Staff-specific reviews** (reviews naming an employee and their behaviour) | Depends on employees, which are cut from Property 1 (`ProShop/SLICE_BRIEF.md` §4 "Out of scope"). |

---

## REJECTED

Recorded with reasons so they stay rejected.

### Tree growth simulation — REJECTED

Planting saplings and waiting does not work at any day length we can ship. A tree takes
years; our fastest day is 45 real minutes. Either saplings mature in a week of game time
and nobody believes it, or the payoff sits decades out and the player never sees it.
Farming sims dodge this with crops that grow in days; **we have no equivalent.**

The two tree features that survive (planting mature trees, maintaining existing ones) are
above — both deliver the fantasy without a growth system.

### Cutscenes when buying a property — REJECTED

Camera work, timing and a script are expensive, and the payoff only exists once there are
properties 2 through 5 — which are cut from Property 1. 

**Cheap alternative, if we ever want the beat:** a still frame with a title card. It gets
most of the moment for a fraction of the work, and it is what we should reach for rather
than reopening cutscenes.

### Gold memberships — REJECTED (already cut)

Cut from Property 1 along with employees, tournaments, events and resort services.
Recorded here so the existing cut stays cut.

### Cut by the feature briefs, restated

- **NamedGolfers cut:** dialogue trees, friendship meters, romance, golfer-vs-golfer
  drama, procedural names, rosters of 100+, voice acting, golfers who give quests, real
  people. Each either industrializes what must stay hand-written, imports a genre this
  game is not, or costs what we will not spend.
- **FoundObjects cut:** randomized stat buffs from found objects — they make the sim's
  numbers illegible. An object's value is money, history, or display; never a hidden
  multiplier. NamedGolfers inherits this as its tier-reward rule: **tier completion
  rewards ACCESS, never stats.**

---

## Cross-references

- **Display is owned by the wall.** `NamedGolfers/SLICE_BRIEF.md` ("Two objects, not
  one") owns the display verb; `FoundObjects/SLICE_BRIEF.md` §5 defers to it. Confirmed
  still standing as of 2026-08-02. Scarce frame slots are what make displaying a
  decision; an unlimited FoundObjects shelf would be the same feature written twice,
  minus the decision.
- **Course call-outs** are a NamedGolfers delivery channel, not a system:
  `NamedGolfers/SLICE_BRIEF.md` → "Two delivery channels".
- **Course-gated features** live in `Course/SLICE_BRIEF.md`, which defers the
  complaint→fix→acknowledgment loop itself to NamedGolfers and the physical-verb rule to
  FoundObjects §2.
- **The beverage-cart attendant** is a named character and follows every NamedGolfers
  writing rule — fictional, hand-written, one fixation.
- **Scope boundaries for the current slice** remain `ProShop/SLICE_BRIEF.md` §4.

---

## Implemented from this document

**The open/closed sign** (2026-08-02). A physical sign on the clubhouse door, flipped
with E. Customers do not arrive until it reads OPEN; flipping to CLOSED stops new
arrivals while anyone inside finishes and leaves; the state persists across save and
reload.

Why it earned immediate implementation rather than a spec: it gives the day a shape.
Arrive, unlock, clean, stock, check the tee sheet, **then** flip the sign — and only then
does the pressure start. That preparation window is where restocking properly actually
pays off, and "am I ready to open?" becomes the player's judgment rather than a timer's.

Opening late costs customers. Opening filthy costs reputation. **No warning popup for
either** — the player learns it.

**Measured on a 1× day** (`tools/qa/shop-sign-day.js`, evidence in `qa/shop-sign/`):

- 60 real seconds at 09:00 with the sign **CLOSED: 0 customers**.
- The same 60 seconds with it **OPEN: 1 customer** — which is the shop's entire
  concurrent target on day one (the target clamps to 1 until sales history exists), so
  that is saturation rather than a thin sample.
- **1× pace:** 450 real seconds per game hour; the whole 6 AM–8 PM trading day is 105
  real minutes.
- **The preparation window is cheap**, which is the right shape — the player should feel
  invited to prepare, not punished for it:

  | Prep spent | Opens at | Trading day left |
  |---|---|---|
  | 5 real min | 06:40 | 95.2% |
  | 10 real min | 07:20 | 90.5% |
  | 20 real min | 08:40 | 81.0% |

Implementation: `src/sim/shopSign.js` (the rule), the E prop in
`src/render3d/clubhouse.js` (the object), `tests/shop-sign.test.js` (the contract).
