Overnight session. Everything below is authorised. Work the queue in order, do
not stop to ask, and do not end early on ambiguity — make the conservative
choice and log it.

## READ THIS FIRST — three items in this queue were already reported done

Price tags (C7), the settings menu (F1) and save robustness (F4) were all
reported complete in previous sessions. All three are wrong in the running game.
F1 was reported as "already built, verified it persists". F4 as "already right,
the deliverable is the proof".

So the standing rule tightens: for anything in this queue, a previous session
reporting it done is not evidence. Verify it yourself in Electron, at the
player's camera, before claiming anything.

## Standing rules — unchanged and non-negotiable

Electron only. Never Chrome. `npm run dev -- --clubhouse=pine-hills-v2`.

A green suite is not evidence. Five fixes on this project have shipped green and
had no effect in game.

Every visual or interaction item needs a screenshot from the running build at
the player's camera, or it is UNCONFIRMED — not complete.

Every new instrument gets a negative control before its result is trusted.

NPC work at 1x, shop OPEN, scriptedVisit exemption active.

Sub-items count separately. 2 of 4 is 2 of 4.

A clean negative result is a completed item. Do not manufacture a fix.

Full suite green before each commit. Commit incrementally and push.

## Pre-resolved decisions — do not stop for any of these

**Autosave interval:** 5 minutes. Also autosave on day rollover and on quit.
**Bag:** smaller than now, larger than the original. Judge it against the
monitor and reader beside it.
**Card reader theme:** lighter. Keep the amount dominant.
**Ledger:** per the ruling already recorded in #127 — the ledger IS the roster
book, the exclusion clause is superseded, an empty roster is blank pages.
**Texture pass:** the set is 19 files, not 12. Do all 19 or none.

---

# HOW TO RUN THIS SESSION

Four phases. Do not stop for my approval at any point.

## PHASE 1 — Plan

Write `Designs/ProShop/PLAN_12.md` before touching code. Per section:

- What you will change, at file level
- How you will VERIFY it in a running Electron build — the specific driver, the
  specific screenshot, the specific measurement
- The negative control that would catch the instrument being wrong
- What you expect to be hard, and what you might get wrong
- Rough time

Order the sections by dependency, and say which ones you expect not to reach.

## PHASE 2 — Adversarial review

Spawn three reviewers against the plan. Give each one this context: five fixes
on this project have shipped with a green suite and no effect in the game, and
roughly twenty instruments have been caught measuring the wrong thing.

Their job is NOT to improve the implementation. It is to predict where this plan
produces a false green.

- **Reviewer 1 — verification.** For each item, can the stated check actually
  fail if the fix does not work? Name every check that would pass on a broken
  build.
- **Reviewer 2 — history.** Read HARNESS_DEBT.md, DEFECTS.md and the recent
  overnight reports. Which items in this plan repeat a mistake already made
  here? Cite the prior instance.
- **Reviewer 3 — scope and order.** Where does one item silently break another?
  I2 changes run speed and I6 derives from it; L3 and L4 share a surface; J2
  changes what every tool cleans. Find the rest.

Write every objection into PLAN_12.md with your written answer beside it —
accepted and how, or rejected and why. Do NOT require agreement to proceed.
Unanimity produces the blandest plan, not the best one. Answer the objections
and go.

## PHASE 3 — Implement

Work the plan. Standing rules unchanged.

If reality contradicts the plan, follow reality and record the divergence. The
plan is a hypothesis, not a contract — several of this project's best findings
came from a plan being wrong.

## PHASE 4 — Adversarial verification, at the end

Spawn verification agents. They do NOT review code. They run the game.

Each gets a list of the items claimed complete and tries to prove the claim
false in Electron, at the player's camera. A screenshot showing the defect still
present beats any assertion.

- **Verifier 1 — the blockers and checkout.** H, K, L.
- **Verifier 2 — the tools and cleaning.** I, J.
- **Verifier 3 — the stranger.** Plays the first twenty minutes having read
  nothing. Reports every moment of confusion, in order, with timestamps. This
  one matters most and its output is a list, not a fix.

Anything a verifier breaks goes back on the NOT DONE list, however it was
reported.

Write the verification results into OVERNIGHT_REPORT_12.md as their own section.
If a verifier disproves something you claimed, say so at the TOP of the report.

