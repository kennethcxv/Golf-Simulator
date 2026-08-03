// BROOM FEEL — every timing and feel number for the Phase 6 first-person broom
// in ONE place, so tuning is an edit here and never a code change.
//
// The broom is the game's core verb and the standard the other tools will copy
// (mop, vacuum, pressure washer stay on the old path until the broom is
// approved). Units: yards, seconds, radians unless a key says otherwise.
//
// Review context (Phase 0 verdict, verbatim): "The broom is completely
// detached from the person and just has some floating hands in front of it…
// it shouldn't phase through any tables etc. Also you should be able to look
// down etc with the broom." Phase 1 traced that to five causes: a 0.11-yd
// forearm stub, no viewmodel camera, no surface alignment, a floor-anchored
// head that pins while the view pitches, and a contact point solved onto the
// floor plane instead of the hands. Each block below exists to close one of
// those causes.

export const BROOM_FEEL = Object.freeze({
  // --- the viewmodel camera -------------------------------------------------
  // The broom renders in its own pass with its own lens, so the tool is not
  // hostage to the world FOV (walk.fov 66): the world camera can zoom, focus,
  // or breathe without the held broom stretching. Layer 29 sits beside the
  // delivery-carry overlay's 30 and follows the same clearDepth pattern.
  camera: Object.freeze({
    // ROUND 5: 50 -> 78. The old lens was NARROWER than the world's 66, which
    // is backwards for a tool that works the floor, and it was the binding
    // constraint behind "the broom points at the ceiling".
    //
    // The arithmetic, from an eye 1.62 yd up: at a 50 deg vertical lens the
    // floor is not visible at all until 3.47 yd ahead at level pitch, so a
    // bristle head anywhere within a broom's reach is off the bottom of the
    // frame by construction. Rounds 1-4 answered that by flattening the carry
    // until the head rose into view — measured at 12.7 deg below horizontal,
    // i.e. a broom held out like a rifle with the bristles floating at chest
    // height. Widening to 78 puts first-visible floor at 1.95 yd, which a
    // held broom CAN reach, so the pose no longer has to choose between
    // pointing at the floor and being on screen.
    //
    // 78 is a deliberate middle: the world walks at 66, House Flipper 2 ships
    // a player FOV slider that goes to about 90, and past ~85 the handle
    // starts to bow noticeably at the frame edge.
    fov: 78,          // degrees; the viewmodel lens, independent of the world's
    near: 0.05,       // the arms live closer than the world near plane (0.15)
    far: 12,
    layer: 29,        // render layer owned by the broom viewmodel pass
  }),

  // --- framing (level pitch) ------------------------------------------------
  // Where the held rig sits in the VIEWMODEL camera's frame. The acceptance
  // pin: the bristle head must be INSIDE NDC at pitch 0 — you can see what
  // you are sweeping without looking down (the old frame put it at NDC
  // y −1.55, off-screen until ~23° of down-look).
  frame: Object.freeze({
    place: [0.42, -0.48, -0.60],   // rig origin in camera space (right, down, forward)
    yaw: 0.22,                     // turned so the head clears LEFT of the grips
    // CARRY pose: at level look the broom is carried nearly horizontal, head
    // ahead and RAISED into frame (the drawn head cannot sit at the true
    // floor contact and be visible — 1.4 yd ahead from 1.6 yd up is ~49°
    // below a 50° lens). The work pose takes over as the view pitches down,
    // where drawn and true contact align exactly.
    headForward: 1.42,             // how far ahead the bristle head works at rest
  }),

  // --- COMPOSITION ----------------------------------------------------------
  // Round 3 rebuild. The rig used to be PLACED (a fixed camera-space point plus
  // a pitch) and the head fell wherever the tool's own length put it: measured
  // at level look, the head sat 2.17 yd out at NDC y −0.90 while the primary
  // hand sat 1.42 yd away at NDC y +0.52 — ABOVE eye level. That is the
  // play-test's "two disembodied forearms… broom head far to the lower left…
  // shaft running off at a steep diagonal": the rig spanned the entire frame.
  //
  // It is now SOLVED: the gripping hand is pinned to `gripAnchor`, the bristle
  // head hangs a RIGID handle away from it, and the tool's rotation is whatever
  // satisfies both. The handle's length and the two grip points are measured
  // from the live asset's own sockets every frame (they are animated), so this
  // block only says where the hands sit and how the tool is carried.
  compose: Object.freeze({
    // Where the UPPER (primary) hand sits, in camera space — close enough to
    // read as YOUR hand rather than a distant nub, far enough that the tool is
    // held out in front of you rather than tucked against your chest.
    //
    // Round 4: pushed out from z −0.56 to −0.72 ("a tad bit too close to the
    // person… a bit more extended out"). The x and y are re-solved for the new
    // depth so the hands hold their SCREEN position (~NDC 0.51, −0.80 through a
    // 50° lens at 16:9) — the rig reads further away without the composition
    // moving, which is what "a tad more out" has to mean.
    // ROUND 5: y -0.27 -> -0.56. THE BUG, in one number. The gripping hand sat
    // 0.27 yd below the eye, i.e. 1.350 yd above the floor, while the FP
    // asset's own sockets measure 1.247 yd from GripPrimary to FloorContact.
    // The handle was 0.103 yd TOO SHORT to touch the boards, so no pitch, no
    // blend and no amount of tuning could ever plant the bristles — the head
    // hung in mid-air at every pose and the solve dutifully drew it there.
    // Hands now ride at 1.06 yd above the floor (hip height, which is where
    // you actually hold a push broom), leaving 0.65 yd of horizontal reach
    // when the head is down on the boards.
    // ROUND 5b: [0.30, -0.56, -0.72] -> [0.24, -0.50, -0.86]. Dropping the
    // hands to hip height (5a) fixed the reach but put the gripping hand at
    // NDC (0.29, -0.96) — ON the bottom edge, clipped, with its whole forearm
    // off-frame. The fix is to push the hands FORWARD rather than back up:
    // depth shrinks the screen offset without giving back any of the height
    // the head needs to touch the boards. Now NDC (0.19, -0.72), both hands
    // fully in the lower-right with 0.55 yd of reach still in hand.
    // ROUND 6: -0.86 -> -0.70. "It reads too far away now. The 78 deg lens
    // fixed the aim but the rig now sits further off than it should." Round 5b
    // spent depth to pull the hands off the bottom edge, and it bought the
    // framing at the cost of shrinking everything: at 0.86 yd down the view
    // axis through a 78 deg lens the whole rig occupies a corner. 0.70 puts the
    // hands where a person's hands are on a broom and grows the head with them;
    // the NDC framing the round-5 arithmetic protected still holds, because the
    // grip sits higher in the frame than the edge it was rescued from.
    gripAnchor: [0.24, -0.50, -0.70],
    // radians the head is carried LEFT of the view centre, so the handle lies
    // diagonally across the lower frame instead of pointing away from the lens
    bearingOffset: -0.20,
    // How far the head hangs below the hand while CARRIED (level look). A head
    // truly resting on the boards is ~1.6 yd below the eye and no honest pose
    // shows it through a 50° lens, so a carried broom rides shallow; the drop
    // grows to the real floor distance as the view pitches down to the work.
    // Round 4: 0.34 -> 0.30. A shallower hang spends more of the fixed handle
    // on REACH than on drop, so the head sits further ahead and stays framed
    // when the view comes up level or above.
    //
    // ROUND 5: 0.30 -> 0.65, and the reasoning above is now inverted, because
    // the wider lens removed the constraint that forced it. Round 4 was
    // spending the handle on reach to keep the head on screen; the cost was a
    // broom carried 12.7 deg off horizontal, which is what reads as "pointing
    // at the ceiling". At 0.65 the shaft sits 31 deg below horizontal even
    // while carried — unmistakably a broom on its way to the floor rather
    // than a pole held out in front — and the head still frames at NDC y
    // around -0.84 through the 78 deg lens.
    carryDrop: 0.65,
    // roll of each hand about the shaft, radians — the two hands oppose each
    // other on the handle the way they do on a real broom
    handRollUpper: 0.10,
    handRollLower: -2.95,
    // ROUND 5: the wrist sits OFF the shaft centreline by this much. It used
    // to be placed exactly on the axis, so the palm straddled the handle and
    // its flat far side poked out as a pale disc beside the shaft — the hand
    // read as skewered by the broom rather than holding it. Offsetting by the
    // shaft radius plus the palm's own half-thickness rests the palm on the
    // handle and lets the fingers close over the top of it. Applied along each
    // hand's own -Y after its roll, so the two hands sit on opposite sides
    // exactly as handRollUpper/handRollLower already intend.
    handShaftOffset: 0.034,
    // ROUND 6: "hands too small to read at 1x." The shared first-person hands
    // are authored at 0.88 for tools held out at arm's length; a broom is
    // gripped, and at the working distance they rendered as pale lumps on the
    // shaft with the modelled fingers, knuckles and thumb all under a pixel or
    // two. This scales the HAND GROUPS, not the hands root — the root carries
    // the equip rise and the viewmodel's own seating arithmetic subtracts its
    // position, so scaling it would move every solved grip.
    handScale: 1.22,
  }),

  // --- the sweep arc --------------------------------------------------------
  // A push broom is SWEPT, not carried statically: the head travels left and
  // right across the floor ahead in a rhythmic arc while the use button is
  // held. The old rig translated the whole group sideways by 0.16 yd, which
  // read as a twitch rather than a stroke.
  sweep: Object.freeze({
    arcRad: 0.40,        // rad; head swing either side of centre about the grip
    handFollow: 0.20,    // fraction of the arc the hands drift along with
  }),

  // --- the arms -------------------------------------------------------------
  // House Flipper proportions: skin is visible from roughly MID-FOREARM to the
  // hand only. Each arm is a short fixed-length forearm at the wrist (it never
  // stretches — the round-1 arms scaled a 0.34-yd capsule up to 1.74 yd and
  // read as tan noodles crossing 74% of the frame), a rolled cuff at the
  // elbow, and a short sleeve that exits through the BOTTOM of the frame.
  arms: Object.freeze({
    forearmSpan: 0.26,     // yd; authored elbow->wrist skin length
    // ROUND 5: the forearm TAPERS. It used to be one uniform capsule, which is
    // the "disembodied forearm cylinder" the review rejected — a pipe reads as
    // a pipe at any radius. An arm is narrow at the wrist and swells toward the
    // elbow, and that single cue is most of what makes it read as a limb.
    forearmWristRadius: 0.026,
    forearmElbowRadius: 0.044,
    // ROUND 5: and it stops SHORT of the wrist. CapsuleGeometry(r, span) is
    // span + 2r long overall, so the old forearm overshot the hand by its own
    // radius and its hemispherical cap sat on top of the fingers — that
    // protruding cap IS the "nub protrusion" in the review. The forearm now
    // ends inside the hand, so the palm covers the joint the way a wrist does.
    // Small on purpose: this is only "tuck the flat end inside the palm". At
    // 0.030 it opened a visible 3 cm gap between forearm and hand at viewmodel
    // range — worse than the nub it was hiding.
    wristInset: 0.010,     // yd short of the wrist the skin stops
    spanScaleMin: 0.85,    // the forearm may compress/stretch only this far
    spanScaleMax: 1.2,
    // elbow sits relative to its WRIST (camera axes: right, down, toward
    // camera) so the entry angle is foreshortened at every pose — mostly
    // straight below the hand, so the forearm hangs rather than juts
    // ROUND 5: the elbows move OUT and TOWARD the viewer. They used to sit
    // almost straight below the wrist (z +0.06), which draws the forearm
    // nearly in the view plane — a tan post standing under each hand, which is
    // the "disembodied forearm cylinder" read. Real first-person arms come in
    // from the lower CORNERS, strongly foreshortened, and leave frame at the
    // bottom edge. Pulling the elbow toward the camera is what buys that
    // foreshortening; pushing it outward is what aims it at the corner.
    elbowOffsetRight: [0.15, -0.30, 0.22],
    elbowOffsetLeft: [-0.14, -0.30, 0.21],
    // ROUND 3: the sleeve is a short segment aimed DOWN in camera axes, not a
    // capsule stretched to a fixed "shoulder" point. The old shoulders were
    // authored at camera-space z −1.0, i.e. a yard IN FRONT of the lens, so
    // each sleeve drew a long green bar across the frame (measured: right
    // sleeve NDC y +0.17 → −3.13, left −0.28 → −2.73). That WAS the play-test's
    // "large green diagonal shape", and no amount of shoulder tuning fixes an
    // anchor in front of the camera. A short downward run leaves frame at the
    // bottom edge and cannot cross it.
    sleeveDir: [0.17, -1.0, 0.30],  // camera axes (x mirrored for the left arm)
    sleeveRadius: 0.050,   // yd; shirt over forearm
    sleeveLength: 0.40,    // yd; short — it exits through the frame's bottom
  }),

  // --- equip / unequip ------------------------------------------------------
  // The authored Broom_Equip/Broom_Unequip clips own the motion; these values
  // own the rise timing and the eased fallback when a clip is missing.
  equip: Object.freeze({
    duration: 0.34,     // s; rise into frame (was a linear 0.26 for every tool)
    settleOvershoot: 0.014, // yd; the little over-rise as the hands take the weight
    settleTime: 0.09,   // s; overshoot return
    ease: 'easeOutCubic',
  }),
  unequip: Object.freeze({
    duration: 0.24,     // s; drop out of frame, slightly brisker than the rise
    ease: 'easeInCubic',
  }),

  // --- idle + locomotion ----------------------------------------------------
  idle: Object.freeze({
    swayYawAmp: 0.008,   // rad; slow whole-rig drift at rest
    swayYawRate: 0.9,    // rad/s of the sway oscillator
    breatheAmp: 0.004,   // yd; vertical breathe at rest
    breatheRate: 1.7,
  }),
  walk: Object.freeze({
    bobAmp: 0.016,       // yd; vertical bob under way (in-phase with the stride)
    bobRate: 8.7,        // rad/s; MUST match the characters' stride rate
    swayAmp: 0.011,      // yd; lateral counter-sway under way
    swayPhase: 0.5,      // fraction of a bob cycle the sway trails by
    blendIn: 6.0,        // 1/s; how fast bob amplitude follows movement state
  }),

  // --- the working stroke ---------------------------------------------------
  // Push-pull sweep. Speed ∝ |cos(phase)|; cleaning lands on the fast middle
  // of each pass (|cos| >= contactCos, duty ≈ 60.6%) with turnaround dt
  // banked and released so NET cleaning is rate-neutral (sim is linear in dt).
  stroke: Object.freeze({
    rate: 4.8,           // rad/s; 2π/4.8 ≈ 1.31 s full push-pull cycle
    span: 0.16,          // yd; lateral travel of the head each direction
    contactCos: 0.58,    // |cos(phase)| ≥ this = bristles in contact
  }),

  // --- weight ---------------------------------------------------------------
  // The head is a mass on the end of a long lever: the drawn head follows the
  // stroke through an under-damped spring, so it LAGS on each direction
  // change, overshoots a touch, and settles rather than snapping. The shaft
  // roll is driven by the spring's velocity, so the lean trails the motion
  // the way a real broom loads up. A slow yaw follower adds body sway when
  // the player turns.
  weight: Object.freeze({
    lagHz: 5.6,          // natural frequency of the head-follow spring
    lagDamping: 0.55,    // < 1 = visible overshoot-and-settle at reversals
    rollVelGain: 0.055,  // rad per yd/s of head velocity
    rollMax: 0.10,       // rad; lean ceiling
    yawLagRate: 9.0,     // 1/s; how fast the rig catches the view's yaw
    yawLagMax: 0.085,    // rad; sway ceiling while turning
    speedBoost: 0.35,    // stroke intensity bonus at full walking speed
  }),

  // --- the dirt itself ------------------------------------------------------
  // The review bar: dirt recedes with VISIBLE IMMEDIACY under the head. The
  // push speed must beat the walk speed (2.2 yd/s) or a forward push walks
  // OVER its own pile and the debris pops out behind the bristles — the
  // round-1 "dirt lag" lived in this number (it shipped at 1.05).
  dirt: Object.freeze({
    pushSpeed: 2.6,      // yd/s; bristles push debris faster than you walk
    maxStep: 0.42,       // yd; no single stroke flings debris further than this
    // A PUSH broom pushes debris AWAY — the pile recedes up the lane ahead of
    // the bristle face, with the stroke adding side drift. (The old purely
    // lateral direction ping-ponged piles sideways; at push speed it ejected
    // them out of the lane entirely.) sideBias is the lateral fraction mixed
    // onto the unit forward push, alternating with the stroke.
    sideBias: 0.35,
  }),

  // --- look-down / pitch coupling ------------------------------------------
  // The head stays planted on the boards through the full look-down range —
  // anchored to the HANDS' reach, not re-solved onto the floor plane (the old
  // solve slid the contact ~0.6 yd across the pitch range).
  pitch: Object.freeze({
    minPitch: -1.25,     // rad; the steepest down-look the rig follows
    maxPitch: 0.30,      // rad; above this nothing more changes
    reachNear: 0.62,     // yd; head distance at the steepest down-look
    reachFar: 1.42,      // yd; head distance at level pitch (== frame.headForward)
    followRate: 10.0,    // 1/s; eased follow of the pitch-driven reach
    // The carry->work blend: full carry pose at/above carryAbove, fully
    // planted work pose at/below workBelow, smoothstepped between.
    // Round 4: the blend used to finish by −0.45, but the camera is not yet
    // looking at the floor there — the head planted on the boards while the
    // view was still high, and dipped clean off the bottom of the frame
    // (measured NDC y −1.10 at pitch −0.35, back in view by −0.8). The pose now
    // stays CARRIED until the view has committed to looking down, so the head
    // is on screen across the whole pitch range.
    //
    // ROUND 5: -0.34/-0.78 -> -0.10/-0.40. Round 4 pushed the plant late
    // because at the 50 deg lens a planted head fell off the bottom of the
    // frame; the side effect was that you had to look 45 deg down before the
    // broom touched anything, which is not how anyone sweeps. Through the 78
    // deg lens a planted head is framed from a down-look of only 12 deg, so
    // the plant can start almost immediately and finish at a comfortable 23
    // deg. Glance down and the bristles are on the boards.
    carryAbove: -0.10,   // rad
    workBelow: -0.40,    // rad
  }),

  // --- surface response -----------------------------------------------------
  // The head aligns to what it is working against: flat floor by default, and
  // when the stroke runs against a fixture/wall collider face the head tilts
  // toward that face's normal instead of pretending the floor continues.
  surface: Object.freeze({
    tiltMax: 0.30,       // rad; maximum head tilt toward a blocking face
    tiltRate: 9.0,       // 1/s; eased in/out of the tilt
    floorKiss: 0.012,    // yd; bristle compression against the boards
  }),

  // --- collision ------------------------------------------------------------
  // The broom must not pass through tables, counters, or fixtures. The head is
  // clamped against the same 2D collider set the player and the cleaning gate
  // use (registeredCols: AABBs + circles), pulled back along the stroke with a
  // standoff so bristles stop AT a face, never inside it.
  collision: Object.freeze({
    headHalfWidth: 0.23, // yd; half the 0.46 block, the swept capsule radius
    standoff: 0.05,      // yd; bristle gap kept off any blocking face
    probeAhead: 0.10,    // yd; how far past the head the clamp looks each frame
    slideRate: 12.0,     // 1/s; eased retreat when a face interrupts the stroke
    // The JAM: pushing into a fixture must read as the broom STALLING proud
    // against it, not folding to a vertical stick at the feet (round 1 pulled
    // the carry pitch down 0.55 rad at full clamp).
    stallSquash: 0.45,   // stroke span multiplier while jammed
    stallIntensity: 0.55, // intensity multiplier while jammed (audio/motes calm)
  }),

  // --- camera response ------------------------------------------------------
  // A submarine-quiet kick: the view dips toward the work on contact and eases
  // back at release. The spec ceiling is 2°; this ships well under it.
  cameraKick: Object.freeze({
    maxDeg: 1.1,         // degrees; peak pitch response at full stroke intensity
    inTime: 0.07,        // s; eased in on the contact edge
    outTime: 0.20,       // s; eased out after the pass
  }),

  // --- audio ----------------------------------------------------------------
  // Three layers: a start transient as bristles first bite, a work loop whose
  // gain and brightness track stroke intensity, and a stop tail as they lift.
  audio: Object.freeze({
    startGain: 0.16,     // one-shot bristle bite on first contact
    loopGain: 0.040,     // base loop level (a broom is quiet work)
    loopGainSlope: 0.55, // × intensity (0..1) added onto loopGain
    loopRateBase: 2.6,   // Hz; LFO pulse rate of the dry-bristle loop at rest
    loopRateSlope: 1.3,  // Hz added at full stroke intensity
    stopTail: 0.24,      // s; release tail after the last contact
    reversalAccent: 0.5, // intensity passed to the stroke-turn accent chirp
    // the loop answers the SURFACE being worked: bright dry bristle on
    // boards, a duller drag on carpet — the bandpass centre and level shift
    surface: Object.freeze({
      'hard-floor': Object.freeze({ hz: 1500, gainScale: 1.0 }),
      carpet: Object.freeze({ hz: 820, gainScale: 0.78 }),
    }),
  }),

  // --- contact particles ----------------------------------------------------
  // Motes kick from the bristle line, answer the surface being worked, and
  // SCALE with how much debris the stroke actually moved — an empty pass
  // barely dusts; a loaded pile kicks visibly.
  particles: Object.freeze({
    burstPerContact: 7,   // motes per contact window
    driftAlongStroke: 0.15, // yd/s along the sweep direction
    hop: 0.15,            // yd; the little arc each mote takes
    amountRef: 0.45,      // moved-debris amount that reads as a full-size kick
    sizeMin: 0.55,        // scale floor (an empty stroke still dusts a little)
    sizeMax: 1.5,         // scale ceiling on a heavy pile
    surface: Object.freeze({
      'hard-floor': Object.freeze({ color: 0x9f8a68, size: 0.052 }), // dry grit
      carpet: Object.freeze({ color: 0xb7a58c, size: 0.064 }),       // fibre fluff
    }),
  }),
});

export default BROOM_FEEL;
