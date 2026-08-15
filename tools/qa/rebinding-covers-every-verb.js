// ITEM 23 — "full key rebinding, in one piece."
//
// Rebinding already existed and was good as far as it went. The gap was that
// eight player-facing verbs never reached it: build mode, four panel toggles
// and the three speed keys were literal `case 'b': case 'B':` arms in main.js,
// several written out TWICE (once inside the clubhouse, once on the overview),
// so a player who rebound everything the screen offered still could not move
// build mode off B.
//
// Two things are checked, in the build:
//   COVERAGE  every key main.js still dispatches literally is either a
//             reserved key (Escape, arrows) or a build-mode-only verb. No
//             MAIN-mode verb may be reachable only by a hardcoded letter.
//   EFFECT    rebinding a verb changes the key that fires it, and the OLD key
//             stops firing it. Both halves matter: a binding that adds a key
//             without removing the old one is not a rebinding.
//
// Control: an action that was never rebound must still answer to its default.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/rebinding');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2800);

  const bindings = await page.evaluate(async () => {
    const mod = await import(new URL('src/core/keyBindings.js', document.baseURI).href);
    return {
      actions: mod.BINDABLE_ACTIONS.map((a) => ({ id: a.id, key: a.defaultKey, group: a.group })),
      defaults: mod.DEFAULT_BINDINGS,
      live: window.__fw.preferences.values.controls.bindings,
    };
  });

  // COVERAGE: what does main.js still switch on literally?
  const literal = await page.evaluate(async () => {
    const res = await fetch(new URL('src/main.js', document.baseURI).href);
    const src = await res.text();
    const found = new Set();
    const rx = /case '([a-zA-Z0-9])':/g;
    let m = rx.exec(src);
    while (m) { found.add(m[1].toLowerCase()); m = rx.exec(src); }
    return [...found].sort();
  });

  // EFFECT: rebind the build-mode verb and prove the key moved
  const effect = await page.evaluate(async () => {
    const app = window.__fw;
    const kb = await import(new URL('src/core/keyBindings.js', document.baseURI).href);
    const store = app.preferences;
    const before = { ...store.values.controls.bindings };
    const firesWith = (key) => kb.actionForKey(store.values.controls.bindings, key);
    const beforeB = firesWith('b');
    const beforeK = firesWith('k');
    store.set('controls.bindings', { ...before, buildMode: 'k' });
    const afterB = firesWith('b');
    const afterK = firesWith('k');
    store.set('controls.bindings', before);
    const restoredB = firesWith('b');
    return { beforeB, beforeK, afterB, afterK, restoredB };
  });

  // CONTROL: an untouched action still answers to its default
  const untouched = await page.evaluate(async () => {
    const app = window.__fw;
    const kb = await import(new URL('src/core/keyBindings.js', document.baseURI).href);
    return kb.actionForKey(app.preferences.values.controls.bindings, 'q');
  });

  // the keys a MAIN-mode verb may still legitimately be literal for
  const ALLOWED_LITERAL = new Set([
    // build-mode-only verbs, which have no row on the rebinding screen
    'e', 'r', 'x', 'z',
  ]);
  const strays = literal.filter((k) => !ALLOWED_LITERAL.has(k));

  const checks = {
    speedKeysAreBindable: ['speedPause', 'speedNormal', 'speedFast']
      .every((id) => bindings.actions.some((a) => a.id === id)),
    panelVerbsAreBindable: ['buildMode', 'maintenancePanel', 'groundsPanel', 'clubPanel', 'empirePanel']
      .every((id) => bindings.actions.some((a) => a.id === id)),
    noStrayLiteralVerbs: strays.length === 0,
    // rebinding moves the key...
    rebindingMovesTheKey: effect.beforeB === 'buildMode' && effect.afterK === 'buildMode',
    // ...and vacates the old one, which is the half that is easy to miss
    rebindingVacatesTheOldKey: effect.afterB === null || effect.afterB === undefined,
    restoresCleanly: effect.restoredB === 'buildMode',
    // control
    untouchedActionKeepsItsDefault: untouched === 'dirtSense',
    noPageErrors: errs.length === 0,
  };
  const out = {
    actionCount: bindings.actions.length,
    actions: bindings.actions,
    literalKeysStillInMain: literal,
    strays,
    effect,
    untouched,
    errs: errs.slice(0, 8),
    checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'rebinding.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
