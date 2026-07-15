// THE CARD SWIPE — a gesture, judged. Pure, no three.js.
//
// The player pays by card the way you swipe a real mag stripe: hold the card at the
// top of the reader slot and pull it down through, top to bottom, at a human pace,
// without backing up. This module is handed the path the card actually travelled —
// a list of { y, t } samples where y is the card's position down the slot (0 at the
// top, 1 at the bottom) and t is seconds — and decides whether that was a clean
// swipe. Every rule the brief names is here, so it can be tested headlessly; the 3D
// layer only captures the path from the mouse and shows the message.
//
// The window is deliberately forgiving. A swipe should feel satisfying, not fussy:
// the failure modes exist to teach the gesture ("swipe slower", "swipe downward"),
// not to punish a slightly wobbly hand.

export const SWIPE = {
  START_MAX: 0.4,   // a swipe has to BEGIN in the top of the slot
  END_MIN: 0.8,     // ...and has to REACH the bottom
  REVERSAL: 0.2,    // how far back up the card may drift mid-stroke before it's a fumble
  MIN_SEC: 0.05,    // quicker than this across the whole slot is a flick, not a swipe
  MAX_SEC: 1.6,     // slower than this is a stall
};

// codes → the line the terminal shows. The four the brief names verbatim, plus two
// that fold onto its vocabulary (a stall reads as "swipe again"; a starting point too
// low reads as its own small nudge).
export const SWIPE_MSG = {
  ok: 'Approved',
  incomplete: 'Complete the swipe',
  start: 'Start at the top',
  direction: 'Swipe downward',
  reverse: 'Swipe again',
  fast: 'Swipe slower',
  slow: 'Swipe again',
};

// Returns { ok, code }. The order of the checks is the order of the messages'
// priority: tell the player the most useful thing about what went wrong first.
export function judgeSwipe(samples, cfg = SWIPE) {
  if (!Array.isArray(samples) || samples.length < 2) return { ok: false, code: 'incomplete' };

  const first = samples[0];
  const last = samples[samples.length - 1];
  let peak = first.y;        // the furthest DOWN reached so far
  let worstReversal = 0;     // the biggest back-UP move after a peak
  let maxY = first.y;
  let minY = first.y;
  for (const s of samples) {
    if (s.y > peak) peak = s.y;
    else if (peak - s.y > worstReversal) worstReversal = peak - s.y;
    if (s.y > maxY) maxY = s.y;
    if (s.y < minY) minY = s.y;
  }
  const dur = last.t - first.t;
  const down = maxY - first.y;   // how far below the start the card got
  const up = first.y - minY;     // how far above the start it wandered

  // pulled the wrong way — up, or barely down while mostly going up
  if (down < 0.12 && up > down) return { ok: false, code: 'direction' };
  // didn't begin at the top of the slot
  if (first.y > cfg.START_MAX) return { ok: false, code: 'start' };
  // backed up too far in the middle of the stroke
  if (worstReversal > cfg.REVERSAL) return { ok: false, code: 'reverse' };
  // never made it to the bottom
  if (maxY < cfg.END_MIN) return { ok: false, code: 'incomplete' };
  // speed window
  if (dur < cfg.MIN_SEC) return { ok: false, code: 'fast' };
  if (dur > cfg.MAX_SEC) return { ok: false, code: 'slow' };

  return { ok: true, code: 'ok' };
}
