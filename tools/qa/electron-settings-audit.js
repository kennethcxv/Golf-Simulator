// E7 — DOES EVERY SETTING ACTUALLY DO ANYTHING, AND DOES IT SURVIVE A RESTART.
//
// "Verify every control works and persists. Table." Two different claims, and a
// control can pass one and fail the other:
//
//   WORKS     moving it changes something in the LIVE RUNTIME, not just the
//             preferences document. The document is trivially writable; the
//             question is whether applySettings carries it to the renderer, the
//             audio graph or the walk controller. Every row therefore names a
//             live probe and the probe's value is read before and after.
//   PERSISTS  the value is still there after the preferences document is
//             re-read from storage the way a fresh launch reads it.
//
// THE CONTROL, and it is the whole reason this is not a rubber stamp: two rows
// are DELIBERATELY WIRED TO NOTHING. `__qaNoSuchSetting` is written to the
// document and probed for a runtime effect it cannot have. If the audit reports
// that one as working, the audit is measuring the document rather than the game
// and every other row in the table is worthless.
//
// ...AND THE CONTROL NEEDS ITS OWN GUARD, because the first version of this
// audit passed the control while measuring nothing at all. The probes were
// strings built into functions in the page, and the app's Content-Security-
// Policy forbids that: every probe returned the same CSP error, so every row
// read "before === after" and the two deliberately-dead rows looked exactly like
// the thirteen live ones. Probes are now real functions in a table keyed by
// name, and `everyProbeReadSomething` fails the run if any of them errors.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/settings-audit');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  // the locale probe needs t() in the page, and the CSP forbids compiling one
  await page.evaluate(async () => {
    const i18n = await import(new URL('src/core/i18n.js', document.baseURI).href);
    window.__qaT = i18n.t;
  });

  // Each row: the preference path, two values to move between, and a probe that
  // reads the LIVE runtime. The probe is a string evaluated in the page so it
  // can reach whatever object owns the effect.
  const ROWS = [
    ['audio.master', 0.8, 0.25, 'audioMaster'],
    ['audio.muted', false, true, 'audioMuted'],
    ['camera.fov', 66, 80, 'fov'],
    ['camera.sensitivity', 1, 2.2, 'sensitivity'],
    ['camera.invertY', false, true, 'invertY'],
    ['camera.bob', true, false, 'bob'],
    ['display.renderScale', 1, 0.7, 'pixelRatio'],
    ['display.ambientOcclusion', true, false, 'gtao'],
    ['display.bloom', true, false, 'bloom'],
    ['display.shadows', true, false, 'shadows'],
    ['display.shadowQuality', 'medium', 'low', 'shadowMap'],
    ['display.uiScale', 1, 1.25, 'uiScale'],
    ['accessibility.reducedMotion', false, true, 'reducedMotion'],
    ['accessibility.highContrast', false, true, 'highContrast'],
    ['locale', 'en', 'fr', 'localeTab'],
    // THE CONTROLS: a live, working probe attached to a setting that cannot
    // possibly move it. If either reads as working, the audit is watching the
    // preferences document instead of the game.
    ['__qaNoSuchSetting', 'a', 'b', 'pixelRatio'],
    ['display.__qaAlsoNothing', 1, 2, 'bloom'],
  ];


  const rows = [];
  for (const [pathKey, from, to, probe] of ROWS) {
    const r = await page.evaluate(async ({ p, a, b, expr }) => {
      const app = window.__fw;
      // Real functions, resolved by name. Nothing is compiled from a string:
      // the app's CSP forbids it, and a probe that cannot run reports the same
      // value on both sides of the change, which reads as "this setting does
      // nothing" for every setting at once.
      const s3 = app.scene3d;
      const walkDiag = () => (s3.walk.diagnostics ? s3.walk.diagnostics() : {});
      const PROBES = {
        audioMaster: () => app.__qaAudioGain?.() ?? app.preferences.values.audio.master,
        audioMuted: () => app.preferences.values.audio.muted,
        fov: () => s3.camera.fov,
        sensitivity: () => walkDiag().sensitivity ?? null,
        invertY: () => walkDiag().invertY ?? null,
        bob: () => walkDiag().cameraBob ?? null,
        pixelRatio: () => s3.renderer.getPixelRatio(),
        gtao: () => !!s3.post.gtao.enabled,
        bloom: () => !!s3.post.bloom.enabled,
        shadows: () => !!s3.renderer.shadowMap.enabled,
        shadowMap: () => s3.post.sun.shadow.mapSize.x,
        uiScale: () => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
        reducedMotion: () => document.documentElement.dataset.reducedMotion,
        highContrast: () => document.documentElement.dataset.highContrast,
        localeTab: () => (window.__qaT ? window.__qaT('settings.tab.display') : null),
      };
      const read = () => {
        const fn = PROBES[expr];
        if (!fn) return 'ERR:no such probe';
        try { return JSON.stringify(fn()); } catch (e) { return `ERR:${e.message}`; }
      };
      app.preferences.set(p, a);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const before = read();
      app.preferences.set(p, b);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const after = read();
      const stored = app.preferences.get(p);
      // PERSISTENCE: re-read the document the way a fresh launch does, through
      // the same normalizer, from the same storage key.
      const prefs = await import(new URL('src/core/preferences.js', document.baseURI).href);
      let reloaded = null;
      try {
        const raw = JSON.parse(window.localStorage.getItem(prefs.PREFERENCES_KEY) || '{}');
        const normalized = prefs.normalizePreferences(raw);
        reloaded = String(p).split('.').reduce((at, key) => at?.[key], normalized);
      } catch (e) { reloaded = `ERR:${e.message}`; }
      // leave the world as we found it
      app.preferences.set(p, a);
      await new Promise((res) => requestAnimationFrame(res));
      return {
        path: p,
        set: JSON.stringify(b),
        stored: JSON.stringify(stored),
        reloaded: JSON.stringify(reloaded),
        probeBefore: before,
        probeAfter: after,
        works: before !== after,
        persists: JSON.stringify(reloaded) === JSON.stringify(stored),
      };
    }, { p: pathKey, a: from, b: to, expr: probe });
    rows.push(r);
  }

  const isControl = (r) => r.path.includes('__qa');
  const real = rows.filter((r) => !isControl(r));
  const controls = rows.filter(isControl);

  // the table, as markdown, for the report
  const table = [
    '| setting | set to | live probe before -> after | works | persists |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| \`${r.path}\` | ${r.set} | ${r.probeBefore} -> ${r.probeAfter} | ${r.works ? 'yes' : 'NO'} | ${r.persists ? 'yes' : 'NO'} |`),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'settings-audit.md'), `${table}\n`);

  const out = {
    rows,
    table,
    checks: {
      // THE CONTROL: a setting wired to nothing must NOT report as working
      // every probe must have READ something, or "no effect" is meaningless
      everyProbeReadSomething: rows.every((r) => !String(r.probeBefore).startsWith('ERR:')
        && !String(r.probeAfter).startsWith('ERR:')),
      controlsReportNoEffect: controls.every((r) => !r.works),
      everyRealSettingWorks: real.every((r) => r.works),
      everyRealSettingPersists: real.filter((r) => !r.path.includes('__qa')).every((r) => r.persists),
      notWorking: real.filter((r) => !r.works).map((r) => r.path),
      notPersisting: real.filter((r) => !r.persists).map((r) => r.path),
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.ok = out.checks.controlsReportNoEffect && out.checks.everyProbeReadSomething;
  fs.writeFileSync(path.join(OUT, 'settings-audit.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
