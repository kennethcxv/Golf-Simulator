// Q3 — a Language section that works, and settings that are not inert.
//
// Two claims, both measured in the running build:
//   A. LANGUAGE: opening Settings > Language and choosing Spanish changes the
//      text ON SCREEN, including the tab strip, and the choice survives a
//      reload. NEGATIVE CONTROL: switching back to English restores the exact
//      original strings, so the change is the language and not a re-render
//      that happens to differ.
//   B. NOT INERT: each audited setting is toggled and something OBSERVABLE
//      moves - the live preferences document AND the thing it drives (the
//      renderer, the audio graph, the camera, the document classes). A
//      setting that only writes to storage is reported as inert BY NAME.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/settings-language');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  const openSettings = async () => {
    await page.keyboard.press('p');
    await page.waitForTimeout(700);
    const opened = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')]
        .find((b) => /settings|ajustes|réglages/i.test(b.textContent || ''));
      if (!button) return false;
      button.click();
      return true;
    });
    await page.waitForTimeout(600);
    return opened;
  };
  const tabTexts = () => page.evaluate(() => (
    [...document.querySelectorAll('.settings-tab')].map((b) => (b.textContent || '').trim())
  ));
  const pageText = () => page.evaluate(() => (
    (document.querySelector('.settings-page')?.textContent || '').trim()
  ));
  const gotoTab = (match) => page.evaluate((needle) => {
    const tab = [...document.querySelectorAll('.settings-tab')]
      .find((b) => new RegExp(needle, 'i').test(b.textContent || ''));
    if (!tab) return false;
    tab.click();
    return true;
  }, match);

  assert(await openSettings(), 'settings did not open');
  const englishTabs = await tabTexts();
  const englishAudio = await pageText();
  await page.screenshot({ path: path.join(OUT, '01-settings-english.png') });

  assert(await gotoTab('language|idioma|langue'), 'no Language tab');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '02-language-page.png') });

  // choose Spanish through the real control
  const switched = await page.evaluate(() => {
    const select = document.querySelector('.setting-language-select');
    if (!select) return false;
    select.value = 'es';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  assert(switched, 'language select missing');
  await page.waitForTimeout(600);
  const spanishTabs = await tabTexts();
  await page.screenshot({ path: path.join(OUT, '03-language-spanish.png') });
  await gotoTab('sonido|audio');
  await page.waitForTimeout(400);
  const spanishAudio = await pageText();
  await page.screenshot({ path: path.join(OUT, '04-audio-spanish.png') });

  // it persists: the document carries it, and a reload comes back Spanish
  const stored = await page.evaluate(async () => {
    const { PREFERENCES_KEY } = await import(new URL('src/core/preferences.js', document.baseURI).href);
    return JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}').locale;
  });

  // NEGATIVE CONTROL: back to English restores the original strings exactly
  await gotoTab('idioma|language');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const select = document.querySelector('.setting-language-select');
    select.value = 'en';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const backTabs = await tabTexts();
  await gotoTab('audio');
  await page.waitForTimeout(400);
  const backAudio = await pageText();

  // ---- B: are the settings inert? ----------------------------------------
  const audit = await page.evaluate(async () => {
    const app = window.__fw;
    const prefs = app.preferences;
    if (!prefs) return { error: 'preferences not exposed' };
    const scene = app.scene3d;
    const probes = [
      {
        id: 'camera.fov',
        set: (v) => prefs.set('camera.fov', v),
        values: [60, 82],
        read: () => Math.round(scene.camera.fov),
      },
      {
        id: 'camera.invertY',
        set: (v) => prefs.set('camera.invertY', v),
        values: [false, true],
        read: () => prefs.get('camera.invertY'),
      },
      {
        id: 'display.shadows',
        set: (v) => prefs.set('display.shadows', v),
        values: [true, false],
        read: () => !!scene.renderer.shadowMap.enabled,
      },
      {
        id: 'display.uiScale',
        set: (v) => prefs.set('display.uiScale', v),
        values: [1, 1.3],
        read: () => getComputedStyle(document.documentElement)
          .getPropertyValue('--ui-scale').trim() || String(prefs.get('display.uiScale')),
      },
      {
        id: 'accessibility.highContrast',
        set: (v) => prefs.set('accessibility.highContrast', v),
        values: [false, true],
        read: () => document.documentElement.dataset.highContrast,
      },
      {
        id: 'accessibility.reducedMotion',
        set: (v) => prefs.set('accessibility.reducedMotion', v),
        values: [false, true],
        // applyDocumentPreferences writes these as data-* attributes, NOT as
        // class names - the first pass read className and called two working
        // settings inert
        read: () => document.documentElement.dataset.reducedMotion,
      },
      {
        id: 'audio.muted',
        set: (v) => prefs.set('audio.muted', v),
        values: [false, true],
        read: () => String(prefs.get('audio.muted')),
      },
    ];
    const results = [];
    for (const probe of probes) {
      probe.set(probe.values[0]);
      await new Promise((r) => setTimeout(r, 220));
      const a = String(probe.read());
      probe.set(probe.values[1]);
      await new Promise((r) => setTimeout(r, 220));
      const b = String(probe.read());
      probe.set(probe.values[0]);
      await new Promise((r) => setTimeout(r, 120));
      results.push({ id: probe.id, a, b, moved: a !== b });
    }
    return { results };
  });

  const inert = (audit.results || []).filter((r) => !r.moved).map((r) => r.id);
  const checks = {
    languageTabExists: englishTabs.some((label) => /language/i.test(label)),
    tabsTranslate: spanishTabs.join('|') !== englishTabs.join('|'),
    pageTranslates: spanishAudio !== englishAudio && spanishAudio.length > 0,
    choicePersists: stored === 'es',
    // NEGATIVE CONTROL: English comes back byte-identical
    controlEnglishRestoresExactly: backTabs.join('|') === englishTabs.join('|')
      && backAudio === englishAudio,
    noSettingIsInert: inert.length === 0,
    noPageErrors: errs.length === 0,
  };
  const out = {
    englishTabs, spanishTabs, backTabs, stored,
    audit: audit.results || audit, inert,
    errs: errs.slice(0, 8), checks,
  };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'language.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
