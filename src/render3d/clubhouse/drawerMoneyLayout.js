// Pure placement math for the cash drawer. Each compartment's Blender socket
// carries an authored contract (well_w/well_d interior bounds, wall_h, max
// pieces, note spacing, clip hinge drop); these functions turn that contract
// plus a piece count into deterministic transforms that stay inside the
// compartment. Unit-agnostic (caller scales the contract into world units)
// and THREE-free so `node --test` can pin the physical guarantees directly.

// Deterministic jumble — same seed, same heap, so a save/reload or a drawer
// re-open never reshuffles the till behind the player's back.
export const scramble = (denom, index, salt) => {
  const h = Math.sin(denom * 127.1 + index * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

// How full a compartment reads at a glance. Thresholds are fractions of the
// authored max_pieces cap, not absolute counts, so they follow the contract.
export function fillState(count, maxPieces) {
  if (count <= 0) return 'empty';
  if (count <= maxPieces * 0.25) return 'low';
  if (count <= maxPieces * 0.75) return 'moderate';
  return 'full';
}

// Notes lie flat and fill their slot: long axis front-to-back at ~94% of the
// interior depth, width just inside the dividers. Returns multipliers for a
// note whose current footprint is `len` x `wid` (world units).
export function billFit(meta, len, wid) {
  return {
    scaleLen: (meta.well_d * 0.94) / len,
    scaleWid: (meta.well_w * 0.92) / wid,
  };
}

// A tidy stack with human jitter: centred, one spacing step per note, a few
// millimetres of slide and a hair of skew — never enough to leave the slot.
export function billLayout(meta, count, denom) {
  const n = Math.max(0, Math.min(count, meta.max_pieces));
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      dx: (scramble(denom, i, 1) - 0.5) * 0.004,
      dy: 0.0015 + i * meta.spacing,
      dz: (scramble(denom, i, 2) - 0.5) * 0.005,
      ry: (scramble(denom, i, 3) - 0.5) * 0.04,
    });
  }
  return out;
}

// The retaining clip rides the top of the stack: 0 = resting on the slot
// floor (authored rest pose), 1 = lifted level with its hinge.
export function clipFillRatio(meta, count) {
  const n = Math.max(0, Math.min(count, meta.max_pieces));
  if (!meta.hinge_drop || meta.hinge_drop <= 0) return 0;
  const stack = n > 0 ? 0.0015 + n * meta.spacing : 0;
  return Math.max(0, Math.min(1, stack / meta.hinge_drop));
}

// Coins land as a scrambled mound: highest in the middle, spilling toward the
// walls, every piece resting on the floor or the layer beneath it, none
// crossing a divider. coinR/coinT are the piece's world radius and thickness.
export function coinLayout(meta, count, coinR, coinT, denom) {
  const n = Math.max(0, Math.min(count, meta.max_pieces));
  const hw = Math.max(0.001, meta.well_w / 2 - coinR - 0.0015);
  const hd = Math.max(0.001, meta.well_d / 2 - coinR - 0.0015);
  const perLayer = Math.max(4, Math.floor((meta.well_w * meta.well_d) / (coinR * coinR * 5.5)));
  const maxLayers = Math.max(1, Math.ceil(n / perLayer));
  const out = [];
  for (let i = 0; i < n; i += 1) {
    // golden-angle spread gives an even scatter; sqrt keeps density uniform
    const t = Math.sqrt((i % perLayer) / perLayer);
    const ang = i * 2.39996 + scramble(denom, i, 5) * 0.9;
    const layer = Math.floor(i / perLayer);
    // upper layers pull toward the centre of the mound
    const shrink = 1 - layer * 0.30;
    const dx = Math.cos(ang) * t * hw * shrink + (scramble(denom, i, 6) - 0.5) * coinR * 0.5;
    const dz = Math.sin(ang) * t * hd * shrink + (scramble(denom, i, 7) - 0.5) * coinR * 0.5;
    const lean = 0.16 + layer * 0.10;
    out.push({
      dx: Math.max(-hw, Math.min(hw, dx)),
      dy: coinT / 2 + layer * coinT * 0.85 + scramble(denom, i, 8) * coinT * 0.35,
      dz: Math.max(-hd, Math.min(hd, dz)),
      rx: (scramble(denom, i, 9) - 0.5) * 2 * lean,
      ry: scramble(denom, i, 10) * Math.PI * 2,
      rz: (scramble(denom, i, 11) - 0.5) * 2 * lean,
    });
  }
  return { pieces: out, layers: maxLayers };
}
