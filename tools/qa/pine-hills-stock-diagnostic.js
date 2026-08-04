async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const outDir = path.join(repoRoot, 'qa', 'pine-hills-clubhouse', 'diagnostics');
  fs.mkdirSync(outDir, { recursive: true });

  await page.goto(baseUrl);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 45000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 45000 });
  await page.evaluate(async () => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    await Promise.all([
      clubhouse.pineHillsInterior?.ready,
      clubhouse.assets51to100Runtime?.ready,
    ].filter(Boolean));
  });
  await page.waitForTimeout(800);

  const result = await page.evaluate(async () => {
    const starter = await import(new URL('src/sim/clubhouseStarterStock.js', document.baseURI).href);
    const slots = await import(new URL('src/data/fixtureSlots.js', document.baseURI).href);
    const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const campaign = await import(new URL('src/sim/campaign.js', document.baseURI).href);
    const property = await import(new URL('src/sim/propertyInventory.js', document.baseURI).href);
    const retail = await import(new URL('src/sim/retailShelfStocking.js', document.baseURI).href);
    const app = window.__fw;
    const state = app.state;
    const clubhouse = app.scene3d.clubhouse();

    return {
      starterVersion: state.shop?.reno?.starterRestockVersion,
      inventory: starter.STARTER_RETAIL_SKU_IDS.map((skuId) => ({
        skuId,
        fixtureId: slots.homeFixture(skuId)?.id || null,
        shelf: state.shop.inventory[skuId]?.shelf || 0,
        back: state.shop.inventory[skuId]?.back || 0,
        capacity: slots.capacityOf(skuId),
        entitlement: starter.STARTER_RETAIL_ENTITLEMENT[skuId],
      })),
      furnishedFixtures: layout.FURNISHED_CLUBHOUSE_FIXTURE_IDS.map((fixtureId) => ({
        fixtureId,
        installed: campaign.fixtureIsInstalled(state, fixtureId),
      })),
      displays: clubhouse.stockDisplayDiagnostics?.() || null,
      starterCartons: (state.shop.deliveries?.boxes || [])
        .filter((box) => box.starterRestockVersion === starter.STARTER_RESTOCK_VERSION)
        .map((box) => ({
          id: box.id,
          starterCartonId: box.starterCartonId,
          loc: box.loc,
          surfaceId: box.surfaceId,
          qty: box.qty,
          contents: box.contents?.map((entry) => ({
            skuId: entry.skuId,
            remainingQuantity: entry.remainingQuantity,
          })) || [],
        })),
      placedRetailShelves: property.placedPropertyItems(state)
        .filter((entry) => entry.category === 'freestanding-shelving')
        .map((entry) => ({
          id: entry.id,
          assetId: entry.assetId,
          assignments: retail.retailShelfAssignments(state, entry.id),
        })),
    };
  });

  fs.writeFileSync(
    path.join(outDir, 'stock-diagnostic.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return result;
}
