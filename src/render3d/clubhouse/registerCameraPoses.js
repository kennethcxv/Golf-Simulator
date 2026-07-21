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
  // eye high on the staff side to keep the upper body in frame
  return {
    eye: { x: cx + 0.26, y: 1.62, z: 4.90 },
    look: { x: cx, y: counterTop + 0.29, z: 3.64 },
    fov: 46,
  };
}

// Terminal entry: the reader remains physically seated on the counter. The
// camera moves close and looks down at the fixed keypad so the hardware never
// has to lift, float, or detach from its authored station.
export function cardTerminalPose(station, counterTop) {
  return {
    eye: { x: station.x + 0.01, y: counterTop + 0.27, z: station.z + 0.55 },
    look: { x: station.x, y: counterTop + 0.07, z: station.z },
    fov: 32,
  };
}

// Receipt feed: keep the thermal printer, output slot, and full paper travel in
// one close composition. The player is not entering data during this automatic
// beat, so a short eased glance can prove that the physical printer actually
// produced the receipt before the camera returns to the customer handoff.
export function receiptPrinterPose(station, counterTop) {
  return {
    eye: { x: station.x - 0.56, y: counterTop + 0.67, z: station.z + 0.90 },
    look: { x: station.x - 0.26, y: counterTop + 0.16, z: station.z - 0.04 },
    fov: 46,
  };
}
