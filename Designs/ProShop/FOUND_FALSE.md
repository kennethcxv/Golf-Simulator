# THE FOUND-FALSE LEDGER

Every item that has been reported DONE and then found false by the owner, across
every session. One row per item, not per occurrence — the count is how many
times it has come back.

This file exists because four sessions running have shipped items that passed
their own checks and failed in the owner's hands. The pattern is not
carelessness about the fix; it is **carelessness about the instrument**. Every
row below had a check, and every check passed.

## THE RULE THIS FILE CREATES

> **An item on this ledger cannot be marked DONE again without a CLIP.** Real
> input, default camera, frames extracted and VIEWED, and the report names the
> frame that proves it by timestamp. A number is not enough for these.

Written into `CLAUDE.md` so it applies without anyone reading this file first.

---

## THE SHAPES

Named so they can be recognised before they are repeated. The first three were
identified across Goals 18-20; the fourth and fifth were identified in Goal 21.

| # | Shape | The question that catches it |
|---|---|---|
| 1 | **Two populations** — the same decision exists in two places and the check measured one | *Is this the only code that decides this?* |
| 2 | **Zero call sites** — the function is correct and nothing in production calls it | *What player action reaches this line?* |
| 3 | **Right object, wrong variable** — the measurement watched a real thing that was not the thing | *Is the number I read the number the player sees?* |
| 4 | **Two selectors** — two different rules answer the same question, and the fix configured the one that does not run | *Which branch actually chose, and does it read what I set?* |
| 5 | **Shipped disabled** — the fix is behind a guard that is almost never true in play | *Under what live conditions does this code execute at all?* |
| 6 | **Visible but not painted** — every property the check reads is correct and the pixels belong to something else | *What does elementFromPoint say is actually there?* |
| 7 | **Wrong runtime** — the check is sound and runs somewhere the player never is | *Is this the binary, the window and the input the player has?* |
| 8 | **Counted the numerator** — the number moves in the right direction and is not the number that matters | *What is the DENOMINATOR, and did I ever read it?* |

**A caveat on shape 6, learned the hard way in Goal 22.** `elementFromPoint`
answers with the topmost element that ACCEPTS POINTER EVENTS. Any HUD layer
carrying `pointer-events: none` therefore answers with the canvas underneath and
reads as unpainted. It proved X3's objectives card was behind the canvas because
that card is hit-testable; used on `.shop-prompt` it produced a **false
negative** about a prompt the recorded frames show drawn and legible. The
instrument that catches shape 6 can manufacture it. Ask what governs the element
in question — for the prompt that is one opacity line in `main.js` — or look at
the pixels.

Shape 4 was found in Goal 21 (the ledger station selector). Shape 5 was HYPOTHESISED
for the NPC look-ahead and then REFUTED by measurement — the guard it blamed runs
92% of the time. The real cause was shape 2 at a scale nobody had considered: a
whole module with no importer. The hypothesis is kept because it is a real shape
worth checking for, but it did not explain this one.

---

## THE LEDGER

### The ledger book — 3 appearances

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1 | The double set-down is gone | The state machine's own y-extents in a replay | Both `closing` and `lowering` descended; the instrument reported the state names, not the height | 3 |
| 2 | Q closes it, only E turns pages | Source assertions on the key handler branches | Both were true in source. The book could not be opened at all in normal play, so no player ever pressed either key | 2 / 4 |
| 3 | The book is reachable at the desk | The prop's `focusBias` and `aimY`, added with a comment saying they beat the desk | Stations were chosen by a *different* selector that reads neither — first match in registration order, 100-degree cone | **4** |

### The NPC stuck rule — 3 appearances

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1 | Customers recover when stuck | The 1-second recovery fired | Recovery after contact is not avoidance | — |
| 2 | Look-ahead added; they change course before contact | 8 headless tests against a hand-drawn room, all passing | The room was hand-drawn. Nothing measured whether the look-ahead runs in the real shop | 2 |
| 3 | Look-ahead added; they change course before contact | 8 headless tests, all passing | **The entire module the fix lives in — `clubhouse/customers.js`, 1,400 lines — is imported by NOTHING.** The live customer loop is inline in `clubhouse.js`. Eight tests passed against code the game never loads | **2, at module scale** |

