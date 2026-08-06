// THE GREYBOX ROOM MUST BE REACHABLE WITHOUT AN ADDRESS BAR.
//
// Reported 2026-07-29: "I am only in a browser because Electron gives me no way to reach
// ?clubhouse=pine-hills-v2." Testing in Chrome means the browser eats keys — X closes a
// tab, Shift+W reloads — and those symptoms get reported as game bugs. The fix is a
// resolver with three sources; these tests pin its precedence, the wiring that carries
// each source, and the two invariants that make the variant seam safe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CLUBHOUSE_LAUNCH_FLAG,
  CLUBHOUSE_VARIANT_STORAGE_KEY,
  DEV_LAUNCH_FLAG,
  SELECTABLE_CLUBHOUSE_VARIANTS,
  clubhouseVariantSources,
  isDevSession,
  resolveClubhouseVariant,
  resolveClubhouseVariantRequest,
  storeClubhouseVariant,
} from '../src/data/clubhouseVariant.js';
import { CLUBHOUSE_LAYOUT_VARIANT, CLUBHOUSE_VARIANT_REQUEST } from '../src/data/shopLayout.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// --- precedence ------------------------------------------------------------------

test('the URL query outranks every other source', () => {
  const r = resolveClubhouseVariantRequest({
    search: '?clubhouse=pine-hills-v2',
    argv: ['--fw-clubhouse=legacy'],
    stored: 'mountain-lodge',
  });
  assert.equal(r.variant, 'pine-hills-v2');
  assert.equal(r.source, 'query');
});

test('the launch flag is used when there is no query', () => {
  const r = resolveClubhouseVariantRequest({
    search: '',
    argv: ['--fw-dev', '--fw-clubhouse=pine-hills-v2'],
    stored: 'legacy',
  });
  assert.equal(r.variant, 'pine-hills-v2');
  assert.equal(r.source, 'launch-flag');
});

test('the persisted setting is used when nothing else asks - the case the brief needs', () => {
  // This is the whole point: plain `npm run dev`, no query, no flag.
  const r = resolveClubhouseVariantRequest({ search: '', argv: [], stored: 'pine-hills-v2' });
  assert.equal(r.variant, 'pine-hills-v2');
  assert.equal(r.source, 'setting');
});

test('no source means no variant', () => {
  const r = resolveClubhouseVariantRequest();
  assert.equal(r.variant, null);
  assert.equal(r.source, 'default');
});

test('an unknown name is refused from every source', () => {
  for (const sources of [
    { search: '?clubhouse=pine-hills-v3' },
    { argv: ['--fw-clubhouse=../../etc/passwd'] },
    { stored: 'pine-hills-v2 ' }, // trailing space: a near-miss must not resolve
    { stored: '{"variant":"pine-hills-v2"}' },
  ]) {
    const r = resolveClubhouseVariantRequest(sources);
    assert.equal(r.variant, null, `${JSON.stringify(sources)} must not resolve`);
  }
});

test('a query that is not a variant request falls through to the lower sources', () => {
  // ?scene=shed is a real entry point. It must not shadow the saved room.
  const r = resolveClubhouseVariantRequest({ search: '?scene=shed', stored: 'pine-hills-v2' });
  assert.equal(r.variant, 'pine-hills-v2');
  assert.equal(r.source, 'setting');
});

// --- the two invariants that keep the seam safe ----------------------------------

test('in Node nothing asks, so the layout datums stay v1', () => {
  // Every layout test in the suite audits the v1 numbers. If this ever resolves to a
  // variant, those tests start measuring a room they were not written against.
  assert.equal(CLUBHOUSE_VARIANT_REQUEST.variant, null);
  assert.equal(CLUBHOUSE_VARIANT_REQUEST.source, 'default');
  assert.equal(CLUBHOUSE_LAYOUT_VARIANT, null);
});

