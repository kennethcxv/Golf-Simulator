# OVERNIGHT REPORT 22

## THE LINE YOU ASKED FOR, AT THE TOP

**Fixes verified by a check that could actually perceive the thing it certified:
2 of 3.**

| Item | Verified by | Perceived, or a property read? |
|---|---|---|
| Section 1 — the front door | a 130-frame clip, frames viewed, `frame-0095.png` at 23.50 s named | **PERCEIVED** — pixels I looked at |
| A2 — the main menu sound | a Web Audio tap recording every node, start and gain, with its own negative control | **PERCEIVED** — audio I recorded |
| L — translations to 100% | key counts per locale against the English key set | a property read |

The translation count is honestly a property, and I am not going to dress it up:
nobody read 2,538 translated strings. What changed there is that the property is
now the RIGHT one — see section L.

---

## VERIFIER 3, THE CLOSING RUN: **A STRANGER GOT INSIDE.**

> **"YES. I GOT INSIDE."** — shot-014, *"OBJECTIVE ✓ Enter the closed clubhouse
> — done."*
>
> "It took **14 commands** (6 of them real inputs). I never once felt lost
> getting in. The door is dead ahead of the spawn, the walk is about three
> seconds, and the prompt at the door is unambiguous. **Whatever was changed
> today, the front door problem is solved.**"

Two strangers previously spent a combined 45 minutes and never got through. This
one was inside in six inputs.

The opening run died on a model quota after 172 screenshots. Its last message was
*"can ANY door in this game open?"* — the front door, reproduced by a stranger in
their own words, without knowing what I had found.

## WHAT THE VERIFIER FOUND ONCE INSIDE — all NOT DONE, all new

Ranked as they ranked them. These are the next session's queue.

