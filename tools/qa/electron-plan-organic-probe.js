// WHY DOES planOrganicOrder PRODUCE NO PICKS?
//
// Ten retail shoppers, zero carts, in a shop measured to hold 110 units across 4
// stocked fixtures. A stop is browse-only when `!visit.skuId`, and the fallback
// when `organicPlan.picks` is EMPTY is exactly one browse-only visit -- so an
// empty plan means nobody ever buys anything, which is what the runs show.
//
// planOrganicOrder itself reads correct on inspection, so this stops reading and
// CALLS IT, with the live state, against the same `browsable` list the spawn path
// builds. Two things can differ from my assumption and only a live call separates
// them: which fixtures survive the `floorFixtures` filter, and what
// `inventory[skuId].shelf` actually holds for those fixtures' SKUs.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/plan-organic');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const saveDir = path.join(process.env.APPDATA || '', 'GOLF EMPIRE', 'saves');
  const autosave = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(saveDir, 'autosave-meta.json'), 'utf8'));
  await page.waitForFunction(() => !!window.fairwayNative?.save, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async ({ save, saveMeta }) => {
    await window.fairwayNative.save('autosave', save);
    await window.fairwayNative.save('autosave-meta', saveMeta);
  }, { save: autosave, saveMeta: meta });
  await page.reload();
  await page.waitForFunction(() => {
    const b = document.querySelector('.menu-action-primary');
    return !!b && !b.disabled;
  }, null, { timeout: 45000 });
  await page.evaluate(() => document.querySelector('.menu-action-primary').click());
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  out.result = await page.evaluate(async () => {
    const flow = await import(new URL('src/render3d/clubhouse/customerFlow.js', document.baseURI).href);
    const layout = await import(new URL('src/sim/layout.js', document.baseURI).href);
    const st = window.__fw.state;
    const inv = st.shop.inventory || {};
    const placed = layout.placedFixtures ? layout.placedFixtures(st) : [];
    const browsable = placed.filter((f) => f.skus && f.skus.length > 0);

    // What does the planner see, SKU by SKU, for the fixtures it is given?
    const shelfByFixture = browsable.map((f) => ({
      id: f.id,
      skus: (f.skus || []).map((id) => ({
        id,
        shelf: Math.max(0, Math.floor((inv[id] && inv[id].shelf) || 0)),
      })),
    }));
    const totalAvailable = shelfByFixture
      .reduce((a, f) => a + f.skus.reduce((b, s) => b + (s.shelf > 0 ? 1 : 0), 0), 0);

    // A deterministic rng of the same shape the spawn path passes.
    const mkRng = (seed) => {
      let x = seed >>> 0;
      const next = () => {
        x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
        return x / 4294967296;
      };
      return { next, int: (n) => Math.floor(next() * n), chance: (p) => next() < p };
    };

    const trials = [];
    for (let i = 0; i < 12; i += 1) {
      const plan = flow.planOrganicOrder(browsable, inv, mkRng(1000 + i));
      trials.push({ target: plan.target, picks: plan.picks.length });
    }

    return {
      placedFixtures: placed.length,
      browsableFixtures: browsable.length,
      browsableIds: browsable.map((f) => f.id),
      distinctSkusWithShelfStock: totalAvailable,
      ORGANIC_ORDER_MIN: flow.ORGANIC_ORDER_MIN,
      shelfByFixture,
      trials,
      trialsWithPicks: trials.filter((t) => t.picks > 0).length,
    };
  });
  console.log('BROWSABLE', JSON.stringify({
    placed: out.result.placedFixtures,
    browsable: out.result.browsableFixtures,
    ids: out.result.browsableIds,
    distinctSkusWithShelfStock: out.result.distinctSkusWithShelfStock,
    min: out.result.ORGANIC_ORDER_MIN,
  }));
  console.log('TRIALS', JSON.stringify(out.result.trials));
  console.log('TRIALS-WITH-PICKS', out.result.trialsWithPicks, 'of', out.result.trials.length);
  console.log('SHELF-BY-FIXTURE', JSON.stringify(out.result.shelfByFixture));

  fs.writeFileSync(path.join(OUT, 'plan-organic.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