test('presentation-only variants never move layout datums', () => {
  // pine-hills-v2 is the ONLY entry that shifts coordinates. Selecting 'legacy' from the
  // dev menu must change what draws, not where things are — CLUBHOUSE_LAYOUT_VARIANT is
  // what shopLayout branches on, and it is derived, not the raw request.
  const layoutSeam = read('../src/data/shopLayout.js');
  assert.match(
    layoutSeam,
    /CLUBHOUSE_LAYOUT_VARIANT = CLUBHOUSE_VARIANT_REQUEST\.variant === 'pine-hills-v2'/,
  );
  for (const id of SELECTABLE_CLUBHOUSE_VARIANTS) {
    const r = resolveClubhouseVariantRequest({ stored: id });
    assert.equal(r.variant, id);
  }
});

test('the layout seam resolves through the shared resolver, not its own query read', () => {
  // Three modules used to each read location.search for themselves. The moment a second
  // source existed, any module still reading only the query would draw v1 geometry on v2
  // datums. Pin the single call, and pin the absence of the old duplicates.
  const layoutSeam = read('../src/data/shopLayout.js');
  assert.match(layoutSeam, /import \{ resolveClubhouseVariant \} from '\.\/clubhouseVariant\.js'/);
  assert.match(layoutSeam, /CLUBHOUSE_VARIANT_REQUEST = Object\.freeze\(resolveClubhouseVariant\(\)\)/);
  for (const file of ['../src/data/shopLayout.js', '../src/render3d/clubhouse.js', '../src/render3d/courseScene.js']) {
    assert.doesNotMatch(
      read(file),
      /URLSearchParams\((?:window\.)?location\.search\)\.get\('clubhouse'\)/,
      `${file} still reads the clubhouse query directly`,
    );
  }
});

// --- source collection off globals ------------------------------------------------

test('sources are collected from the globals each one actually lives on', () => {
  const scope = {
    location: { search: '?clubhouse=legacy' },
    fairwayNative: { launchArgs: ['--fw-clubhouse=pine-hills'] },
    localStorage: { getItem: (k) => (k === CLUBHOUSE_VARIANT_STORAGE_KEY ? 'pine-hills-v2' : null) },
  };
  assert.deepEqual(clubhouseVariantSources(scope), {
    search: '?clubhouse=legacy',
    argv: ['--fw-clubhouse=pine-hills'],
    stored: 'pine-hills-v2',
  });
  assert.equal(resolveClubhouseVariant(scope).variant, 'legacy');
});

test('a storage that throws does not take the resolver down with it', () => {
  // Private-mode browsers and blocked file:// origins throw on getItem. The room falls
  // back; the game still boots.
  const scope = {
    location: { search: '' },
    localStorage: { getItem() { throw new Error('storage denied'); } },
  };
  assert.equal(resolveClubhouseVariant(scope).variant, null);
});

test('storing a room writes the key, and clearing it removes the key', () => {
  const data = new Map();
  const scope = {
    localStorage: {
      setItem: (k, v) => data.set(k, v),
      removeItem: (k) => data.delete(k),
    },
  };
  assert.deepEqual(storeClubhouseVariant('pine-hills-v2', scope), { ok: true, variant: 'pine-hills-v2' });
  assert.equal(data.get(CLUBHOUSE_VARIANT_STORAGE_KEY), 'pine-hills-v2');
  storeClubhouseVariant(null, scope);
  assert.equal(data.has(CLUBHOUSE_VARIANT_STORAGE_KEY), false);
  // An unknown name clears rather than persisting junk that later reads must re-reject.
  storeClubhouseVariant('pine-hills-v2', scope);
  storeClubhouseVariant('nonsense', scope);
  assert.equal(data.has(CLUBHOUSE_VARIANT_STORAGE_KEY), false);
});

