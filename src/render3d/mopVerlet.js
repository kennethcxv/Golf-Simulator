// THE MOP'S YARN, SIMULATED — Verlet integration with distance constraints and
// a real floor. B2 (Goal 20), sixth attempt at this tool.
//
// WHY NOT A SIXTH LAG CURVE. The rig this replaces (mopStrands.js, still used by
// the broom, whose feel the owner says is right) drives every strand with
//
//     lag += (target - lag) * dt * chase
//
// a first-order filter toward an angle derived from the head's swing. It has no
// state beyond one angle per segment, no momentum, no floor and no notion of
// where the strand actually IS in the room. Everything it cannot express had to
// be added as another input: the mopping stroke (ITEM 8), then the head's carry
// fan (B3), then the head's world delta so that turning on the spot would stir
// it (E4). Three signals, three patches, and it still reads as animation because
// a filter chasing a target is animation. A fourth input was the thing the brief
// forbade, and rightly.
//
// WHY THIS SOLVER. Position-based dynamics (Verlet integration + iterated
// distance constraints, Jakobsen 2001 / Müller 2006) is the standard way rope,
// hair and cloth are done, and it produces all four things the brief asks for
// from ONE mechanism rather than four tuned terms:
//
//   * pressed to the floor they spread out and flatten — the floor clamps the
//     nodes, the distance constraint has nowhere left to put the length, and it
//     buckles outward
//   * moved side to side they flow and trail, then settle — momentum carries the
//     nodes, damping and floor friction bleed it off
//   * direction changes whip them — a reversal leaves the accumulated velocity
//     pointing the old way; the constraint converts it into a snap
//   * nothing reads as a canned loop — there is no clock in here. The old rig
//     literally had `Math.sin(time * 1.7 + phase)` in its rest pose.
//
// And because the nodes live in WORLD space, the strands respond to anything the
// head does — stroke, carry, walking, strafing, turning, a lift, a stumble —
// with no drive signal plumbed in at all. The three patches above become one
// line: read the anchor's world matrix.
//
// WHY NOT VENDOR ONE. The small JS Verlet libraries (mattdesl/verlet3d,
// VerletExpressJS, trzy/verlet) are particle-and-stick engines that allocate an
// object per particle and per constraint, and none of them models floor
// friction or writes into an InstancedMesh. At 640 strands x 4 nodes that is
// 2,560 live objects a frame plus an adapter, against ~90 lines of flat
// Float32Array arithmetic here. The thing that failed five times was not that
// the code was local — it was that it was a LAG CURVE. This is the named
// algorithm, run on real state, against a real floor.

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// TUNED AGAINST THE PLAYER-CAMERA FRAMES, not by taste. The first pass ran
// gravity 11 / damping 0.90 / buckle 0.55 and the photographs showed two faults
// the simulation tests could not: on a strafe reversal the yarn whipped clean
// ABOVE its own collar, and a planted head splayed so hard it read as a flat
// disc rather than a bundle. Wet cotton is heavy and it damps fast, so the fix
// is physical rather than cosmetic — more weight, less retained velocity, and a
// buckle that lets the head keep its volume when it is pressed down.
const DEFAULT_PARAMS = Object.freeze({
  gravity: 19.0,      // yd/s^2 — waterlogged cotton, not hair
  damping: 0.865,     // velocity kept per step (air)
  floorFriction: 0.55, // horizontal velocity kept per step while touching boards
  iterations: 2,      // constraint passes; more = stiffer yarn
  buckle: 0.30,       // how strongly a compressed strand splays outward
  stiffness: 1.0,     // 0..1 fraction of the length error corrected per pass
  maxStep: 1 / 90,    // fixed sub-step, so feel never depends on frame rate
  // PLAYTEST 4, ITEM 3b — HOW MUCH OF THE HEAD'S OWN MOTION THE YARN SIMPLY RIDES.
  //
  // 0 is the pure simulation: every node is left where it was and the solver
  // pulls it along, which is why turning your head swings the strands. 1 carries
  // every node with the head's rigid transform, so walking, turning and looking
  // move the yarn without deforming it AT ALL. Applied to both the current and
  // previous positions, so it transports the chain without injecting velocity --
  // the yarn is not being pushed, it is being carried.
  rigidity: 0,
});

// 5.2 (Goal 26) — "IT MUST FEEL HEAVY... SEPARATE CARRY AND ACTIVE PARAMETERS --
// ONE SOLVER TUNING CANNOT DO BOTH."
//
// He is right that it cannot, and the reason is that the two states want opposite
// things from the same numbers:
//
//   CARRIED   "they barely move, a sharp turn produces a small slow response, no
//             flailing, no jitter at rest." That wants heavy damping and stiff
//             constraints -- the yarn should behave like a hanging weight that
//             resists being swung.
//   ACTIVE    "they drag, compress, lag and recover, and settle smoothly when the
//             stroke stops." That wants the opposite: looser damping so the yarn
//             can trail, and more give so it can compress against the floor.
//
// Tuning one set to sit between them is what produces yarn that flails when
// carried AND feels stiff when mopping, which is the complaint.
//
// These are DELTAS applied over DEFAULT_PARAMS rather than two full tables, so a
// change to the shared physics does not have to be made twice and cannot drift
// between the two states.
// `damping` is the fraction of a node's own velocity it KEEPS each step, and in
// this solver that runs the opposite way round to the intuition. A node that
// keeps its velocity keeps travelling with the head it inherited that velocity
// from, so it hangs tight underneath. A node whose velocity is killed each step
// is left behind and trails. Measured, at a 1.0 yd/s drag, mean tip lag:
//
//     damping   0.20    0.50    0.74    0.865   0.90    0.96
//     lag (yd)  0.240   0.230   0.196   0.135   0.106   0.033
//
// I had these two tables the wrong way round on the first pass for exactly that
// reason, and the sweep above is why they are now this way round.
export const CARRY_FEEL = Object.freeze({
  damping: 0.92,        // tight under the head: ~0.09 yd of lag at walking pace
  floorFriction: 0.55,
  iterations: 3,        // stiffer: the bundle holds its shape instead of splaying
  buckle: 0.16,         // little outward splay when nothing is pressing it
  stiffness: 1.0,
  // PLAYTEST 4, ITEM 3b — "CARRIED IS EFFECTIVELY STILL", which damping cannot do.
  //
  // 5.2 tuned damping for this and the owner still sees it swing. Swept, that is
  // not stubbornness, it is the wrong lever: against a 140 deg/s look-around the
  // peak tip excursion barely moves across the whole usable range --
  //
  //     damping   0.92    0.95    0.97    0.985   0.995   0.999
  //     look (yd) 0.0953  0.0899  0.0890  0.0925  0.1004  0.1023
  //
  // -- because the swing is not the yarn keeping velocity, it is the ANCHOR
  // travelling on an arc while the tips are still where they were. No amount of
  // damping removes that; above 0.985 it gets worse, since a node that never
  // sheds energy keeps ringing.
  //
  // `rigidity` is the lever that does: the head's frame-to-frame transform is
  // applied to the nodes themselves. Swept against the same two motions, with
  // ACTIVE untouched at 0 in every row (mopping peak 0.1402 throughout):
  //
  //     rigidity   0       0.5     0.8     0.9     0.94    0.97    1.0
  //     walk (yd)  0.0864  0.0549  0.0246  0.0125  0.0076  0.0038  0.0001
  //     look (yd)  0.0953  0.0694  0.0712  0.0338  0.0233  0.0128  0.0001
  //
  // 0.97 is 4 mm of walk swing and 13 mm of look swing on a 336 mm head: still
  // in every practical sense, which is the bar he set, while 1.0 is a literal
  // weld that would read as dead when the tool is jolted. The 3% left is the
  // "small slow response" 5.2 asked for, and it is now the ONLY thing that
  // moves when the player is not mopping.
  rigidity: 0.97,
});