1. **A grey slab swallowed the camera.** shot-065 is a 100% flat grey screen —
   walked forward and ended up inside the geometry, HUD floating on a void.
   shot-077: one untextured grey slab eats 60% of the lobby, with a visible gap
   under it so it reads as floating. *(This is the greybox — 61/62/63 are
   deliberately suppressed — but a stranger reads it as "the level isn't
   finished", and one of them is enterable.)*
2. **Total silence on E at things** — shot-023, shot-058, shot-060, including at
   an object the game itself named. The engine gives good refusals elsewhere
   ("blocked: Vacuum and mop the lobby…"); it just says nothing when the answer
   is "nothing here". **This is 1A's silence rule, still open indoors.**
3. **An object is named with no verb.** shot-056: "Rangefinder display — Laser
   rangefinder 3/6 — backroom empty", same prompt styling as actionable prompts,
   no key at all.
4. **The prompt bar is sticky** — shot-054 and shot-062 show it advertising
   objects the crosshair is nowhere near. "I cannot trust the prompt bar to tell
   me what I'm aiming at."
5. **B means two things.** The tool wheel labels "4 | B | Push broom"; pressing B
   opens **Build mode** (shot-088). "A stranger will trip this every time."
6. **Tool use is taught only by failing.** Broom equipped, E at debris →
   silence (shot-095). Only a click produced "Hold the button down to use a
   tool" (shot-097).
7. **Tab overview from indoors shows dense forest**, no clubhouse, none of the
   "18 dirty spots marked" (shot-069) — **M1 confirmed by a second stranger** —
   and returning via Tab silently drops mouse-look (shot-073 pixel-identical to
   shot-067).
8. **The PRO SHOP sign floats in mid-air**, attached to nothing, clipping the
   door frame, cropped to read "HOP" (shot-077, 088, 097, 100).
9. **The task card double-prints**: a faded second text layer bleeds under the
   header from shot-030 to shot-102, and the body text was stale at shot-016.
10. Untextured grey placeholders through the retail space, including **a grey
    block floating in mid-air** beside the ledger (shot-102); counter has a grey
    top and end cap with a wood front.
11. Hard stepped banding across the counter surface (shot-105, shot-109).
12. **The interior is unreadably dark at 6:00 AM** — shots 014–027 near-black in
    the upper third. Fine by 8:00.
13. Collision has no feel: nose-first against flat surfaces, no slide, no cue.
14. "Recover any missing **authored** workstation" — dev jargon in player UI.

What they praised: the door, the tee desk and tee sheet, the tool wheel's key
legend, the layered carton interaction (tape → flap → armful), the clutter haul
bumping shop condition 9→10, and the laptop back-office — "the most
finished-looking thing in the build".

## THE GOLDEN GATE IS FAILING, AND I DID NOT REBASELINE IT

`npm run golden`: **12 of 13 poses FAIL** at 7.75–9.17% against thresholds of
0.25–0.75. `bag-packed` is the only pass, at 0.

It is not tonight's work. Nothing I changed touches `shop-floor`,
`stockroom-wall` or eleven tool poses. And looking at the diff images, the
changed pixels are **edges only** — wall/floor seams, counter edges, the door
frame — with flat interiors untouched. That is an antialiasing or sub-pixel
signature, not a content change.

I suspected GPU contention, because the first capture ran while the verifier's
Electron was live. **Refuted**: re-run alone, the numbers reproduce to four
decimal places (8.4134 both times). It is deterministic.

The baseline was last accepted at `c27d3a2`, and render-loop changes have landed
since — notably X4's `ensurePlayerPin()` call added to the top of `render()`.

**I have not run `golden:accept`.** Accepting would bake in whatever changed and
destroy the only evidence of it. This needs a bisect between `c27d3a2` and HEAD,
and that is the first item of the next session.

---

# SECTION 1 — THE FRONT DOOR. **DONE, on a clip.**

Two strangers played a combined 45 minutes and neither ever got inside the pro
shop. It was not the lock, the collision, or the door.

## What was actually wrong

`REPAIR_SITES` in `campaignWorld.js` puts the **`entranceDoor` repair marker at
x = −0.8**. `DOOR_MAIN.x` is −0.8. The marker sits exactly on the door, and it
carried no focus bias. Prop focus is distance-led, and a player walking up to a
door ends up standing on it — so from every straight-on approach the marker won
the crosshair. What a new player read at the front door of a brand-new game was
not "Shop doors — [E] open both". It was:

> **"Entrance doors and hardware — blocked: Clear the entrance and wash the porch
> before repairing the doors."**

The entrance it names is the clutter **inside** the lobby. The broom that clears
it is on the **indoor** belt — measured, the outdoor belt offers exactly *Hands
free, Rented washer, Watering hose, Divot kit, Bunker rake*, and not one of them
can move debris. At a shut door, the game instructed the player to go and do the
one thing that is only possible on the far side of that door. **E was silent**,
because the refusal it fired had nowhere useful to go.

That is 1A's "clear the entrance maps to no verb a player can find", and it is
not a missing verb. It is a **message pointing at an impossible errand**, winning
the crosshair from the verb that would have worked.

The `CLOSED` sign three feet away already carries `focusBias: -0.65` with a
comment saying *the door must win focus*. Somebody hit this exact class of
problem before, solved it for the sign, and the repair marker never got the same
treatment.

## Measured, before and after

Fresh profile, real keyboard, no teleports, no concessions
(`tools/qa/electron-1b-cold-walk-in.js`):

| | before | after |
|---|---|---|
| step 2, crosshair reads | *"Entrance doors and hardware — blocked: Clear the entrance…"* | **"Shop doors — [E] open both · [X] open left leaf"** |
| E produces | nothing. No toast, no refusal | doors open; label flips to "close both" |
| final position | stopped at z = 10.11, outside | z = 7.32, **inside** |
| `gotInside` | **false** | **true** |

## The fix

Two rules, both about what a player can FIND rather than what exists:

- `focusBias: -0.9` on the entrance repair site, so the door outranks it across
  the door's own 2.1 reach.
- The repair markers are **dormant until `enteredClubhouse`**. The campaign's own
  objective list puts *"Enter the closed clubhouse"* before every repair, so
  before the player has been inside once, a blocked repair is pure noise sitting
  on the only verb that matters. Not *never* — after entering it speaks again,
  because the entrance repair is a real late job.

Pinned by `tests/entrance-door-is-findable.test.js` (4 tests). Watched fail on
the unfixed build: tests 2 and 3 fail quoting the exact sentence the player read
at the door, while 1 and 4 pass. **The revert was asserted to have changed the
file** before the run — the fix present in the backup, absent on disk.

## 1B — THE CLIP

`qa/clips/walk-in`, 32.5 s, 130 frames extracted at 4 fps and viewed.

- **22.25 s** — the doors swing.
- **23.50 s, `frames/frame-0095.png`** — **the threshold.** The player is
  crossing the *PINE HILLS MUNICIPAL GOLF* mat, both leaves open, the prompt
  reading "Shop doors · [E] close both · [X] close left leaf", the objective card
  still bottom-left. **That frame is Section 1.**

### The reading I took, and it changes the game

1B says *"boot, clear the entrance, wash the porch to 60%, repair the doors, open
them, stand inside."* That sequence is the false trail the blocked message put
you on. The game's own objective chain is `survey → enter → entrance-trash →
loose-debris`: entering comes **first**, and clearing the entrance is something
you do **after** you are in. The door repair is a late cosmetic job.

So I took the reading that changes the game: **entry requires none of it.** A
player walks up and opens the door. The prerequisite chain you were shown was the
bug talking.

---

# SECTION A — AUDIO

## A2 — the main menu speaks. **DONE, verified by recorded audio.**

### What the check measured

`tests/menu-sound.test.js` is four **regexes over the text** of `menu.js` and
`main.js`. They assert the file *contains* `audio?.uiTick?.()` and *contains* the
`addEventListener('pointerdown', pressSound, true)` line. Both strings are
present. **Not one of the four tests executes anything**, so none of them could
tell whether a sound was made. A test that reads the source cannot ask what the
source does.

### What was wrong

The press handler was attached in exactly one place: inside `setVisible(true)`.
The menu is **born visible** — `root` carries no `display:none`, `main.js`
appends it at `uiRoot.append(menu.root, gameUi)`, and the only `setVisible` call
on the boot path is `setVisible(FALSE)` for the shed scope. `setVisible(true)` is
for **returning** to the menu from a game. So on the one path every player takes
— launching the game — the listener was never installed.

**Shape 2, zero call sites.** A correct handler, unreachable. And the regex that
asserts that very `addEventListener` line exists could never notice it never ran.

### The check that can hear

`tools/qa/electron-a2-menu-audio.js` wraps the Web Audio graph before the first
gesture and records every context created (with its state), every source node,
every `start()`, and every gain value scheduled. A node built and never started
is silent; a node started into zero gain is silent; both are now visible without
ears.

It carries a **negative control**: it builds a context and an oscillator by hand
and asserts the tap heard them, because a tap that records nothing looks exactly
like a game that plays nothing.

And a **discriminator**, because two stories fit "pressed, no oscillator" — the
handler never ran, or it ran and `uiTick` bailed. Calling `uiTick` directly with
the tap listening created 2 nodes and started 1, and twice in a row started 2. So
the audio module was never the problem and the 0.12 s debounce was never the
problem. The handler simply never ran.

| | before | after |
|---|---|---|
| buttons pressed | 4 | 4 |
| buttons that made sound | **0** | **4** |
| silent | New game, Settings, Credits, Quit | — |
| audio context | alive and `running` the whole time | alive and `running` |

The context being alive and running while every button was silent is why this
survived: every reasonable property of the audio system was correct.

## A3 — cash into the register. **NOT DONE**, but the reason is located.

It is not missing a call. `settleTenderDrag` in `simplifiedRegisterMode.js`
fires on every piece that lands in the drawer — but it fires
`sfx('billHandle')` or `sfx('coinHandle')`, which are **handling** sounds: paper
and metal moving in a hand. There is no voice in the vocabulary for money
*landing in a till well*, and the cue list confirms it — `drawerUnlock`,
`drawerOpen`, `drawerClose`, `notesDown`, `coinsDown` (those two are notes and
coins landing on the DESK), `billHandle`, `coinHandle`. Nothing for the deposit.

So the moment you describe — the money leaving the desk and landing in the
drawer — plays the same faint rustle as picking it up, which is why it reads as
mute. It needs its own voice with weight to it, not another call site.

## A1 — real recorded audio. **NOT STARTED.**

---

# SECTION B — THE MOP. **Count fixed. NOT DONE: the solver is not running.**

## The count — done

You asked for 10 to 20. It was 820.

Every previous pass chased **density**: 480 → 640 → 820, each time because the
disc "no longer FILLED" and a planted head "splayed the gaps open". The
reasoning was internally sound and aimed at the wrong target. A string mop is
not an opaque disc. It is fifteen to thirty thick bands of yarn with daylight
between them, and **the gaps are most of what makes it read as a mop rather than
a brush**. 820 fibres at 3.4 mm covering 54% of the disc is a pom-pom.

Now **16 bands at 11 mm**, radial segments 5 → 8 (a rope that wide shows facets
where a hair could not). The solver is untouched, as you asked. 3,280 instances
→ 64, still 4 draw calls.

**Two populations, closed on the way past.** The shipped numbers lived only as
arguments at the single call site; the function defaults said something else; and
the test asserted **the defaults**. The shipped mop could change without the test
noticing, and the test could pass about a mop nobody holds. Both now read
`SHIPPED_MOP_YARN`. The assertion is a **range** (10–20), because the point is
that a person can count the bands, not any one number in it.

## What the frames showed — NOT DONE

At the player camera the yarn **radiates stiffly along the shaft axis instead of
hanging**. That is the seeded rest pose, not a simulation. Verlet nodes live in
world space under gravity 19, so a stepping solver would drop them toward
world-down however the head is held.

`tools/qa/electron-b-mop-is-simulated.js` reads the drawn instance matrices:

| | drift |
|---|---|
| head motionless, 0.5 s | **0** |
| walking, 0.7 s | **0** |
| after stopping, 1.4 s | **0** |

The mop's yarn does not move at all, ever, on the held mop. Six attempts at this
tool have been spent tuning how the yarn *behaves*, and it has not been animating.

**Stated plainly: that driver's negative control is VOID.** "A motionless head
must be still" passes trivially when every number is zero, and a control that
passes for the same reason the test fails is not a control. The independent
corroboration is the **viewed frames** — `qa/electron/mop-strand-clip/carried.png`
and `mopping.png` show the seed pose directly, strands along the shaft. A
positive control is owed before the frozen solver is called proven, and that is
the first thing to do on B next.

---

# SECTION C — THE BROOM HEAD. **NOT DONE**, but with the reason the last three
# checks passed.

I did not get to the roll/pitch contact sheet. What I did find is why this keeps
coming back:

**`tools/qa/broom-pitch-sweep.js` — the existing sweep — boots with
`page.goto('http://localhost:8457/')`.** It is a dev-server run in a browser
context, not the Electron build. That is **shape 7, wrong runtime**: exactly the
fault that voided the door-lag checks in Goal 21, sitting unnoticed in the broom
tooling as well. Any candidate chosen from that sweep was chosen in a runtime the
player never uses.

The head orientation is also not an exposed parameter — it is composed inside the
rig from `rollLean`, `rollStroke` and a tilt axis in `broomViewmodel.js`, which is
why "sweep roll and pitch" is not a one-line job. The sweep must drive those, in
Electron, at the default camera.

---

# SECTION L — TRANSLATIONS. **DONE, all ten locales at 100%.**

| locale | before | after |
|---|---|---|
| en | 282/282 | 282/282 |
| es, fr, de | **168/282** | **282/282** |
| pt-BR, ru, zh-Hans, ja, ko, tr | 168/282 → done earlier in Goal 21 | 282/282 |

342 keys merged in this session's final batch, zero refusals against the two
guards `tools/merge-locale-json.mjs` enforces: the placeholder multiset must
match English exactly, and no em dashes.

### What the old check measured

It counted keys **added** to all ten tables and never once looked at the
denominator. "Translations done" was true on every run for four sessions while
nine locales sat at 59% and a Spanish player read a third of the game in English.
Counting the numerator is a different question from counting the fraction, and
only the fraction is what a player experiences. **New shape 8: counted the
numerator.**

`tools/i18n-baseline.json` is now the lint ratchet's contract applied to
language: missing-key count per locale, shrink-only. Strict `fraction === 1` was
tried in Goal 16 and removed for a real reason — it made adding one English key a
breaking change for nine languages, so 155 strings stayed raw rather than
translatable. This is the third position: the number may fall freely and may
never rise on its own. Drift is allowed; **silent** drift is not.

Watched fail: reverting `i18n.js` failed the ratchet naming `es 114, de 114,
fr 114` while all thirteen other tests stayed green — including the one called
*"coverage is reported honestly per locale"*.

---

# HARNESS

**The free-play bridge no longer dies on one failed screenshot.** `shot()` was
called from outside the command try/catch, so when the app fell over during
"Loading models" it took a 30-minute stranger session with it, leaving a blank
error and five frames. A dead frame is a finding, not a reason to stop playing;
the bridge now records the failure, keeps going, and reports a crash only after
eight consecutive dead frames.

**Four wrong selectors in one session**, all of which reported "not on screen"
about a HUD that was drawing fine: `.objectives-panel` (it is `.objectives-card`),
`.prompt`, `.walk-prompt` (it is `.shop-prompt`). A selector that matches nothing
is indistinguishable from a feature that renders nothing. Both come back false.

**And a caveat on the instrument that catches shape 6.** `elementFromPoint`
answers with the topmost element that *accepts pointer events*. Any HUD layer
carrying `pointer-events: none` therefore answers with the canvas underneath and
reads as unpainted. It proved X3's objectives card was behind the canvas because
that card is hit-testable; used on `.shop-prompt` it produced a **false negative**
about a prompt the recorded frames show drawn and legible at 22.75–24 s. The
instrument that catches shape 6 can manufacture it.

---

# THE FIVE RUNNING LISTS

## 1. DONE, with the evidence

| Item | Evidence |
|---|---|
| **Section 1** — the front door | clip `qa/clips/walk-in`, `frame-0095.png` @ 23.50 s; `gotInside` false → true |
| **A2** — main menu sound | audio graph tap, 0/4 → 4/4 buttons, negative control passing |
| **L** — translations | 282/282 in all ten locales, ratchet installed |

## 2. NOT DONE

Everything from B onward is untouched at the time of writing: B (mop strand
count), B1 (hand meshes), C (broom head roll/pitch contact sheet), D (bag
containment), E (queue follows properly), F1 (fullscreen/4K performance), F2
(door lag, third attempt), F3 (draw calls), G1–G3 (phone notify, mouse, icons),
H (credit card art), I1–I4 (ledger key, sounds, UI, gesture), J (buy and book),
K (loading screen alternation), M1–M4 (overview framing, card in fingers, the
owed clips, bunker rake).

## 3. FOUND, NOT FIXED

- **The outdoor tool belt cannot touch debris.** Measured: outside, the belt
  offers Hands free, Rented washer, Watering hose, Divot kit, Bunker rake. The
  brief asks for a broom and a debris bag where the task is. Section 1 no longer
  depends on it — the entrance trash is indoors, where the broom is — but a
  player who wants to sweep the porch still cannot.
- **The game crashed once during "Loading models"** on a fresh profile, killing
  the first stranger session two minutes in. Not reproduced since (four
  subsequent cold boots were clean). Unexplained.

## 4. REFUTED

- *Hypothesis: the menu was silent because `uiTick`'s 0.12 s debounce swallows
  the first tick on a fresh context (`currentTime` starts at 0).* **Refuted by
  measurement** — calling `uiTick` twice in a row produced 2 starts, and a single
  direct call produced 1. The debounce is not implicated.

## 5. REPORTED DONE PREVIOUSLY, FOUND FALSE

Permanently in `Designs/ProShop/FOUND_FALSE.md`. This session added the main menu
sound (2nd appearance, shape 2), the front door / "clear the entrance"
(shape 4 in the world rather than in code), and shape 8 — counted the numerator.
