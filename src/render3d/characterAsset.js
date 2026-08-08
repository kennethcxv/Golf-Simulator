// GOLF COURSE FLIPPER — articulated character, built in code (style guide §5).
// A jointed figure (hip/knee/shoulder pivots under a chest pivot) with
// procedural Walk / Idle / Swing / Browse animation. Chosen after the rigged
// GLB path exported broken skins twice (see DEV_LOG 2026-07-09 asset session):
// this keeps real articulated motion fully under our control, no exporter risk.

import * as THREE from 'three';
import { STRIDE_RATE_RAD_S } from '../data/locomotion.js';
import { CUSTOMER_IMPATIENT_BEAT_SECONDS } from './clubhouse/customerFlow.js';

// Articulation stays per actor; immutable GPU resources do not. A bounded
// palette and geometry cache prevents a busy clubhouse from allocating a new
// material/geometry set for every arrival.
const materials = new Map();
const geometries = new Map();
const M = (color, rough = 0.85) => {
  const key = `${color}|${rough}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough }));
  return materials.get(key);
};
const G = (key, build) => {
  if (!geometries.has(key)) geometries.set(key, build());
  return geometries.get(key);
};

// CharacterAsset is authored facing local +Z: the eyes, nose, polo placket and
// shoe toes all sit on that side of the rig. Keep world-facing math here so a
// caller cannot accidentally add a legacy 180-degree model correction and make
// an actor walk backwards.
export function characterYawToward(fromX, fromZ, toX, toZ) {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

function sharedM(color, rough = 0.85) {
  const resolved = color?.isColor ? color : new THREE.Color(color);
  const key = `${resolved.getHexString()}|${rough}`;
  let material = sharedCharacterMaterials.get(key);
  if (!material) {
    material = M(resolved, rough);
    material.userData.sharedCharacterMaterial = true;
    sharedCharacterMaterials.set(key, material);
  }
  return material;
}

function box(w, h, d, mat, y = 0, z = 0) {
  const m = new THREE.Mesh(G(`box|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), mat);
  m.position.set(0, y, z);
  m.castShadow = true;
  return m;
}

function ellipsoid(w, h, d, mat, y = 0, z = 0, segments = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, segments, Math.max(10, segments - 2)), mat);
  m.scale.set(w, h, d);
  m.position.set(0, y, z);
  m.castShadow = true;
  return m;
}

function capsule(radius, straight, mat, y = 0) {
  // rounder caps/rings than the old 4x8 — at counter distance the low silhouette
  // was the single biggest "made of tubes" tell.
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, straight, 6, 14), mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

// A sphere sized in absolute units — used for the joints that tie the body's
// tubes together (neck, shoulders, hips) so the figure reads as one piece.
function ball(radius, mat, segments = 16) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.max(10, segments - 4)), mat);
  m.castShadow = true;
  return m;
}

