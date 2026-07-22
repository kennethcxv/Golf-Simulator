const DIGIT_BITS = Object.freeze([
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
]);

export const CHECKOUT_SCAN_TIMING = Object.freeze({
  pickup: 0.28,
  approach: 0.18,
  hold: 0.30,
  exit: 0.18,
  bag: 0.46,
});

// The barcode centre passes near the cashier-visible edge of the 74 x 86 mm
// scanner window. Its 74 x 40 mm label still overlaps the glass while remaining
// readable around the housing from the player camera.
export const CHECKOUT_SCAN_TARGET = Object.freeze({
  distance: 0.12,
  sideOffset: 0.045,
  upOffset: 0.018,
  sweep: 0.040,
  maximumLateralDistance: 0.060,
});

export function barcodeBits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  const halves = Math.ceil(digits.length / 2);
  let bits = '101';
  for (let index = 0; index < digits.length; index += 1) {
    if (index === halves) bits += '01010';
    const pattern = DIGIT_BITS[Number(digits[index])] || DIGIT_BITS[0];
    bits += index < halves
      ? pattern
      : [...pattern].reverse().map((bit) => (bit === '1' ? '0' : '1')).join('');
  }
  return `${bits}101`;
}

export function scanDuration(timing = CHECKOUT_SCAN_TIMING) {
  return timing.pickup + timing.approach + timing.hold + timing.exit + timing.bag;
}

export function scanChoreographyAt(elapsedSeconds, timing = CHECKOUT_SCAN_TIMING) {
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
  const phases = [
    ['pickup', timing.pickup],
    ['scan-approach', timing.approach],
    ['scan-hold', timing.hold],
    ['scan-exit', timing.exit],
    ['bag', timing.bag],
  ];
  let cursor = 0;
  for (const [phase, duration] of phases) {
    const end = cursor + duration;
    if (elapsed < end || phase === 'bag') {
      const phaseT = duration > 0 ? Math.min(1, Math.max(0, (elapsed - cursor) / duration)) : 1;
      return {
        phase,
        phaseT,
        elapsed,
        complete: elapsed >= scanDuration(timing),
        shouldCommitScan: ['scan-hold', 'scan-exit', 'bag'].includes(phase),
      };
    }
    cursor = end;
  }
  return {
    phase: 'bag', phaseT: 1, elapsed, complete: true, shouldCommitScan: true,
  };
}

function vector(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const result = value.slice(0, 3).map(Number);
  return result.every(Number.isFinite) ? result : null;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalized(value) {
  const v = vector(value);
  if (!v) return null;
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 1e-8 ? v.map((component) => component / length) : null;
}

export function scannerReadFacts({
  barcodePosition,
  barcodeNormal,
  rayOrigin,
  rayDirection,
  minimumDistance = 0.03,
  maximumDistance = 0.22,
  maximumLateralDistance = CHECKOUT_SCAN_TARGET.maximumLateralDistance,
} = {}) {
  const position = vector(barcodePosition);
  const normal = normalized(barcodeNormal);
  const origin = vector(rayOrigin);
  const direction = normalized(rayDirection);
  if (!position || !normal || !origin || !direction) {
    return {
      scanHit: false,
      facingDot: 1,
      distanceAlongRay: null,
      lateralDistance: null,
    };
  }
  const relative = position.map((component, index) => component - origin[index]);
  const distanceAlongRay = dot(relative, direction);
  const lateral = relative.map((component, index) => (
    component - direction[index] * distanceAlongRay
  ));
  const lateralDistance = Math.hypot(lateral[0], lateral[1], lateral[2]);
  return {
    scanHit: distanceAlongRay >= minimumDistance
      && distanceAlongRay <= maximumDistance
      && lateralDistance <= maximumLateralDistance,
    facingDot: dot(normal, direction),
    distanceAlongRay,
    lateralDistance,
  };
}
