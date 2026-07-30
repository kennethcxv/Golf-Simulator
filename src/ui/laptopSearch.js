// LAPTOP SEARCH — the page map, the ranking, and the filter set.
//
// Extracted from laptop.js so all three can be tested without a browser. The
// INDEX still lives in laptop.js because it reads live state (unlock tier, what
// you own, who works here); what lives here is everything with a decision in it:
// where each page is, what a query matches, and how the matches are ordered.
//
// Reported 2026-07-29: "Follow Apple's Settings search behaviour specifically:
// results show the PAGE PATH the thing lives on; selecting a result NAVIGATES to
// that page and section, with the match highlighted or scrolled to; live results
// as you type; exact and prefix matches outrank substring matches; aliases work."
//
// The alias requirement is the oldest of the five: the game says "clubhouse kit"
// over a broken fitting and the catalogue says "Clubhouse repair components".
// Searching names alone cannot bridge that, so entries carry explicit keywords
// and an exact keyword hit outranks a substring buried in a description.

// --- THE PAGE MAP — one table, and the sidebar is built FROM it ----------------------
//
// This used to be two tables that agreed by hand: NAV in laptop.js for the sidebar,
// and a per-page `tabs` array inside each page function. A search result has to name
// the place it lives ("Pro Shop › Orders & Suppliers"), and a third hand-maintained
// copy of those labels would be wrong the first time a tab was renamed. So the nav
// and the tab bars now READ this, and the path a result displays is derived from the
// same rows the tab bar draws.
export const LAPTOP_SECTIONS = Object.freeze([
  { page: 'home', label: 'Home', icon: 'home', tabs: Object.freeze([]) },
  { page: 'reservations', label: 'Bookings', icon: 'calendar', tabs: Object.freeze([]) },
  {
    page: 'shop',
    label: 'Pro Shop',
    icon: 'bag',
    tabs: Object.freeze([
      Object.freeze(['stock', 'Inventory']),
      Object.freeze(['order', 'Orders & Suppliers']),
      Object.freeze(['cart', 'Cart']),
      Object.freeze(['prices', 'Pricing']),
      Object.freeze(['deliveries', 'Deliveries']),
    ]),
  },
  {
    page: 'course',
    label: 'Course',
    icon: 'flag',
    tabs: Object.freeze([
      Object.freeze(['overview', 'Overview']),
      Object.freeze(['fleet', 'Cart Fleet']),
      Object.freeze(['tasks', 'Tasks']),
      Object.freeze(['holes', 'Holes']),
    ]),
  },
  {
    page: 'upgrades',
    label: 'Upgrades',
    icon: 'up',
    tabs: Object.freeze([
      Object.freeze(['course', 'Course']),
      Object.freeze(['clubhouse', 'Renovations']),
      Object.freeze(['staff', 'Staff']),
      Object.freeze(['equipment', 'Equipment']),
    ]),
  },
  {
    page: 'finances',
    label: 'Business',
    icon: 'dollar',
    tabs: Object.freeze([
      Object.freeze(['finances', 'Finances']),
      Object.freeze(['reviews', 'Reviews']),
      Object.freeze(['memberships', 'Memberships']),
      Object.freeze(['marketing', 'Marketing']),
    ]),
  },
  {
    page: 'settings',
    label: 'Settings',
    icon: 'gear',
    tabs: Object.freeze([
      Object.freeze(['general', 'General']),
      Object.freeze(['checkout', 'Checkout']),
    ]),
  },
]);

const SECTION_BY_PAGE = new Map(LAPTOP_SECTIONS.map((s) => [s.page, s]));

/** The sidebar, derived. */
export function navEntries() {
  return LAPTOP_SECTIONS.map(({ page, label, icon }) => ({ id: page, label, icon }));
}

/** The tab bar for a page, derived. Pages with no tabs return []. */
export function tabsOf(page) {
  return (SECTION_BY_PAGE.get(page)?.tabs || []).map((pair) => [pair[0], pair[1]]);
}

