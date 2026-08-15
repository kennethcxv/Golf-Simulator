# GOAL 26 — PLAYTEST ROUND 4

I auditioned the sounds. My picks are below, plus what still needs replacing.

Work this in the order written. Finish each item before starting the next.

**TWO OF THESE ARE SECOND REPORTS.** Items 4 and 5 were fixed and measured last
session and I am still seeing them in play. Do not re-run the old check and
conclude they are fine — the check passed and the game did not, so the fix is in
the wrong place. Find the path the game actually takes.

---

## 1 — THE AUDITION RESULTS. APPLY THESE, THEN REPLACE THE REST.

### Winners — make these the defaults and delete the losing options

| Family | Winner |
|---|---|
| Menu button | **felt tap** |
| Drawer open | **wood drawer deep** |
| Cash landing | the one closest to **paper money** |
| Ledger close | **book close** |

Delete the other options in those four families and remove their files. I do not
want them coming back by re-vendoring, the way the Kenney sci-fi set did.

### Losers — I did not like ANY of these. Source more.

- **Ledger pickup / grab** — none of them. Get more candidates.
- **Ledger page turn** — none of them. Get more candidates.

For both, source in the same character as the winners above: warm, physical,
real. Paper and board, a book being handled by a person. At least four new
candidates each, all CC0 or CC-BY, all in `THIRD_PARTY_ASSETS.md`, all in the
audition picker so I can choose again.

### The reference for the drawer

**Go and listen to Book Store Simulator's cash register opening sound.** That is
the target — the shape, the warmth, the polish of it. Match that character.

---

## 2 — THE CASH REGISTER TIMING IS STILL WRONG

You sequenced it and the sequence is now too generous.

- **The gap between the drawer opening and the cash going in is too long.**
  Tighten it. The cash should start close behind the drawer, not after a pause.
- **The cash sound runs past the animation.** It must stop the moment the last
  piece lands, not a beat later. Right now it lasts too long.
- **ADD A SOUND FOR CLICKING THE CASH IN THE REGISTER TO HAND IT TO THE PLAYER.**
  Taking change out of the drawer to hand over is silent. It needs its own voice,
  distinct from putting cash in and distinct from picking it back up.

---

## 3 — THE MOP: REMODEL IT PROPERLY, AND STOP IT MOVING

### 3a. Build it to match the reference image

The head is better but it is still not the reference. **Model it properly** —
through `golf-assets`, or by driving Blender headless with a Python script if
Blender is available on this machine, or by generating the geometry directly.
Whichever you choose, say which and why.

I want it polished and matching `Designs/ProShop/Images/Goal_26/MopReferenceImage.png`:
a dense uniform disc of microfibre, the hub clamping it cleanly, strands that
read as continuous loops rather than separate rods.

### 3b. The strands have far too much physics

They move too easily. Right now they swing when I am merely **looking around**,
which is wrong — turning my head is not moving the mop.

**The strands should only move when I am holding the left mouse button — when I
am actually mopping.** Carried, walking, turning, looking: they hold still.

**Note:** 5.2 gave you separate carry and active tunings, and the carried tuning
still lets them swing. This is stricter than "barely move" — carried is
**effectively still**. Change the carry parameters accordingly and update that
test rather than working around it.

---

## 4 — SECOND REPORT: ITEMS STILL PHASE THROUGH THE BAG

You fixed the counter layout and measured 0.127 yd of overlap removed. **I am
still watching customers place items through the bag.**

So the layout is not the path being taken. Look at `item.placedAt` — you noted
yourself last session that it **overrides the computed layout with no overlap
check**. If the customer's placement writes a position directly, your layout fix
never runs for the case I am seeing.

Find the path the customer actually uses, and prove the fix on **that** path —
with a customer really placing goods, not by calling the layout function.

---

## 5 — SECOND REPORT: MY BODY STILL BLOCKS THEM, PLUS SOMETHING NEW

You built `playerBlocksCustomers` and measured walk-in-place frames 110 → 0. **I
am still being walked into.**

- Re-check that the predicate covers the states I am actually in during play, not
  just the four you staged. If it regressed, find when.
- **NEW, and not previously asked for:** when I come back from the ledger or the
  register and a customer is standing inside me, **I should just move a bit.**
  Push me clear gently, or push them clear — either way nobody stays inside
  anybody. Do not teleport me across the room.

---

## 6 — THE NPCs ARE STILL GETTING STUCK ON THE LINE

They still jam trying to reach merchandise past the queue instead of going
around it. **I see this in ordinary play.**

Your Phase 3 verifier concluded the failure was your own staging — the errand
went to a customer 17.4 yd away, outside the building. That verdict is about your
driver, not about the game, and the game is still doing it in front of me.

So build the scenario from **what I actually do**: open the shop, let real
shoppers arrive on their own, let a queue form naturally, and watch a shopper
whose target is behind that queue. No injected errand, no synthetic goal.

Then fix it properly. **Use the best tool available** — recast's crowd/Detour
avoidance, a better library, or your own implementation if that is genuinely
better. I want this system excellent, not adequate. Say which you chose and why.

---

## 7 — THE LEFTOVERS FROM LAST SESSION

**7a. The rake is a detached hand.** You identified it: four finger capsules, a
palm, a thumb, two cuff plates and the cuff roll, floating in the sky, while a
second hand still grips the shaft. Fix it. Also: `setTool('rake')` returns
success while **no `Tool_rake` exists in the scene at all** — chase that too.

**7b. `deskAction('exit')` returns `ok: true` twenty-five times and does nothing.**
The desk offers exit as a live, non-disabled hotspot while the register is
inactive. A control that reports success and changes nothing is worse than a
disabled one. Fix it.

**7c. The crash log has a per-frame `checkout.refused.sale-refused` storm.** You
found it while hunting the ledger freeze and nobody has chased it. Do that now —
it may also be the freeze.

**7d. Finish the stranger.** Your driver never got inside, so the three-customer
half never ran. Follow the tutorial's own prompts rather than guessing a heading.
And answer the question it raised: on Day 1 at 6:01 AM the shop is shut and
nothing tells a new player to open it.

**7e. The static mesh merge.** You measured it and reported dedup is NOT required
— 1446 standing calls, −47.6% available against a 30% target, 17 points of
headroom. Go ahead and do it.

---

## STILL MY DECISIONS — DO NOT GUESS

- **4.1, time compression.** Golfers move at fixed wall speed, so compressing the
  day makes rounds proportionally longer. I decide whether the cap lifts for the
  course population or route distances shrink.
- **5.1, mop density.** Goal 25 says daylight between bunches stops it reading as
  a brush, with a test behind it; my reference is a packed disc. I decide.
- **The strand thickness bar** you raised from 8 mm to 11 mm. I will say if
  10.2 mm reads as pipe.

Item 3's remodel and physics are **not** part of those decisions. Do them.