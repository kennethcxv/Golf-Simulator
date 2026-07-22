// Pure card-swipe gesture judge. The renderer records normalized top-to-bottom
// samples; this module owns the forgiving speed, direction, and completion rules.

export const SWIPE = Object.freeze({
  START_MAX: 0.4,
  END_MIN: 0.8,
  REVERSAL: 0.2,
  MIN_SEC: 0.05,
  MAX_SEC: 1.6,
});

export const SWIPE_MSG = Object.freeze({
  ok: 'Approved',
  incomplete: 'Complete the swipe',
  start: 'Start at the top',
  direction: 'Swipe downward',
  reverse: 'Swipe again',
  fast: 'Swipe slower',
  slow: 'Swipe again',
});

export function judgeSwipe(samples, cfg = SWIPE) {
  if (!Array.isArray(samples) || samples.length < 2) {
    return { ok: false, code: 'incomplete' };
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  let peak = first.y;
  let worstReversal = 0;
  let maxY = first.y;
  let minY = first.y;
  for (const sample of samples) {
    if (sample.y > peak) peak = sample.y;
    else worstReversal = Math.max(worstReversal, peak - sample.y);
    maxY = Math.max(maxY, sample.y);
    minY = Math.min(minY, sample.y);
  }

  const duration = last.t - first.t;
  const down = maxY - first.y;
  const up = first.y - minY;
  if (down < 0.12 && up > down) return { ok: false, code: 'direction' };
  if (first.y > cfg.START_MAX) return { ok: false, code: 'start' };
  if (worstReversal > cfg.REVERSAL) return { ok: false, code: 'reverse' };
  if (maxY < cfg.END_MIN) return { ok: false, code: 'incomplete' };
  if (duration < cfg.MIN_SEC) return { ok: false, code: 'fast' };
  if (duration > cfg.MAX_SEC) return { ok: false, code: 'slow' };
  return { ok: true, code: 'ok' };
}
