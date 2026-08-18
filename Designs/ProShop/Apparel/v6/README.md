# v6 reference — real photographs, on disk, in the repository

36 photographs from Wikimedia Commons, four to six per garment. Every file has
an entry in its folder's `sources.json` giving the Commons page, the licence,
the author, and a `shows` line saying what the photograph is FOR.

## Why this folder exists

v5 shipped with one board for the whole garment set, and the hardgoods session
after it reported *"no way to save photos to disk"* and built ten assets from
construction knowledge alone. Both were wrong in the same way:

- `tools/blender/hero/v4/fetch_ref.mjs` already existed and worked.
- It wrote into `qa/hero/v4/ref/`, and **`/qa/` is gitignored** — so sixteen
  perfectly good photographs sat outside the repository where the next session
  could not find them. "There is no reference on disk" was true of the tracked
  tree and false of the machine.

`Designs/` is tracked. The reference now survives the session that fetched it.

## Fetching more

    node tools/blender/hero/v6/fetch_ref.mjs --cat "Baseball caps" 160
    node tools/blender/hero/v6/fetch_ref.mjs --get cap side "File:Games Maker Cap Side.JPG"
    node tools/blender/hero/v6/fetch_ref.mjs --audit
    node tools/blender/hero/v6/fetch_ref.mjs --control

**Browse categories, do not full-text search.** Every one of the 33 hits for
"polo shirt hanger" was a scanned book — Popular Science 1918, the Federal
Register 1955 — because search reads OCR. Commons categories are curated and
hold the actual photographs.

**Then look at what came back.** Of the first six polo results, one was an
ink-and-wash drawing and one was labelled "hung" and shows a folded garment. A
Commons title is not a photograph. `tools/blender/hero/v6/sheet.py` builds the
triage sheet; the frames themselves are in `qa/hero/v6/ref-triage/`.

## What is here

| folder | n | the angles that matter |
|---|---|---|
| `cap/` | 6 | a true side elevation, a four-view sheet, a golf cap with a badge |
| `hoodie/` | 6 | a slatwall rail in four colourways, three flat-laid, a hood crown from behind |
| `polo/` | 5 | macro piqué knit, a low-angle folded stack, a contrast collar with a patch |
| `tee/` | 4 | flat front and back, folded stacks under a hung rail |
| `trousers/` | 6 | folded from above, a waistband and belt loops, a welt pocket, a worn crease |
| `towel/` | 6 | waffle macro, terry macro, a low-angle stack of five folded towels |
| `rail/` | 3 | hung garments from a low angle: hooks, shoulders, spacing |

These are other people's photographs under CC BY / CC BY-SA / CC0 / public
domain. The attribution is in `sources.json` and travels with the files.
