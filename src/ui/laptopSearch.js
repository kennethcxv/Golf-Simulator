// LAPTOP SEARCH — ranking, extracted so it can be tested without a browser.
//
// The index itself stays in laptop.js because it depends on live state (unlock
// tier, what you already own). What lives here is the part with a decision in
// it: given entries and a query, which come back and in what order.
//
// The requirement that shaped it: "the clubhouse kit should be findable by
// typing 'kit'". The item is called "Clubhouse repair components" in the
// catalogue and "clubhouse kit" in the prompt over a broken fitting — the game
// has two names for one thing. Searching only names cannot bridge that, so
// entries carry explicit keywords and an exact keyword hit outranks a substring
// buried in a description.

export const SEARCH_SCORE = Object.freeze({
  EXACT_LABEL: 100,
  EXACT_KEYWORD: 90,
  LABEL_PREFIX: 80,
  LABEL_SUBSTRING: 60,
  KEYWORD_SUBSTRING: 40,
  DETAIL_SUBSTRING: 20,
});

export const SEARCH_RESULT_LIMIT = 40;

export function scoreSearchEntry(entry, needle) {
  if (!entry || !needle) return 0;
  const label = String(entry.label || '').toLowerCase();
  const keywords = (entry.keywords || []).map((k) => String(k).toLowerCase());
  const detail = String(entry.detail || '').toLowerCase();
  if (label === needle) return SEARCH_SCORE.EXACT_LABEL;
  if (keywords.includes(needle)) return SEARCH_SCORE.EXACT_KEYWORD;
  if (label.startsWith(needle)) return SEARCH_SCORE.LABEL_PREFIX;
  if (label.includes(needle)) return SEARCH_SCORE.LABEL_SUBSTRING;
  if (keywords.some((k) => k.includes(needle))) return SEARCH_SCORE.KEYWORD_SUBSTRING;
  if (detail.includes(needle)) return SEARCH_SCORE.DETAIL_SUBSTRING;
  return 0;
}

export function rankSearchEntries(entries, query, limit = SEARCH_RESULT_LIMIT) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const scored = [];
  for (const entry of entries || []) {
    const score = scoreSearchEntry(entry, needle);
    if (score) scored.push({ ...entry, score });
  }
  // Ties broken alphabetically so the same query always returns the same order —
  // a result list that reshuffles between keystrokes is unusable.
  scored.sort((a, b) => b.score - a.score || String(a.label).localeCompare(String(b.label)));
  return scored.slice(0, limit);
}
