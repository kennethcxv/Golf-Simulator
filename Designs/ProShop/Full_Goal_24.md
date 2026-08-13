# Full Goal 24

**Every line is an INSTRUCTION.** Ambiguity resolves toward the reading that
CHANGES the game; record which you took.

This is more than one night. Work it in order, do not stop to ask.

---

## THREE DECISIONS, ANSWERED. Do these first, they cost minutes and unblock work.

1. **Take the CSP commit.** `'wasm-unsafe-eval'` is approved. It permits
   WebAssembly compilation only, the broad `'unsafe-eval'` stays refused by name,
   and your own test pins the header directive by directive. Commit it, then
   vendor recast and bake the navmesh — **section C from Goal 23 has been blocked
   on this and it is the answer to the NPC problem.**
2. **The broom roll: pick it yourself from the contact sheet.** You built the
   sweep, you have thirteen candidates, and the head must be **square to the
   floor** — that is the whole criterion. Choose the one that is square, bake it,
   photograph the result. Do not send me a sheet again.
3. **The crosshair wins over the station.** If I am aimed at the ledger, the
   prompt says ledger. `walkStationPropInReach` is overruled — a documented rule
   that a stranger and I both read as broken is broken.

## FOUND-FALSE, AGAIN — and the first one is your own fix

| Item | Reported | Reality |
|---|---|---|
| **F, the bag** | faked, item hidden, "any size always clean" | **Image 3: a flat layer at the mouth that grows with each item.** That is `bagFill` |
| **I2, the book locks me** | measured 0.0000 forward, 0.0000 strafe | I can still walk with WASD while holding it |
| **I1, the ledger hotkey** | in Goal 22, in Goal 23 | There is no hotkey |
| **A2/G2, the money sounds** | notes, coins, deposit voices, stacking | I hear nothing when cash goes in |

**For I2 say what the check measured.** You recorded exact zeros. Either the
driver held keys in a state I never reach, or it measured a different mover than
the one WASD drives. Find out before changing anything.

## STANDING RULES

Electron only, `--clubhouse=pine-hills-v2`. A green suite is not evidence. A
check that reads a property has perceived nothing — **and this session proved
that seven times over in your own probes.** Anything that MOVES needs a clip with
frames viewed. Assert the revert changed the file. Suite green before each commit.
Commit and push per item.

---

# A — THE BAG SHOWS NOTHING

Image 3 is `bagFill` — the kraft block you added so the bag would read as full.
**Delete it.** No block, no mass, no contents at the mouth. The bag looks exactly
the same empty or full.

An item travels to the mouth, sinks in, stops being drawn, and **nothing appears
in its place.** That is the whole instruction and there is no case where anything
shows.

---

# B — THE CHECKOUT IS BROKEN AND IT BLOCKS PLAY

## B1 The customer never hands me the card

I bagged everything and the sale will not complete — no card offered. This is the
core loop and it is stuck. Reproduce it the way I hit it: a real customer, real
scanning, real bagging, and find where the flow stops.

## B2 The tee-time ask has no time in it

A customer who has bought goods and wants a tee time asks *"have you got a time
free today?"* and **never names one**, so there is nothing for me to book.

They must ask the way every other walk-in asks: **a specific time**, which I then
offer, adjust, or refuse. Same flow, same wording shape, same desk buttons.

## B3 The status line is wrong when a tee time is in play

It says *"all items are being bagged, the customer's cash is being prepared."*
When there is also a tee time it must say so — *"items bagged, the customer wants
a tee time"* or better.

## B4 Refusing the tee time must not lose the sale

- **Tee time refused** (booked out, or I decline): they still pay for the goods.
  Just the goods.
- **Tee time booked**: they pay for the goods **and** the green fee, one payment.

## B5 A button on the laptop to make a customer leave

When the game wedges or I do not want them there, I need a way to clear them.
Put it on the laptop.

---

# C — NPCs. Now that the CSP is in, do the real thing.

## C1 Vendor recast and bake the navmesh

It is the only candidate that generates a navmesh from your geometry, and it
carries crowd avoidance. Vendor it the way you vendored `postprocessing`.

## C2 A customer blocked by the queue must walk AROUND it

