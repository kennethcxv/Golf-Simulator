async (page) => {
  // SAVE ROUND-TRIP ACROSS THE ROOMS — FLOOR_PLAN.md §9's both-directions diff.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-greybox-save-roundtrip.js
  //
  // One seeded empire: save in the v1 room → load the SAME save in pine-hills-v2 →
  // save there → load back in v1. The fingerprint is proshop-phase1-save-reload's
  // (grime cells, debris, windows, architecture, drawer, campaign, uiPrefs...);
  // every leg is diffed field-by-field and the round trip must be lossless.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  const fingerprint = () => page.evaluate(() => {
    const app = window.__fw;
    const st = app.state;
    const S = (fn, d = null) => { try { const v = fn(); return v === undefined ? d : v; } catch (e) { return `ERR:${e.message}`; } };
    const reno = st.shop.reno;
    const sum = (a) => a.reduce((x, v) => x + v, 0);
    return {
      variant: S(() => new URLSearchParams(window.location.search).get('clubhouse')),
      grime: { len: reno.grime.length, sum: +sum(reno.grime).toFixed(4) },
      grimeCells: reno.grime.map((v) => +v.toFixed(5)),
      debris: {
        count: reno.debris.length,
        totalMass: +sum(reno.debris.map((d) => d.a)).toFixed(4),
        positions: reno.debris.map((d) => `${d.x.toFixed(2)},${d.z.toFixed(2)},${d.kind}`).sort(),
      },
      wetSum: S(() => +sum(reno.wet || []).toFixed(3)),
      cleaning: S(() => JSON.parse(JSON.stringify(reno.cleaning))),
      clutter: reno.clutter.map((c) => `${c.x},${c.z},${c.cleared}`),
      windows: [...reno.windows],
      architecture: Object.fromEntries(Object.entries(reno.architecture.components).map(([k, v]) => [k, v.restored])),
      targetProgress: S(() => JSON.parse(JSON.stringify(reno.targetProgress))),
      cash: st.cash,
      inventoryShelfTotal: Object.values(st.shop.inventory).reduce((a, v) => a + (v.shelf || 0), 0),
      inventoryBackTotal: Object.values(st.shop.inventory).reduce((a, v) => a + (v.back || 0), 0),
      drawerTotal: S(() => JSON.stringify(st.shop.drawer)),
      heldCount: st.shop.held.length,
      campaignFacilities: S(() => JSON.parse(JSON.stringify(st.campaign?.facilities || {}))),
      layoutMoved: S(() => JSON.stringify(st.shop.layout?.moved || {})),
      propertyVariant: S(() => st.property?.clubhouseVariant),
      saveVersion: st.version,
    };
  });

  const settle = async () => {
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 120000 });
    await page.waitForTimeout(2500);
  };
  const loadInto = async (query) => {
    await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /^Continue/ }).first().click();
    await settle();
  };
  const saveNow = () => page.evaluate(() => {
    const app = window.__fw;
    if (typeof app.autosave === 'function') return void app.autosave() ?? true;
    return false;
  });

  const diff = (left, right) => {
    const problems = [];
    const walk = (a, b, at) => {
      if (at === 'variant') return; // the query param itself is expected to differ
      if (typeof a !== typeof b) { problems.push(`${at}: type ${typeof a} vs ${typeof b}`); return; }
      if (a && typeof a === 'object') {
        const keys = new Set([...Object.keys(a), ...Object.keys(b || {})]);
        for (const key of keys) walk(a[key], b?.[key], at ? `${at}.${key}` : key);
        return;
      }
      if (a !== b) problems.push(`${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    };
    walk(left, right, '');
    return problems;
  };

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  }, SEED);

  await loadInto('');
  await saveNow();
  const inV1 = await fingerprint();

  await loadInto('?clubhouse=pine-hills-v2');
  const inV2 = await fingerprint();
  const v1ToV2 = diff(inV1, inV2);

  await saveNow();
  await loadInto('');
  const backInV1 = await fingerprint();
  const v2ToV1 = diff(inV2, backInV1);
  const fullCircle = diff(inV1, backInV1);

  const result = {
    seed: SEED,
    grimeCellCount: inV1.grime.len,
    legs: {
      v1ToV2: { differences: v1ToV2.length, detail: v1ToV2.slice(0, 20) },
      v2ToV1: { differences: v2ToV1.length, detail: v2ToV1.slice(0, 20) },
      fullCircle: { differences: fullCircle.length, detail: fullCircle.slice(0, 20) },
    },
    savedVariantField: { inV1: inV1.propertyVariant, inV2: inV2.propertyVariant, backInV1: backInV1.propertyVariant },
    errs: errs.slice(0, 16),
    ok: v1ToV2.length === 0 && v2ToV1.length === 0 && fullCircle.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'greybox-save-roundtrip.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
