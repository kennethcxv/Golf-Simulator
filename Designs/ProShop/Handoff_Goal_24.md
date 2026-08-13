# Goal 24 — Handoff

You are picking up mid-brief from another agent. **Read this whole file before
touching anything.** Every line is an INSTRUCTION.

---

## THE ONE RULE THAT MATTERS MOST HERE

The agent before you spent 30 hours and closed **one** item from a fourteen-item
brief. It was not short of skill — the item it closed is the hardest in the
document and it solved it beautifully. It went 22 hours without a commit while
building a 3,041-line write-ahead log nobody asked for, and never touched the
thing I had called the production priority.

So:

- **Do not redesign anything.** If a fix needs a new subsystem, it is the wrong
  fix. Write down why and move on.
- **5 commits or 45 minutes per item.** Then NOT DONE, and the next item.
- **Push after every item.** Nothing lives only in the working tree, ever.
- **Order is not a suggestion.** Section 1 first. It has had zero minutes across
  two sessions while everything around it got polished.

If you finish the list, come back and deepen. Nobody has finished the list.

**When two of these pull against each other, this is the order:**

> **PLAYER EXPERIENCE > REQUIRED VERIFICATION > ARCHITECTURAL CLEVERNESS.**

And do not spend hours proving theoretical failure states that are not in this
brief. That is precisely what the last 22 hours went on.

---

## SECTION 0 — ORIENT. Verify, do not trust the report.

The previous agent's handoff report is a claim, not evidence. Spend your first
half hour establishing what is actually true, and write the answers at the top of
your own report:

1. **Is the tree clean and pushed?** If anything is uncommitted, commit it to a
   branch before you do anything else.
2. **Does the full suite pass?** Run it. Name any red test.
3. **Is the golden gate trustworthy?** `golden-capture.js` was mid-rewrite. Run
   `npm run golden`. If it is not 12/12, that is your first item — **do not
   rebaseline**, diagnose. A wrong lens cost this project a week already.
4. **Which files carry mixed-author hunks?** Some ledger WIP from a third agent
   was edited into `keyBindings.js`, `i18n.js` and `main.js`. Know what you
   inherited before you edit those files.
5. **Is recast wired into production, or only into a QA bake?** The CSP now
   permits WASM. A navmesh baked in a QA driver and never used by a walking
   customer is the zero-call-sites shape, and this project has shipped that four
   times.

**About the settlement write-ahead log:** it is live in `completeSale`. Do not
extend it, do not build on it, and do not revert it without asking me. If an item
in this brief tempts you into it, stop and say so.
Also spot-check three Codex claims that its own report marked unproven:
(1) the bag — is bagFill actually gone, and are empty and filled pixel-identical
under a fixed camera? (2) the crosshair rule — does any scenario fail with it
reverted? If not, say whether it should be removed rather than proven.
(3) C3 — is there an early return bypassing the corridor-clear check?
---

# SECTION 1 — RETURN TO CARD. The core loop is stuck.

I bag every item and **the customer never hands me the card.** The sale cannot
complete. This is the single most important thing in the file and it has had no
attention in two sessions.

**The flow, step by step. The transition at step 7 is the bug:**

1. Customer picks products and reaches the counter.
2. I scan and bag every product.
3. Customer asks for a **specific tee time**, or asks to check in for a booking.
4. I open the desk screen.
5. I book, adjust to another valid time, or refuse.
6. The desk action completes.
7. **The desk screen exits by itself and the register workspace and camera come
   back.** Camera, focus, pointer-lock state, register stage and prompts must
   match the normal check-in flow. I must not have to back out of the computer
   to discover the card is waiting.
8. Customer presents payment.
9. One payment. Booked: goods and green fee on one ticket. Refused: goods only,
   and the sale is never lost.
10. Customer leaves; the next one can proceed.

Cover all of: accepted at the requested time, adjusted to another time, refused
or unavailable, check-in for an existing booking, card, cash if that path exists,
and the laptop's clear-the-counter action while wedged. No double banking, no
lost products, no duplicate green fee, nobody leaving unpaid.

**Prove it on a clip** — one customer, shelves to counter to desk to card to bag
to door — and assert the return to checkout by observing the real register camera
and the card target, not by reading a workspace string.

## 1B Refusing a tee time must not lose the sale

- Tee time refused or booked out: **they still pay for the goods.**
- Tee time booked: **goods and green fee, one payment.**

## 1C The tee-time ask must name a time

A customer who wants a tee time asks *"have you got a time free today?"* and
never says when, so there is nothing to book. They ask for a **specific time**,
like every other walk-in, which I then offer, adjust or refuse.

## 1D The status line

It says *"all items are being bagged, the customer's cash is being prepared"*
even when a tee time is pending. Say what is actually happening.

## 1E A laptop button to make a customer leave

For when the game wedges. Small, and it makes every other bug survivable.

---

# SECTION 2 — THE BAG SHOWS NOTHING

There is a kraft-coloured block at the bag's mouth that grows with each item —
it was added so the bag would read as full. **Delete it.** Empty and full look
identical. An item sinks in, stops being drawn, and nothing takes its place.

---

# SECTION 3 — NPCs

The CSP permits WASM now, so the real fix is available.

- **Wire recast into production routing.** A QA-only bake proves nothing.
- **A customer blocked by the queue walks around it**, rather than grinding into
  the back of the line.
- **Nobody passes goods through the body of the person in front**, and nothing is
  handed over before they reach the desk.

---

# SECTION 4 — THE LEDGER