export const ACTIVE_FEEL = Object.freeze({
  damping: 0.78,        // sheds velocity, so the yarn TRAILS the stroke ~2x further
  floorFriction: 0.42,  // catches on the boards rather than sliding with the head
  iterations: 2,
  buckle: 0.42,         // compresses and splays where it meets the floor
  stiffness: 0.92,      // a little give, so the drag reads as weight not as rods
  // Mopping is the one time the owner WANTS the strands to move, so the yarn is
  // handed back to the solver completely.
  rigidity: 0,
});

// THE YARN THE PLAYER ACTUALLY SEES, owned in one place.
//
// This used to live only as arguments at the single call site in
// toolViewmodel.js, while the function defaults below said something else and
// the test asserted the DEFAULTS. Two populations: the shipped mop could change
// without the test noticing, and the test could pass about a mop nobody holds.
// Both now read this object.
// How far out the collar starts, as a fraction of the head radius. 0 is the old
// point-source fill; 1 would be a bare ring with a hole in the middle. 0.52
// keeps the whole width covered while leaving nothing on the axis.
export const COLLAR_INNER = 0.52;

// D (Goal 23) — 16 BANDS WAS RIGHT AND TOO THIN. MAKE THEM COVER THE HEAD.
//
// Goal 22 cut 820 hairs to 16 bands, which was the correct direction and, on
// its own, produced spikes: sixteen 12 mm ropes hung off a sunflower fill that
// puts the first few on the axis. What a string mop actually is, is a wide band
// of yarn clamped across the head, thick enough that neighbours touch and mat.
//
// So three changes together, none of which works alone:
//   * 22 bands rather than 16 — still inside the 16-24 the owner asked for, and
//     enough to close the gaps at this diameter;
//   * the collar (COLLAR_INNER) so they hang from the head's width, not a point;
//   * bands more than twice as thick, 26 mm across at the top tapering to 20 mm,
//     which at ~40 mm anchor spacing is nearly touching at rest and fully matted
//     once they splay.
// Cost is 88 instances against 3,280 before Goal 22, still 4 draw calls.
// P2 (Goal 25 playtest) — "THE MOP still does not look right. Go and look at
// House Flipper's mop and match it. That is the reference, not a parameter
// sweep."
//
// THE REFERENCE, and it decides everything below: a looped-end YARN STRING MOP.
// Many fine cotton strands gathered in a tailband, folded double so the ends are
// loops rather than cut tips, splaying into a skirt and CLUMPING — one mass with
// no daylight through it. That is what House Flipper hands you and what every
// commercial string-mop head is.
//
// WHAT SHIPPED WAS THE OPPOSITE OF THE REFERENCE, and not by a little:
//
//   22 strands, each 13 mm thick, over a 105 mm head.
//
// Twenty-two fat rods on a 0.0346 m2 disc is 33.7% coverage — two thirds of the
// head is daylight — and at 13 mm each rod reads individually as a length of
// pipe. That is precisely the owner's "comb of pale rods with daylight between
// every one", and it is visible in the golden gate's own tool-mop frame.
//
// It is also a contradiction of the module it configures: createVerletMopStrands
// below DEFAULTS to 820 strands at 3.0 mm. Seven passes of guessing landed on
// few-and-thick when the reference, and this file's own design point, is
// many-and-thin.
//
// THE SHAPE OF THE ANSWER, stated as the brief requires. Three were open: many
// more thin overlapping strands; flat ribbons overlapping into a sheet; or
// modelled/cloth-baked geometry through golf-assets. TAKEN: MANY MORE THIN
// STRANDS.
//   * the per-strand verlet solver already exists here, and 4.4 wants believable
//     per-strand dynamics — ribbons would need new geometry AND a new binding to
//     that solver, and a baked mesh cannot move per strand at all
//   * the strands are drawn from an InstancedMesh (line ~137), so DRAW CALLS
//     EQUAL THE SEGMENT COUNT and are completely independent of strand count.
//     Density is nearly free on the axis this renderer is bound by; the note in
//     this file records it as draw-call bound.
//
// THE ARITHMETIC, so the next reader does not have to guess again:
//   head area           pi * 0.105^2                 = 0.0346 m2
//   shipped   22 x 13.0 mm  ->  33.7% coverage,   1 408 triangles
//   now      380 x  6.2 mm  -> 132% at the collar, 100% at the head radius
//                              once the taper is counted, 15 200 triangles
// Over 100% is the point: strands must overlap or the eye finds the gaps. The
// hem still opens up as the skirt splays past the head radius, which is correct
// — a real mop is ragged at the hem and solid above it.
//
// radialSegments 8 -> 5 is what pays for the density. A 6 mm strand is a few
// pixels wide at the viewmodel camera; sides are not what makes a fibre read as
// a fibre, and mopStrands.js already carries that finding in words. Draw calls
// are unchanged at 4.
//
// The MATERIAL is deliberately untouched (0x8f8a80, roughness 0.97, metalness 0
// in toolViewmodel.js) — already damp cotton. The plastic read was the geometry.
// NOT CHANGED. I built the 380-strand version described above, photographed it
// at the player camera, and it is a BRUSH -- a dense straight-sided barrel of
// fibre. tests/mop-verlet-strands.test.js:212 predicted exactly that, in the
// owner's own words from Goal 22 and 23: "filling the disc was the wrong goal
// ... the gaps are most of what distinguishes it from a brush", count asked for
// as 10-20 and then widened to 16-24. Shipping 380 would have reversed a
// standing ruling to produce the thing that ruling was written against, and
// making the test green would have been weakening a gate to hide a real
// disagreement. Left at the values the owner ruled on; the conflict is in the
// report for him to settle.
// GOAL 25 ROUND 2 — THE RULING THAT SUPERSEDES 16-24 STRANDS.
//
// The owner, resolving the collision I reported between his own two rulings:
//
//   "The 16-24 ruling was about THICK BANDS. House Flipper's is MANY FINE
//    STRANDS THAT SPLAY AND CLUMP. Your own screenshot shows why 380 read as a
//    brush: it was a straight-sided barrel. A string mop is not a cylinder -- it
//    flares into a skirt and the strands clump in groups. So: density AND splay
//    together."
//
// The two rulings were never about the same number. What a person counts when
// they look at a mop is BUNCHES, and 16-24 was always the right count of those.
// The mistake in both directions was making the bunch and the strand the same
// object: at 22 strands each bunch was one 13 mm rod (a comb of pale pipes), and
// at 380 evenly-spread strands there were no bunches at all (a brush).
//
//   count 432 fine strands       6.4 mm across: yarn you can pick out one at a
//                                time, not the 13 mm length of pipe that shipped
//                                and not the 4.4 mm thread that replaced it
//   clumps 18                    inside the 16-24 a person can still count, now
//                                24 strands to a bunch instead of 14
//   splay 0.32                   the hem sits ~32% of a head-radius proud of
//                                the collar: a skirt, not a cylinder
//
// Draw calls are UNCHANGED at 4 -- one InstancedMesh per segment index, so
// density costs geometry and no submissions. That is why "many fine strands"
// is affordable here at all.
export const SHIPPED_MOP_YARN = Object.freeze({
  // ROUND 3: "the mop needs more strings that are bigger, it's currently too
  // small." All three of those, together -- the head as well as the yarn, because
  // a fuller bundle on the same 105 mm disc would just read as denser rather than
  // bigger.
  //
  // 432 = 18 x 24 exactly. An uneven split would give some bunches more strands
  // than others, and since the splay force is per-strand that imbalance is the
  // same off-axis drift the even angles above exist to remove.
  // GOAL 26 5.1: "Too thin. It needs more body." The reference he supplied is a
  // SPIN MOP -- a dense uniform microfibre disc, not a string mop with daylight
  // between the bunches. Measured against the old numbers, 432 strands at 3.2 mm
  // covered roughly a quarter of the disc, which is why it photographed as a
  // spray of spikes.
  //
  // 756 = 18 x 42, keeping the clump structure exactly (an uneven split would
  // give some bunches more strands than others, and the splay force is
  // per-strand). With the radius lift that is about 2.4x the fill of the version
  // he called too thin, while the 18 countable bunches the Goal 25 ruling settled
  // on are untouched.
  // 972 = 18 x 54, keeping the clump structure exactly (an uneven split gives
  // some bunches more strands than others, and the splay force is per-strand).
  //
  // THE BODY COMES FROM COUNT, NOT THICKNESS, and that is a constraint rather
  // than a preference: the Goal 25 ruling caps a strand under 8 mm across
  // ("a strand is yarn, not pipe"), and mop-verlet-strands.test.js enforces it.
  // My first attempt at "more body" went to 4.5 mm radius -- 9 mm across -- and
  // was correctly refused. 2.25x the strands at the same fineness is 2.25x the
  // fill without turning the yarn back into the pipes Goal 25 threw out.
  count: 972,
  // GOAL 26 5.1 ROUND 2 -- THE PROPORTIONS WERE A BALL, NOT A DISC.
  //
  // His reference is a spin mop: the white microfibre is roughly TWICE AS WIDE
  // AS IT IS DEEP, a flat packed disc under a red collar. Shipped, the head was
  // 0.256 across and the yarn hung 0.335 -- longer than the head was wide -- so
  // whatever the density, the silhouette could only ever be a sphere of spikes,
  // and that is what it photographed as. Widening to 0.336 across and cutting
  // the drop to 0.20 puts the ratio at 1.7:1, which is the reference's shape.
  radius: 0.168,
  length: 0.132,
  // "The solver can keep four simulation nodes; the GEOMETRY must not show
  // them." With 4 the outward flare -- which scales by n/S -- puts a visible
  // corner at every node, and at the shorter 0.20 drop those corners photograph
  // as fish-hooks around the rim. 8 halves the angle at each joint, which is
  // what turns the chain back into a rope. It costs four more instanced draws on
  // the one tool that is on screen at viewmodel distance.
  // I raised this to 8 believing the fish-hooks around the rim were a corner at
  // every simulation node, photographed it, and the picture was indistinguishable
  // -- so that was not what they were. They are the OPEN MOUTHS of the strand
  // tubes (see the openEnded note below). 4 is enough for the motion and costs
  // half the draws and half the triangles, so it stays at 4.
  segments: 4,
  // PLAYTEST 3 ITEM 5 -- "MAKE EACH STRAND THICKER. They are far too thin."
  //
  // 0.0038 yd is 3.5 mm of radius, 7 mm across. An earlier round went to 4.5 mm
  // radius (9 mm across) and was refused as too thick -- but that was against a
  // DIFFERENT head: 380 strands on a 0.256-wide ball, where 9 mm ropes read as
  // pipes. At 972 strands on a 0.336-wide disc the same thickness reads as yarn,
  // because each strand is a smaller fraction of what the eye sees.
  //
  // 1.35x, not 2x: the tips are what splay apart at the hem, and doubling the
  // bottom radius closes the daylight between bunches that the Goal 25 ruling is
  // about -- which is the owner's call, not mine to pre-empt.
  strandRadiusTop: 0.0051,
  strandRadiusBottom: 0.0036,
  radialSegments: 5,
  lengthVariation: 0.24,
  clumps: 18,
  // GOAL 26 5.1 ROUND 2: "clumped into a MASS." 0.42 gathers each bunch to 42%
  // of the gap to its neighbour, which leaves daylight all the way round every
  // one of the 18 -- photographed at the player camera the head read as a sea
  // urchin, a starburst of separate tufts with black between them, not the
  // packed white disc in his reference. 0.80 lets neighbouring bunches meet at
  // the collar while the bunches themselves stay countable, which is what the
  // Goal 25 ruling was actually about.
  clumpGather: 0.80,
  // ITEM 5: the bunches hang from inside the hub's grip rather than from a ring
  // outside it. See COLLAR_RADIUS below for the measurement that forced this.
  collarRadiusFrac: 0.50,
  // and a stronger flare, because a disc is what the outward push makes: at 0.32
  // the bundle fell as a column and only the hem opened.
  // ITEM 5, AND IT IS THE OTHER HALF OF MOVING THE ANCHORS INSIDE THE HUB.
  //
  // Clamping the bunches at 0.50 of the head radius takes 0.39 of a radius off
  // where they start, and at splay 0.52 the tips then reached only 0.1259
  // against a 0.168 head -- I had made the whole head NARROWER while fixing the
  // gap, which the "the collar must still reach the rim" assertion caught.
  //
  // Swept rather than guessed (tip radius after 240 frames of settling is not
  // linear in splay):
  //     0.52 -> 0.1259   0.70 -> 0.1364   0.90 -> 0.1476
  //     1.10 -> 0.1583   1.30 -> 0.1684   1.50 -> 0.1779
  // 1.30 puts the hem at 0.1684 against a head radius of 0.168, so the yarn
  // reaches the rim exactly. Anchored at the middle, open at the hem: a cone
  // that fills the head rather than a ring that outlines it.
  // PLAYTEST 5: the first LIT frame of this head shows a shuttlecock -- straight
  // white spikes radiating off a red disc. 1.30 was solved so the hem reached the
  // rim (tips 0.1684 against radius 0.168) and that arithmetic is right; pushing
  // every tip of a STRAIGHT strand to the rim is what makes a starburst. The
  // reference's disc is strands HANGING and gathering, with gravity winning over
  // the outward push, not strands fanned to their maximum radius.
  splay: 0.78,
});