I watched one run continuously into the back of the line instead of going round.
An agent never grinds against anything, ever.

## C3 Nobody passes items through the person in front

The walking-into-backs is fixed — thank you. Now they hand goods **through** the
body of the person being served, before their turn. Nothing crosses another body,
and nothing is handed over until they are at the desk.

---

# D — THE DOOR STALL. You found it. Fix it.

Your own measurement: **2.9 to 13.1 seconds, five runs in seven, 100% inside the
draw submit, on the APPROACH, nothing created, not the shadow map.** The press
itself is clean.

That is a complete diagnosis. Go after what the submit is doing on those frames —
and say plainly whether it still fires afterwards.

---

# E — THE MOP

## E1 Too reactive

The physics is good. It moves too much and too easily. Heavier, more damped —
wet cotton, not rope on a string.

## E2 It still reads as separate pieces stuck together

Image 1. It is a comb of pale rods with daylight between every one. **I want one
mass: each strand reading as a single strand, and NO GAPS.**

You have said yourself that guessing the count again is the loop this tool has
been stuck in for seven passes. So decide the shape of the answer first and say
which you took:

- **many more thin strands** that overlap into opacity — now viable, because the
  solver actually runs
- **flat ribbons** rather than round rods, which overlap into a sheet at far
  lower cost
- **modelled or cloth-baked geometry** through `golf-assets`

Then photograph it — you can reach the head in one run now.

---

# F — THE BROOM

## F1 The head is still tilted right

Image 2. Bake the value from your own contact sheet. Square to the floor.

## F2 The hands are bad and this is the fourth time

Both hands, both tools. The lower hand is a blob. They are visibly low-poly and
they do not read as hands.

**This is mesh work, not a slider.** Fingers that read as fingers at viewmodel
distance, a thumb on the correct side, enough geometry not to look faceted. Go
through `golf-assets` if that is what it takes.

---

# G — THE LEDGER

## G1 A hotkey to open it

Asked for in Goal 22 and Goal 23. Routed through the binding table.

## G2 I can still move while holding it

Lock me in place, exactly like the cash register does. Say what the previous
check measured first.

## G3 A hover outline when I aim at it

Like the money highlight in the drawer. I cannot tell when it is selectable.

## G4 Opening, closing and page turns must feel smooth

It opens the right way now. It is not smooth — the motion snaps. Film it, watch
the frames, and fix the easing you see.

## G5 The sounds are still static and electricity

Not a tuning problem. **See section H.**

---

# H — AUDIO. Real recordings, and the honest blocker.

You reported there is not one audio file in the repository, that the sample
player and licence gate are built, and that you could not get recordings —
freesound needs a key and Wikimedia returned photographs.

**So tell me exactly what you need and I will fetch it.** A list: the filenames,
the sound each one is, the licence you can accept, and where to put them. One
message from you and this unblocks.

Meanwhile, do the parts that need no files:

## H1 Every main-menu button makes a sound

Some do, some do not. Every one, including inside the dialogs.

## H2 The register drawer opening

No sound at all when it opens.

## H3 The cash going in must be continuous

Not one impact — **a run of them, "trrrrrrr", for as long as the money is going
in.** It stops when the last piece lands.

## H4 Background music

The kind these simulators have — quiet, loopable, unobtrusive. CC0 or CC-BY, and
name the licence.

---

# I — WHAT IS STILL OWED FROM GOAL 23

- **J** — merge static meshes per material. 574 draw calls standing, 942 peak,
  838 static meshes on 290 materials. Never started.
- **I3** — the ledger UI: you closed "where am I" and "how do I get anywhere
  else". The rest of the rebuild stands.
- **The mop head photograph** — you have it now. Use it.

---

# PHASE 4

**VERIFIER 3 runs at the END.** One question: **can a stranger complete one full
customer — items, tee time, one payment, bag, out the door?** Section B is what
that verifies.

**VERIFIER 1** — A, B, C on clips. **VERIFIER 2** — D through I.

A verifier finding is the next item.

---

# REPORTING

`Designs/ProShop/OVERNIGHT_REPORT_24.md`, under 2,000 lines. Keep the perception
ratio at the top, and keep counting how many of your own probes lied — that count
has been the most useful number in three reports.