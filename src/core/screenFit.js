// Where to sit so a physical screen fills the view.
//
// The laptop interface is a real 1024x640 DOM projected onto the lid's four corners, so how
// readable the game's entire management surface is comes down to one number: how far the seated
// camera sits from the lid. Hardcode it and it is wrong the moment the field of view, the window
// shape, or the model changes — which is exactly how the screen ended up at 9.7% of the viewport.
//
// So derive it. Both directions are checked and the binding one wins: the screen never overflows
// the frame, and never floats in the middle of it either.

const halfAngle = (fovDeg) => Math.tan((fovDeg * Math.PI) / 180 / 2);

// how much of the viewport a screen of this size covers, seated at `dist`
export function coverage({ screenW, screenH, fovDeg, aspect, dist }) {
  const visH = 2 * dist * halfAngle(fovDeg);
  const visW = visH * aspect;
  const heightFrac = screenH / visH;
  const widthFrac = screenW / visW;
  return { heightFrac, widthFrac, areaFrac: heightFrac * widthFrac };
}

// the closest seat that keeps the whole screen inside the frame with a margin on both axes
export function fitDistance({ screenW, screenH, fovDeg, aspect, fracH = 0.80, fracW = 0.90 }) {
  const t = halfAngle(fovDeg);
  const dH = screenH / (2 * fracH * t); // close enough to fill fracH of the height
  const dW = screenW / (2 * fracW * t * aspect); // ...and no closer than fracW of the width allows
  return Math.max(dH, dW);
}
