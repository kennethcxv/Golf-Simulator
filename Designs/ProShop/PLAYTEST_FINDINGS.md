# Pro-shop playtest findings — the greybox walk

Raw playtest notes from the 2026-07-28 walk of the pine-hills-v2 greybox, filed
before any code was touched so later sessions can cite a finding by number
instead of re-typing it.

**Part A** is the notes exactly as written — verbatim, unedited, typos and all.
**Part B** is the numbered index over the same text, so `PT-14` is a stable
handle. Part B quotes; it never paraphrases and never corrects.

**How the 24 were counted.** Two sentences in the notes each describe two
separable fixes, and the count of 24 resolves them one way:

- The card-PIN note ("input it in the actual card pin thingy" **and** "zooms in
  a bit … or moves that towards the user") is counted as **one** item (PT-02).
  Both halves are the same interaction change.
- The tray note ("sometimes it phases through" **and** "make it easier to see on
  the tray") is counted as **two** items (PT-22, PT-23). One is a collider bug,
  the other is a readability change; they fix in different files.

If that split is wrong, renumber Part B — Part A is the authority and does not
move.

**Tags.** `BLOCKER` items were authorised for the session that follows this
file; `CHECKOUT`, `NPC` and `LAPTOP` items are explicitly deferred and must not
be started. Where a finding was promoted to a numbered session blocker, the
index carries `→ Blocker N`.

---

## Part A — the notes, verbatim

### Round one

```
For some reason the letter D doesnt move us to the right in wasd. Also for some reason when the user gives a card it needs to input the pin in the actual screen of the pin instead of the actual card payment thingy. PLease make it so the user has to input it in the actual card pin thingy. And make it so it zooms in a bit to the pin card thing when using it or moves that towards the user etc. Also make sure the scanner thing actually shows a scanner scanning the items. Also move the bag more up so it isngt phasing the table. Also make it so the bag is standing up. Also make it so when the user is handing you money it allows you to look to the side otr be a better view to grab the card or money and noth on the entire left hand side of the screen./ Also allow me the cashier to entier intop the chaier asection its currently fully blacked and the only way to man the cashier is if im oppiosite of the table like backward then click e and it phases me into the  cashier section. Also for some reason when i order various things it givers me the error of something wrnt wrong the shop page could not be drawn. Cannot read properties of undefined reading 'cat" however the notification says orders received. Also please make it so that the tags are attached to the item itself. Currently thre ttag just spwawns in on checkout please fix that. Also please make it so if the user is walking into something and cant move that it moves away and finds another paths since sometimes they just get stuck on me or something else and just move forward indefinitely. Also make sure that when the user grabs an item that the place it in a bag or something and it isnt just floating and also that it isnt phasimng through them as they walk. Also make it so that there is a proportional amount ofg people buying items in the shop and playing a golf round. Please make sure they can do both as well so buy then checkin for a golf round etc. Also make sure they are buying a reasonable amount of things atnd the things they buy are based on popularity of the item etc. so that the player can learn to see what sells more than others etc. Also find a new location to put the laptop. Maybe in another room but in the chsherier section facing towards the player is not the correct place. Maybe face it towards the chaier or find another spot. Also make it so that when you buy things in the game like upgrades or deliveries etc in the laptop that you dont needto scroll up to select purache item maybe add it to the cart etc its kind of annoying to go back and forward with thatr. Also make it so that when a user buys a vinyl or something its not automatically installed. Its just added to there inventory where then they can build with that. Also there is a lot of phasing through objects for paintings, boxes etc etc. Also I cant seem to open a box ai can place it but cant open it. Tell me how ot or implement it if havent done so yet.
```

### Round two

```
The room is not dark enough honestly it should be darker. Also i walk in and
click E on the ceiling and it says dead ceiling repired however the lights dont
turn on and i didnt even have the clubhouse kit. Also fix the issue in the
cashier where they put an item that is clearly too big for the desk find a way
around it. Also, when the user places a flat item on the dark green tray
sometimes it phases through please fix that make it easier to see on the tray.
Also add a search inside the laptop so its easier to navigate things. Like if
the clubhouse kit was in the laptop it would be hard to find.
```

---

## Part B — numbered index

| # | Tag | Finding (quoted) |
|---|---|---|
| PT-01 | **BLOCKER** → Blocker 7 | "For some reason the letter D doesnt move us to the right in wasd." |
| PT-02 | CHECKOUT | "when the user gives a card it needs to input the pin in the actual screen of the pin instead of the actual card payment thingy. PLease make it so the user has to input it in the actual card pin thingy. And make it so it zooms in a bit to the pin card thing when using it or moves that towards the user etc." |
| PT-03 | CHECKOUT | "make sure the scanner thing actually shows a scanner scanning the items." |
| PT-04 | CHECKOUT | "move the bag more up so it isngt phasing the table." |
| PT-05 | CHECKOUT | "make it so the bag is standing up." |
| PT-06 | CHECKOUT | "when the user is handing you money it allows you to look to the side otr be a better view to grab the card or money and noth on the entire left hand side of the screen." |
| PT-07 | **BLOCKER** → Blocker 5 | "allow me the cashier to entier intop the chaier asection its currently fully blacked and the only way to man the cashier is if im oppiosite of the table like backward then click e and it phases me into the  cashier section." |
| PT-08 | **BLOCKER** → Blocker 3 | "when i order various things it givers me the error of something wrnt wrong the shop page could not be drawn. Cannot read properties of undefined reading 'cat\" however the notification says orders received." |
| PT-09 | CHECKOUT | "make it so that the tags are attached to the item itself. Currently thre ttag just spwawns in on checkout please fix that." |
| PT-10 | **BLOCKER** → Blocker 9 | "make it so if the user is walking into something and cant move that it moves away and finds another paths since sometimes they just get stuck on me or something else and just move forward indefinitely." |
| PT-11 | NPC (parenting half → Blocker 6) | "when the user grabs an item that the place it in a bag or something and it isnt just floating and also that it isnt phasimng through them as they walk." |
| PT-12 | NPC | "make it so that there is a proportional amount ofg people buying items in the shop and playing a golf round. Please make sure they can do both as well so buy then checkin for a golf round etc." |
| PT-13 | NPC | "make sure they are buying a reasonable amount of things atnd the things they buy are based on popularity of the item etc. so that the player can learn to see what sells more than others etc." |
| PT-14 | LAPTOP | "find a new location to put the laptop. Maybe in another room but in the chsherier section facing towards the player is not the correct place. Maybe face it towards the chaier or find another spot." |
| PT-15 | LAPTOP | "when you buy things in the game like upgrades or deliveries etc in the laptop that you dont needto scroll up to select purache item maybe add it to the cart etc its kind of annoying to go back and forward with thatr." |
| PT-16 | LAPTOP | "when a user buys a vinyl or something its not automatically installed. Its just added to there inventory where then they can build with that." |
| PT-17 | **BLOCKER** → Blocker 6 | "there is a lot of phasing through objects for paintings, boxes etc etc." |
| PT-18 | **BLOCKER** → Blocker 4 | "I cant seem to open a box ai can place it but cant open it. Tell me how ot or implement it if havent done so yet." |
| PT-19 | **BLOCKER** → Blocker 8 | "The room is not dark enough honestly it should be darker." |
| PT-20 | **BLOCKER** → Blocker 1 | "i walk in and click E on the ceiling and it says dead ceiling repired however the lights dont turn on and i didnt even have the clubhouse kit." |
| PT-21 | CHECKOUT | "fix the issue in the cashier where they put an item that is clearly too big for the desk find a way around it." |
| PT-22 | **BLOCKER** → Blocker 6 | "when the user places a flat item on the dark green tray sometimes it phases through please fix that" |
| PT-23 | CHECKOUT | "make it easier to see on the tray." |
| PT-24 | LAPTOP | "add a search inside the laptop so its easier to navigate things. Like if the clubhouse kit was in the laptop it would be hard to find." |

---

## Session blockers authorised from these findings

The walk-through authorised nine blockers. Seven map onto findings above; two
(Blocker 2, the optimistic-success audit; the lighting-state rework) were raised
by the walk-through itself rather than by a single note.

| Blocker | Source findings | One line |
|---|---|---|
| 1 | PT-20 | The ceiling repair reports success while the kit gate leaks and the light stays dark. |
| 2 | PT-08, PT-20 | Success-reported-effect-absent as a class, across every player-facing interaction. |
| 3 | PT-08 | The `'cat'` crash on ordering; say plainly whether the order landed. |
| 4 | PT-18 | Boxes cannot be opened — or the interaction is unfindable. |
| 5 | PT-07 | The cashier station renders black and has no legitimate walkable route. |
| 6 | PT-17, PT-22, PT-11 | Collision and parenting sweep, batched, plus a permanent test. |
| 7 | PT-01 | D does not strafe right, and two harnesses claim it does. |
| 8 | PT-19 | The unpowered room should read genuinely neglected, not merely dim. |
| 9 | PT-10 | NPCs stall and push forever; the recovery ladder did not fire. |

Deferred by explicit instruction and **not** to be started in that session:
every `CHECKOUT`, `NPC` and `LAPTOP` item above, except the tray collider
(PT-22), which enters through Blocker 6.

## Rulings recorded alongside these findings

- **Windows: none, permanently.** The room stays windowless; a window works
  against the darkness the walk asked for. Settled in `Greybox/FLOOR_PLAN.md`
  and `ART_BIBLE.md`.
- **Crowd churn is a missing feature, not a threshold problem.** Logged as
  `NAV-WAIT-001` in `DEFECTS.md`: NPCs have nowhere to wait for an occupied
  browse stand. Episodes attributable to it are exempted from the block cap
  **only while that defect is open**, and only when tagged with its ID.