### The broom — 3 appearances

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1 | The bristles read as a brush, not a rake | Tuft count and spacing arithmetic | The tuft *tapers*; the tip is what the eye reads and it was still a comb | 3 |
| 2 | Strand physics are good | Tip travel in metres | Travel is not the same as reading as bristles | 3 |
| 3 | The head angle is fixed | Never measured — the run produced only a symmetric-bar mean, which cancels to zero by construction | The statistic could not express the fault | 3 |

### The mop — 6 appearances

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1-4 | Successive lag-curve tunings | Pixel divergence against a frozen-strand control | Motion was never the problem; the numbers were honest and measured the wrong property | 3 |
| 5 | The yarn trails when carried | Tip travel *after* a carry-drive signal was added | With that signal absent — every path that does not compute it — the measured offset is **0.000000 yd** | 2 |
| 6 | The head reads as damp when wet | The tint was applied and the material changed | It was applied to `MESH_MopSkirt`, hidden since Goal 19, so no player ever saw it | 3 |

### The queue / desk screen — 3 appearances

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1 | IN QUEUE means standing in the line | `atSlot` distance from body to slot | Correct, but the *list membership* was never filtered, so shoppers browsing sat on it | 1 |
| 2 | The TOTAL no longer collides with UNIT | A rect-overlap sweep over every screen, with its own planted-overlap control | All three checkout fixtures omitted `items`, so the sweep only ever rendered "Waiting for products" | 2 |
| 3 | A walk-in cannot ask hours ahead | The arrival planner, watched failing on the old constants | `clubhouse.js` has a *second* walk-in ask reaching ten slots — five hours | **1** |

### The current task on screen — 1 appearance

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1 | The objectives card shows the current task | display, visibility, opacity, a 300x104 rect at (16,778), and `checkVisibility()` returning true | **All five were correct and the card was behind the canvas.** One line re-parented it from `#ui` (z-index 3) to `document.body`, and `append()` moves a node. `document.elementFromPoint` at the card's own centre returned the canvas | **6** |

### The loading screen — 2 appearances

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1 | Immersive: club name, landscape, teaching tips | A driver that photographed the veil and read its DOM | Real, and photographed. The owner reports it unchanged — under investigation | ? |
| 2 | The veil is up for 6.4 s | The last poll sample that still saw the veil | The renderer blocks for ~14 s and `page.evaluate` blocks with it, so the longest stretch is invisible to a polling loop. Independent wall clock: **24-25 s** | 3 |

### Translations — 2 appearances

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1 | Locale tables extended | New keys present in all ten tables | True, and the *fraction* barely moved: 114 keys per locale were still missing | 3 |
| 2 | *(Goal 21)* 59% to 60% | — | The bulk work was never done; it was on NOT DONE, and is now being reported as a false DONE | — |

### The door lag — 2 appearances

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1-2 | Measured as costing nothing, twice | tools/qa/doors-performance.js, which runs against **http://localhost:8457 in headless Chrome** | It never touched the shipped Electron build, never cold-booted, and never had a player walk up to a door. The runner header already records three defects that shipped this way | **WRONG RUNTIME** |
| 3 | *(Goal 21)* Measured free a THIRD time, by me | rAF frame times across still / control / approach / open, cold boot, real input, Electron | **My own instrument never reached the door.** The frame shows the player short of it, the door shut, and the E press pulling WEEDS. 4.2 ms median describes walking on a porch | 2 |

### The stranger's own instrument — 1 appearance

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1 | Three sessions of stranger verification "looked around" | That `page.mouse.move` did not throw | The bridge's sweep nudged out and back every step, netting **zero** rotation. No yaw delta was ever read | 3 |