test('a blocked write is reported rather than silently swallowed', () => {
  const scope = { localStorage: { setItem() { throw new Error('nope'); } } };
  const result = storeClubhouseVariant('pine-hills-v2', scope);
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

// --- who sees the Developer tab ---------------------------------------------------

test('the Developer tab is a development surface, not a player one', () => {
  // Yes: Electron with --dev, and a localhost dev server.
  assert.equal(isDevSession({ argv: [DEV_LAUNCH_FLAG] }), true);
  assert.equal(isDevSession({ protocol: 'http:', hostname: 'localhost' }), true);
  assert.equal(isDevSession({ protocol: 'http:', hostname: '127.0.0.1' }), true);
  // No: a packaged build a player opened, and anything hosted.
  assert.equal(isDevSession({ argv: [], protocol: 'file:', hostname: '' }), false);
  assert.equal(isDevSession({ protocol: 'https:', hostname: 'golfempire.example.com' }), false);
  assert.equal(isDevSession({}), false);
});

// --- the wiring that carries the launch flag -------------------------------------

test('main.cjs forwards a validated --clubhouse into renderer argv', () => {
  const main = read('../main.cjs');
  assert.match(main, /--clubhouse=/);
  assert.match(main, /additionalArguments: rendererArguments/);
  // Validated in the main process too, so only known names cross the boundary.
  assert.match(main, /SELECTABLE_CLUBHOUSE_VARIANTS\.includes\(value\)/);
  assert.match(main, /`--fw-clubhouse=\$\{requestedClubhouse\}`/);
  assert.match(main, /DEV \? \['--fw-dev'\] : \[\]/);
});

test('preload exposes launchArgs synchronously, filtered to the planted flags', () => {
  // It has to be a preload global rather than an IPC call: shopLayout freezes its datums
  // at module-eval time and cannot await anything.
  const preload = read('../preload.cjs');
  assert.match(preload, /FORWARDED_FLAG_PREFIXES = \['--fw-dev', '--fw-clubhouse='\]/);
  assert.match(preload, /process\.argv/);
  // Frozen copy — the live process object must not reach the page.
  assert.match(preload, /Object\.freeze\(/);
  // EXPOSED, not merely declared. Matching /launchArgs/ anywhere in the file passed with
  // the key deleted from exposeInMainWorld, because the const above it still existed —
  // a computed value nothing can read is the same as no value at all.
  assert.match(
    preload,
    /exposeInMainWorld\('fairwayNative', \{\s*launchArgs,/,
    'launchArgs is declared but not exposed on the bridge',
  );
});

test('the flag names the renderer reads are the flag names the wiring writes', () => {
  // Two files spell these; a rename in one is a silent no-op, which is exactly how a
  // launch flag ends up doing nothing.
  assert.equal(CLUBHOUSE_LAUNCH_FLAG, '--fw-clubhouse=');
  assert.equal(DEV_LAUNCH_FLAG, '--fw-dev');
  assert.ok(read('../main.cjs').includes('--fw-clubhouse='));
  assert.ok(read('../main.cjs').includes('--fw-dev'));
  assert.ok(read('../preload.cjs').includes('--fw-clubhouse='));
  assert.ok(read('../preload.cjs').includes('--fw-dev'));
});

test('the Developer tab is wired into the settings panel', () => {
  const panel = read('../src/ui/settingsPanel.js');
  assert.match(panel, /devSessionActive\(\) \? \{ developer: developerPage \} : \{\}/);
  assert.match(panel, /storeClubhouseVariant/);
  // The tab strip and the arrow-key handler must be driven from the same key list, or
  // the conditional tab exists in one and not the other. Q3 moved the strip into
  // buildTabs() so a language change can redraw it; the INTENT is unchanged and is
  // what this pins - the buttons still come from Object.keys(pages).
  assert.match(panel, /function buildTabs\(\)/);
  assert.match(panel, /tabs\.replaceChildren\(\.\.\.Object\.keys\(pages\)\.map\(/);
  // and a language change rebuilds it, or the strip keeps the language just left
  assert.match(panel, /onLocaleChange\(\(\) => \{ buildTabs\(\); render\(\); \}\)/);
});
