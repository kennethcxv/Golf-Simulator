# The four hardgoods, and what the assets cost

The two additions from the goal, after the two regressions. Evidence is in
`qa/goal39/` and `qa/hero-cost/`.

---

## 1. Wire the four hardgoods

All four **draw**, measured by authored material name in a live scene, with a
scanner control that passes in both directions before any result is believed.

| | before | after |
|---|---|---|
| counter | 0/4 materials | **CounterOak 4/4, CounterKick 1/1, CounterBrass 2/2, CounterTop 2/2** |
| driver | 0/8 | **8/8** |
| iron | 0/6 | **6/6** |
| putter | 0/10 | **10/10** |

All with `normal=Y ao=Y rough=Y COLOR_0=Y` — the v7 bake survives the load.

### The counter: the suppression is lifted for this one asset

`pine-hills-v2` greys assets 61/62/63 on purpose so the floor plan reads as
volume rather than as dressing. **62 and 63 stay grey. 61 does not**, and the
lift is stated at the call site rather than left to be discovered.

The greybox's actual job is untouched: the slab is **hidden, not removed**, so
the colliders, the register stand, the queue head and the ledger all keep the
datum they are pinned to. `qa/goal39/v3-desk-oblique.png` is the frame — oak
body, stone top, brass rail, kick panel, terminal and ledger on it.

### The clubs: the display was never the descriptor

The first cut wired the three clubs into `catalogProductVisual` and **changed
nothing on the wall.** That module is the CHECKOUT representation — the unit in
a customer's hand and on the desk. The display is built somewhere else
entirely: `makeStockItem`'s `sku.cat === 'clubs'` branch, procedurally, out of a
cylinder shaft, a cylinder grip, a tinted accent ring and a `head_*` GLB. The
hero belongs there, and the descriptor edit is reverted.

**Top tier only** — `driver3`, `irons2`, `putter3` — and that is a budget and
legibility decision, not a wiring one:

- a hero driver is **13,884 triangles across eight materials**, and a comb rack
  has twenty slots;
- the accent ring is how a tier reads from across the room, and
  `instantiateRaw` cannot tint, because tinting is what the bake replaced.

Lower tiers keep the tinted procedural club beside it. Say the word and they
follow.

### NOT OBTAINED: a frame of the club display

The club racks are in `PINE_HILLS_V2_LAYOUT.cutFixtures` — a failing municipal
starter has no club wall — so the driver splices them in through `layout.extra`
into the **stockroom**, which is unlit and enclosed. Both v2 and v3 photograph a
black volume behind a PUTTER STUDIO sign.

The wiring is proven by the controlled scan. **Where the clubs go on a lit
retail wall is a placement decision**, and it is the open question here.

### The inside is not broken

| golden | diff |
|---|---|
| `shop-floor` | **0.0000** |
| `stockroom-wall` | **0.0000** |
| `bag-packed` | 7.65% → rebaselined |

The `bag-packed` diff image is confined to the desk surface and its front face.
The customer, the shelving, the check-in board and the light are untouched. That
is the intended swap. Gate green end to end, one-pixel control fired.

---

## 2. What the assets cost

`tools/qa/hero-asset-cost.js`. A/B **in one boot** so lighting, time of day and
save state are shared rather than assumed equal. The heroes are found by the 61
material names their bakes carry — read out of the GLBs, not from memory — then
hidden, measured, restored.

**The restore is the control.** If the reading does not come back, something
other than the heroes moved and the delta is not theirs.

| station | draws | triangles | programs | textures | restore drift |
|---|---|---|---|---|---|
| **indoors**, on the shop floor | **+9** | +404 | **+0** | +0 | 0 |
| **outdoors**, on the apron | **+33** | +137,808 | **+0** | +0 | 0 |

`isInside false → true` walking in, `true → false` walking out, both asserted.
Zero failures.

**Three things worth saying about those numbers.**

1. **They mint no programs.** Not one, at either station. Whatever the outdoor
   item-switch latency is, the hero assets are not adding compiles to it.
2. **Texture count does not move with visibility** (324 either way). The ~12 MB
   is a load-time residency cost, not a per-frame one, and hiding them does not
   give it back.
3. **Outdoors costs more than indoors**, which is the opposite of the intuition
   that the shop is where the shop's assets are expensive. From the apron the
   building and its interior are in frustum at once.

### Frame time is NOT here, and that is deliberate

This box presents WebGL at **1 Hz** — menu 14.6 ms/frame, scene 1009.9, in play
1003.0, one window, visible and focused throughout
(`BOOT_AND_OUTDOOR_2026_08_19.md`). Indoor and outdoor both sit on that floor.
Every millisecond read here is ~60× inflated; draw calls, triangles, programs
and texture counts are not, and that is why those are the columns above.

**Whether the ground work or the hero assets cost frames outdoors is still
open**, and it needs a machine that presents frames.

---

## Four instrument bugs, each of which had already produced a wrong answer

1. **The scanner's control injected a material named `CounterOak`** — a name
   that cannot be free once the counter is really wired. It failed on the build
   where everything worked: the control was measuring the fix. Now
   `__goal39ControlMat`.
2. **The rack check counted meshes under `Fixture_<id>`, where stock never
   goes.** `rebuildStock` parents each baked display into `stockGroup`, so a
   rack full of clubs and an empty one both read "6 meshes".
3. **`isInside` takes coordinates.** Called bare it answers about
   `(undefined, undefined)` and returns false everywhere — it labelled a
   968-draw interior reading "never reached the interior" while the player was
   standing in the shop.
4. **The hero material names were written from memory** (`PoloBody`,
   `CapCrown`, `TowelBody`) and matched four — the counter's. The first cost run
   reported the whole fifteen-asset set costing what one desk costs.

Plus the clock: the first club frames were all shot at 6:02 AM, the same trap
the ground work hit. It is pinned and asserted now.

---

## Next

**Step two: wear.** Not started. Worn apron by each tee, walk-off scar at each
green, scuffed margin where carts leave the path, authored from the course
vector and sampled by the mow flow field — and **the close-wear reference comes
first**, the way step one did, because that is what worked.
