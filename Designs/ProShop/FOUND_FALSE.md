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
| 1-2 | Measured as costing nothing, twice | Frame timings around the door | The owner still feels it on **first approach and first open**. A warm measurement cannot see a first-time cost | ? — under investigation |

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
