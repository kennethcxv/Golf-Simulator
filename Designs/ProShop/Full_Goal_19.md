# Full Goal 19

Everything below comes from me playing the build you shipped last night.

**Every line here is an INSTRUCTION, not a defect report.** Do the thing it says.
If a line is genuinely ambiguous, take the reading that CHANGES the game rather
than the one that preserves it, and record which you took.

---

## READ THIS FIRST — FOUR ITEMS WERE REPORTED DONE LAST NIGHT AND ARE STILL BROKEN

| Item | Reported | Reality |
|---|---|---|
| **B4** ledger open glitch | *"Verified: the same frame window now shows the full boards through the swing"* | Still shows a bare page with no cover for a moment, then corrects itself |
| **B5** double set-down | *"CANNOT REPRODUCE"* — traced at per-frame resolution | It plays the animation twice. Every time |
| **F2** 1-second stuck rule | *"watched fail with the old threshold restored"* | NPCs still walk continuously into boxes, into the counter, and into each other without changing course |
| **E1** broom grip | *"picked and baked frame.yaw = 0.02, both hands verified on screen"* | Still slanted. Lower hand is a shapeless blob, upper hand is backwards |

**For each of these four, before you change anything:** say what the check
measured and why it passed while the thing was broken. You found the mechanism
behind this class last night — two customer populations, and tested code with
zero production call sites. **Check each of these four against those two shapes
first.** The instrument being wrong is the more likely explanation than the fix
being wrong.

**And the B5 trace deserves special suspicion.** You traced `bookState` per
frame and saw one clean pass. I see two animations. Either the trace watched a
route I do not use, or the second animation is not a state change at all —
something re-entering the same state, or two objects animating where I see one.

## THE STOP RULE STILL APPLIES

More than 5 commits or 45 minutes on one item: STOP, write what you found, put it
on NOT DONE, move on. It worked last night. Keep it.

## STANDING RULES

Electron only, `--clubhouse=pine-hills-v2` (the greybox stays). A green suite is
not evidence. Visual items need a screenshot at the **default player camera**.
Every instrument gets a negative control. Every fix gets a check you have
**watched fail**. Suite green before each commit. Commit and push per item.

---

# A — THE PHONE AND THE EMAIL. The biggest item in this brief.

Last night you built a ring chip and one inbox row. **That was the seed. This is
the feature.** These two channels are going to carry reservations, named golfers,
suppliers and complaints for the rest of the game, so build them as real systems
rather than as a booking mechanism with a UI stuck on it.

## A1 THE PHONE — model it on GTA's phone

That is the reference I want. Study it:

- **A hotkey brings it up.** It slides in from the bottom right and sits there
  while the world keeps running. **I keep control the whole time** — I can still
  look around and walk. Same key puts it away.
- **Pick the hotkey and route it through the binding table** so it appears in
  Controls and in the on-screen control line like every other verb. `T` is my
  suggestion; if it collides, choose and say which.
- **A home screen with apps.** Navigate with the mouse or the movement keys.
- **It rings.** Audible ringtone, an on-screen indicator even when the phone is
  down, a caller ID with the name, and Answer / Decline. An unanswered call
  becomes a missed call — it does not vanish.

**The apps it ships with:**

- **Phone** — incoming calls, call history, missed calls. A golfer calls asking
  for a tee time; I hear what they want and book it, offer an alternative, or
  turn them down.
- **Contacts** — everyone who has called, with their history. Named golfers
  belong here as they become known.
- **Messages** — a text channel for short things a call is too heavy for.

Design it so more apps can be added later without rebuilding the shell. Say in
the report what the app surface looks like and how a new app plugs in.

## A2 THE EMAIL — on the work laptop

A real email client, not a card on an existing page:

- **An inbox with a list and a reading pane.** Unread state, sender, subject,
  time. An unread count visible from the laptop's home screen.
- **Booking requests arrive as emails I read and answer** — accept into the tee
  sheet, decline, or reply proposing a different time.
- **Other mail belongs here too:** supplier order confirmations, complaints,
  whatever the game already tells me through toasts that would read better as
  mail. Say which existing notifications you moved and which you left alone.

## A3 Both channels feed one sheet

Phone bookings, email bookings, walk-ins and the auto-generator all land on the
same tee sheet with the same three states (free, reserved-and-expected,
checked-in) and record their channel. **No second booking path.**

## A4 How a player learns each one

Say it in the report. The phone ringing teaches itself; the email needs a reason
to open the laptop.

---

# B — THE QUEUE. Two separate faults.

## B1 The line forms SIDEWAYS. Make it single file.

Image 7 and image 5: customers stand shoulder to shoulder across the counter.
**I want a single-file line running BACK from the desk**, one behind another, the
way a queue actually works. The person at the front is served; everyone else is
behind them.

Also in image 5: a customer is clipping through the counter. Fix that too.

## B2 "IN QUEUE" is lying

Image 2. The check-in screen lists people as **AT DESK** and **IN QUEUE** who are
not there. One of them asked ten minutes ago and left; another had only just
walked in.

**"IN QUEUE" must mean: this person is physically standing in the line, right
now.** Not "asked earlier", not "is somewhere in the building". If they leave the
line, the row leaves the list or changes state.

**This is very likely the two-populations bug again** — the desk list reading one
population while the room contains another. Check that first.

---

# C — CHECKOUT

## C1 Items STILL stick out of the bag

Image 1. The black object sits clear of the bag's mouth. You reverted this last
night after four attempts and said the bag's authored anchor probably needs
re-authoring in `checkout/shopping_bag.glb`.

