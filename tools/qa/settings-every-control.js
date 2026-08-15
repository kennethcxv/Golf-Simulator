// ITEM 19 — "Verify every settings control in the build. Table: works y/n,
// persists y/n."
//
// EVERY control, not a chosen five. The panel builds its rows from paths
// (audio.master, camera.fov, display.bloom ...), so the list is discovered from
// the panel itself rather than typed out here — a hand-written list silently
// stops covering a control the moment someone adds one.
//
// works    = writing the preference changes the STORED value, and the panel
//            reads the new value back. A control that moves and is ignored is
//            not working, so this reads the store, not the widget.
// persists = the value survives a full reload from disk with no interaction.
//
// Negative controls, both needed:
//   - a path that does not exist must report works:false, or "works" is just
//     "the setter did not throw";
//   - every value is set to something DIFFERENT from the current one, and the
//     driver asserts it differed, so a no-op write cannot pass as a success.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/settings-every');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2600);

  // Discover the controls from the panel's own source, so the list cannot drift.
  const controls = await page.evaluate(async () => {
    const res = await fetch(new URL('src/ui/settingsPanel.js', document.baseURI).href);
    const src = await res.text();
    const found = [];
    const rx = /\b(slider|toggle|choice)\(\s*[^,]+,\s*[^,]+,\s*'([\w.]+)'/g;
    let m = rx.exec(src);
    while (m) { found.push({ kind: m[1], path: m[2] }); m = rx.exec(src); }
    return found;
  });

  const readAll = () => page.evaluate(async (paths) => {
    // THE LIVE INSTANCE, not the module. preferences.js exports makePreferences,
    // a factory - importing it and calling .get() on the module namespace threw
    // "store.get is not a function", and a fresh instance would have measured a
    // store the game is not using anyway.
    const store = window.__fw.preferences;
    const out = {};
    for (const p of paths) {
      try {
        out[p] = typeof store.get === 'function'
          ? store.get(p)
          : p.split('.').reduce((at, k) => (at == null ? at : at[k]), store.values);
      } catch { out[p] = '__ERR__'; }
    }
    return out;
  }, controls.map((c) => c.path));

  const before = await readAll();

  // pick a genuinely different value for each control
  const applied = await page.evaluate(async (list) => {
    const store = window.__fw.preferences;
    const rows = [];
    for (const { kind, path: p } of list) {
      const read = (key) => (typeof store.get === 'function'
        ? store.get(key)
        : key.split('.').reduce((at, k) => (at == null ? at : at[k]), store.values));
      const was = read(p);
      let want;
      if (typeof was === 'boolean') want = !was;
      else if (typeof was === 'string') want = was === 'hold' ? 'toggle' : 'hold';
      else if (typeof was === 'number') {
        // DISCOVER THE RANGE by asking the store, not by parsing the panel.
        // Regexing min/max out of settingsPanel.js kept returning null, and a
        // null range means the driver writes 0.5 into a field measured in
        // DEGREES. normalizePreferences clamps that straight back, and the
        // table then reports "camera.fov works: n" about a control that works
        // perfectly. Push past both ends and see where it lands.
        store.set(p, 1e9);
        const hi = read(p);
        store.set(p, -1e9);
        const lo = read(p);
        store.set(p, was);
        const a = lo + (hi - lo) * 0.25;
        const b = lo + (hi - lo) * 0.75;
        want = Math.abs(was - a) > Math.abs(was - b) ? a : b;
        want = Math.round(want * 1000) / 1000;
        rows.discovered = rows.discovered || {};
        rows.discovered[p] = [lo, hi];
      } else want = was;
      let threw = null;
      try { store.set(p, want); } catch (e) { threw = String(e.message || e); }
      const now = read(p);
      rows.push({
        path: p, kind, range: rows.discovered?.[p] ?? null, was, want, now, threw,
        differed: JSON.stringify(was) !== JSON.stringify(want),
        works: JSON.stringify(now) === JSON.stringify(want),
      });
    }
    return rows;
  }, controls);

  // NEGATIVE CONTROL: a path that is not a setting must not report success
  const bogus = await page.evaluate(async () => {
    const store = window.__fw.preferences;
    try { store.set('nonsense.notASetting', 12345); } catch { /* fine */ }
    const back = typeof store.get === 'function'
      ? store.get('nonsense.notASetting')
      : store.values?.nonsense?.notASetting;
    return { readBack: back === undefined ? null : back };
  });

  await page.screenshot({ path: path.join(OUT, '01-after-changes.png') });

  // ---- persistence: reload from disk, touch nothing -----------------------
  await page.reload();
  await page.waitForFunction(() => !!window.__fw, null, { timeout: 180000 });
  await page.waitForTimeout(4000);
  const after = await readAll();

  const rows = applied.map((r) => ({
    ...r,
    persisted: JSON.stringify(after[r.path]) === JSON.stringify(r.want),
    afterReload: after[r.path],
  }));

  const worksCount = rows.filter((r) => r.works).length;
  const persistCount = rows.filter((r) => r.persisted).length;

  const checks = {
    discoveredControls: controls.length >= 12,
    everyValueActuallyChanged: rows.every((r) => r.differed),
    // the control: a made-up path must not read back as if it were a setting
    bogusPathRejected: bogus.readBack === null || bogus.readBack === undefined,
    everyControlWorks: rows.every((r) => r.works),
    everyControlPersists: rows.every((r) => r.persisted),
    noPageErrors: errs.length === 0,
  };
  const out = {
    controlCount: controls.length,
    worksCount,
    persistCount,
    bogus,
    table: rows.map((r) => ({
      path: r.path, kind: r.kind, range: r.range, was: r.was, set: r.want,
      works: r.works ? 'y' : 'n', persists: r.persisted ? 'y' : 'n',
      afterReload: r.afterReload, threw: r.threw,
    })),
    before,
    errs: errs.slice(0, 8),
    checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'settings-every.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