export function pageLabel(page) {
  return SECTION_BY_PAGE.get(page)?.label || String(page || '');
}

export function tabLabel(page, tab) {
  if (!tab) return null;
  const found = (SECTION_BY_PAGE.get(page)?.tabs || []).find((pair) => pair[0] === tab);
  return found ? found[1] : null;
}

/** ['Pro Shop', 'Orders & Suppliers'] — the crumbs a result row displays. */
export function pagePathOf(page, tab = null, extra = null) {
  const out = [];
  const top = SECTION_BY_PAGE.get(page);
  out.push(top ? top.label : String(page || ''));
  const t = tabLabel(page, tab);
  if (t) out.push(t);
  if (extra) out.push(String(extra));
  return out;
}

export const PATH_SEPARATOR = ' › ';

export function formatPagePath(page, tab = null, extra = null) {
  return pagePathOf(page, tab, extra).join(PATH_SEPARATOR);
}

// --- RANKING ------------------------------------------------------------------------
//
// "Exact and prefix matches outrank substring matches." Six tiers of that, plus one
// the brief did not ask for and the content demanded: a match at a WORD boundary
// inside the label. Typing "kit" against "Commercial shelving kit" is a prefix of a
// word even though it is not a prefix of the string, and it deserves to beat "kit"
// buried mid-word. Without that tier, word-start hits and mid-word hits tie and the
// order falls to the alphabet.
//
// The page PATH is deliberately NOT scored. All 114 products live at
// "Pro Shop › Orders & Suppliers", so scoring the path would make typing "pro shop"
// return the entire catalogue instead of the page the player asked for.
export const SEARCH_SCORE = Object.freeze({
  EXACT_LABEL: 100,
  EXACT_KEYWORD: 92,
  LABEL_PREFIX: 84,
  KEYWORD_PREFIX: 76,
  LABEL_WORD_PREFIX: 68,
  LABEL_SUBSTRING: 56,
  KEYWORD_SUBSTRING: 40,
  DETAIL_SUBSTRING: 20,
});

export const SEARCH_RESULT_LIMIT = 60;

// A word start is the string start or anything after a non-alphanumeric run.
const WORD_STARTS = /[^a-z0-9]+/;

function labelWordPrefix(label, needle) {
  if (!needle) return false;
  for (const word of label.split(WORD_STARTS)) {
    if (word && word.startsWith(needle)) return true;
  }
  return false;
}

function scoreOneNeedle(entry, needle) {
  const label = String(entry.label || '').toLowerCase();
  const keywords = (entry.keywords || []).map((k) => String(k).toLowerCase());
  const detail = String(entry.detail || '').toLowerCase();
  if (label === needle) return SEARCH_SCORE.EXACT_LABEL;
  if (keywords.includes(needle)) return SEARCH_SCORE.EXACT_KEYWORD;
  if (label.startsWith(needle)) return SEARCH_SCORE.LABEL_PREFIX;
  if (keywords.some((k) => k.startsWith(needle))) return SEARCH_SCORE.KEYWORD_PREFIX;
  if (labelWordPrefix(label, needle)) return SEARCH_SCORE.LABEL_WORD_PREFIX;
  if (label.includes(needle)) return SEARCH_SCORE.LABEL_SUBSTRING;
  if (keywords.some((k) => k.includes(needle))) return SEARCH_SCORE.KEYWORD_SUBSTRING;
  if (detail.includes(needle)) return SEARCH_SCORE.DETAIL_SUBSTRING;
  return 0;
}

/**
 * How well one entry answers one query. The whole phrase is tried first; if it
 * misses, every WORD of the query must hit something (AND, not OR) and the entry
 * scores its weakest word, discounted so a whole-phrase hit always wins.
 *
 * The discount is what makes "clubhouse kit" work both ways round: the catalogue
 * entry carries it as a literal alias (exact keyword, 92) and any other entry that
 * merely happens to contain both words scores at most 90 and sorts below it.
 */