export function makeCharacter({ polo = 0x3b6fb3, khaki = 0xc2b190, cap = 0xf2efe4, skin = 0xd9a97e } = {}) {
  const mPolo = M(polo, 0.8);
  const mKhaki = M(khaki, 0.85);
  const mSkin = M(skin, 0.7);
  const mCap = cap == null ? null : M(cap, 0.8);
  const mShoe = M(0x33291f, 0.9);
  const mSole = M(0x1c1916, 0.95); // rubber shoe sole, darker than the leather upper
  const mBelt = M(0x40382f, 0.78);

  const root = new THREE.Group();
  root.name = 'characterRoot';
  const fineDetailMeshes = [];
  const fineDetail = (mesh) => {
    mesh.userData.characterPresentationDetail = 'fine';
    fineDetailMeshes.push(mesh);
    return mesh;
  };

  // pelvis + legs hang off the root; chest carries torso/head/arms for lean+twist.
  // The whole figure is built so the SHOE SOLES sit at model y≈0: the game places a
  // character's root exactly on the floor/terrain, so a body whose feet were at y≈0.05
  // hovered ~5 cm above the ground. Every base height below is lowered to plant the feet.
  const pelvis = ellipsoid(0.32, 0.18, 0.21, mKhaki, 0.98);
  root.add(pelvis);
  // H3 (Goal 17) — THE TORSO WAS WIDER THAN THE BELT, AND THE BELT WAS A
  // COARSER POLYGON. Both, at once, on the sides.
  //
  // Computed rather than eyeballed. The belt sits at y 1.055; the chest group
  // sits at 1.07, so the belt meets the torso lathe at local y -0.015. The
  // profile interpolates between (0.202, -0.018) and (0.212, 0.035) to a radius
  // of 0.2026 there. The belt's mid radius was (0.205 + 0.198) / 2 = 0.2015.
  // The shirt was already 1.1 mm outside the belt before any pose.
  //
  // And the belt had 18 radial segments to the torso's 24. A cylinder is a
  // POLYGON: between its vertices its surface sits at r * cos(pi/n), so the
  // belt's real surface on its flats was 0.2015 * 0.9848 = 0.1984 - putting
  // 4.2 mm of shirt outside the belt at every flat. That is the "skin phases
  // through the belt" of H3, and it is a static geometry fault, not a pose one:
  // it is true standing still.
  //
  // Fixed on both counts. The segment count matches the torso, so neither is a
  // coarser polygon than the other, and the radii are set so the belt's
  // INSCRIBED radius (0.206 * cos(pi/24) = 0.2043) clears the torso's
  // circumscribed 0.2026 with 1.7 mm to spare. Depth is unchanged and was never
  // the problem: at scale.z 0.74 against the torso's 0.72 the belt already
  // stood 6.6 mm proud front and back.
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.209, 0.203, 0.038, 24), mBelt);
  belt.position.y = 1.055;
  belt.scale.z = 0.74;
  belt.castShadow = true;
  root.add(belt);
  // Q6: a real buckle. A plain dark band round the waist reads as a seam; the
  // bright rectangle at the front is what says "belt", and a belt is most of
  // what says the trousers are golf trousers rather than pyjamas.
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.044, 0.014), M(0xb9a06a, 0.34));
  buckle.position.set(0, 1.055, 0.152);
  buckle.castShadow = true;
  root.add(buckle);
  const buckleTongue = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.020, 0.008), mBelt);
  buckleTongue.position.set(0, 1.055, 0.160);
  root.add(buckleTongue);

  const chest = new THREE.Group();
  chest.position.y = 1.07;
  root.add(chest);
  // A smooth revolved shirt profile provides a waist, ribcage and collar slope
  // without the visibly flat cap of a tapered cylinder.
  const torso = new THREE.Mesh(new THREE.LatheGeometry([
    // Close the underside on the axis. Leaving the first ring open exposed
    // alternating triangle backs as a sawtooth hem in the player camera.
    new THREE.Vector2(0, -0.061),
    new THREE.Vector2(0.190, -0.060),
    new THREE.Vector2(0.202, -0.018),
    new THREE.Vector2(0.212, 0.035),
    new THREE.Vector2(0.238, 0.320),
    new THREE.Vector2(0.226, 0.425),
    new THREE.Vector2(0.150, 0.492),
    new THREE.Vector2(0.094, 0.515),
  ], 24), mPolo);
  torso.scale.z = 0.72;
  torso.castShadow = true;
  chest.add(torso);

  // --- CONNECTIVE TISSUE ---------------------------------------------------------------------
  // The figure used to be a pile of separate tubes and balls with air at every joint — a
  // floating head worst of all. These pieces are children of the chest, so they lean, twist
  // and bob WITH the torso; they carry no rig, they just close the gaps.
  // A polo shoulder yoke lying across the top of the chest, tying both arm-roots into the body.
  const yoke = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.26, 6, 14), mPolo);
  yoke.rotation.z = Math.PI / 2;
  // ITEM 16, proportions: at scale 1 this is a 27 cm roll of fabric lying
  // across the shoulders from y 0.265 to y 0.535, and the four-up portrait
  // reads it as balloon sleeves on every customer. Flattened to 0.68 it becomes
  // a shoulder LINE. The x scale is untouched, so the shoulder span and the
  // deltoid coverage at the arm root are exactly as they were - only the
  // roundness goes.
  yoke.scale.set(1, 0.68, 0.82);
  yoke.position.y = 0.392;
  yoke.castShadow = true;
  chest.add(yoke);
  // A skin neck rising out of the collar and into the skull — no more floating head.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.076, 0.18, 16), mSkin);
  neck.position.y = 0.47;
  neck.castShadow = true;
  chest.add(neck);
  // The lathed torso itself now overlaps the waistband. The previous separate
  // cylinder hem occupied the same surface and produced a dark, jagged
  // z-fighting seam in every handoff frame.
  // A folded polo collar at the neckline — the fabric detail that turns "blue tube with a
  // ball on top" into a shirt. An open flared cone in the shirt material.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.108, 0.072, 0.058, 18, 1, true), mPolo);
  collar.position.y = 0.415;
  collar.castShadow = true;
  chest.add(collar);
  // Q6 (2026-08-06): "add real golf clothes on them etc." The shirt was already
  // a polo in shape - collar, placket, buttons - but nothing said GOLF polo.
  // The tells a player actually recognises are contrast trim on the collar and
  // sleeve openings, so they go on here in a tone derived from the shirt rather
  // than a fixed colour, which keeps every randomised polo looking deliberate.
  const trimTone = (base) => {
    const c = new THREE.Color(base);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    // a crisp light trim on a dark shirt, a deep one on a pale shirt
    return new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.55), hsl.l > 0.5 ? 0.20 : 0.86);
  };
  const mTrim = M(trimTone(polo).getHex(), 0.7);
  const collarTrim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1105, 0.1105, 0.012, 18, 1, true), mTrim,
  );
  collarTrim.position.y = 0.441;
  fineDetail(collarTrim);
  chest.add(collarTrim);
  // A short placket + two buttons down the chest so the front reads as a polo.
  const placket = box(0.028, 0.17, 0.012, M(polo, 0.62), 0.30, 0.138);
  fineDetail(placket);
  chest.add(placket);
  for (const by of [0.34, 0.26]) {
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.010, 8, 6), M(0xf3efe6, 0.5));
    button.position.set(0, by, 0.144);
    fineDetail(button);
    chest.add(button);
  }

  const head = new THREE.Group();
  head.name = 'headJoint';
  head.position.y = 0.62;
  chest.add(head);
  // H2 (Goal 17) — THE SAME CAUSE AS H3, ON A DIFFERENT PART OF THE BODY.
  //
  // "Eyebrows and moustaches float in front of the face. From the side they sit
  // off the skin with a visible gap."
  //
  // The features ARE seated against the skull's nominal 0.155 radius - the brow
  // at (0.058, 0.114, 0.137) sits 0.1523 from the skull centre on its inner
  // face, comfortably inside 0.155. On paper it is buried.
  //
  // But the skull was a SphereGeometry(0.155, 20, 14), and a UV sphere is a
  // POLYGON in both axes. Between its vertices the drawn surface pulls in by
  // roughly cos(pi/20) * cos(pi/28) = 0.9814 - so the skin that actually gets
  // drawn sits at about 0.1521, which is INSIDE the brow's inner face. The
  // features were seated against a surface the renderer never draws, and the
  // gap opens exactly where the brief says it does: from the side, on the
  // facets.
  //
  // Raising the segment count is the fix for every feature at once - eyes,
  // brows, catchlights, moustache - rather than re-seating each against a
  // faceting allowance. At 28 x 20 the drawn surface is 0.1540, which is now
  // OUTSIDE the brow's inner face by 1.7 mm, so the features are buried in skin
  // from any angle.
  //
  // The cost is triangles, not draw calls: one mesh either way, 280 -> 560
  // triangles on a head. A1 measured this renderer as draw-call bound, so this
  // is the cheap axis to spend on.
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.155, 28, 20), mSkin);
  skull.position.y = 0.06;
  skull.castShadow = true;
  head.add(skull);
  const mFace = M(0x2b2521, 0.9);
  const mBrow = M(0x4a3524, 0.9);
  const mEyeLight = M(0xf5ead7, 0.55);
  for (const x of [-0.057, 0.057]) {
    // The old eyes were 12 mm dots that vanished into a blank, faintly unsettling face
    // at the counter distance. A slightly larger almond eye with a soft brow above it
    // gives a readable, friendly expression without breaking the shop's simple heads.
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0165, 10, 7), mFace);
    // Keep the features proud of the 15.5 cm skull. At the former z=0.139,
    // almost the entire eye sat behind the sphere at register distance.
    eye.position.set(x, 0.083, 0.157);
    eye.scale.set(0.9, 1.12, 0.72);
    fineDetail(eye);
    head.add(eye);
    const catchlight = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 7, 5), mEyeLight);
    catchlight.position.set(x - 0.004, 0.088, 0.168);
    fineDetail(catchlight);
    head.add(catchlight);
    const brow = box(0.052, 0.012, 0.014, mBrow, 0.114, 0.137);
    brow.position.x = x * 1.02;
    // G2: seated on the skull along the FULL radial — the first fix used
    // the x=0 surface (0.145) and left the brows 10 mm proud on their
    // diagonal at x ±0.058, which the mesh-raycast instrument caught. The
    // surface at (x, y 0.114) is sqrt(0.155^2 - x^2 - 0.054^2) ≈ 0.133.
    brow.position.z = 0.139;
    brow.rotation.z = x < 0 ? 0.14 : -0.14;
    fineDetail(brow);
    head.add(brow);
  }
  const nose = ellipsoid(0.034, 0.045, 0.030, mSkin, 0.043, 0.163, 8);
  fineDetail(nose);
  head.add(nose);
  // G2: this dark slab at z 0.158 hovered ~25 mm off the skull (surface z
  // at mouth height is 0.1276) and read in profile as a floating moustache
  // — there IS no moustache mesh; this was it. Seated now, <=2 mm proud.
  const mouth = box(0.058, 0.011, 0.010, mFace, -0.028, 0.133);
  mouth.rotation.x = 0.12; // a faint upward set, so the resting face is neutral-friendly
  fineDetail(mouth);
  head.add(mouth);
  for (const x of [-0.158, 0.158]) {
    const ear = ellipsoid(0.025, 0.052, 0.020, mSkin, 0.052, 0.004, 8);
    ear.position.x = x;
    fineDetail(ear);
    head.add(ear);
  }
  if (mCap) {
    // A soft golf cap: a domed crown hugging the skull, a top button, and a curved bill —
    // not a soup can with a slab stuck to it.
    //
    // Q6 (2026-08-06): "the persons hat is like phased in with there head." It
    // was, and the numbers said so. The skull is a 0.155 sphere centred at
    // y=0.06, so its crown reaches 0.215. The cap's crown was a 0.168 sphere
    // scaled 0.94 in y and seated at 0.05, reaching 0.208 - SEVEN MILLIMETRES
    // BELOW the head it was supposed to cover, so the skull came through the
    // top. The cap now sits on the skull's own centre and keeps a real band of
    // clearance all the way round rather than a coincidence at the sides.
    const SKULL_R = 0.155;
    const SKULL_Y = 0.06;
    // ITEM 16: "hats worst", and the four-up portrait says why. Q6 fixed the
    // skull poking THROUGH the crown by seating the crown on the skull's own
    // centre and giving it a 0.58*PI sweep. That sweep runs 14 degrees past the
    // equator, so the crown skirt came down to y=0.019 ALL THE WAY ROUND -
    // including across the front of the face, which puts the eyes (y 0.083) and
    // the brows (y 0.114) inside the hat. Add the old bill, a 0.185-wide slab
    // sitting at y 0.118 directly over them, and the result reads as a
    // motorcycle helmet with a visor and a face in shadow. It measured as a
    // well-seated cap the whole time because clearance was the only thing being
    // measured.
    //
    // A cap's crown stops at the brow. So the crown is now a plain hemisphere
    // whose RIM is the brow line: sweep PI/2 exactly, so the rim sits at the
    // crown's own centre height, and that centre is placed at brow height
    // rather than at the skull's.
    const CAP_RIM_Y = 0.135; // ~15 mm above the top of the brow (0.120)
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.145, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), mCap,
    );
    // shallower than a ball: a cap crown is a low dome, and 0.66 puts its top
    // 16 mm clear of the skull's 0.215 instead of 19 mm of headroom
    crown.scale.set(1.0, 0.66, 1.04);
    crown.position.y = CAP_RIM_Y;
    crown.castShadow = true;
    head.add(crown);
    // the button rides the crown's actual top, not the old one's
    const crownTop = crown.position.y + 0.145 * crown.scale.y;
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mCap);
    button.position.y = crownTop + 0.004;
    fineDetail(button);
    head.add(button);
    // The bill projects FORWARD from the rim and stays above the brow. Its
    // underside at y 0.121 is 38 mm clear of the eyes; the old one's was 8 mm
    // clear and its tilt took it lower still.
    // ...and it has to PROJECT, or it reads as part of the dome and the whole
    // thing looks like a beret. The crown's front edge is at z 0.151, so a bill
    // ending at 0.205 clears it by 54 mm; a real peak stands about 85 mm proud,
    // which is what separates the two shapes at conversational distance.
    const bill = ellipsoid(0.165, 0.021, 0.215, mCap, CAP_RIM_Y - 0.003, 0.128, 18);
    bill.rotation.x = 0.24;
    bill.castShadow = true;
    head.add(bill);
    // the sweatband: the dark inner rim a real cap shows under the crown edge.
    // It sits AT the rim now (the old one was 87 mm lower, level with the ears,
    // where a cap has no band).
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1425, 0.1435, 0.022, 22, 1, true),
      M(0x2f3a34, 0.9),
    );
    band.position.y = CAP_RIM_Y - 0.010;
    band.scale.set(1.0, 1, 1.04);
    fineDetail(band);
    head.add(band);
  } else {
    // ITEM 16: the bare head wore a hemisphere sliced flat across a round
    // skull. Its rim sat at y 0.112 - ABOVE the skull's widest point - so the
    // sides and back of the head were bare scalp below a hard horizontal line,
    // and the portrait read as a swim cap. Measured as coverBelowEquator
    // -0.30: the covering stopped three tenths of a skull radius short of even
    // reaching the equator.
    //
    // Real hair reaches the nape at the back and stops at the brow in front, so
    // the rim is not horizontal - it is TILTED. One sphere segment, swept a
    // little past its own equator and tipped back, gives both edges at once:
    // the front rim rises to the hairline and the back rim drops to the neck.
    const HAIR_R = 0.163;
    const HAIR_SWEEP = Math.PI * 0.56; // 10.8 degrees past the equator
    const hair = new THREE.Mesh(
      G('hair', () => new THREE.SphereGeometry(HAIR_R, 20, 14, 0, Math.PI * 2, 0, HAIR_SWEEP)),
      M(0x3d3024, 0.82),
    );
    hair.position.y = 0.075;
    // Tipped back 0.52 rad: the rim circle is 0.160 across, so each edge moves
    // 0.160*sin(0.52) = 79 mm. Front hairline lands at y 0.124, 4 mm above the
    // top of the brow; the back reaches y -0.034, below the ears and onto the
    // nape. A sphere is rotation-invariant, so tipping it moves the rim without
    // touching the clearance Q6 measured.
    hair.rotation.x = -0.52;
    hair.castShadow = true;
    head.add(hair);
  }

  const limbs = {};
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.265, 0.42, 0);
    chest.add(shoulder);
    // deltoid cap at the pivot: a polo ball merging the yoke into the sleeve. Sitting on
    // the joint centre, it caps the shoulder at every arm angle without a visible socket.
    // ITEM 16: 0.080 against a 0.056 upper arm is a 24 mm bulb at the joint,
    // and with the yoke behind it every customer read as balloon sleeves. 0.071
    // still clears the arm by 15 mm, so the joint stays closed at every angle -
    // which is the only reason this ball exists - without the balloon.
    const deltoid = ball(0.071, mPolo, 16);
    deltoid.scale.set(0.94, 0.90, 0.84);
    shoulder.add(deltoid);
    const upperArm = capsule(0.056, 0.20, mPolo, -0.15);
    upperArm.scale.z = 0.88;
    shoulder.add(upperArm);
    // the short-sleeve hem, a slightly proud fabric ring where the polo sleeve ends
    const sleeveCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.062, 0.03, 14), mPolo);
    sleeveCuff.position.y = -0.275;
    sleeveCuff.castShadow = true;
    shoulder.add(sleeveCuff);
    // Q6: the matching contrast band at the sleeve opening - the other half of
    // what makes a shirt read as a golf polo rather than any collared top
    const sleeveTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.0635, 0.0635, 0.011, 14), mTrim);
    sleeveTrim.position.y = -0.288;
    fineDetail(sleeveTrim);
    shoulder.add(sleeveTrim);
    const elbow = new THREE.Group();
    elbow.name = `elbow${side}`;
    elbow.position.y = -0.32;
    shoulder.add(elbow);
    // elbow cap: a skin ball at the pivot closing the sleeve→forearm gap at every arm angle
    const elbowCap = ball(0.052, mSkin, 12);
    elbow.add(elbowCap);
    const forearm = capsule(0.050, 0.18, mSkin, -0.13);
    forearm.scale.z = 0.88;
    elbow.add(forearm);
    // a shaped hand — a flatter palm than the old blob, plus a thumb, so it reads as a hand
    // that could hold a card. Position is preserved: the carry grip below copies it.
    const hand = ellipsoid(0.074, 0.118, 0.052, mSkin, -0.295, -0.005, 10);
    elbow.add(hand);
    const thumb = ellipsoid(0.030, 0.060, 0.030, mSkin, -0.262, 0.028, 8);
    thumb.position.x = sx * 0.046;
    elbow.add(thumb);
    // Four overlapping low-poly finger forms preserve the stylised silhouette
    // while making card, cash, receipt and bag ownership readable in close-ups.
    // They remain geometry only; the generous gameplay hit targets stay hidden.
    for (let fingerIndex = 0; fingerIndex < 4; fingerIndex += 1) {
      const finger = ellipsoid(
        0.018,
        0.052 - fingerIndex * 0.003,
        0.024,
        mSkin,
        -0.340 + Math.abs(fingerIndex - 1.5) * 0.002,
        0.010,
        8,
      );
      finger.position.x = (fingerIndex - 1.5) * 0.014;
      finger.rotation.z = (fingerIndex - 1.5) * -0.025;
      fineDetail(finger);
      elbow.add(finger);
    }
    // A sibling of the non-uniformly scaled hand mesh gives carried props a
    // stable attachment joint.  Parenting a shopping bag to the hand mesh
    // itself would squash it; parenting it to the elbow loses the authored
    // hand position and forces every caller to guess an offset.
    const carryGrip = new THREE.Group();
    carryGrip.name = `CarryGrip${side}`;
    carryGrip.position.copy(hand.position);
    carryGrip.position.x += sx * 0.045; // stay inside the palm, biased away from the torso
    carryGrip.position.z += 0.015;
    carryGrip.userData.kind = 'customer-carry-grip';
    elbow.add(carryGrip);
    limbs[`shoulder${side}`] = shoulder;
    limbs[`elbow${side}`] = elbow;
    limbs[`hand${side}`] = hand;
    limbs[`carryGrip${side}`] = carryGrip;

    const hip = new THREE.Group();
    hip.position.set(sx * 0.10, 0.93, 0);
    root.add(hip);
    // hip cap at the pivot: a khaki ball tying the pelvis into the thigh, closing the
    // crotch/hip gap that made the legs read as two loose posts under a bowl.
    const hipCap = ball(0.072, mKhaki, 14);
    hipCap.scale.set(0.90, 0.76, 0.86);
    hip.add(hipCap);
    const thigh = capsule(0.078, 0.30, mKhaki, -0.22);
    thigh.scale.z = 0.92;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.name = `knee${side}`;
    knee.position.y = -0.46;
    hip.add(knee);
    // knee cap: a khaki ball at the pivot closing the thigh→shin gap
    const kneeCap = ball(0.072, mKhaki, 12);
    kneeCap.scale.set(1, 0.92, 0.98);
    knee.add(kneeCap);
    const shin = capsule(0.064, 0.29, mKhaki, -0.19);
    shin.scale.z = 0.92;
    knee.add(shin);
    // a real shoe: a soft leather upper on a rubber sole with a rounded toe, in place of the
    // dark block that used to sit under the trouser cuff.
    const sole = box(0.135, 0.035, 0.30, mSole, -0.452, -0.03);
    sole.castShadow = true;
    knee.add(sole);
    const foot = ellipsoid(0.128, 0.115, 0.235, mShoe, -0.398, -0.05, 12);
    knee.add(foot);
    const toe = ellipsoid(0.118, 0.088, 0.13, mShoe, -0.41, -0.135, 12);
    knee.add(toe);
    const tongue = box(0.075, 0.05, 0.10, mShoe, -0.352, 0.01);
    tongue.rotation.x = -0.25;
    fineDetail(tongue);
    knee.add(tongue);
    // Q6: a golf shoe, not a street shoe. Two tells, both cheap: a pale
    // midsole stripe between the upper and the sole, and a trouser cuff that
    // BREAKS over the shoe instead of a khaki tube ending in mid-air.
    const midsole = box(0.138, 0.014, 0.302, M(0xe6e3dc, 0.62), -0.4335, -0.03);
    fineDetail(midsole);
    knee.add(midsole);
    const trouserCuff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.076, 0.084, 0.055, 14), mKhaki,
    );
    trouserCuff.position.set(0, -0.318, 0.006);
    trouserCuff.scale.z = 0.94;
    trouserCuff.castShadow = true;
    knee.add(trouserCuff);
    limbs[`hip${side}`] = hip;
    limbs[`knee${side}`] = knee;
  }

  // Snapshot only the resources built by this character factory. Checkout later
  // parents shared merchandise proxies and the paid-bag GLB under this hierarchy;
  // a teardown-time traversal would incorrectly dispose those cache-owned assets.
  const ownedGeometries = new Set();
  const ownedMaterials = new Set();
  root.traverse((object) => {
    if (object.geometry && typeof object.geometry.dispose === 'function') {
      ownedGeometries.add(object.geometry);
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material && typeof material.dispose === 'function') ownedMaterials.add(material);
    }
  });

  let resourcesDisposed = false;
  const char = {
    root,
    mode: 'Idle',
    phase: Math.random() * 6.28,
    dispose() {
      if (resourcesDisposed) return false;
      resourcesDisposed = true;
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      return true;
    },
  };

  char.setMode = (mode) => {
    if (char.mode !== mode) {
      char.mode = mode;
      char.phase = 0;
    }
  };
  char.hand = (side = 'R') => limbs[`hand${side}`] || limbs.handR;
  char.carryGrip = (side = 'R') => limbs[`carryGrip${side}`] || limbs.carryGripR;
  let presentationDetail = 'full';
  char.setPresentationDetail = (detail = 'full') => {
    const next = detail === 'far' ? 'far' : 'full';
    if (next === presentationDetail) return false;
    presentationDetail = next;
    const visible = next === 'full';
    for (const mesh of fineDetailMeshes) mesh.visible = visible;
    return true;
  };
  char.presentationDetail = () => presentationDetail;

  const lerpSeg = (t, segs) => {
    // segs: [ [t0, v0], [t1, v1], ... ] piecewise-linear, clamped
    for (let i = 1; i < segs.length; i++) {
      if (t <= segs[i][0]) {
        const [t0, v0] = segs[i - 1];
        const [t1, v1] = segs[i];
        return v0 + (v1 - v0) * ((t - t0) / (t1 - t0 || 1));
      }
    }
    return segs[segs.length - 1][1];
  };

  char.update = (dt) => {
    char.phase += dt;
    const p = char.phase;
    let hipL = 0, hipR = 0, kneeL = 0, kneeR = 0, shL = 0, shR = 0, elb = -0.25;
    // Both elbows share `elb` for every symmetric pose. `elbL` overrides the
    // LEFT one for poses where the two arms are doing different jobs — one arm
    // reaching while the other hangs, which a single shared bend cannot say.
    let elbL = null;
    let lean = 0.04, twist = 0, headTilt = 0, bob = 0, shLz = 0.06, shRz = -0.06;

    if (char.mode === 'Walk' || char.mode === 'WalkBag') {
      const w = p * STRIDE_RATE_RAD_S; // ~1.4 strides/s
      hipL = 0.55 * Math.sin(w);
      hipR = -hipL;
      kneeL = 0.4 * Math.max(0, Math.sin(w - 1.1));
      kneeR = 0.4 * Math.max(0, Math.sin(w + Math.PI - 1.1));
      if (char.mode === 'WalkBag') {
        // Ease from the acceptance pose into a one-handed side carry, avoiding
        // a one-frame snap as the customer turns to leave.
        const u = Math.min(1, p / 0.55);
        const settle = u * u * (3 - 2 * u);
        // C4: THE CARRIED ARM HANGS. It used to hold shL at -1.18 for the whole
        // walk — a 68 deg lift, held — on the reasoning that "a fully dropped
        // arm hides the entire bag behind the walnut top". That is one second
        // of framing bought with a customer who carries a shop bag out at
        // waist height like a lantern. They are walking AWAY from the counter;
        // the bag is in clear view within a stride either way.
        shL = -0.42 * (1 - settle) + (-0.16 + 0.06 * Math.sin(w * 0.5)) * settle;
        shR = -0.05 * (1 - settle) + 0.38 * Math.sin(w) * settle;
        elbL = -0.55 * (1 - settle) - 0.20 * settle;   // the carrying arm straightens
        elb = -0.12 * (1 - settle) - 0.35 * settle;    // the free arm swings
        lean = 0.14 * (1 - settle) + 0.07 * settle;
      } else {
        shL = -0.45 * Math.sin(w);
        shR = 0.45 * Math.sin(w);
        elb = -0.35;
        lean = 0.07;
      }
      bob = 0.02 * Math.sin(2 * w);
    } else if (char.mode === 'Sit' || ['CartSit', 'CartEnter', 'CartExit'].includes(char.mode)) {
      // Lounge seating keeps its established lowered-leg pose. Golf-cart
      // seating uses the same articulated bend without dropping the hip joints
      // half a metre below the pelvis: the authored seat/foot anchors already
      // provide the correct vertical relationship inside the vehicle.
      const cartTransition = char.mode === 'CartEnter'
        ? Math.min(1, p / 0.55)
        : char.mode === 'CartExit'
          ? 1 - Math.min(1, p / 0.55)
          : 1;
      const seated = char.mode === 'Sit' ? 1 : cartTransition;
      hipL = -1.35 * seated;
      hipR = -1.35 * seated;
      kneeL = 1.35 * seated;
      kneeR = 1.35 * seated;
      shL = -0.28 * seated;
      shR = -0.28 * seated;
      elb = -0.25 - 0.45 * seated;
      lean = 0.04 + 0.02 * seated;
      bob = char.mode === 'CartSit' ? 0.006 * Math.sin(p * 4.5) : 0;
    } else if (['Swing', 'DriverSwing', 'IronSwing', 'PracticeSwing', 'BunkerSwing'].includes(char.mode)) {
      const cycle = char.mode === 'PracticeSwing' ? 2.9 : 2.6;
      const t = p % cycle;
      const power = char.mode === 'DriverSwing' ? 1.12 : char.mode === 'BunkerSwing' ? 1.18 : 1;
      twist = power * lerpSeg(t, [[0, 0], [0.45, 0.03], [0.72, -0.04], [1.2, 0.55], [1.43, -0.6], [2.15, 0], [cycle, 0]]);
      const arm = power * lerpSeg(t, [[0, -0.5], [0.45, -0.53], [0.72, -0.47], [1.2, -1.5], [1.43, 0.7], [2.15, -0.5], [cycle, -0.5]]);
      shL = arm; shR = arm * 0.85;
      elb = char.mode === 'BunkerSwing' ? -0.18 : -0.3;
      lean = char.mode === 'BunkerSwing' ? 0.24 : 0.16;
      headTilt = 0.28;
    } else if (['Browse', 'Inspect', 'Reach'].includes(char.mode)) {
      const r = lerpSeg(p % 3.2, [[0, 0], [0.5, 1.25], [1.9, 1.0], [2.6, 0], [3.2, 0]]);
      shR = r;
      elb = r > 0.5 ? -0.55 : -0.25;
      shL = 0.05;
      headTilt = char.mode === 'Inspect' ? 0.34 : 0.2;
      bob = 0.008 * Math.sin(p * 2);
    } else if (char.mode === 'Checkout') {
      // Both hands reach over the product surface with a small alternating lead.
      // The item-placement controller reads the wrist objects below, giving its
      // product arc a real animation target instead of a floating chest origin.
      shR = -1.02 + Math.sin(p * 3.2) * 0.08;
      shL = -0.78 + Math.sin(p * 3.2 + Math.PI) * 0.06;
      elb = -0.52;
      lean = 0.12;
      headTilt = 0.14;
    } else if (char.mode === 'Present') {
      // Wallet/card/cash presentation: one hand reaches naturally across the
      // customer edge while the other stays close to the torso.
      shR = -1.12 + Math.sin(p * 2.6) * 0.035;
      shL = -0.14;
      elb = -0.62;
      lean = 0.13;
      headTilt = 0.08;
    } else if (char.mode === 'PayCash' || char.mode === 'PayCard') {
      // THE HAND THE MONEY IS IN. customers.js has set these two modes on every
      // PAYING frame since the checkout shipped, and neither existed here — the
      // unknown name fell through to the default slack-arms pose, so the tender
      // fan hung in the air with the arm at the customer's side (reported
      // 2026-07-29: "Cash is floating: the customer's hand must be attached to
      // the cash as it is placed"). Same reach as Present, but HELD — no
      // breathing term — because the presented fan and the invisible click
      // target are laid out once at the grip point and a bobbing wrist would
      // detach them by a couple of centimetres.
      shR = -1.12;
      shL = -0.14;
      elb = -0.62;
      lean = 0.13;
      headTilt = 0.08;
    } else if (char.mode === 'CashLaid') {
      // F6 (Full_Goal_16): the notes are DOWN on the counter — the arm comes
      // back and the customer waits for change with hands settled, a touch
      // of forward attention keeping them "at the counter" rather than idle.
      // The card path never uses this: a card stays in the held-out hand
      // until the cashier takes it.
      shR = -0.30;
      shL = -0.16;
      elb = -0.18;
      lean = 0.07;
      headTilt = 0.05;
    } else if (char.mode === 'Receive') {
      shR = -1.05;
      shL = -0.10;
      elb = -0.72;
      lean = 0.10;
      headTilt = 0.16;
    } else if (char.mode === 'ReceiveBag') {
      // ONE HAND, like a person. This used to raise both arms (shL -1.18
      // alongside shR -1.00), which reads as being handed something heavy with
      // two hands — or worse, as a surrender. Nobody takes a small shop bag
      // that way: you put one hand out, take the handles, and go.
      //
      // C4 — AND IT HAS TO BE THE HAND THE BAG GOES TO. The bag attaches to
      // carryGrip('L') (clubhouse.js onCustomerPaid), and this pose raised the
      // RIGHT arm to -1.00 while the left hung: the customer reached with one
      // hand and received in the other. Photographed at the counter 2026-08-04
      // — a raised empty fist on one side, a flat bag half inside the desk on
      // the other.
      //
      // So the LEFT arm is the one that moves, and it goes FORWARD, not up:
      // -0.42 puts the hand out at hip height, which is where the brief says
      // the bag is taken. The right arm hangs.
      shL = -0.42;   // the receiving arm — forward at the hip, not lifted
      elbL = -0.55;  // forearm out, so the hand clears the body
      shR = -0.05;   // the other arm just hangs
      elb = -0.12;   // …near enough straight
      lean = 0.14;
      // A small appreciative nod makes the ownership transfer read as a positive
      // customer reaction without turning checkout into an arcade celebration.
      const nod = Math.sin(Math.min(1, p / 1.25) * Math.PI * 2);
      headTilt = 0.10 + nod * 0.095;
      bob = Math.max(0, Math.sin(Math.min(1, p / 1.25) * Math.PI)) * 0.012;
    } else if (char.mode === 'Declined') {
      shR = 0.18;
      shL = 0.18;
      elb = -0.45;
      lean = -0.03;
      twist = Math.sin(p * 4.5) * 0.06;
      headTilt = -0.12;
    } else if (char.mode === 'Impatient') {
      // A compact folded-arm settle and one quiet head shake. It reads clearly
      // across the counter without turning a lost sale into a broad tantrum.
      const t = Math.min(1, p / CUSTOMER_IMPATIENT_BEAT_SECONDS);
      const settle = t * t * (3 - 2 * t);
      const shakeEnvelope = Math.sin(Math.PI * t);
      shL = -0.72 * settle;
      shR = -0.72 * settle;
      shLz = 0.06 - 0.36 * settle;
      shRz = -0.06 + 0.36 * settle;
      elb = -0.95 * settle - 0.25 * (1 - settle);
      lean = 0.02 - 0.055 * settle;
      twist = Math.sin(t * Math.PI * 3) * 0.075 * shakeEnvelope;
      headTilt = -0.08 * settle;
      bob = -0.008 * settle;
    } else { // Idle
      lean = 0.03 + 0.015 * Math.sin(p * 1.1);
      shL = 0.06 + 0.03 * Math.sin(p * 1.1);
      shR = 0.06 + 0.03 * Math.sin(p * 1.1 + 0.4);
      shRz = -0.06;
      bob = 0.01 * Math.sin(p * 1.1);
    }

    const sitOffset = char.mode === 'Sit' ? -0.5 : 0;
    limbs.hipL.rotation.x = hipL;
    limbs.hipR.rotation.x = hipR;
    limbs.hipL.position.y = 0.93 + sitOffset;
    limbs.hipR.position.y = 0.93 + sitOffset;
    limbs.kneeL.rotation.x = kneeL;
    limbs.kneeR.rotation.x = kneeR;
    limbs.shoulderL.rotation.x = shL;
    limbs.shoulderR.rotation.x = shR;
    limbs.shoulderL.rotation.z = shLz;
    limbs.shoulderR.rotation.z = shRz;
    limbs.elbowL.rotation.x = elbL ?? elb;
    limbs.elbowR.rotation.x = elb;
    chest.rotation.x = lean;
    chest.rotation.y = twist;
    head.rotation.x = headTilt;
    chest.position.y = 1.07 + bob; // bob lives on the body — root stays placeable
    // G1 (Full_Goal_16): FOUR vertical laws used to meet at the waist —
    // shirt 1.0x bob, stomach 0.7x, belt and buckle never, hips never — so
    // at stride the hem slid against a static belt at 2.8 Hz and the torso
    // read as pumping apart. One law now: the whole trunk rides the same
    // bob, and the only remaining seam (pelvis-to-hip) is the one hipCap
    // already covers.
    pelvis.position.y = 0.98 + bob;
    belt.position.y = 1.055 + bob;
    buckle.position.y = 1.055 + bob;
    buckleTongue.position.y = 1.055 + bob;
  };

  char.update(0.001); // land in a valid pose immediately
  return char;
}