### The voicemail / call-back — 1 appearance

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1 | A missed caller leaves a message you can play and ring back | 5 sim tests on the verbs, plus a source assertion that the UI calls both and renders a button | All true. The phone is driven by arrows and Enter, and the shell's focus model could not reach the button | **2** (the *input path* had zero call sites) |

### The bag — 2 appearances

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1 | Items no longer poke out of the mouth | The mouth clamp | True, and it pushed long items out through both *side walls* instead | 3 |
| 2 | Every body is clamped inside the authored volume | The clamp expression | `clamp(v, -(h-b), h-b)` **inverts its own bounds** when the body is wider than the bag | 3 |
| 3 | A long item stands up rather than lying through the wall, `insideFrac` 1 | The stand-up rule and a containment fraction | Owner: **big items still stick out.** Goal 22 has not re-measured this yet — the standing rule now is that a body too big for the bag is a DESIGN answer (it is not bagged) rather than a geometry one | — |

### The main menu sound — 2 appearances

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1 | Every menu button clicks; one delegated listener covers the dialogs too | Four **regexes over the source text** of `menu.js` and `main.js` | Every asserted string is genuinely present. **No test executed anything**, so none could tell whether a sound was made. A test that reads the source cannot ask what the source does | 2 |
| 2 | (same fix, Goal 22) | An audio-graph tap recording contexts, nodes, `start()` and gain, with a negative control | FIXED: the handler was attached only inside `setVisible(true)`, and the menu is born visible, so on the launch path the listener was never installed. 0/4 buttons → 4/4 | 2 |

### Buy AND book in one visit — 2 appearances, never once seen

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1 | A combined visit exists (M1) | the sim path | — |
| 2 | Done with a measured split (Goal 17 G13) | a proportion of customers on the combined path | Owner: **"I have never once seen it happen."** Not re-measured in Goal 22. The two candidate shapes are stated in the brief and both fit: a combined path that exists and is never taken (5), or a check reading one customer population while the shop runs the other (1) | 1 or 5 |

### The front door — 1 appearance, and it cost two strangers 45 minutes

| # | What was claimed | What the check measured | Why it passed | Shape |
|---|---|---|---|---|
| 1 | The warp trap and the dead trigger are fixed, so the entrance works | Those two specific faults, both genuinely fixed | **Nothing ever asked "can a new player get inside?"** The `entranceDoor` repair marker sits at x = −0.8, which is `DOOR_MAIN.x` exactly, with no focus bias, so it won the crosshair from every straight-on approach and showed *"blocked: Clear the entrance and wash the porch"* — an errand only possible on the far side of the door it was covering | **4**, in the world rather than in code |

---

## HOW TO USE THIS FILE

Before claiming any item above is DONE:

1. Find its row. Read why the last check passed.
2. Write down what your new check measures, and how it differs.
3. Record a clip at the default camera with real input. Extract the frames.
   **View them.** Name the frame that proves it.
4. Only then add the DONE claim, with the frame reference.

If the new check is a number of the same kind that passed last time, it is not a
new check.

---

## SHAPE 9 — THE PINNED WORLD IN AN UNPINNED MACHINE (Goal 23)

A determinism pin that covers the SIMULATION and not the PRESENTATION.

The golden gate failed twelve of thirteen poses for a week at 7.75-9.16%, edges
only, deterministic. The seed, the clock, the interior origin and the customer
spawn were all pinned and byte-reproducible - and the FIELD OF VIEW was a saved
player preference sitting in the Electron profile's localStorage, editable by
any driver or free-play session on the machine. Somebody moved the slider from
the shipped 66 to 60. Every capture after that was the same room through a
different lens: a clean 1.125x magnification about the exact principal point.

A bisect of the whole range found nothing, because the cause was never in the
repository. `c27d3a2` - the commit that COMMITTED the goldens - fails its own
goldens, and HEAD draws a pixel-identical picture to it.

> ASK OF ANY GOLDEN OR BUDGET: what, outside this repository, can change this
> number?