---

# QUEUE H — blockers

## H1. Pressing `i` crashes the game

"The game has hit a problem. Your last save is untouched, reloading starts again
from it."

A single keypress kills the run. Reproduce it, find the cause, fix it, and add a
test. Then check every other single-letter binding for the same fault — `i` was
one of the keys added to the preventDefault list, so look there first.

## H2. Autosave

Every 5 minutes, on day rollover, and on quit. Rotating slots so one bad write
cannot lose the run. Show the player something small when it happens.

## H3. Price tags are still on items

C7 was reported done. Tags are still visible when an item goes through checkout.

Find every place a tag is created, drawn or referenced. Delete them. Then walk a
full sale and screenshot the counter with items on it.

---

# QUEUE I — the other tools

## I1. Every stick tool gets the broom's treatment

The broom is good now. Nothing else is. The mop still reads far away, has no
real animation, and does not feel like the broom does.

The broom's fixes were: viewmodel lens, hands at hip height, floor-anchored head
with a plant window, real sweep arc, weighted lag on direction change, hand
scale, grip stow on up-look.

Apply all of it to mop, vacuum, dustpan, scrub, sponge, spray, cloth, washer.

Most of this should be CONFIG rather than new code, since they share the
viewmodel. If a tool needs real code changes, say which and why — that is a
finding about the shared rig, not a chore.

Screenshot every tool at rest and mid-use, at the player camera.

## I2. Shift while brooming is far too fast

Running with a tool out reads as 100 mph. Reduce it. Report the measured yd/s
before and after, and say whether run speed should differ by tool.

## I3. The broom look-up still glitches

The head is anchored and the numbers are right, but the transition reads badly
on screen.

Target behaviour, stated plainly: the head stays on the floor, and when the
player looks up the broom simply leaves the frame. No hovering, no visible lerp
fighting itself, no stick without a hand.

Record the pan and watch it. Fix what you see, not what the numbers say.

## I4. The hands

Both hands are on the same side of the shaft, and the whole hand reads as low
quality.

The same-side grip was a deliberate change (handRollUpper -2.70 / handRollLower
-2.95) to put fingers camera-side on both. It looks wrong. Put them on opposite
sides the way a person holds a push broom, and solve the camera-side problem
some other way.

Then improve the hand mesh itself. Study reference footage. Screenshot at the
player camera and at crop.

## I5. E2's collider clamp — never finished

The tools' collision against fixtures was left open when E2 closed. A tool that
passes through a counter undoes the anchoring work. Finish it for all nine
tools, and screenshot each one pressed against a fixture.

## I6. pushSpeed was changed and NEVER PLAYTESTED

You derived it from WALK_SPEED × 1.15 after finding the old 2.6 was guarded by
an assert against a stale 2.2 while the player walks at 3.4. You said plainly
that you could not playtest sweeping.

Playtest it now. Walk forward at full speed while sweeping and confirm the pile
stays ahead of the bristles rather than being overrun. Your own driver returns
inconclusive — fix the driver or measure it another way, but do not leave a live
feel value unverified.

Do I2 first: if run speed comes down, the push speed derived from it moves too.

## I7. The known-blind constant

The broom handle length 1.247 is a hand-typed measurement of the shipped GLB
with no authority to import from. If the asset is ever re-exported, every test
that depends on it silently starts measuring the wrong broom.

Give it an authority — read it from the GLB at build time, or generate the
constant from the Blender source. If neither is practical, say why and leave it
in HARNESS_DEBT.md as permanently known-blind.

---

# QUEUE J — dirt and cleaning legibility

## J1. The reveal must show the OBJECT, not a marker

Q currently shows blue circles and flat orange patches. That tells me where
something is, not what it is.

Outline the actual dirt, debris and surfaces that need cleaning — a silhouette
or edge highlight on the thing itself, drawn through geometry. The player should
see the shape of what needs doing.

## J2. Every tool gets its own medium and its own colour

There are two media for nine tools. A vacuum should not clean what a mop cleans.

Define a real medium per tool class with a distinct colour, so the reveal is a
legend the player learns by using it. Where two tools genuinely overlap, say so
rather than inventing a difference.

Report the full tool-to-medium map and screenshot the reveal with each tool held.

---

# QUEUE K — checkout

## K1. The bag

