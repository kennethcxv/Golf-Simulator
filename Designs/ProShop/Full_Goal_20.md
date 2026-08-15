# Full Goal 20

Everything below comes from me playing the build. **Every line is an
INSTRUCTION, not a defect report.** If a line is genuinely ambiguous, take the
reading that CHANGES the game, and record which you took.

---

## FIRST — I TESTED THE TIP. EVERYTHING BELOW IS CURRENT.

Three of last night's fixes genuinely landed and I am not asking for them again:

- **The card is no longer vertical.** It lies flat now. It still phases through
  the fingers — that is E2, and it is the only card item left.
- **Items no longer poke out of the bag's mouth.** A different fault replaced
  it — see E1.
- **The double set-down animation is gone.** The gesture still reads wrong, which
  is F5.

Still broken on the tip, confirmed by me: the white plane under the shoes
(Goal 18 G1, image 2), placed items popping bigger when the last one lands, the
mop, the broom's head angle, the queue, the desk screen, translations, and
performance. Each of those that was previously reported DONE goes on the fifth
running list with what its check measured.

## THE STOP RULE STILL APPLIES

More than 5 commits or 45 minutes on one item: STOP, write what you found, put
it on NOT DONE, move on.

## STANDING RULES

Electron only, `--clubhouse=pine-hills-v2`. A green suite is not evidence.
Visual items need a screenshot at the **default player camera**. Every
instrument gets a negative control. Every fix gets a check you have **watched
fail**. Suite green before each commit. Commit and push per item. Every section
ends with its Phase 4 adversarial verification, and **a verifier finding is the
next item, not a note for later.**

---

# A — THE QA MOUSE TRAP. Do this first; it costs me every session.

When you test the game, **my cursor gets locked inside the Electron window and I
cannot get it out until you are finished.** I cannot use my own machine while you
work.

Fix it. The requirement, stated as behaviour:

- **The QA window must never capture my cursor.** Not for a frame.
- Real-input fidelity must survive — you established that synthetic events lie,
  so do not solve this by going back to them.
- Say what you did and what it cost.

Directions worth measuring: run the QA Electron instance with its own window
that never takes OS focus; release pointer lock between driver steps; drive
input through the window's own event target rather than the OS cursor while
still going through the real input path; or run the QA instance on a separate
virtual display. **You pick, you measure, you tell me the trade.**

If it genuinely cannot be solved without losing real-input fidelity, say so
plainly and tell me the least-bad option.

---

# B — THE MOP. Sixth attempt. Give it real physics.

The mop is unchanged in feel. It is rigid and animated. What I want:

## B1 Study House Flipper's mop and match it

Search for footage. Watch it. **Write in the report what it does that ours does
not**, then match it. This has been asked three times and never done as
research — do the research first this time.

## B2 Real physics, not an animation curve

The strands should behave like wet cotton on a stick:

- pressed to the floor they **spread out and flatten**
- moved side to side they **flow and trail**, then settle
- direction changes **whip** them
- nothing about it should read as a canned loop

**Use a real solution rather than hand-writing another lag curve.** You have
`three-mesh-bvh` vendored; there are also verlet/rope solvers small enough to
vendor, and Blender can bake cloth or hair simulation into the asset. Look at
what exists, pick one, and say why. A hand-rolled fourth lag parameter is the
thing that has failed five times.

## B3 The fibres look low quality

Even grey and moving, the individual strands read as coarse sticks. More of
them, finer, with variation in length.

## B4 The broom's strand physics are GOOD — leave them

The broom's strands are right. **The broom's head is still sideways** — fix that
and nothing else about the broom's strands.

---

# C — THE PHONE AND THE EMAIL. Make them real.

The bones are in and they work. Now make them worth having.

## C1 Far more traffic, far more often

Calls and emails both trickle too slowly to matter. **Many more of each, much
more frequently.** Report the measured arrivals per day before and after.

## C2 A real phone, not a call log

- **Missed calls I can call BACK** — pick the row, ring them, and they answer.
- **Voicemail.** A missed caller leaves a message I can play.
- Everything else a phone does that would earn its place here.

## C3 More apps, and better ones

More GTA-like, and more useful for THIS game. Decide what belongs and say why.
Candidates worth considering: a tee-sheet glance, the day's takings, supplier
ordering, a weather forecast, staff, a contacts list that grows into the named
golfers. **You choose — the test is whether I would open it more than once.**

## C4 Online reservations come ONLY through email and the phone

No other channel invents online bookings. Walk-ins ask at the desk; everyone
else calls or writes.

---

# D — THE DESK AND THE QUEUE

## D1 "IN QUEUE" is still wrong, and the time-ask is in the wrong place

Two rules:

- **"IN QUEUE" means this person is physically standing in the line right now.**
  Not waiting ten minutes ago, not just walked in the door.
- **I only see what time they want when they are AT THE DESK in front of me
  asking for it.** A person in the line has not asked yet.

