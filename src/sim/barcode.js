// Physical checkout barcode rules. Kept free of Three.js so ownership, orientation,
// and rejection feedback can be pinned by headless tests.

export const BARCODE_FACING_DOT = -0.35;

function hashText(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function barcodeFor(skuId, price = 0) {
  const cents = Math.max(0, Math.round(Number(price || 0) * 100));
  const body = `${String(hashText(skuId) % 1_000_000).padStart(6, '0')}${String(cents % 100_000).padStart(5, '0')}`;
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[i]) * (i % 2 ? 3 : 1);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

export function judgeBarcodeRead({
  barcode,
  scanHit,
  facingDot,
  itemUid,
  expectedUid,
  alreadyScanned = false,
} = {}) {
  if (!barcode) return { ok: false, code: 'missing' };
  if (!itemUid || itemUid !== expectedUid) return { ok: false, code: 'wrong-customer' };
  if (alreadyScanned) return { ok: false, code: 'duplicate' };
  if (!scanHit) return { ok: false, code: 'outside-zone' };
  if (!Number.isFinite(facingDot) || facingDot > BARCODE_FACING_DOT) {
    return { ok: false, code: 'orientation' };
  }
  return { ok: true, code: 'ok' };
}

export const BARCODE_MSG = {
  missing: 'This product has no readable barcode.',
  'wrong-customer': 'That item belongs to another order.',
  duplicate: 'Already scanned.',
  'outside-zone': 'Move the barcode across the scanner glass.',
  orientation: 'Turn the barcode toward the scanner glass.',
};