**Do that.** Re-author the anchor in Blender through the `golf-assets` skill,
with the viewport look, so the packing code has a frame it can trust. Then pin a
golden pose at the bag so it cannot regress invisibly — you named that yourself
as the right treatment.

## C2 The card is vertical and phasing through the fingers

Image 1. The card stands upright like a little sign and the fingers pass through
it. **A card handed over is held flat**, pinched between finger and thumb, angled
toward me. Make it read like a real card being offered.

## C3 Items change size when they land

Placed items sit smaller than they should, then when the last one goes down
they all pop bigger in a little animation. Whatever is rescaling them at that
moment, stop it. One size, from the moment they leave the customer's hand.

---

# D — THE LEDGER

## D1 The open glitch is still there

Image 3. Press E and for a moment the book is a bare page with no cover, then it
corrects itself. Exactly what B4 claimed to fix.

## D2 The same glitch on putting it back

Image 4. Same bare-page frame on the way down.

## D3 It still plays the set-down animation twice

See the note at the top. Find the second one.

## D4 One key for opening and for turning right

Opening the book and turning to the next page should be the **same key**. Do not
make me learn two.

---

# E — THE MOP AND THE BROOM

## E1 The mop is completely unchanged. Same instruction as before.

- The head looks bad: too few, too chunky, wrong colour. **Rebuild it** — many
  fine strands, damp, hanging heavy, greyish rather than white.
- **The stroke follows how I actually move the mouse** — side to side, back and
  forth, circles — not one canned axis.
- **Pressed to the floor the strands splay out** and flatten.
- **The strands move whenever the mop moves**, including while I walk and turn,
  not only while the button is held.

This is asset work through `golf-assets` plus the stroke seam you located in the
feel file. You scoped both last night. Build them.

## E2 The broom's hands are wrong and the head is still slanted

Image 6:

- **The lower hand is a shapeless blob.** It reads as a lump, not a hand.
- **The upper hand is backwards** — the thumb and fingers are on the wrong sides.
- **The head is still slanted**, not square to the floor, despite yaw 0.02.
- There are **shader artefacts** on the shaft and head.

Use the tuning overlay, screenshot each candidate at the default camera, and give
me the values you set.

---

# F — SETTINGS UI

## F1 The scrollbar is a browser scrollbar

Image 8. It is the native OS scrollbar — completely different from the game's own
UI — and it sits flush against the top of the page, which reads as broken.

Style it to match the game: the palette, the corner radius, the weight of
everything else on that screen. Give it margin so it does not touch the top
edge. **Same fault on the Display page** — fix every scrolling surface, not the
one I photographed.

## F2 Translations to 100%, and accurate

You reported 54% at best. I want every language complete and correct, not machine
drafts. Report the honest per-language coverage after, and if any language cannot
be done properly, say which and why rather than shipping a bad table.

---

# G — PERFORMANCE. Better, and nowhere near ready.

The framerate cap and the GTAO cut helped. It is still not a shippable frame.

You named the next lever yourself: **8.0 ms of CPU-side render submit for the
un-frozen ~2,208-object clubhouse subtree.** That is the whole reason 120 does
not pace. Go after it.

- Freeze the static subtree's matrices properly this time — you found the earlier
  attempt never reached the interior.
- Then re-run the cap driver. **If 120 paces cleanly, flip the default to 120**,
  which your own comment in `preferences.js` says to do.
- The action stalls (first equip, ledger open, first look) are the exhaustive
  negative. **Do not reopen them.** But say plainly in the report whether they
  still fire, because they are what I feel most.

Report GPU ms, CPU submit ms, achieved fps at each cap, and the worst frame in a
60-second indoor walk, before and after.

---
# PHASE 4 — ADVERSARIAL VERIFICATION. Required, at the end of every section.

Spawn verifiers. They do NOT read your code and they do NOT read your report's
claims as evidence. They run the game with real keyboard, real mouse, real
pointer lock, the default camera, no state forcing, and try to prove each DONE
claim FALSE.

A screenshot showing the defect still present beats any assertion you have made.

VERIFIER 1 — THE FOUR REGRESSIONS. Its only job: B4, B5, F2 and E1. For each,
reproduce the way I did — open the ledger and watch the first frames, put it
back and count the animations, follow a customer into an obstacle for ten
seconds, equip the broom and look at both hands. It reports what it SEES, in
words, before any number.

VERIFIER 2 — EVERY OTHER DONE CLAIM in this session. Same discipline. Where a
golden pose exists, use it. Where one does not and the item is visual, say so —
that gap is a finding.

VERIFIER 3 — THE STRANGER. Twenty minutes from the main menu having read
nothing. Every moment of confusion, in order. This has been asked for three
times and has never run. If it does not run this session, say why at the TOP of
the report.

ANYTHING A VERIFIER BREAKS GOES BACK ON NOT DONE and is fixed before you move
on. A verifier finding is the next item, not a note for later.

If a verifier disproves something you claimed, say so at the TOP of the report,
and say what the original check measured.
# REPORTING

Append to `Designs/ProShop/OVERNIGHT_REPORT_19.md` as you go. Keep it under 2,000
lines. Per item: what changed, how verified, the screenshot path.

Four running lists at the bottom, updated continuously: UNCONFIRMED, NOT DONE,
VERIFIER FINDINGS STILL OPEN, and anything you fixed that I did not ask for.

**And add a fifth list this time: REPORTED DONE PREVIOUSLY, FOUND FALSE.** Four
items are on it already. Every time you find another, the entry names the check
that passed and why it passed.