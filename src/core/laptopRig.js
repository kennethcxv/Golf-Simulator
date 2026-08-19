// THE LAPTOP'S PHYSICAL FRAME — pure geometry, no three.js.
//
// The renderer builds its meshes from exactly these numbers and nothing else, so "does the
// machine face the chair?" is a question a test can answer instead of a question you squint at.
// The brief asked for debug helpers to check the orientation; helpers prove it once. This
// proves it every time the suite runs.
//
// ONE CONVENTION, AND EVERYTHING ELSE FOLLOWS:
//
//        local -Z  ←  the seat. The player sits here and looks toward +z.
//
//   ┌──────────────────────────────┐  +z (far)   ── hinge runs along X at z = +hingeZ
//   │  ▓▓▓▓▓▓ screen (on the lid)  │             ── lid swings up and AWAY from the player
//   ├──────────────────────────────┤
//   │  ⌨  keyboard                 │             ── beyond the trackpad, nearer than the display
//   │  ▭  trackpad                 │             ── the palm rest, closest to the seat
//   └──────────────────────────────┘  -z (near)
//
// So: trackpad.z < keyboard.z < hingeZ, and the open screen's normal points back at -z.
// Yards throughout (the game's unit). A 15" machine is ~0.4 yd wide.

// SCALE. The machine that was here measured 21.6 inches across the deck with a 23.8-inch
// display — a television lying on the desk. Nobody noticed, because at the old seat distance it
// filled the view and there was nothing beside it to judge against. The brief asks for
// believable scale, so: a 15.4-inch 16:10 laptop, which is 14.0 inches across.
//
// The 16:10 is not cosmetic. The interface is a 1024x640 DOM — exactly 16:10 — and it is mapped
// corner-to-corner onto the glass. Let the panel drift to 16:9 and every glyph is quietly
// stretched 11% wide, which reads as "the font is a bit off" and is impossible to place.
export const LAPTOP = {
  deck: { w: 0.390, d: 0.270, t: 0.020 },  // the base you type on  (14.0" x 9.7")
  lid: { w: 0.390, d: 0.270, t: 0.014 },   // the panel that swings up
  screen: { w: 0.3628, h: 0.2268 },        // the glass: 15.4" diagonal, 16:10
  bezel: 0.013,                            // lid minus screen, per side (~0.5")
  hingeZ: 0.135,                           // far edge of the deck (deck.d / 2)
  hingeY: 0.021,                           // the barrel sits just above the deck
  lidOpen: 1.87,                           // ~107 degrees: reclined, the way a real one sits
  keyboard: { z: 0.035, w: 0.345, d: 0.125 },
  trackpad: { z: -0.088, w: 0.115, d: 0.072 },
  led: { x: 0.168, z: -0.128 },            // power light on the front lip, player side
  // THE FEET, AND HOW FAR THEY HANG BELOW THE GROUP'S ORIGIN.
  //
  // The origin is the top of the desk as far as a caller is concerned, but the
  // lowest DRAWN point is the underside of the rubber feet, 1.55 mm below it.
  // A caller that sets position.y to a surface height therefore sinks the
  // laptop into that surface by exactly this much. It is declared here so the
  // geometry that builds the feet and the code that seats them read the same
  // number -- which is the failure the seating bug was made of.
  foot: { rTop: 0.006, rBottom: 0.007, h: 0.0035, y: 0.0002, inset: 0.022 },
  baseDrop: 0.0035 / 2 - 0.0002,
};

const v3 = (x, y, z) => ({ x, y, z });

// the direction the machine faces = the direction the seated player is looking FROM.
// The player is at -z looking toward +z, so the machine's "out of the screen" is -z.
export const forwardLocal = () => v3(0, 0, -1);

// the lid pivots about local X. Everything about the lid is this rotation and nothing else.
export const hingeAxisLocal = () => v3(1, 0, 0);

// rotate a point in HINGE-LOCAL space (origin at the barrel) by the lid angle, into LAPTOP-LOCAL.
function fromHinge(angle, p) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return v3(
    p.x,
    LAPTOP.hingeY + (p.y * c - p.z * s),
    LAPTOP.hingeZ + (p.y * s + p.z * c),
  );
}

// The lid extends from the barrel back over the deck when shut: hinge-local z runs 0 → -lid.d.
// Open it and the far end rises. This is the tip (the top edge of the lid).
export function lidTipLocal(angle) {
  return fromHinge(angle, v3(0, 0, -LAPTOP.lid.d));
}

// The screen's outward normal. Shut, the glass faces DOWN onto the deck (that is what "closed"
// means); open, it must look back at the seat.
export function screenNormalLocal(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // hinge-local -Y is the face of the glass; rotate it.
  return v3(0, -c, -s);
}

// The four corners of the glass, in the order the SEATED PLAYER reads them:
// [top-left, top-right, bottom-right, bottom-left].
//
// main.js used to project all four and then SORT them by y to guess which were the top pair.
// That guess is only ever as good as the camera angle. The lid's own frame knows the answer
// exactly, so hand it over and delete the guess.
//
// The player looks along +z with +y up, so their right hand is at local -x (right = fwd x up).
// And the lid's tip (more negative hinge-z) is the TOP of the screen once it stands up.
export function screenCornersLocal(angle) {
  const hw = LAPTOP.screen.w / 2;
  const zMid = -LAPTOP.lid.d / 2;              // the glass is centred on the lid
  const zTop = zMid - LAPTOP.screen.h / 2;     // further from the barrel = higher up
  const zBot = zMid + LAPTOP.screen.h / 2;
  const eps = -0.0006;                          // a hair proud of the lid, so it never z-fights
  return [
    fromHinge(angle, v3(+hw, eps, zTop)), // top-left  (player's left  = local +x)
    fromHinge(angle, v3(-hw, eps, zTop)), // top-right (player's right = local -x)
    fromHinge(angle, v3(-hw, eps, zBot)), // bottom-right
    fromHinge(angle, v3(+hw, eps, zBot)), // bottom-left
  ];
}

// where the player's hand rests to use it — the interaction point the debug helper draws
export function interactionPointLocal() {
  return v3(0, LAPTOP.deck.t, LAPTOP.trackpad.z);
}