export function createVerletMopStrands({
  THREE, material,
  radius = 0.115,
  length = 0.30,
  count = 820,
  segments = 4,
  strandRadiusTop = 0.0030,
  strandRadiusBottom = 0.0016,
  radialSegments = 5,
  // B3: real mop yarn is not cut to one length. +/-18% around the nominal, so
  // the hem of the bundle is ragged instead of a machined disc.
  lengthVariation = 0.18,
  // GOAL 25 ROUND 2 — CLUMPS AND SPLAY, together, by the owner's ruling:
  // "The 16-24 ruling was about THICK BANDS. House Flipper's is MANY FINE
  // STRANDS THAT SPLAY AND CLUMP... A string mop is not a cylinder -- it flares
  // into a skirt and the strands clump in groups."
  //
  // So the 16-24 the last two goals argued over is not the strand count at all.
  // It is the count of BUNCHES a person can pick out by eye, and each bunch is
  // now made of many fine strands instead of being one fat rod. That is what
  // reconciles the two rulings: the reading he wanted was always the clumping.
  clumps = 18,
  // how tightly a bunch gathers at the collar, as a fraction of the gap between
  // neighbouring bunches. Below 1 the bunches do not touch, which IS the point:
  // the daylight between them is what stops it reading as a brush.
  clumpGather = 0.42,
  // Where the bunch centres sit, as a fraction of the head radius. Must stay
  // inside the hub's bottom radius (HEAD_R * 0.52 in toolViewmodel.js) or the
  // yarn hangs outside the clamp again.
  collarRadiusFrac = 0.50,
  // outward flare at the hem, as a fraction of the head radius. This is the
  // skirt: 0 is the straight-sided barrel that photographed as a brush.
  splay = 0.55,
  params = {},
}) {
  const live = { ...DEFAULT_PARAMS, ...params };
  const N = Math.max(1, Math.round(count));
  const S = Math.max(1, Math.round(segments));
  const NODES = S + 1; // node 0 is the anchor, pinned to the head

  const root = new THREE.Group();
  root.name = 'MopVerletRig';

  // Geometry is authored at the NOMINAL segment length with its origin at the
  // top, so a segment scales about the joint it hangs from.
  const nominalSeg = length / S;
  // Chosen so the hem sits about `splay * radius` further out than the collar
  // at rest under this gravity: the flare is expressed in the same units the
  // owner sees (a fraction of the head) rather than as a tuned acceleration.
  const splayAccel = Math.max(0, splay) * radius * DEFAULT_PARAMS.gravity * 2.4;
  const RADIAL = Math.max(3, Math.round(radialSegments));

  // 5.1 (Goal 26) — "EACH STRAND LOOKS LIKE FOUR CONNECTED PIECES INSTEAD OF ONE
  // COHERENT PIECE", and this is exactly where that came from.
  //
  // ONE geometry used to be shared by all four segment layers, tapering
  // strandRadiusTop -> strandRadiusBottom. So every segment ran 3.2 mm down to
  // 2.3 mm and then THE NEXT ONE JUMPED BACK TO 3.2 mm: a repeating bulge at
  // every node, four times down each strand. The solver was never the problem --
  // the owner is describing a silhouette, and the silhouette had four waists in
  // it by construction.
  //
  // Now each segment index gets its own geometry whose radii are interpolated
  // along the WHOLE strand, so segment s runs r(s/S) -> r((s+1)/S) and meets its
  // neighbour at exactly the same width. One continuous tapered rope, with the
  // four simulation nodes still doing the bending. That is 5.1's "the solver can
  // keep four simulation nodes; the GEOMETRY must not show them", done as stated.
  const radiusAt = (t) => strandRadiusTop + (strandRadiusBottom - strandRadiusTop) * t;
  const segmentGeometries = [];
  for (let s = 0; s < S; s += 1) {
    // NOT open-ended. Photographed at the player camera, an open 5-sided tube
    // seen anywhere near end-on shows its own far wall through the mouth, and
    // 972 of them read as a ring of curled paper shells around the collar -- the
    // "fish-hooks" I first blamed on the solver's node corners. Caps cost ten
    // triangles a segment on one viewmodel tool and remove the whole artifact.
    const g = new THREE.CylinderGeometry(
      radiusAt(s / S), radiusAt((s + 1) / S), nominalSeg, RADIAL, 1, false,
    );
    g.translate(0, -nominalSeg / 2, 0);
    segmentGeometries.push(g);
  }

  const layers = [];
  for (let s = 0; s < S; s += 1) {
    const mesh = new THREE.InstancedMesh(segmentGeometries[s], material, N);
    mesh.name = `MopVerletLayer_${s}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    root.add(mesh);
    layers.push(mesh);
  }

  // PLAYTEST 4, ITEM 3a — "strands that read as continuous LOOPS rather than
  // separate rods."
  //
  // On the reference mop every fibre is a loop: it leaves the backing, goes out,
  // folds and comes back. Simulating that would double the node count for a
  // detail nobody sees at viewmodel distance. What the eye actually reads as
  // "loop" is the ROUNDED FOLD at the hem versus a cut end, and a flat cap on a
  // 5-sided tube is unmistakably a cut end.
  //
  // So each strand ends in a low-poly bead the width of its own tip. 20
  // triangles, one extra instanced draw for the whole head, and the hem stops
  // being a field of sawn-off pipes.
  const tipGeometry = new THREE.SphereGeometry(strandRadiusBottom * 1.15, 5, 3);
  const tipLayer = new THREE.InstancedMesh(tipGeometry, material, N);
  tipLayer.name = 'MopVerletTips';
  tipLayer.castShadow = false;
  tipLayer.receiveShadow = false;
  tipLayer.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tipLayer.frustumCulled = false;
  root.add(tipLayer);

  // Per-strand constants. Sunflower placement fills the disc evenly (golden
  // angle, sqrt radius) — no spokes, no banding, and deterministic, so two
  // sessions are identical.
  const anchorX = new Float32Array(N);
  const anchorZ = new Float32Array(N);
  const outX = new Float32Array(N); // buckling direction: away from the centre
  const outZ = new Float32Array(N);
  // The SPLAY direction is the buckle direction with the bundle's mean removed
  // (see below). Buckling keeps the raw azimuth: it only acts on strands the
  // floor is compressing, so it has no resting state to bias.
  const splayX = new Float32Array(N);
  const splayZ = new Float32Array(N);
  const segLen = new Float32Array(N);
  const CLUMPS = Math.max(1, Math.min(Math.round(clumps), N));
  const clumpOutX = new Float32Array(CLUMPS);
  const clumpOutZ = new Float32Array(CLUMPS);
  const clumpOf = new Int32Array(N);
  // Bunch centres ride the collar annulus. Spacing between neighbours sets how
  // far a strand may wander from its own centre, so the gaps survive whatever
  // count is asked for.
  // PLAYTEST 3 ITEM 5 -- "THE STRANDS DO NOT TOUCH THE RED HUB. They form a RING
  // floating around and below it with clear daylight between."
  //
  // He is describing a measurement. The hub is a cone of bottom radius
  // HEAD_R * 0.52 = 0.0874, and this ring sat at
  //     radius * (0.52 + 0.48 * 0.78) = 0.894 * radius = 0.150,
  // with the bunches spreading inward only as far as 0.129. So the nearest yarn
  // began 42 mm outside the widest part of the clamp that is supposed to be
  // gripping it, and the middle of the head -- everything inside 0.129 -- was
  // empty. That is a ring, exactly as reported, and no amount of density fixes
  // it because the strands were never under the hub to begin with.
  //
  // `collarRadiusFrac` is now the fraction of the head radius the bunch centres
  // sit at, and it defaults INSIDE the hub's grip. The hem still reaches the
  // rim: the splay force pushes the tips out by about `splay * radius`, so
  // anchors at 0.50 * radius plus a 0.52 splay lands the hem at roughly the full
  // head radius. Clamped at the middle, open at the hem -- which is what a spin
  // mop is, and it fills the disc instead of outlining it.
  //
  // NOTE FOR THE DENSITY RULING, which is the owner's: this changes WHERE the
  // bunches hang, not how many there are or how far apart they are. The 18
  // bunches and their daylight are untouched, so whichever way that ruling goes
  // it composes with this.
  const COLLAR_RADIUS = radius * collarRadiusFrac;
  const clumpGap = (2 * Math.PI * COLLAR_RADIUS) / CLUMPS;
  for (let i = 0; i < N; i += 1) {
    // D (Goal 23) — THE BANDS HANG FROM A COLLAR, NOT FROM A POINT.
    //
    // A plain sunflower fill (r = radius * sqrt(i/N)) is the right way to fill a
    // DISC evenly, and it is the wrong way to hang a mop. With 16 bands it puts
    // the first few almost on the axis, so the head reads as spikes radiating
    // out of a centre — which is exactly what the owner is looking at.
    //
    // A real string mop is clamped in a band across the head's whole width. So
    // the anchors start at COLLAR_INNER of the way out and fill the annulus
    // from there: no strand originates on the axis, the outer edge is still
    // reached, and the ring of anchors is wide enough that neighbouring bands
    // touch and mat instead of fanning apart.
    //
    // AND THEY HANG IN BUNCHES. The strand's anchor is its BUNCH's place on the
    // collar plus a small deterministic offset inside that bunch, rather than
    // its own place in a sunflower fill. A sunflower spreads points as evenly as
    // a disc can be covered -- which is precisely the even, gapless, straight
    // sided barrel that photographed as a brush at 380 strands. Even coverage
    // was never the goal; countable bunches with daylight between them were.
    const c = i % CLUMPS;
    clumpOf[i] = c;
    // ONE COLLAR RING, one radius for every bunch. Letting the radius grow with
    // the bunch index makes a spiral, and a spiral's anchor centroid is not on
    // the axis -- which showed up immediately as the resting tip cloud sitting
    // 10.6 mm off centre. A string mop's bunches are clamped in a single band
    // across the head, so the ring is also what the reference actually is.
    // EVENLY SPACED IN ANGLE, not golden-angle, and this is a physics
    // requirement rather than a taste one. The splay force points along each
    // bunch's own azimuth, so the bunches' directions have to sum to zero or the
    // whole head drifts off-axis at rest. On a golden-angle layout they did not,
    // and the resting tip centroid sat 4.74 mm off centre against this file's
    // own 4 mm bar. Even spacing cancels the radial forces exactly, and a real
    // mop's bunches are gathered evenly around the band anyway.
    const ctheta = (c / CLUMPS) * Math.PI * 2;
    const cx = Math.cos(ctheta) * COLLAR_RADIUS;
    const cz = Math.sin(ctheta) * COLLAR_RADIUS;
    clumpOutX[c] = Math.cos(ctheta);
    clumpOutZ[c] = Math.sin(ctheta);
    // where this strand sits inside its own bunch: a deterministic little disc,
    // golden-angle again so a bunch is not a line of strands
    const perClump = Math.max(1, Math.ceil(N / CLUMPS));
    const within = Math.floor(i / CLUMPS);
    const wt = Math.sqrt((within + 0.5) / perClump);
    // even angles inside the bunch as well, for the same reason as the ring: a
    // golden-angle scatter of 14 strands does not balance, and each bunch's
    // residual becomes another few millimetres of drift at rest
    const wtheta = (within / perClump) * Math.PI * 2 + c * GOLDEN;
    const wr = clumpGap * clumpGather * 0.5 * wt;
    anchorX[i] = cx + Math.cos(wtheta) * wr;
    anchorZ[i] = cz + Math.sin(wtheta) * wr;
    // A BUNCH FLARES AS ONE. The outward direction is the BUNCH's, not the
    // strand's own azimuth, so a bunch leans and buckles together instead of
    // every strand in it splaying away from its neighbours -- which would undo
    // the clumping the moment the head touched the floor.
    outX[i] = clumpOutX[c];
    outZ[i] = clumpOutZ[c];
    // Deterministic ragged hem -- keyed on the strand's place WITHIN its bunch,
    // not on its global index. Keyed on `i`, the length pattern beats against
    // the bunch period (i % CLUMPS) and some bunches come out longer than
    // others; longer strands splay further, so that imbalance walks the resting
    // tip cloud off the axis. Measured: 13.8 mm of drift against this file's own
    // 4 mm bar, with the anchors and the splay forces both already balanced to
    // 1e-5. Every bunch now carries the same set of lengths.
    const v = ((within * 0.6180339887) % 1) * 2 - 1;
    segLen[i] = (length * (1 + v * lengthVariation)) / S;
  }

  // THE SPLAY FORCES MUST SUM TO ZERO, FOR ANY STRAND COUNT.
  //
  // Splay pushes every strand along its bunch's azimuth on every step, so if the
  // bunches are not equally populated the leftover is a constant sideways force
  // on the whole head and the yarn hangs off-axis at rest. That is not
  // hypothetical: this file's own test builds its rig with count 48 against 18
  // bunches -- 3 strands in some, 2 in others -- and the resting tip cloud sat
  // 13.8 mm off centre against a 4 mm bar. The shipped 252/18 divides exactly
  // and hid it completely, which is the worst way for it to be wrong.
  //
  // Subtracting the mean makes the sum identically zero whatever the counts are,
  // and costs nothing when they already balance (the shipped mop's mean is 1e-8).
  // And the COLLAR ITSELF must be centred on the head for the same reason. A
  // strand count that does not divide by the bunch count leaves the last bunch
  // short, so the ring of anchors has more yarn on one side and the whole bundle
  // hangs off-axis before splay is even considered. Centring costs nothing when
  // it already divides (the shipped 252/18 moves by 1e-5).
  let meanAnchorX = 0;
  let meanAnchorZ = 0;
  for (let i = 0; i < N; i += 1) { meanAnchorX += anchorX[i]; meanAnchorZ += anchorZ[i]; }
  meanAnchorX /= N;
  meanAnchorZ /= N;
  for (let i = 0; i < N; i += 1) { anchorX[i] -= meanAnchorX; anchorZ[i] -= meanAnchorZ; }

  let meanOutX = 0;
  let meanOutZ = 0;
  for (let i = 0; i < N; i += 1) { meanOutX += outX[i]; meanOutZ += outZ[i]; }
  meanOutX /= N;
  meanOutZ /= N;
  for (let i = 0; i < N; i += 1) {
    splayX[i] = outX[i] - meanOutX;
    splayZ[i] = outZ[i] - meanOutZ;
  }

  // World-space node state. Flat arrays: this runs 2,560 nodes a frame.
  const px = new Float32Array(N * NODES);
  const py = new Float32Array(N * NODES);
  const pz = new Float32Array(N * NODES);
  const qx = new Float32Array(N * NODES); // previous position (Verlet velocity)
  const qy = new Float32Array(N * NODES);
  const qz = new Float32Array(N * NODES);
  let seeded = false;

  const _m = new THREE.Matrix4();
  const _inv = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);
  const _dir = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _scale = new THREE.Vector3(1, 1, 1);
  // Constants for the hem beads: a sphere has no orientation, and scaling it
  // with the strand's own length variation would shrink the fold on short ones.
  const _qIdentity = new THREE.Quaternion();
  const _one = new THREE.Vector3(1, 1, 1);
  // ITEM 3b: the head's motion since the previous frame, as a transform the nodes
  // can ride. Kept as the INVERSE because that is the form the delta needs.
  const _prevWorldInv = new THREE.Matrix4();
  const _delta = new THREE.Matrix4();
  const _carry = new THREE.Vector3();
  let hasPrevWorld = false;
  const _anchor = new THREE.Vector3();

  // Seed (and re-seed) every chain hanging straight down from its anchor, at
  // rest. Used on the first frame, and whenever the head teleports — equipping,
  // a scene change, a respawn — so a 40-yard jump can never fling the yarn.
  function seed(rootWorld) {
    // A seed is a teleport or a first frame. The carry transport must not run
    // against a stale previous matrix, or the whole bundle would be dragged
    // across the room by the delta between two unrelated places.
    hasPrevWorld = false;
    for (let i = 0; i < N; i += 1) {
      _anchor.set(anchorX[i], 0, anchorZ[i]).applyMatrix4(rootWorld);
      for (let n = 0; n < NODES; n += 1) {
        const k = i * NODES + n;
        px[k] = _anchor.x;
        py[k] = _anchor.y - n * segLen[i];
        pz[k] = _anchor.z;
        qx[k] = px[k];
        qy[k] = py[k];
        qz[k] = pz[k];
      }
    }
    seeded = true;
  }

  /**
   * @param dt      seconds
   * @param floorY  world Y of the boards under the player, or null for none
   *
   * No drive signal: the strands read the anchor's own world matrix, so every
   * way the head can move is already accounted for.
   */
  // 5.2: which tuning is in force. Set by the viewmodel from the tool's own
  // active flag, so the solver never has to guess and there is one owner.
  //
  // The switch is BLENDED, not snapped. "Settle smoothly when the stroke stops"
  // is a requirement about the transition itself: swapping damping 0.90 -> 0.74
  // in one frame changes how much velocity every node keeps, and the whole head
  // visibly stiffens on the frame the button comes up. Easing over ~0.3 s reads
  // as the yarn losing its momentum, which is what actually happens to a wet mop.
  const FEEL_KEYS = ['damping', 'floorFriction', 'iterations', 'buckle', 'stiffness', 'rigidity'];
  const FEEL_BLEND_SECONDS = 0.3;

  // AN EXPLICIT OVERRIDE STILL WINS. The look sweep (rebuildYarn) and every unit
  // test in mop-verlet-strands drive this solver by passing damping/buckle/etc
  // straight into the constructor. A mode table that overwrote them would make
  // all of those calls silently inert -- the caller sets damping 0.2, the mop
  // runs at 0.74, and the sweep reports that damping does not matter. So a key
  // the caller named is pinned to `live` and the mode never touches it; the mode
  // only fills in the keys nobody asked about.
  const pinned = new Set(Object.keys(params || {}).filter((k) => FEEL_KEYS.includes(k)));
  const tableFor = (mode) => {
    const t = {};
    for (const key of FEEL_KEYS) t[key] = pinned.has(key) ? live[key] : mode[key];
    return t;
  };
  let feelTarget = tableFor(CARRY_FEEL);
  let feel = { ...feelTarget };
  let activeFlag = false;
  let blending = false;

  function setActive(on) {
    const want = !!on;
    if (want === activeFlag) return false;
    activeFlag = want;
    feelTarget = tableFor(want ? ACTIVE_FEEL : CARRY_FEEL);
    blending = true;
    return true;
  }

  // A linear approach at a fixed rate, not an exponential ease: an exponential
  // never actually arrives, so `feel` would sit a hair off the table forever and
  // "which mode am I in" would have no exact answer. 0.3 s means 0.3 s.
  function blendFeel(dt) {
    if (!blending) return;
    const k = Math.min(1, dt / FEEL_BLEND_SECONDS);
    let done = true;
    for (const key of FEEL_KEYS) {
      const to = feelTarget[key];
      const gap = to - feel[key];
      if (Math.abs(gap) < 1e-6) { feel[key] = to; continue; }
      const span = Math.abs(ACTIVE_FEEL[key] - CARRY_FEEL[key]) || Math.abs(gap);
      const stepped = feel[key] + Math.sign(gap) * Math.min(Math.abs(gap), span * k);
      feel[key] = stepped;
      if (Math.abs(to - stepped) > 1e-6) done = false; else feel[key] = to;
    }
    if (done) blending = false;
  }

  function update(dt, floorY = null) {
    root.updateWorldMatrix(true, false);
    const rootWorld = root.matrixWorld;
    if (!seeded) { seed(rootWorld); return; }

    // A teleport must reset rather than simulate: compare the first anchor's
    // new world position with where its own node 0 was last frame.
    _anchor.set(anchorX[0], 0, anchorZ[0]).applyMatrix4(rootWorld);
    const jump = Math.abs(_anchor.x - px[0]) + Math.abs(_anchor.y - py[0])
      + Math.abs(_anchor.z - pz[0]);
    if (jump > 2.0) { seed(rootWorld); return; }

    blendFeel(Math.max(0, Math.min(dt, 0.1)));

    // PLAYTEST 4, ITEM 3b — CARRY THE YARN WITH THE TOOL BEFORE SIMULATING IT.
    //
    // "They swing when I am merely LOOKING AROUND, which is wrong -- turning my
    // head is not moving the mop." Correct, and it is not a damping problem: the
    // anchor swings through an arc while the tips sit where they were, and the
    // solver reads the difference as the yarn being dragged.
    //
    // So the head's frame-to-frame rigid transform is applied to the nodes first,
    // scaled by `rigidity`. At 1 the whole bundle rides the tool exactly and the
    // simulation sees no relative motion at all -- walking, turning and looking
    // become invisible to it, because for a real mop they are. At 0 (mopping) the
    // solver gets the raw motion back and the strands drag the way they should.
    //
    // BOTH p and q move by the same vector, which is the part that matters: Verlet
    // velocity is (p - q), so transporting the pair leaves the node's velocity
    // untouched. Moving only p would inject a fake impulse the size of the head's
    // step, and the yarn would fling itself every time the player turned.
    const rigidity = Math.max(0, Math.min(1, feel.rigidity ?? live.rigidity ?? 0));
    if (rigidity > 0.001 && hasPrevWorld) {
      _delta.copy(rootWorld).multiply(_prevWorldInv);
      for (let i = 0; i < N; i += 1) {
        const base = i * NODES;
        for (let n = 1; n < NODES; n += 1) {
          const k = base + n;
          _carry.set(px[k], py[k], pz[k]).applyMatrix4(_delta);
          const mx = (_carry.x - px[k]) * rigidity;
          const my = (_carry.y - py[k]) * rigidity;
          const mz = (_carry.z - pz[k]) * rigidity;
          px[k] += mx; py[k] += my; pz[k] += mz;
          qx[k] += mx; qy[k] += my; qz[k] += mz;
        }
      }
    }
    _prevWorldInv.copy(rootWorld).invert();
    hasPrevWorld = true;

    // Fixed sub-steps: the yarn must feel the same at 30 fps and 144 fps.
    let remaining = Math.min(Math.max(dt, 0), 0.1);
    const floor = floorY == null ? null : floorY + 0.004;
    while (remaining > 0) {
      const h = Math.min(remaining, live.maxStep);
      remaining -= h;
      const gdt = live.gravity * h * h;
      const damp = feel.damping ?? live.damping;

      for (let i = 0; i < N; i += 1) {
        const base = i * NODES;
        // node 0 is pinned to the head, in world space
        _anchor.set(anchorX[i], 0, anchorZ[i]).applyMatrix4(rootWorld);
        px[base] = _anchor.x; py[base] = _anchor.y; pz[base] = _anchor.z;
        qx[base] = _anchor.x; qy[base] = _anchor.y; qz[base] = _anchor.z;

        for (let n = 1; n < NODES; n += 1) {
          const k = base + n;
          const onFloor = floor !== null && py[k] <= floor + 1e-4;
          // friction only bites the horizontal, the way a wet strand dragging
          // on boards does; the vertical is free to settle
          const lat = onFloor ? (feel.floorFriction ?? live.floorFriction) : damp;
          const vx = (px[k] - qx[k]) * lat;
          const vy = (py[k] - qy[k]) * damp;
          const vz = (pz[k] - qz[k]) * lat;
          qx[k] = px[k]; qy[k] = py[k]; qz[k] = pz[k];
          // THE SKIRT IS A FORCE, NOT A POSE. Seeding the strands flared and
          // leaving it there does nothing: the very first constraint pass pulls
          // each chain back to a plumb line and the head is a straight-sided
          // barrel again by frame two. A real string mop flares because the
          // bundle is thick at the collar and the strands have nowhere to go but
          // outward, so the outward push has to be applied every step alongside
          // gravity. It scales down the chain (n / S) so the collar stays
          // gathered and only the hem opens out -- a cone, not a tube.
          const flare = splayAccel * (n / S) * h * h;
          px[k] += vx + splayX[i] * flare;
          py[k] += vy - gdt;
          pz[k] += vz + splayZ[i] * flare;
        }
      }

      const passes = Math.max(1, Math.round(feel.iterations ?? live.iterations));
      for (let iter = 0; iter < passes; iter += 1) {
        for (let i = 0; i < N; i += 1) {
          const base = i * NODES;
          const L = segLen[i];
          for (let n = 1; n < NODES; n += 1) {
            const k = base + n;
            const p = k - 1;
            let dx = px[k] - px[p];
            let dy = py[k] - py[p];
            let dz = pz[k] - pz[p];
            let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d < 1e-6) {
              // degenerate: a fully compressed chain has no direction of its
              // own, so give it the one a real fibre would buckle along
              dx = outX[i] * 1e-3; dy = -1e-3; dz = outZ[i] * 1e-3;
              d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
            const f = ((L - d) / d) * (feel.stiffness ?? live.stiffness);
            // the parent is authoritative (the chain hangs from a pinned
            // anchor), so only the child moves — one pass down the chain is
            // stable and needs no mass bookkeeping
            px[k] += dx * f;
            py[k] += dy * f;
            pz[k] += dz * f;

            if (floor !== null && py[k] < floor) {
              // BUCKLING: the length has to go somewhere. Pushing the node out
              // along its own azimuth by the amount the floor stole is what
              // makes a pressed head spread and flatten instead of stacking.
              const bite = floor - py[k];
              py[k] = floor;
              px[k] += outX[i] * bite * (feel.buckle ?? live.buckle);
              pz[k] += outZ[i] * bite * (feel.buckle ?? live.buckle);
            }
          }
        }
      }
    }

    // Compose the instance matrices in the rig's own local frame.
    _inv.copy(rootWorld).invert();
    for (let i = 0; i < N; i += 1) {
      const base = i * NODES;
      const yScale = segLen[i] / nominalSeg;
      for (let n = 0; n < S; n += 1) {
        const a = base + n;
        const b = a + 1;
        _dir.set(px[b] - px[a], py[b] - py[a], pz[b] - pz[a]);
        const len = _dir.length();
        if (len > 1e-6) _dir.multiplyScalar(1 / len); else _dir.set(0, -1, 0);
        // the cylinder is authored pointing DOWN from its origin
        _q.setFromUnitVectors(_up, _dir.negate());
        _pos.set(px[a], py[a], pz[a]);
        _scale.set(1, yScale, 1);
        _m.compose(_pos, _q, _scale);
        _m.premultiply(_inv);
        layers[n].setMatrixAt(i, _m);
      }
      // The bead rides the LAST node, which is the hem. Unrotated and unscaled:
      // a sphere has no orientation to get wrong, and scaling it with the
      // strand's length variation would make short strands end in small beads.
      const tip = base + S;
      _pos.set(px[tip], py[tip], pz[tip]);
      _m.compose(_pos, _qIdentity, _one);
      _m.premultiply(_inv);
      tipLayer.setMatrixAt(i, _m);
    }
    for (let n = 0; n < S; n += 1) layers[n].instanceMatrix.needsUpdate = true;
    tipLayer.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    // One geometry PER SEGMENT now (see the continuous-taper note above), so all
    // of them have to go. Disposing only the first would leak three per rebuild,
    // and rebuildYarn exists precisely to be called repeatedly.
    for (const g of segmentGeometries) g.dispose();
    for (const layer of layers) layer.dispose();
    tipGeometry.dispose();
    tipLayer.dispose();
  }

  return {
    root,
    update,
    dispose,
    // broomViewmodel drives the filtered rig with four scalars and this one with
    // a floor height; the flag is how it tells them apart.
    isVerlet: true,
    params: () => ({ ...live }),
    setParams(patch = {}) {
      for (const [key, value] of Object.entries(patch)) {
        if (key in live && Number.isFinite(Number(value))) live[key] = Number(value);
      }
      return { ...live };
    },
    defaults: () => ({ ...DEFAULT_PARAMS }),
    // 5.2: the viewmodel flips this from the tool's own active flag.
    setActive,
    isActive: () => activeFlag,
    feel: () => ({ ...feel }),
    strandCount: N,
    clumpCount: CLUMPS,
    // the anchors, so a test can measure the gaps between bunches rather than
    // trusting the count alone
    anchors: () => Array.from({ length: N }, (_, i) => ({
      x: anchorX[i], z: anchorZ[i], clump: clumpOf[i],
    })),
    tipCount: N,
    drawCalls: S,
    // For a driver: where the tips ACTUALLY are, in world space, read out of the
    // simulation state rather than inferred from the head's pose.
    tipsWorld: () => {
      const out = [];
      for (let i = 0; i < N; i += 1) {
        const k = i * NODES + NODES - 1;
        out.push(new THREE.Vector3(px[k], py[k], pz[k]));
      }
      return out;
    },
    tipsLocal: () => {
      _inv.copy(root.matrixWorld).invert();
      const out = [];
      for (let i = 0; i < N; i += 1) {
        const k = i * NODES + NODES - 1;
        out.push(new THREE.Vector3(px[k], py[k], pz[k]).applyMatrix4(_inv));
      }
      return out;
    },
    tipLayer: () => layers[S - 1],
    // the hem beads, so a probe can prove the loops are drawn rather than assumed
    hemBeads: () => tipLayer,
  };
}
