# THE GROUND — reference board

Real photographs of the surfaces the player looks at for most of every outdoor
frame. Fetched from Wikimedia Commons with
`node tools/course/fetch_ground_ref.mjs`; every file is credited in its folder's
`sources.json` (title, page, licence, author, original size).

Gathered the way the apparel v6 board was gathered, and for the same reason: v5
was built from construction knowledge and v6 was built from photographs, and v6
was the one that worked. **Browse categories, do not full-text search** —
Commons search reads OCR, so "fairway golf" returns scanned books.

    node tools/course/fetch_ground_ref.mjs --cat "Sand bunkers (golf)" 30
    node tools/course/fetch_ground_ref.mjs --get bunker atalaya "File:2006-02-28-Atalaya-2.JPG"
    node tools/course/fetch_ground_ref.mjs --audit
    node tools/course/fetch_ground_ref.mjs --control

## What the board says, and what each thing changed

These are the readings the maps in `tools/course/turf.py` were sized against.
Each is something the shipped ground got wrong, named against the frame that
shows it.

| # | reference | what it shows | what the game did |
|---|---|---|---|
| G1 | `bunker/atalaya.jpg` | bunker sand is **near white and barely saturated** — a pale cream against the green | `colSand` tinted `(0.78, 0.66, 0.46)`: a strong orange tan |
| G2 | `fairway/hole_and_path.jpg` | the cart path is **light warm-grey concrete** with a dark seam where it meets turf | the path zone reused the rough tint; the ribbon was a canvas speckle with no normal and no roughness |
| G3 | `mow/cambridge_stripes.jpg` | the mow bands are **nearly invisible in the near foreground**, strongest toward the horizon, and they **swap when you walk to the other end** | `col *= 1.0 + band * amp` — one number, identical at your feet and at three hundred yards, identical whichever way you face |
| G4 | `fairway/hole_and_path.jpg`, `green/putting_senne.jpg` | fairway, green and rough differ in **hue and structure**, not only in value: the rough beside the path is dry, yellow-brown and patchy with bare soil showing | one `leafy_grass` photograph served fairway, semi, tee, green, fringe, rough and heavy rough, separated by a tint and a UV scale — and `FW_STYLIZE` reduced it to its luminance first |
| G5 | `turf_close/sod_farm.jpg` | mown turf under flat light is **almost uniform** at five metres, with the structure carried by a directional lay rather than by visible blades | there was no directional structure at all: the tile was isotropic noise |
| G6 | `bunker/atalaya.jpg` | at the rolled turf edge there is a band of **dead brown grass and exposed soil**, not merely shaded green | modelled as a darkening ramp only |

## Folders

| folder | what is in it |
|---|---|
| `fairway/` | three holes at eye height, including `hole_and_path.jpg` — the single most useful frame on the board: fairway, first cut, dry rough, concrete path and aerial perspective in one picture |
| `green/` | putting surfaces, and a green read against the rough beside it |
| `rough/` | uncut grass beside a managed surface |
| `bunker/` | sand, its lip, and the fairway beyond |
| `tee/` | a tee box |
| `path/` | cart paths, close |
| `mow/` | striping: a lawn at a grazing angle, and mower track marks |
| `turf_close/` | a sod farm — turf with nothing else in the frame |

## Step two: the wear board (2026-08-19)

Six close references in `wear/`, fetched by category from Commons and credited
in `wear/sources.json`. **Both of the frames below say the opposite of the
obvious implementation**, which is why they were fetched before anything was
authored.

| # | reference | what it shows | what an unread implementation would have done |
|---|---|---|---|
| W1 | `wear/santander_scar.jpg` | worn ground is **LIGHTER than the turf, not darker** — a pale grey-cream soil close to the value of the paving beside it, and strongly **desaturated** rather than browned | darken the turf where wear is high. Wear would have read as shadow or as damp, which is the one thing it is not |
| W2 | `wear/santander_scar.jpg` | the scar's edge is **ragged and fingered**, with surviving grass in islands and tufts *inside* the bare area and a broken fringe of thinning blades maybe 10–20 cm wide | a threshold on a smooth mask: a clean contour, which reads as a decal |
| W3 | `wear/amer_path.jpg` | wear is **two-toned**. A broad **straw-blond halo** of dry, dying grass spreads metres wide, and a **narrow darker compacted line** runs through it where the traffic actually concentrates | one channel, one colour. The halo is most of the visible area and it is a different material from the track |
| W4 | `wear/amer_path.jpg`, `wear/cyclepath_margin.jpg` | at a hard edge the worn ground **creeps over the paving** — the outer courses of brick are half-buried in soil, so there is no clean seam | a hard boundary between path ribbon and turf, which is what the game draws today (G2) |
| W5 | `wear/santander_scar.jpg` | the turf **immediately beside** the scar is not darkened or discoloured at all; the wear is confined and the healthy grass runs right up to the fringe | a soft radial falloff tinting good turf for metres around |
| W6 | `wear/helsinki_line.jpg`, `wear/lisboa_organic.jpg`, `wear/amer_path_2.jpg` | scars **converge and widen at their junctions**, and they follow the desire line, not the built line | width constant along the mask |

### What that means for the authoring

The brief is *worn apron by each tee, walk-off scar at each green, scuffed margin
where carts leave the path, authored from the course vector as a mask, sampled by
the mow flow field.* The board says the mask needs **two thresholds, not one**:

- a wide **dry** band — desaturate hard, lift value, kill the mow lay
- a narrow **compacted** core inside it — darker than the dry band, still lighter
  than turf, smooth and near-specular when damp

and the boundary between them and the turf wants the fringe noise of W2 rather
than a contour. `turf.py` already builds a periodic height field per surface, so
the dry band is a candidate for a fifth authored set rather than a tint.

**Nothing is authored yet.** This is the reference, gathered first, the way step
one did.

## Not on this board yet

Step one stopped at the surfaces. Nothing here yet answers **wear**: the worn,
compacted, part-bare ground beside a tee, around a green's walk-off, and where
carts turn. `fairway/hole_and_path.jpg` shows it beside the path and
`rough/halle_westf.jpg` shows it faintly, but neither is a close reference, and
the game's `wear` channel is driven by the simulation rather than by placement.
That is the first thing step two would need.
