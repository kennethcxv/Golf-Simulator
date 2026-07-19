const asPoint = (value = {}) => ({
  x: Number(value.x) || 0,
  y: Number(value.y) || 0,
  z: Number(value.z) || 0,
});

const isBill = (denom) => Number(denom) >= 1;

// Customer props use the articulated carry grip as contact, then offset just
// enough for the fingers to pinch an edge instead of occupying the prop centre.
export function customerCardPoint(hand) {
  const point = asPoint(hand);
  return { x: point.x - 0.030, y: point.y + 0.018, z: point.z + 0.028 };
}

export function customerCashPoint(hand) {
  const point = asPoint(hand);
  return { x: point.x - 0.024, y: point.y + 0.026, z: point.z + 0.028 };
}

// Incoming tender is one held handful. Notes overlap like a counted stack and
// coins sit along its near edge; neither is spread into a counter-sized fan.
export function presentedTenderLayout(denominations = [], hand = {}) {
  const origin = customerCashPoint(hand);
  let billIndex = 0;
  let coinIndex = 0;
  return denominations.map((rawDenom) => {
    const denom = Number(rawDenom);
    if (isBill(denom)) {
      const index = billIndex++;
      return {
        denom,
        position: {
          x: origin.x + index * 0.009,
          y: origin.y + index * 0.0022,
          z: origin.z + index * 0.002,
        },
        rotation: { x: 1.04, y: -0.05 + index * 0.025, z: 0 },
      };
    }
    const index = coinIndex++;
    return {
      denom,
      position: {
        x: origin.x - 0.018 + (index % 3) * 0.025,
        y: origin.y + 0.010 + Math.floor(index / 3) * 0.003,
        z: origin.z + 0.035 + Math.floor(index / 3) * 0.018,
      },
      rotation: { x: 0.92, y: 0, z: (index % 3 - 1) * 0.08 },
    };
  });
}

// Counted change stays inside the 38 x 20 cm handoff tray. Notes form one tidy
// stack; coins form a small three-column count beside it.
export function selectedChangeLayout(denominations = [], handoff = {}, counterTop = 0) {
  const tray = asPoint(handoff);
  let billIndex = 0;
  let coinIndex = 0;
  return denominations.map((rawDenom) => {
    const denom = Number(rawDenom);
    if (isBill(denom)) {
      const index = billIndex++;
      return {
        denom,
        position: {
          x: tray.x - 0.078 + index * 0.006,
          y: Number(counterTop) + 0.020 + index * 0.0015,
          z: tray.z - 0.020 + index * 0.002,
        },
        rotation: { x: 0, y: 0.10 + index * 0.018, z: 0 },
      };
    }
    const index = coinIndex++;
    return {
      denom,
      position: {
        x: tray.x + 0.030 + (index % 3) * 0.032,
        y: Number(counterTop) + 0.024 + Math.floor(index / 3) * 0.003,
        z: tray.z - 0.032 + Math.floor(index / 3) * 0.034,
      },
      rotation: { x: 0, y: 0, z: (index % 3 - 1) * 0.07 },
    };
  });
}

// Once confirmed, every selected piece belongs to one physical handful. These
// are local offsets inside that carrier, allowing a single coherent handoff.
export function changeBundleLayout(denominations = []) {
  let billIndex = 0;
  let coinIndex = 0;
  return denominations.map((rawDenom) => {
    const denom = Number(rawDenom);
    if (isBill(denom)) {
      const index = billIndex++;
      return {
        denom,
        position: { x: index * 0.006, y: index * 0.0015, z: index * 0.002 },
        rotation: { x: 0, y: index * 0.018, z: 0 },
      };
    }
    const index = coinIndex++;
    return {
      denom,
      position: {
        x: -0.018 + (index % 3) * 0.022,
        y: 0.010 + Math.floor(index / 3) * 0.003,
        z: 0.034 + Math.floor(index / 3) * 0.017,
      },
      rotation: { x: 0, y: 0, z: (index % 3 - 1) * 0.08 },
    };
  });
}

export function changeHandoffPoint(hand) {
  const point = asPoint(hand);
  return { x: point.x - 0.018, y: point.y + 0.025, z: point.z + 0.030 };
}