## D2 Nobody books a tee time hours ahead as a walk-in

It was 6:44 am in the clubhouse and people were teeing up for 8:30. **A walk-in
cannot book 8:30 when it is 6:46.** Make the clock move faster if that is what
it takes for the day to work — but the bookings have to correlate with the time
on the wall.

## D3 The checkout table's TOTAL sits too close to UNIT

Image 1. They run together and read as one number, and it will get worse with
larger totals. Space that column properly and check every other numeric column
on that screen for the same fault.

---

# E — THE BAG AND THE CARD

## E1 A long item passes out through the bag's LEFT AND RIGHT SIDES

The mouth is fixed — nothing pokes out the top any more. But a long item is
still wider than the bag, so it now exits through **both side walls at once**,
which reads worse than the original fault.

Your packing rule clamps a body inside the anchored volume; a body that does not
fit gets clamped and still intersects the paper. **A long item must stick out of
exactly ONE end — the mouth — and never through a side wall.** So when a body's
longest axis will not fit the interior, stand it UP along the mouth axis and let
it lean out the top, the way a club or an umbrella actually sits in a bag.

Add the case to the golden bag pose: one long item plus two short ones.

## E2 The card still phases through the fingers

Image 3. Flat and angled now, which is right — but the fingers pass through the
plastic. Seat it in the pinch so nothing intersects.

---

# F — THE LEDGER

## F1 Rebuild the book's UI to be intuitive and legible

Not a tweak. The whole interface: what a page shows, how sections are found, the
type, the hierarchy. It should be obvious at a glance where I am and how to get
anywhere else.

## F2 The sound effects are horrendous

Replace them. A real book: a soft leather creak on the lift, a proper paper
sweep on the turn, a dull board thump on the close. Layered and pitch-varied.

## F3 Q closes the book, not Esc

## F4 Both E and D turn the page — pick one

E is the forward key. D should not also turn pages.

## F5 It still opens and closes strangely

The double animation is gone. It still does not read as a book being picked up,
opened, closed and set down. Watch the whole gesture frame by frame and fix what
you see, not what the state machine says.

---

# G — NPCs. They must never walk into anything.

The 1-second rule reacts after the fact. **I want them to not get stuck in the
first place.**

A customer should detect that continuing on their current line would put them
into a box, a fixture, the counter or another person, and **change course
before contact**. Add that logic — a look-ahead along the intended path, not a
recovery after the collision.

The 1-second rule stays as the safety net underneath it.

---

# H — SOUND

## H1 The main menu has no sound

Clicks on New Game, Settings, everything. It is silent and reads as broken.

## H2 The money sounds

- **cash going down on the desk** — notes and coins, different
- **the card coming out**
- **taking cash from the register drawer** — the current one is poor, make it
  better

---

# I — THE LOADING SCREEN

Make it immersive. Real images of the club and the course, tips that teach
something, the club's name, a sense of place. Right now it is a veil and thirteen
seconds of nothing — the stranger verifier called that out too.

---

# J — PERFORMANCE. Buttery smooth. This is not a demanding game.

It still feels laggy. You measured the real lever last night: **2,413 draw calls,
not the matrix walk (1.3 ms).** Go after it.

- **Merge static meshes per material.** The runtime batching pattern is already
  proven on 10 props — apply it to the interior.
- Then re-run the cap ladder. **If 120 paces cleanly, flip the default.**
- Report draw calls, GPU ms, CPU submit ms, achieved fps per cap, and the worst
  frame in a 60-second indoor walk, before and after.

Say plainly whether the first-equip and first-ledger stalls still fire.

---

# K — TRANSLATIONS

Still 59% — 114 keys × 9 locales. **Finish them, accurately.** If a locale
cannot be done to native quality, name it and say why rather than shipping a bad
table.

---

# PHASE 4 — ADVERSARIAL VERIFICATION, at the end of every section

Verifiers do NOT read your code and do NOT treat your report as evidence. Real
keyboard, real mouse, real pointer lock, default camera, no state forcing.

**VERIFIER 3 — THE STRANGER runs FIRST**, before any fix, as it did last night.
Twenty minutes from the main menu having read nothing.

**VERIFIER 1** attacks the five stale-suspect items in the opening section, then
every DONE claim in A, B, D, E.

**VERIFIER 2** attacks C, F, G, H, I, J, K.

Anything a verifier breaks goes back on NOT DONE and is fixed before you move
on. If a verifier disproves a claim, say so at the TOP of the report with what
the original check measured.

---

# REPORTING

`Designs/ProShop/OVERNIGHT_REPORT_20.md`, as you go, under 2,000 lines.

Five running lists: UNCONFIRMED, NOT DONE, VERIFIER FINDINGS STILL OPEN, FIXED
BUT NOT ASKED FOR, and **REPORTED DONE PREVIOUSLY, FOUND FALSE** — with the
check that passed and why, every time.