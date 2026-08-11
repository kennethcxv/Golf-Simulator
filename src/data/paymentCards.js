// H (Goal 23) — THE CARDS CUSTOMERS CARRY.
//
// "Still all Pine Hills cards. I asked for multiple variants that read like
// real payment cards — different networks, different banks, so different
// customers carry different cards. Invented names and marks only. Nothing
// trademarked, no real logos, no lifted colour schemes. Build it data-driven so
// a new card is a new row."
//
// Every card in the build was one hard-coded face: the club's own green-and-gold
// "FAIRWAY MEMBER" panel with the club name on it, painted by a function with
// the colours written into its body. So every customer in the shop paid with a
// membership card from the shop they were standing in.
//
// A NOTE ON THE MARKS, because this is the part that can actually cause harm.
// Payment-network branding is aggressively defended, and the resemblance does
// not have to be deliberate to be a problem. So the marks here are drawn from
// primitives that are deliberately UNLIKE the real ones — no interlocking
// circles, no split ovals, no blue-and-gold roundel, no centurion. Each is a
// plain geometric device any designer would arrive at independently, and the
// names are coined rather than adapted. `tests/payment-card-variants.test.js`
// holds a refusal list of real network and issuer names and fails the build if
// one appears here.
//
// Adding a card is adding a row. Nothing else.

/**
 * mark: how the network device is drawn. Each is a primitive the painter knows.
 *   'chevrons'  three stacked chevrons
 *   'ring-bar'  an open ring crossed by a bar
 *   'lattice'   a triangular lattice block
 *   'wave'      two offset sine crests
 *   'keystone'  a tapered block, wider at the top
 */
export const PAYMENT_CARDS = Object.freeze([
  Object.freeze({
    id: 'meridian-northbank',
    network: 'MERIDIAN',
    issuer: 'NORTHBANK',
    tier: 'CLASSIC',
    mark: 'chevrons',
    // A cool slate with a copper device. Chosen to sit away from every real
    // scheme's palette rather than near one.
    base: '#2b3440',
    baseEnd: '#161d25',
    ink: '#e8ecef',
    accent: '#c97a4a',
    chip: '#c8a45c',
    prefix: '4',
    numberMask: '•••• •••• •••• 2841',
  }),
  Object.freeze({
    id: 'orbis-halloway',
    network: 'ORBIS',
    issuer: 'HALLOWAY TRUST',
    tier: 'SIGNATURE',
    mark: 'ring-bar',
    base: '#5c2733',
    baseEnd: '#33161e',
    ink: '#f4e7e0',
    accent: '#d9a441',
    chip: '#d5b26a',
    prefix: '5',
    numberMask: '•••• •••• •••• 7106',
  }),
  Object.freeze({
    id: 'crest-cedarunion',
    network: 'CREST',
    issuer: 'CEDAR UNION',
    tier: 'EVERYDAY',
    mark: 'lattice',
    base: '#1f4438',
    baseEnd: '#102721',
    ink: '#eaf2ea',
    accent: '#7fc4a0',
    chip: '#c3b273',
    prefix: '6',
    numberMask: '•••• •••• •••• 9930',
  }),
  Object.freeze({
    id: 'vanta-pinnacle',
    network: 'VANTA',
    issuer: 'PINNACLE SAVINGS',
    tier: 'RESERVE',
    mark: 'keystone',
    base: '#1b1b1f',
    baseEnd: '#0a0a0c',
    ink: '#efe6d2',
    accent: '#b9974e',
    chip: '#cdb277',
    prefix: '3',
    numberMask: '•••• •••••• •4472',
  }),
  Object.freeze({
    id: 'tideline-ashgrove',
    network: 'TIDELINE',
    issuer: 'ASHGROVE MUTUAL',
    tier: 'CLASSIC',
    mark: 'wave',
    base: '#1d3a52',
    baseEnd: '#0d1f2e',
    ink: '#e4eef5',
    accent: '#59a7c9',
    chip: '#c2ab6e',
    prefix: '4',
    numberMask: '•••• •••• •••• 5518',
  }),
  // The club's own card stays in the deck. It was the ONLY card before, which
  // was the fault; it is a perfectly good thing for a member to be carrying.
  Object.freeze({
    id: 'club-member',
    network: 'MEMBER',
    issuer: null, // painted with the live club name instead
    tier: 'FAIRWAY MEMBER',
    mark: 'ring-bar',
    base: '#173f2d',
    baseEnd: '#0e2d21',
    ink: '#f8f0dc',
    accent: '#b9974e',
    chip: '#d9bd76',
    prefix: '',
    numberMask: 'MEMBER 042 718',
  }),
]);

export const DEFAULT_PAYMENT_CARD = PAYMENT_CARDS[PAYMENT_CARDS.length - 1];

/**
 * Which card a given customer carries.
 *
 * Deterministic on the customer's own identity, so a person who pays twice does
 * not change bank between visits — and so a screenshot of four customers is
 * reproducible. A non-string key falls back to the club card rather than
 * throwing, because a missing identity must never break a sale.
 */
export function paymentCardFor(key) {
  if (key == null) return DEFAULT_PAYMENT_CARD;
  const text = String(key);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return PAYMENT_CARDS[hash % PAYMENT_CARDS.length];
}
