Final batch. Do all of these in one run, same loop and the same quality bar as
the broom/dustpan/spray run — that process is what produced them and it is not
optional here.

  THE LEDGER BOOK — closed, open, and a leaf mid-turn. The only asset I STUDY
  rather than glance at. Leather or cloth board, visible spine, a real page block
  with thickness and an uneven fore-edge, ribbon or clasp. The open state needs a
  proper gutter — two pages meeting at a spine, not a flat card with a line down
  it. Build it with a leaf that can MOVE, not one welded slab.

  THE CASH REGISTER / TILL — drawer, monitor, body. The reward loop. The drawer
  must be a real compartment with dividers, because coins and notes are placed
  INTO it and land on each other. Report the drawer's interior dimensions and the
  divider layout the same way you reported the bag's.

  THE MONEY — cash, coins and cards. Full spec below; the one item here with a
  variety requirement.

  THE CUSTOMER BASKET — Publix-style hand basket. Moulded plastic, two folding
  handles, open top, stackable taper, ribbed sides. Interior volume reported.

  THE PRESSURE WASHER WAND — belt tool, lowest frequency of the set. Do it last
  and drop it if you run short rather than rushing the register.

Same assertions, same broken-variant discipline. Drawer dividers and basket
handles are both the "many small things on one big thing" class.

The register monitor is an emissive screen — BOTH Cycles and EEVEE, and I see
both. Same for anything glossy or translucent.

Park anything past six rounds. If you run low on context, finish what you are on,
push it, and tell me what is left — do not start the wand with nothing behind it.

---

THE MONEY: VARIETY THROUGH TEXTURES, NOT THROUGH MODELS

A customer handing me the identical card every time reads as fake. But ten card
MODELS cost ten materials and ten programs, and a parallel session is cutting
this game from 349 materials to under 40 because that is what stands between me
and a 70-second load. So the variety lives in the textures.

  CREDIT CARDS — one mesh, one material, 8-12 different face TEXTURES. Vary what
  a real wallet varies: dark navy, matte black, silver, warm red, bank-blue,
  green, a plain white one. Chip and stripe stay put — those are geometry.
  Generic cards only: no real bank names, no real logos, nothing resembling a
  specific issuer. The card is currently reported FLAT AND PHASING THROUGH the
  customer's fingers, so it needs real thickness and a measured footprint.

  NOTES — one mesh, and a texture ATLAS holding 1, 5, 10, 20, 50, 100, plus two
  wear variants so a stack does not read as photocopied. Generic currency, not a
  real note reproduced.

  COINS — these genuinely differ in SIZE, so quarter, dime, nickel and penny are
  scaled instances of ONE mesh with different face textures and a shared metal
  material. Two metal tones at most: a copper and a silver.

  REPORT THE COST FOR THE WHOLE SET, not per design: materials, programs, draw
  calls. Target is one material family for cards, one for notes, one or two for
  coins. If a variant would add a material, say so BEFORE building it.

  Why the coin sizes matter beyond looks: the register already hands the audio
  cue its denomination so a quarter sounds different from a twenty, and the
  pile-depth audio distinguishes a coin landing in an empty well from one landing
  on coins. Different-sized coin meshes make that visible as well as audible.

---

THEN, AND ONLY AFTER THOSE ARE DONE: THE UNIVERSAL SHELF.

The shop uses ONE shelving unit that holds anything, not bespoke fixtures per
product type. Three reasons, and the third is binding:

  - It is the genre's own answer. A shelf you place anywhere and stock with
    whatever you like is the loop, not a limitation — deciding what goes where is
    the interesting decision, and it only exists if the shelf does not decide.
  - It makes the layout MINE. A ball display that only holds balls means the
    store arrangement is authored; one shelf that holds anything means
    merchandising is something I can be good at.
  - MATERIALS. Bespoke fixtures are exactly how material counts explode: four
    fixture types is four models, four material sets, four sets of shader
    variants. One gondola instanced twelve times is one model, one material, one
    program.

WHAT TO BUILD:

  ONE RETAIL GONDOLA in three SIZES — low (see over it), standard, and a tall
  back-wall run. Same model, same material, scaled. Sizes are free: no new
  geometry, no new material.

  Uprights, adjustable shelves with real thickness and a front lip, a base kick
  plate, a back panel. Every shelf SEATED in its uprights, not floating — the
  "many small things on one big thing" class again, same assertion, watched
  failing on a deliberately floating variant first.

THE DELIVERABLE IS THE MEASURED TOP SURFACE, not the silhouette.

  Report, per shelf: the usable top rectangle (width x depth), the front lip
  height, and the clear height to the shelf above. Those numbers feed the
  footprint-aware packer that already exists for the counter — the one that packs
  items by real size and stops them interpenetrating. Feed a shelf's measured
  surface into that and ANY product fits ANY shelf automatically. That is the
  whole feature.

  A beautiful gondola with no measurable usable surface fixes nothing. The bag
  phasing bug survived two fixes precisely because the game cleared goods against
  a rectangle somebody typed rather than real geometry.

BEFORE MODELLING, PHOTOGRAPH WHAT EXISTS. vendor/models/assets_51_100/sheet_07
already has a tiered retail gondola and a stockroom shelving system. Light them,
turntable them, and tell me whether they already read correctly. If one does,
keep it and say so — that is what you did with the broom and it was the right
call.

BUDGETS, both harder than for hero assets:

  TRIANGLES ARE PER-INSTANCE. One gondola at 3,000 is fine; twelve is 36,000.
  Report the count AND how many I am likely to have on the floor.

  MATERIALS ARE THE CONSTRAINT. Every fixture shares from ONE small library — the
  same painted metal, the same laminate, the same trim. Tell me how many NEW
  materials the shelf costs. Ideally zero. Anything above zero needs justifying.

I am NOT asking for special fixtures yet. If you think one or two are genuinely
unavoidable — a locking glass case because it is transparent and has a different
rule, a wall pegboard because hanging is not stacking — name them and what they
would cost, and I will decide. Do not build them.