Smaller than it is now. Add wrinkles and creases so it reads as paper. Fix the
stamp — it looks wrong.

## K2. The bag must always be there

It currently spawns once the player finishes placing items. A bag sitting on the
counter is where the items go; it should be there from the start of the
transaction, or permanently.

## K3. The cash hover

It highlights about 25% of the note's interior. I want the OUTLINE of the note
and nothing else.

## K4. The cash itself

Placed cash reads as random chunks of low-quality green paper. It must be the
same notes that are in the register drawer — same mesh, same materials.

And the cash on the table must visually represent the correct amount. If they
owe $24.36 and hand over $30, I should see notes that add up to $30.

## K5. Card reader theme

Too dark. Lighten it. Keep the amount dominant.

---

# QUEUE L — the front desk and the laptop

## L1. Tee-time check-in does not work

Checking a customer in at the time they asked for fails. Fix it, then verify at
1x across several requested times and report asked-versus-offered-versus-booked
for each.

## L2. The tee-sheet UI is unusable

32 times squeezed into 3 buttons. Rebuild it.

It should be obvious at a glance which slots are free, which are near what the
customer asked for, and which one you are about to book. Design it properly —
this is the screen the player uses most.

Screenshot it.

## L3. The ledger cannot be found

C9 was never built. Build it per #127's ruling.

A physical book on the front desk, opens in place with page turns, auto-records
what the game tracks. Blank pages are a legitimate day-one state.

It must be findable: visible on the desk, with a prompt.

## L4. Fixing a lamp still does not teach itself

"Ceiling circuit is dead" tells me what is wrong and nothing about what to do.

The player needs to learn, from the world: what is broken, what it needs, where
that comes from, and what to do. The ledger from L3 is a reasonable place for
standing instructions if the prompt cannot carry it.

Then write out the shortest path a first-time player takes, step by step.

---

# QUEUE M — customers

## M1. Nobody does both

Every customer either books or buys, never both. This has been reported three
times and measured as "1 of 1" in a window with one customer, which is not
evidence.

Make combined visits common. Report the buy-only / book-only / both split across
a full 1x day with a real number of arrivals.

---

# QUEUE N — the things reported done that are not

Re-verify each of these yourself in Electron before touching them. If one turns
out to be genuinely fine, say so and show me why.

## N1. F1 — settings menu
Resolution, fullscreen, FOV, master and category volumes, mouse sensitivity,
invert Y, graphics preset. Persisted. Screenshot it open.

## N2. F2 — full key rebinding
Every bound key, including the walk verbs. This was never started and you
correctly said it should land in one piece. Land it.

## N3. F3 — crash handling
Verify the log actually writes and the restart actually restarts. H1 gives you a
real crash to test against.

## N4. F4 — save robustness
Corrupt, truncated, wrong-version and empty saves. None may crash. Show the
messages.

## N5. F5 — first-run legibility pass
Play the first ten minutes as though you have never seen this game. Write down
every moment where you would not know what to do next, ranked by how early it
happens. Do NOT fix them. The list is the deliverable and it is the most
valuable thing in this queue.

---

# QUEUE O — writing and polish

## O1. Remove every em dash from anything the player reads

Prompts, toasts, menus, laptop copy, item descriptions, tooltips, error
messages. All of it.

## O2. Rewrite the game's copy to sound like a person wrote it

Current text reads dense and machine-generated. Short sentences. Plain words.
Say the thing.

Do not touch code comments — only strings the player sees.

## O3. Final polish pass

With everything above done, walk the whole game and fix what you find. Report
what you changed and what you left.

---

# QUEUE P — LAST

## P1. The texture pass, 19 files, one block

All 19 or zero. The positioning pre-check is already clear.

Per asset: CC0 sourced, UV, mapped, on-palette per ART_BIBLE §7.4.1, through the
shared pool and resolution ceiling. Report texture memory against the 150 MB
threshold before and after. Screenshot each against its untextured version.

---

Write `Designs/ProShop/OVERNIGHT_REPORT_12.md`. Per item: what changed, how
verified, screenshot path, meets the twenty-minute-stranger bar yes/no.

Close with UNCONFIRMED, NOT DONE, and UNASSESSED-AESTHETIC lists.

Reserve the last 30 minutes to commit, shelve anything half-done so the tree runs
clean, and write the report.