- **A hotkey to open it.** Asked for three times. Binding table.
- **Holding it locks me in place completely.** A previous check measured exact
  zeros for movement and I can still walk, so whatever it measured was not the
  mover I am using — **say what that check measured before you change anything.**
  While the book is open, none of these do anything: WASD, controller
  translation, mouse-look, controller camera look, camera drift, tool cycling,
  world interaction. The camera stays on the book. Escape still gets me out.
- **A hover outline** when I aim at it, like the money in the drawer.
- **Smooth open, close and page turns.** It opens the right way now and it snaps.
  Film it, watch the frames, fix the easing you see.

---

# SECTION 5 — THE MOP AND THE BROOM

## 5A The mop reads as separate rods with gaps

I want **one mass — no daylight between strands.** Seven passes have gone into
guessing the count. Decide the *shape* of the answer first and say which you
took: many more thin strands that overlap into opacity, flat ribbons that overlap
into a sheet, or modelled geometry through `golf-assets`. Then photograph it.

It is also **too reactive** — heavier and more damped. Wet cotton.

## 5B The broom head is still tilted right

A contact sheet of candidates already exists. **Pick the one that is square to
the floor, bake it, photograph the result.** Do not send me another sheet.

## 5C The hands are bad, and this is the fifth time

Both hands, both tools. The lower one is a blob; they read as low-poly lumps.
**This is mesh work, not a slider.**

---

# SECTION 6 — AUDIO

Every sound is synthesized from oscillators, which is why the ledger sounds like
static and electricity. There is not one audio file in the repository. The sample
player and licence gate are already built.

## Where to get them — you do not need to ask me

Prefer CC0 so the game can ship without attribution complexity.

- **Kenney UI Audio** — CC0 — https://kenney.nl/assets/ui-audio
- **Kenney Interface Sounds** — CC0 — https://kenney.nl/assets/interface-sounds
- **Kenney Casino Audio** — CC0 — https://kenney.nl/assets/casino-audio
- Other Kenney packs only after checking that pack's own page says CC0.

For book, page, foley or music that Kenney does not cover: Freesound filtered to
CC0 or Attribution, OpenGameArt where the **downloadable file itself** is marked
CC0 or CC-BY, or another library with an explicit commercial-use licence.

**Never:** NonCommercial, vague "royalty free" with no licence text, a preview
file whose download has a different licence, or a runtime call to a remote audio
API. Remote sources are for obtaining assets during development only — the
shipped game plays vendored local files.

Vendor everything and record it in `THIRD_PARTY_ASSETS.md`: local filename,
source page, original title, creator, licence and version, required attribution,
any conversion you performed, date obtained. Normalise, trim silence, short
fades, no clipping.

**If a sound you need genuinely cannot be sourced under those terms, tell me what
it is and I will fetch it — but exhaust the list above first.**

## The work

- **Kill the loud mower/static noise at startup.** It is the first thing anyone
  hears and it sounds broken. Find the actual source — a stray oscillator, a bad
  loop seam, a duplicated node, a decode error — and remove or replace it. Do not
  just lower the master volume.
- **Every main-menu button makes a sound**, including inside dialogs. Some do,
  some do not. Disabled controls stay silent; keyboard activation sounds the same
  as a click; nothing double-fires on bubbling.
- **The register drawer opening** is silent.
- **Cash going in is continuous** — a run of impacts for as long as money is
  going in, not one hit.
- **Background music**, quiet and loopable, licence named.

---

# SECTION 7 — THE REST, IN ORDER

- **Global Escape router** — small, high value, never started.
- **The crosshair overrules the station.** If I am aimed at the ledger, the
  prompt says ledger. `walkStationPropInReach` is overruled; this is decided.
- **Tool-cycling hitch.**
- **Merge static meshes per material** — 574 draw calls standing, 942 peak, 838
  static meshes on 290 materials. Never started.
- **The ledger UI rebuild** — "where am I" and "how do I get anywhere else" are
  closed; the rest stands.

---

# PHASE 4

**VERIFIER 3 runs at the END.** One question: **can a stranger complete one full
customer — items, tee time, one payment, bag, out the door?** That is Section 1's
real verification and no unit test substitutes for it.

Verifier 1 takes Sections 1–3 on clips. Verifier 2 takes 4–7. A verifier finding
is the next item, not a note for later.

---

# STANDING RULES

Electron only, `--clubhouse=pine-hills-v2`, greybox stays. A green suite is not
evidence. Anything that MOVES needs a clip with the frames viewed and named. Every
fix gets a check you have watched fail, and **assert the revert changed the file**
— a silent no-op revert has produced a false green in this repo before. Suite
green before each commit.

**`FOUND_FALSE.md` is the law.** Anything on it cannot be marked done again
without a clip. Read it before you start; it has eight distinct shapes of
"the check passed and the thing was broken", and you will hit at least two.

---

# FINAL GATES

Before you call any section complete: its focused tests green, the full suite
green, the golden gate green where it applies, the Electron evidence captured, no
unexplained dirty files, and everything committed and pushed.

# REPORTING

`Designs/ProShop/OVERNIGHT_REPORT_25.md`, under 2,000 lines, appended as you go.

Per item: what changed, the evidence path, the commit hash, and any limitation
you are aware of. Where a section had numbers — performance, draw calls, coverage
— give before and after.

Two numbers at the top, both of which have been more useful than any other line
in three reports:

1. **How many fixes were verified by a check that could perceive what it
   certified** — pixels looked at, frames viewed, audio recorded — versus a
   property read.
2. **How many of your own probes lied to you.** The previous sessions logged 13
   and 16. A zero here means you are not looking hard enough.