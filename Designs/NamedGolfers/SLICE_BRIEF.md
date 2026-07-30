# Named Golfers — Slice Brief

**STATUS: SPEC ONLY.** Nothing in this document authorizes implementation. No code, no
assets, no data files. A slice may only be executed when the owner explicitly names it.

---

## The load-bearing rule

**The book never generates golfers.** Course condition and prestige decide who becomes
eligible to arrive; conditions decide whether they stay. Restoration remains the gate to
everything. The ledger and the wall are *lenses* on progress the player earned out on the
grass and in the shop — the moment either one produces a golfer, grants a stat, or shortcuts
a repair, the system has broken the game it lives in.

A corollary that is not negotiable either: **tier completion rewards ACCESS, never stats.**
A tier-completion buff is the same shape as the randomized stat buffs FoundObjects §4
explicitly cut for making the sim's numbers illegible. If filling the Club Champion page
made greens grow back 4% faster, every number on the laptop would stop being trustworthy.
Completing a tier makes the next caliber of golfer *eligible*. That is all it does.

---

## The system

Roughly **30 hand-written named golfers** on Pine Hills. Five per tier, six tiers. No
procedural generation. No roster of 100. Every one of them written by a person, with a name,
a grievance, and a return line.

**No real people.** Real golfers' names and likenesses require licensing we do not have and
will not pursue. Every golfer is fictional. This is settled; do not re-raise it.

### Tiers — diegetic, not letter-graded

Visitor → Member → Club Champion → County → Regional → Touring Pro

"S-tier" in a leather-bound clubhouse ledger reads like a gacha game. The golf vocabulary
already tells the player what the rank means: a County player outranks a Club Champion the
same way it does in the real world, and nobody needs a legend explaining it.

---

## The core loop — this is the mechanic; the journal is packaging

**complaint → fix → acknowledgment.**

Every named golfer arrives with ONE grievance tied to a real object in the world. Not
"conditions poor" — the men's room tap drips, bunker 7's sand is like concrete, the third
green never drains.

- They mention it on arrival or exit, repeatedly. **Mildly annoying is correct.** The
  irritation is the design working: it is what makes the fix feel like shutting a door.
- The player repairs the actual object. No menu, no toggle. The tap is a thing in the world
  with a wrench verb; the bunker is sand the tools already touch; the drainage is course
  work that costs real money and days.
- Next visit, **unprompted**, they notice. Tolerance rises, spend rises, a referral unlocks.
  The acknowledgment line is the payoff of the whole system and gets writing attention
  accordingly.

### Tier the grievance

A Visitor complains about a dripping tap. A Touring Pro complains the third green does not
drain. **The tier ladder IS the difficulty curve** — climbing it means solving harder, more
specific, more expensive problems. By the time a Regional walks in, their fixation should be
something the player has to plan a week around, not something fixed between customers.

---

## Two objects, not one

### The ledger — the record

A bound book on the front desk. It opens in place with physical page turns — a prop, not a
stat screen. It **auto-records**: every named golfer's first visit, the date, their
signature, visit count, best round, and the fix that won them over.

- **No decision lives in the ledger.** It is the roster browser, the progress record, and
  the loss record. Completionists chase blank pages.
- The aging "last visit" date is doing quiet, important work — see Departure below.

### The wall — the decision

A scarce number of frame slots in the clubhouse. The player chooses what goes in: signed
scorecards, a framed signature, restored memorabilia. **Filling a slot makes prospects of
that caliber ELIGIBLE to arrive.**

- Scarcity is the point. If every trophy fits, nothing on the wall says anything.
- The wall OWNS display for found objects too — see the cross-reference below.

### Cross-reference: the wall owns display

FoundObjects §5 previously said "display it in the clubhouse." That was this feature written
twice. **The wall owns display**, because scarce slots make displaying something a decision,
and FoundObjects/SLICE_BRIEF.md now defers its display verb here. A restored persimmon
driver in a frame slot is simultaneously a FoundObjects outcome and a NamedGolfers
eligibility signal — one wall, one scarcity, two systems reading it.

---

## Departure matters more than arrival

Past a golfer's tolerance they simply **stop appearing. No notification, no warning.** A
Saturday comes and Dale is not there. The ledger's aging last-visit date is how the player
reads the loss — the book quietly turning into a record of who used to come here is the
strongest consequence this system has, and a toast would ruin it.

Lapsed golfers can be won back by fixing their fixation. **The return line should land** —
it is the emotional peak of the loop and earns the same writing attention as the
acknowledgment beat.

---

## Referrals

A loyal golfer with their fixation resolved brings **one linked golfer** within a few weeks.
The newcomer arrives as a prospect with their own — usually harder — fixation. Chains climb
in caliber: the Member you won over knows a Club Champion; the Club Champion knows somebody
on the county circuit. Referrals are how the tier ladder feels like a community rather than
a menu unlocking.

---

## OPEN QUESTIONS — recorded, deliberately unanswered

1. **What happens after a fixation is resolved?** If nothing, the golfer goes inert and the
   emotional engine fires once per person — thirty beats and done. If they get a new one, it
   risks reading as whack-a-mole and cheapening the first fix. This decides whether the
   system has legs, and it is not decided here.

2. **How does the player learn a fixation?** Mentioned on arrival or exit will be missed in
   a busy shop. There needs to be a persistent place to read outstanding complaints — and
   the ledger as specced records the *past*, not a to-do list. Whether that place is a page
   in the ledger, the laptop, or something else is open.

---

## CUT — not deferred

Dialogue trees. Friendship meters. Romance. Golfer-vs-golfer drama. Procedural names.
Rosters of 100+. Voice acting. Golfers who give quests. Real people.

Each of these is cut because it either industrializes what must stay hand-written (rosters,
procedural names), imports a genre this game is not (romance, drama, quests), or costs what
we will not spend (voice, likeness licensing). None of them are "later." They are cut.

---

## First slice

**6 hand-written golfers.** One fixation each, all inside the pro shop or clubhouse — no
course-work fixations yet, so the slice does not gate on course tooling.

- The three-state loop: complaint → fix → acknowledgment.
- Persistence across days and reloads.
- The ledger prop with auto-signing and a last-visit date.
- **NO referrals. NO wall. NO lapsing.** The slice proves the loop's feel; the systems that
  scale it wait until the loop has been felt.

---

## Ordering — argued, not assumed

This system starts **after**: the pro-shop slice completes, a stranger plays it, and the
cleaning-feel pass lands.

The argument: the acknowledgment beat only works if the fixing itself feels good. A golfer
thanking the player for a repair that felt like clicking a menu is worse than no golfer at
all — it draws attention to the weakest verb in the game. The cleaning-feel pass is
therefore a hard prerequisite, not a preference. And a stranger playing the slice first
means the loop's pacing gets tuned against real impatience, not ours.
