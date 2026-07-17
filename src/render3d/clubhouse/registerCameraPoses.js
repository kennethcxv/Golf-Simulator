// Pure geometry for the card-payment camera. The register composes these eye/
// look points into world poses via poseBetween; keeping the math here (THREE-
// free, interior-local yards) lets node --test pin the framing invariants the
// user cares about — the handoff frames the PERSON, the entry frames the RAISED
// reader — without booting the game.
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
    eye: { x: cx + 0.30, y: 1.66, z: 4.98 },
    look: { x: cx, y: counterTop + 0.26, z: 3.66 },
    fov: 50,
  };
}

// Terminal entry: the eye and look rise WITH the reader's live floated height
// (floatT 0 = seated on the counter, 1 = fully lifted), so the keypad stays
// centred and readable at whatever height the reader settles.
export function cardTerminalPose(station, counterTop, termLift, floatT) {
  const ty = counterTop + termLift * Math.max(0, Math.min(1, floatT));
  return {
    eye: { x: station.x + 0.02, y: ty + 0.34, z: station.z + 0.92 },
    look: { x: station.x, y: ty + 0.07, z: station.z },
    fov: 40,
  };
}