export function scoreSearchEntry(entry, query) {
  if (!entry) return 0;
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return 0;
  const phrase = scoreOneNeedle(entry, needle);
  const tokens = needle.split(WORD_STARTS).filter(Boolean);
  if (tokens.length < 2) return phrase;
  let weakest = Infinity;
  for (const token of tokens) {
    const s = scoreOneNeedle(entry, token);
    if (!s) { weakest = 0; break; }
    if (s < weakest) weakest = s;
  }
  const tokenScore = weakest && weakest !== Infinity ? Math.max(1, Math.round(weakest * 0.9)) : 0;
  return Math.max(phrase, tokenScore);
}

/**
 * Ranked hits. `filter` is a group id from SEARCH_GROUPS ('all' or absent means
 * every group). Ties break alphabetically so the same query always returns the
 * same order — a list that reshuffles between keystrokes cannot be clicked.
 */
export function rankSearchEntries(entries, query, opts = {}) {
  const { limit = SEARCH_RESULT_LIMIT, filter = 'all' } = typeof opts === 'number' ? { limit: opts } : opts;
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const scored = [];
  for (const entry of entries || []) {
    if (filter && filter !== 'all' && groupOfKind(entry.kind) !== filter) continue;
    const score = scoreSearchEntry(entry, needle);
    if (score) scored.push({ ...entry, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.label).localeCompare(String(b.label)));
  return scored.slice(0, limit);
}

// --- FILTERS ------------------------------------------------------------------------
//
// "Propose the filter set from what the index actually contains rather than guessing."
//
// So: filtering is by GROUP, groups are defined over the kinds the index emits, and
// searchGroups() below only returns a chip for a group the live index actually
// populated. Twelve kind-chips would not fit the 1024 px lid and most would be empty
// on day one; eight groups do fit, and a group with nothing in it never appears.
export const SEARCH_GROUPS = Object.freeze([
  { id: 'pages', label: 'Pages', kinds: Object.freeze(['Page']) },
  { id: 'catalogue', label: 'Catalogue', kinds: Object.freeze(['Product']) },
  { id: 'investments', label: 'Upgrades', kinds: Object.freeze(['Upgrade', 'Amenity', 'Material', 'Equipment']) },
  { id: 'course', label: 'Course', kinds: Object.freeze(['Hole', 'Turf']) },
  { id: 'bookings', label: 'Bookings', kinds: Object.freeze(['Booking', 'Customer']) },
  { id: 'people', label: 'Staff', kinds: Object.freeze(['Staff', 'Candidate']) },
  { id: 'money', label: 'Money', kinds: Object.freeze(['Order', 'Delivery', 'Ledger', 'Property']) },
  { id: 'settings', label: 'Settings', kinds: Object.freeze(['Setting']) },
]);

const GROUP_OF_KIND = new Map();
for (const group of SEARCH_GROUPS) for (const kind of group.kinds) GROUP_OF_KIND.set(kind, group.id);

export function groupOfKind(kind) {
  return GROUP_OF_KIND.get(kind) || 'other';
}

/**
 * The chips to draw, with live counts. Only groups the index populated appear, and
 * the count is the number of MATCHES when a query is supplied — a filter chip that
 * claims 40 rows and then shows none is worse than no chip.
 */
export function searchGroups(entries, query = null) {
  const counts = new Map();
  const needle = String(query || '').trim();
  for (const entry of entries || []) {
    if (needle && !scoreSearchEntry(entry, needle)) continue;
    const id = groupOfKind(entry.kind);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const out = [{ id: 'all', label: 'All', count: total }];
  for (const group of SEARCH_GROUPS) {
    const count = counts.get(group.id) || 0;
    if (count > 0) out.push({ id: group.id, label: group.label, count });
  }
  return out;
}
