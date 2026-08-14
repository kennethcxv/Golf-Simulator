// WHY DOES NOBODY BUY ANYTHING?
//
// Four retail shoppers browsed fixtures for ~170 s and `everHeldGoods` was 0 --
// not one of them ever picked a unit up, which is why not one of them ever
// queued. clubhouse.js only lets a shopper take something when the fixture they
// are standing at HAS STOCK; otherwise the branch is literally "bare display:
// they glance and move on".
//
// So the question is not about navigation at all: are there goods on the shelves
// in the owner's save? This reads the same two things the pick decision reads --
// the placed fixtures with their assigned SKUs, and the shop inventory those SKUs
// resolve against -- rather than inferring from customer behaviour, which is
// several steps downstream and is exactly the proxy that produced the withdrawn
// finding earlier in this session.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/shelf-stock');
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

  // THE INVENTORY VALUE IS `{ shelf, back }`, NOT A NUMBER AND NOT `.qty`.
  // My first version read `.qty`, which does not exist on these records, so every
  // SKU came back with 0 units and the probe confidently reported an empty shop
  // -- the exact answer it was built to detect, produced by its own missing
  // accessor (FOUND_FALSE shape 10). `shelf` is what a shopper can pick up;
  // `back` is stockroom and is deliberately counted separately, because goods in
  // the back explain an empty SHELF rather than excusing it.
  out.shop = await page.evaluate(() => {
    const st = window.__fw.state;
    const inv = st?.shop?.inventory || {};
    const entries = Object.entries(inv);
    const shelfOf = (v) => (v && typeof v.shelf === 'number' ? v.shelf : 0);
    const backOf = (v) => (v && typeof v.back === 'number' ? v.back : 0);
    const onShelf = entries.filter(([, v]) => shelfOf(v) > 0);
    const inBack = entries.filter(([, v]) => backOf(v) > 0);
    return {
      inventoryKeys: entries.length,
      skusOnShelf: onShelf.length,
      skusInBack: inBack.length,
      shelfUnits: entries.reduce((a, [, v]) => a + shelfOf(v), 0),
      backUnits: entries.reduce((a, [, v]) => a + backOf(v), 0),
      sampleShelf: onShelf.slice(0, 8).map(([k, v]) => `${k}=${shelfOf(v)}`),
      sampleBack: inBack.slice(0, 8).map(([k, v]) => `${k}=${backOf(v)}`),
      shopOpen: st?.shop?.open ?? null,
    };
  });
  console.log('SHOP', JSON.stringify(out.shop));

  // FIXTURES COME FROM placedFixtures(state) IN sim/layout.js, not from
  // state.shop.fixtures -- which does not exist, so my first version read
  // `undefined`, mapped it to an empty array, and reported "0 fixtures placed" in
  // a shop that has them. Same missing-accessor shape as the inventory above, in
  // the same probe, twice.
  out.fixtures = await page.evaluate(async () => {
    const layout = await import(new URL('src/sim/layout.js', document.baseURI).href);
    const st = window.__fw.state;
    const placed = layout.placedFixtures ? layout.placedFixtures(st) : [];
    return {
      count: placed.length,
      withSkus: placed.filter((f) => Array.isArray(f?.skus) && f.skus.length > 0).length,
      sample: placed.slice(0, 6).map((f) => ({
        id: f?.id ?? null,
        skus: Array.isArray(f?.skus) ? f.skus.length : null,
        firstSkus: Array.isArray(f?.skus) ? f.skus.slice(0, 3) : null,
      })),
    };
  });
  console.log('FIXTURES', JSON.stringify(out.fixtures));

  // The decisive cross-check, and the one the pick decision actually makes: for
  // each placed fixture, how many of its SKUs are ON THE SHELF right now?
  out.stocked = await page.evaluate(async () => {
    const layout = await import(new URL('src/sim/layout.js', document.baseURI).href);
    const st = window.__fw.state;
    const inv = st?.shop?.inventory || {};
    const shelf = (id) => {
      const v = inv[id];
      return v && typeof v.shelf === 'number' ? v.shelf : 0;
    };
    const placed = layout.placedFixtures ? layout.placedFixtures(st) : [];
    const rows = placed.map((f) => {
      const skus = Array.isArray(f?.skus) ? f.skus : [];
      return {
        id: f?.id ?? null,
        skus: skus.length,
        onShelf: skus.filter((id) => shelf(id) > 0).length,
      };
    });
    return {
      fixtures: rows.length,
      fixturesWithAnyStock: rows.filter((r) => r.onShelf > 0).length,
      rows: rows.slice(0, 12),
    };
  });
  console.log('STOCKED', JSON.stringify(out.stocked));

  out.verdict = {
    skusOnShelf: out.shop?.skusOnShelf ?? 0,
    shelfUnits: out.shop?.shelfUnits ?? 0,
    skusInBack: out.shop?.skusInBack ?? 0,
    backUnits: out.shop?.backUnits ?? 0,
    fixturesPlaced: out.fixtures?.count ?? 0,
    fixturesWithSkus: out.fixtures?.withSkus ?? 0,
    fixturesWithAnyStock: out.stocked?.fixturesWithAnyStock ?? 0,
    // The one that decides it: a shopper can only ever buy from a fixture that
    // both carries SKUs and has them in stock.
    canAnyoneBuyAnything: (out.stocked?.fixturesWithAnyStock ?? 0) > 0,
  };
  fs.writeFileSync(path.join(OUT, 'shelf-stock.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('SHELF-STOCK', JSON.stringify(out.verdict, null, 2));
  return out;
}
