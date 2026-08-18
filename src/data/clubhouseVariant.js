// WHICH CLUBHOUSE ROOM THIS SESSION DRAWS — resolved once, from more than one source.
//
// The greybox room used to be reachable only as ?clubhouse=pine-hills-v2, which meant the
// only way to look at it was a browser address bar. The packaged app has no address bar,
// so every hour spent testing the v2 room was an hour spent in Chrome — where X closes a
// tab, Shift+W reloads, and half the reported input bugs turn out to belong to the
// browser rather than the game. Testing the shipping runtime has to be possible.
//
// Three sources, highest first:
//
//   1. ?clubhouse= on the URL. Unchanged, and still first, because every QA probe in
//      tools/qa navigates by query and must keep working byte-for-byte.
//   2. --fw-clubhouse=<variant> in the renderer's argv, planted by main.cjs from its own
//      --clubhouse flag. A one-shot run that leaves nothing behind: `npm run dev --
//      --clubhouse=pine-hills-v2`.
//   3. A persisted setting, written by the Developer tab in Settings. This is the one the
//      brief asks for — pick the room once, and plain `npm run dev` boots into it until
//      you pick something else.
//
// WHY THIS IS ONE FUNCTION AND NOT THREE READS. shopLayout, clubhouse.js and courseScene
// each used to call `new URLSearchParams(location.search).get('clubhouse')` for
// themselves. Three copies of a rule agree only by luck: the moment a second source
// exists, a module that still reads only the query draws v1 geometry on v2 datums. The
// resolution lives here, the answer is computed once at module load, and everything
// downstream reads that constant.
//
// EVERY SOURCE MUST BE SYNCHRONOUS. shopLayout resolves its datums at module-eval time,
// so anything the resolver reads has to be available before the first import runs. The
// query string and localStorage are; an IPC round-trip to the main process is not, which
// is why the launch flag arrives through the renderer's argv (planted by preload before
// any page script executes) rather than by asking for it.

export const CLUBHOUSE_VARIANT_STORAGE_KEY = 'golfempire:dev:clubhouse-variant';
export const CLUBHOUSE_LAUNCH_FLAG = '--fw-clubhouse=';

// Everything clubhouse.js's presentation switch understands. 'pine-hills-v2' is the only
// entry that also moves LAYOUT datums; the rest are presentation-only and are here so the
// dev menu can send you to v1 for a side-by-side without hand-editing a URL.
export const SELECTABLE_CLUBHOUSE_VARIANTS = Object.freeze([
  'pine-hills-v2',
  // A COPY OF THE GREYBOX, on the same floor plan, where the finished Blender
  // assets get dressed in. pine-hills-v2 is the working variant and CLAUDE.md
  // says it stays grey; this is the room where raising it is allowed. It shares
  // v2's layout datums exactly (see CLUBHOUSE_LAYOUT_VARIANT in shopLayout.js),
  // so the two rooms differ only in what is drawn.
  'pine-hills-v3',
  'pine-hills',
  'modern-public',
  'mountain-lodge',
  'legacy',
]);

const known = (value) => (SELECTABLE_CLUBHOUSE_VARIANTS.includes(value) ? value : null);

// PURE, so Node can test the precedence without globals. Each source is passed in
// already-extracted: a query string, an argv array, a stored string.
export function resolveClubhouseVariantRequest({ search, argv, stored } = {}) {
  if (typeof search === 'string' && search) {
    try {
      const fromQuery = known(new URLSearchParams(search).get('clubhouse'));
      if (fromQuery) return { variant: fromQuery, source: 'query' };
    } catch { /* a malformed query is not a variant request */ }
  }
  if (Array.isArray(argv)) {
    for (const arg of argv) {
      if (typeof arg !== 'string' || !arg.startsWith(CLUBHOUSE_LAUNCH_FLAG)) continue;
      const fromFlag = known(arg.slice(CLUBHOUSE_LAUNCH_FLAG.length));
      if (fromFlag) return { variant: fromFlag, source: 'launch-flag' };
    }
  }
  const fromSetting = known(typeof stored === 'string' ? stored : null);
  if (fromSetting) return { variant: fromSetting, source: 'setting' };
  return { variant: null, source: 'default' };
}

// Collect the three sources off whatever globals exist. In Node none of them do, so the
// answer is `null` and the layout tests keep auditing the v1 numbers — the variant seam
// stays invisible to everything that does not deliberately ask for it.
export function clubhouseVariantSources(scope = globalThis) {
  let search = null;
  let argv = null;
  let stored = null;
  try { search = scope?.location?.search || null; } catch { /* no location: Node */ }
  try { argv = scope?.fairwayNative?.launchArgs || null; } catch { /* no bridge: browser QA */ }
  try { stored = scope?.localStorage?.getItem?.(CLUBHOUSE_VARIANT_STORAGE_KEY) ?? null; } catch { /* storage denied */ }
  return { search, argv, stored };
}

export function resolveClubhouseVariant(scope = globalThis) {
  return resolveClubhouseVariantRequest(clubhouseVariantSources(scope));
}

export const DEV_LAUNCH_FLAG = '--fw-dev';

// WHO GETS THE DEVELOPER TAB. A room selector is not a player setting, so it appears only
// in a development session: Electron started with --dev (i.e. `npm run dev`), or a page
// served from localhost (i.e. `node tools/serve.cjs`). A packaged build opened by a player
// is file:// with no flag and never shows it.
export function isDevSession({ argv, protocol, hostname } = {}) {
  if (Array.isArray(argv) && argv.includes(DEV_LAUNCH_FLAG)) return true;
  if (protocol === 'http:' || protocol === 'https:') {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  }
  return false;
}

export function devSessionActive(scope = globalThis) {
  let argv = null;
  let protocol = null;
  let hostname = null;
  try { argv = scope?.fairwayNative?.launchArgs || null; } catch { /* no bridge */ }
  try { protocol = scope?.location?.protocol || null; } catch { /* no location */ }
  try { hostname = scope?.location?.hostname || null; } catch { /* no location */ }
  return isDevSession({ argv, protocol, hostname });
}

// Writing the setting is a separate act from reading it, and it only ever takes effect on
// the next load — shopLayout has already frozen its datums by the time any menu exists.
// Callers are expected to say so and offer a reload; this function does not reload for
// them, because a settings panel that reloads out from under you loses unsaved state.
export function storeClubhouseVariant(variant, scope = globalThis) {
  const value = known(variant);
  try {
    if (value) scope?.localStorage?.setItem?.(CLUBHOUSE_VARIANT_STORAGE_KEY, value);
    else scope?.localStorage?.removeItem?.(CLUBHOUSE_VARIANT_STORAGE_KEY);
    return { ok: true, variant: value };
  } catch (error) {
    return { ok: false, variant: value, error };
  }
}
