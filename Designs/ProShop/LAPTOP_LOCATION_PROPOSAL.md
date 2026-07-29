# Where the laptop should live — proposal

**Status: PROPOSAL. Nothing moved. Awaiting approval**, per the brief ("do not
move it until I approve").

The laptop is the back office: ordering, prices, deliveries, bookings, upgrades,
finances. It is opened dozens of times a session and it is the only way to spend
money. Where it sits decides how much of the room the player crosses to run their
own shop.

---

## 1. Where it is now, and what is actually wrong with it

`FRONT_DESK.laptop = frontDeskPose(-1.72, 0.08)` → **(1.58, 3.43)** building-local
under `pine-hills-v2`. That is on the counter top, at the **west end of the front
desk**, staff side. The seat is the office chair at (2.30, 4.40).

```
                          NORTH  (z −4.60)
     x −2.60                                              x 5.70
        ┌───────────────────────────────────────────────────┐
        │                                                   │
        │                  the retail floor                 │
        │                                                   │
  z 2.3 │              ①  ②  ③   ← the customer queue        │
        │        ┌──────────────────────────────────────┐   │
  z 2.94│        │                                      │   │  ← counter, customer face
        │        │  [laptop]                  [till]    │   │
  z 3.76│        └──────────────────────────────────────┘   │
        │         1.58                        3.82          │
  z 4.3 │        ▓chair▓        the staff corridor    →  ────┼──→ office
        │         2.30                                      │
  z 5.49└───────────────┤ MAIN DOOR ├───────────────────────┘
                          SOUTH  (the porch)
```

Three things are true about that spot, and only one of them is a problem.

**It is on the counter, which is right.** The laptop is shop equipment and it
belongs on the shop's own desk. Nothing about the pro-shop fantasy improves by
hiding it in a back office.

**It is 2.24 yd from the till, which is fine.** Ordering stock and serving a
customer are different jobs; they do not need to be within arm's reach.

**It is at the FAR END of a corridor with one entrance, which is the problem.**
The staff side of the desk is entered from the office (FLOOR_PLAN §7: *office →
corridor mouth at (5.65, 4.3) → till*). The laptop sits at **x 1.58** — the
west-most point of that corridor, 4.1 yd from the mouth, past the till and past the
chair. Every visit to the laptop is the full length of the corridor and back.

That was catastrophic while the corridor was unreachable at all (TILL-REACH-001,
fixed 2026-07-29 — a hand truck was blocking the only lane in). It is now merely
a long walk, which is why this is a proposal and not a defect.

---

## 2. Three options

### A — leave it where it is *(the null option, and it is not silly)*

- **Cost:** nothing.
- **What it gets right:** the seat, the focus camera, the campaign anchor, the
  boxPlacement reservation and asset 81's placement all key off
  `FRONT_DESK.laptop` and `FRONT_DESK.staffChair`. None of them move.
- **What it gets wrong:** every laptop visit is a 4.1 yd corridor walk each way,
  and the corridor is 1.13 yd wide with a chair in it.
- **Take it if:** the walk reads as "going to the back office to do paperwork"
  rather than as friction. That is a judgement about feel, which is why it is
  yours and not mine.

### B — move it EAST along the same counter, beside the till *(recommended)*

`frontDeskPose(-1.72, 0.08)` → **`frontDeskPose(1.44, 0.24)`** → world **(4.74,
3.59)**.

```
        ┌──────────────────────────────────────┐
        │                                      │
        │                    [till]  [laptop]  │
        └──────────────────────────────────────┘
                             3.82     4.74
         ▓chair▓ ← stays at 2.30, still the seat
              ← ← ← ← ← corridor ← ← ← ←  mouth at 5.65
```

- **Cost:** small, and entirely in `shopLayout.js`. One pose.
- **The walk:** 0.9 yd from the corridor mouth instead of 4.1. You step behind
  the counter and the laptop is right there.
- **The trade the player feels:** the laptop and the till share the east end of
  the counter, so "run the shop" is one place. Standing there you can see the
  queue.
- **What has to be checked before it ships** (all mechanical, all verifiable):
  1. `FRONT_DESK.staffChair` stays at (2.30, 4.40). The chair is the *seat*, and
     at 2.44 yd from the new pose it is no longer beside the laptop — so either
     the chair moves with it, or the laptop becomes a stand-up device and the
     seat pose is retired. **This is the real decision inside option B** and I
     want it made explicitly rather than discovered.
  2. `placeableCatalog.js` `laptop-seat` critical rect is derived from
     `staffChair`, so it follows whatever (1) decides.
  3. The focus camera: `walk.focusOn` is given the laptop pose, so it follows
     automatically — but the shot now looks WEST along the counter into the
     till block rather than east into open corridor. That composition needs a
     look before it ships, not an assertion.
  4. `REGISTER.printer` sits at `frontDeskPose(1.08, 0.28)` → (4.38, 3.63).
     The proposed laptop pose is 0.36 yd east of it. Too close: one of the two
     moves, or the laptop goes to `frontDeskPose(1.75, 0.24)` → (5.05, 3.59)
     and clears it by 0.67.

### C — move it to the office desk

`OFFICE.desk` is at **(8.35, 4.20)**, through the corridor mouth and into the
service wing.

- **Cost:** moderate. New seat, new focus camera, and every anchor listed in (A)
  is re-pointed rather than nudged.
- **What it gets right:** it is where a real club manager does paperwork, and it
  gives the office a job. The office currently has a desk nobody uses.
- **What it gets wrong:** ordering stock becomes a trip out of the shop, through
  the stock lane, into another room. In a game whose loop is *see an empty shelf
  → order more*, that is a lot of floor between the observation and the action.
  It also puts the laptop behind a door, and the last time something the player
  needs was behind a door in that wing, it was unreachable for a build.
- **Take it if:** the intent is that the back office is a place you go, and the
  shop floor is for serving. That is a bigger design position than a pose.

---

## 3. Recommendation

**Option B, at `frontDeskPose(1.75, 0.24)` → (5.05, 3.59)** — the clearance-safe
variant from B(4) — **with the chair question answered first.**

The laptop belongs on the shop's own counter and at the end of it you can
actually reach. What I do not want to do is move it and silently orphan the seat:
the chair is the laptop's seat today, and 2.5 yd away it is just a chair. Two
coherent answers, pick one:

- **B-sit:** the chair moves with the laptop to `frontDeskPose(1.75, 1.05)` →
  (5.05, 4.40). You sit at the east end. Costs one more pose; the `laptop-seat`
  rect follows; check it does not foul the corridor mouth at 5.65 (0.60 yd
  clear at 0.72 chair width — tight, and worth measuring rather than trusting).
- **B-stand:** the laptop becomes a standing device at the counter, the chair
  stays where it is as the desk's own seat, and the seat pose is retired. Fewer
  moving parts, and standing at a counter laptop is what a pro-shop assistant
  actually does.

I lean **B-stand**: it removes a coupling rather than relocating it, and the
corridor is 1.13 yd wide — a chair in it is a thing to walk around whichever end
it sits at.

**Nothing is moved. Awaiting your pick of A / B-sit / B-stand / C.**