## AND A SHARPER STATEMENT OF AN OLD ONE

> A PROBE THAT CANNOT SEE THE THING REPORTS THE SAME AS A THING THAT DID NOT
> HAPPEN.

Three times in one session, in code written that same hour:

* the door probe read `ch.doorApi.doors`, which is passed INTO the sub-builders
  and is not on the returned object. It reported `doorActuallyOpened: false`
  about a clip that plainly shows both leaves swinging to 100 degrees.
* the desk-list probe read `ch.frontDeskReservations` instead of
  `ch.frontDeskBridge()`. An empty list is indistinguishable from a missing row.
* the mop photograph came back black twice and empty once. The tool viewmodel is
  not drawn outdoors, and `setTool` reported `equipped: true` and
  `vmActive: true` the whole time.

Every one was caught by LOOKING AT PIXELS. None would have been caught by a
number, and two of them had already produced a written conclusion before the
frames contradicted it.

## A STALE ARTIFACT READS AS A PASS (Goal 23)

The golden capture skipped `bag-packed` and said so honestly in its manifest.
The differ then compared LAST RUN'S leftover file, scored 0.0000%, and printed
the row green. The pose the gate was most confident about was the one that never
ran. Fixed both ways: the capture clears its output directory first, and the
differ walks the GOLDENS as the contract so a missing pose fails as NOT CAPTURED.


## A TOOL VIEWMODEL DRAWS ONLY IN ITS OWN DOMAIN (Goal 23)

Four photographs failed this session for one reason, and it took all four to see
it. `setTool(id)` reports `equipped: true` and the viewmodel reports
`vmActive: true` in every case, and the tool is simply NOT DRAWN:

  * the MOP, photographed outdoors, three times -- black or empty frames
  * the BUNKER RAKE, photographed at the golden suite's indoor tool pose --
    equipped, active, and a picture of a wall

The belts are split by domain: broom, mop, vacuum, spray, cloth, sponge,
dustpan and trashbag are the INDOOR belt; washer, hose, divot kit and rake are
the OUTDOOR one. A tool draws in its own domain and not in the other, and
nothing in the API says so -- `equipped` and `vmActive` are both true either
way, which is what made it look like a missing mesh four times running.

The rake photographs perfectly well OUTDOORS
(Designs/ProShop/J_BUNKER_RAKE.png). The mop will photograph indoors, in a lit
room, which a fresh save does not have.

> BEFORE PHOTOGRAPHING A HELD TOOL, PUT THE PLAYER WHERE THE TOOL BELONGS.
> `equipped: true` and `vmActive: true` do not mean it is on screen.

---

## SHAPE 10 — THE MISSING ACCESSOR RETURNS THE ANSWER YOU WERE TESTING FOR (Goal 25)

Twice in one probe, in the same hour, and both would have produced a written
finding about the game.

* The probe asked whether the shop's customer capacity was zero — the exact
  hypothesis under test — by calling `shop.shopCustomerCapacity(state)`. That
  function lives in `shopProgression.js`, not `shop.js`. The import returned
  `undefined`, the probe reported `capacity: null`, and **null is
  indistinguishable from the zero it was built to detect.**
* The same probe counted people with `ch.customerCount()`, which does not exist
  on the clubhouse API at all. It returned `undefined`, the `?? 0` beside it
  turned that into a confident **0**, and the driver reported an empty shop that
  had four people standing in it.

> ASK OF ANY ACCESSOR IN A PROBE: does this function exist on this object? An
> optional-chained call to a name that was never there returns `undefined`, and
> `undefined ?? 0` is a measurement of nothing wearing the costume of a zero.

The tell is that the null and the finding agree. When a probe's failure mode
produces the same value as the defect it hunts, it cannot distinguish them, and
a passing OR failing run means the same thing. `footfallDiagnostics().onFloor` —
the number the arrival loop itself owns — is what it should have read.

## SHAPE 13 — THE SPY ATTACHED TO A THING THAT DID NOT EXIST YET (Goal 26)

