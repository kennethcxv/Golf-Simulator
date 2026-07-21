// Pure geometry for the card-payment camera. The register composes these eye/
// look points into world poses via poseBetween; keeping the math here (THREE-
// free, interior-local yards) lets node --test pin the framing invariants the
// user cares about: the handoff frames the person and the entry frames the
// fixed counter-mounted reader without booting the game.
//
// Frame of reference: +z is the STAFF/north side, lower z is the customer/south
// side; the camera always sits on the staff side (high z) and looks south (a
// look point at lower z than the eye), so it never spins between these poses.

// Card handoff: eye on the staff side at standing height, a touch to the
// customer's right, looking across the counter at the card held out at chest
// height. Frames the upper torso; the counter falls out of the bottom of the shot.
export function cardHandoffPose(customer, counterTop) {
  const cx = Math.max(2.15, Math.min(3.15, customer.x));
  // the card is held OUT over the counter at ~z 3.9 (customerHandPoint); aim
  // between the extended card and the customer's torso so both read, with the
  // eye high on the staff side to keep the upper body in frame. The extra step
  // back keeps the seated terminal fully clickable during the handoff instead
  // of clipping its centre below the viewport.
  return {
    eye: { x: cx + 0.26, y: 1.66, z: 5.35 },
    look: { x: cx, y: counterTop + 0.29, z: 3.64 },
    fov: 52,
  };
}

// Terminal entry: the reader remains physically seated on the counter. The
// camera moves close and looks down at the fixed keypad so the hardware never
// has to lift, float, or detach from its authored station.
export function cardTerminalPose(station, counterTop) {
  return {
    eye: { x: station.x + 0.01, y: counterTop + 0.38, z: station.z + 0.75 },
    // Aim through the centre of the full vertical swipe channel so both the
    // starting edge and release edge remain visible at the close reader FOV.
    look: { x: station.x, y: counterTop + 0.13, z: station.z },
    fov: 38,
  };
}

// Fulfilment keeps the printer, receipt path, and receiving customer in one
// composed frame. It sits a little farther back than the card handoff so the
// right-side printer and the customer's two palm grips remain visible together.
export function fulfillmentHandoffPose(customer, printer, counterTop) {
  const customerX = Math.max(2.10, Math.min(3.10, customer.x));
  const printerX = Number.isFinite(printer?.x) ? printer.x : 3.98;
  const centreX = (customerX + printerX) / 2;
  return {
    eye: { x: centreX - 0.38, y: 1.64, z: 5.72 },
    look: { x: centreX - 0.26, y: counterTop + 0.17, z: 4.08 },
    fov: 54,
  };
}
