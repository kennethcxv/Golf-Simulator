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

## WHAT A VERIFIER DISPROVED, AND WHAT THE ORIGINAL CHECK MEASURED

Nothing yet from Verifier 3's closing run; it is playing the fixed build as this
is written. The opening run is recorded below under Phase 4 — it died on a model
quota after 172 screenshots, and its last message was
*"can ANY door in this game open?"*, which is the front door reproduced by a
stranger in their own words.

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