Three times in one session, in three different audio probes, and every one
reported the game as SILENT.

A WebAudio context can only be created from a user gesture, so before the first
press `audio.qaContext()` returns null. All three probes clicked something, waited
a fixed number of milliseconds, and then attached their `createBufferSource` /
`createOscillator` spy to whatever `qaContext()` gave them. It gave them null. The
spy was never installed, every counter stayed at zero, and the run printed
"0 sound events" for controls that were in fact making sound.

> A PROBE THAT INSTALLED NOTHING REPORTS THE SAME AS A GAME THAT PLAYED NOTHING.
> Wait for the thing you are about to instrument to EXIST, and make its absence a
> loud abort — never a fixed timer and never an optional chain that shrugs.

This is shape 10 wearing new clothes: the failure mode and the finding produce the
same number, so a passing OR failing run means the same thing. The tell was that
the bank reported 50 files loaded while every cue reported zero — two numbers from
the same graph that could not both be true.

## SHAPE 14 — elementFromPoint VOUCHED FOR A CLICK THAT LANDED SOMEWHERE ELSE (Goal 26)

The menu-click inventory pressed each control with
`page.mouse.click(centreX, centreY)` taken from `getBoundingClientRect`, and every
enabled control came back silent while keyboard Enter worked. It looked like a
menu bug and was not: the window runs at **devicePixelRatio 1.5**, the press
landed off the button, and the `pointerdown` that arrived had target `DIV` with no
button ancestor — so the menu's own `closest('button')` handler correctly declined
to speak for it.

`document.elementFromPoint` at those exact coordinates still answered
`BUTTON.menu-action`.

> elementFromPoint ANSWERS GEOMETRICALLY. It knows what is drawn at a point and
> nothing whatsoever about where a synthetic press actually went. On a scaled
> display the two disagree, and the geometric one is the liar.

Note the irony worth remembering: elementFromPoint is the instrument this file
already recommends for catching shape 6 (visible but not painted). Here it
manufactured a false negative about a click. Click by ELEMENT HANDLE and let the
driver compute the hit point; read `event.target` from a real listener when you
need to know where a press landed.

## SHAPE 11 — MEASURING THE END OF A PROCESS TO DETECT ITS BEGINNING (Goal 25)

"Did a customer arrive?" was implemented as "are there goods on the counter?"

Goods on the counter is the LAST beat of a twenty-game-minute visit: walk in,
cross the floor, browse a fixture, choose, queue, reach the head, place. At the
measured clock rate — 1.34 game-minutes per ten wall seconds — that is minutes
of real time after the arrival it was standing in for. The driver waited three
minutes, saw no goods, and reported *"three minutes of open shop and nobody came
in"* while three to four customers were on the floor the entire time.

> ASK OF ANY PROXY: is the thing I am measuring the thing I am claiming, or is
> it several steps downstream of it? If the chain between them can stall for a
> reason unrelated to my hypothesis, the proxy is not evidence.

Here the chain stalled for a reason that was itself the real finding — the queue
head was desk business waiting for a player who never came — and the proxy hid
it behind a wrong answer to an easier question.

## SHAPE 12 — THE PROBE THAT COULD NOT CLICK (Goal 25)

The stranger driver reported *"clicked forty times on the register and no ticket
ever banked"* after fourteen beats. Every screenshot was the same NEW GAME
difficulty dialog. `.difficulty-card` is a `<div>`; the helper only queried
`<button>`; no card was ever picked and the game never started.

This is the old "a probe that cannot see the thing reports the same as a thing
that did not happen" with the verb changed from SEE to CLICK, and it is worth its
own line because the failure surfaced fourteen steps away from its cause and
named an innocent subsystem.

> A DRIVER THAT CANNOT PERFORM AN ACTION REPORTS THE SAME AS A GAME THAT REFUSED
> IT. Fail closed at the step: if the dialog is still on screen after you claim
> to have dismissed it, stop there.

Every one of these three was caught by looking at the screenshots.
