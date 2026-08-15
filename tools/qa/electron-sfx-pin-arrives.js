// PLAYTEST 4, ITEM 1 — DOES THE OWNER'S PICK REACH THE BANK AT BOOT?
//
// The audition run found every family reporting `current: null` on a fresh boot,
// including `drawerOpen`, whose winning recording still exists. If no pin is
// applied then the cue draws at random across everything it has, and the drawer
// the owner chose is one of four things he might hear. That is the "the check
// passed and the game did not" shape, so this driver reads the chain end to end:
//
//   DEFAULT_PREFERENCES.audio.sfx   what the code ships
//   preferences.values.audio.sfx    what normalisation left of it
//   localStorage                    what the profile on disk actually holds
//   sfxFamilies().current           what the bank is pinned to
//
// A single mismatch in that chain is the whole defect, and reading only the ends
// would say "the pin is missing" without saying where it was dropped.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-sfx-pin-arrives.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/sfx-pin');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  out.chain = await page.evaluate(async () => {
    const app = window.__fw;
    const prefs = app.preferences;
    let stored = null;
    try {
      const raw = window.localStorage.getItem('golf-empire:preferences')
        || window.localStorage.getItem('golfEmpire.preferences');
      stored = raw ? JSON.parse(raw)?.audio?.sfx ?? null : null;
    } catch { stored = 'unreadable'; }
    const storageKeys = Object.keys(window.localStorage).filter((k) => /pref/i.test(k));
    const mod = await import('./src/core/preferences.js').catch(() => null);
    return {
      shippedDefault: mod?.DEFAULT_PREFERENCES?.audio?.sfx ?? '(module not importable here)',
      afterNormalise: prefs?.values?.audio?.sfx ?? null,
      musicTrack: prefs?.values?.audio?.musicTrack ?? null,
      storageKeys,
      stored,
      bankPins: (app.audio?.sfxFamilies?.() || []).map((f) => `${f.family}=${f.current ?? 'NONE'}`),
    };
  });
  console.log('CHAIN', JSON.stringify(out.chain, null, 2));

  // NEGATIVE CONTROL for the reader itself: set a pin through the same public
  // call the settings panel uses, and require every link in the chain to move.
  // If the reader cannot see a pin that IS there, its "NONE" means nothing.
  out.control = await page.evaluate(async () => {
    const app = window.__fw;
    app.preferences.set('audio.sfx', { ...(app.preferences.get('audio.sfx') || {}), drawerOpen: 'wood-deep' });
    app.audio.sfxSetFamilyOption('drawerOpen', 'wood-deep');
    await new Promise((r) => setTimeout(r, 200));
    return {
      afterNormalise: app.preferences.values.audio.sfx,
      bankPins: (app.audio.sfxFamilies() || []).map((f) => `${f.family}=${f.current ?? 'NONE'}`),
    };
  });
  console.log('CONTROL(set a pin)', JSON.stringify(out.control, null, 2));

  fs.writeFileSync(path.join(OUT, 'sfx-pin.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
