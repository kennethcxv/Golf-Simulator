async (page) => {
  // WALK FINDING 3 — "boxes in the shop still cannot be opened".
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-box-open-loop.js
  //
  // The previous pass established that a carton only opens on an approved work
  // surface and added a prompt saying so. A prompt that names the rule is not
  // the same as a loop the player can enter, so this walks the loop instead:
  // where does the starter's box actually sit, what does the game say about it,
  // and can it be opened from there.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__fw.speedIdx = 1; });

  const surveyBoxes = () => page.evaluate(async () => {
    const BP = await import('/src/sim/boxPlacement.js');
    const st = window.__fw.state;
    const boxes = BP.allBoxes ? BP.allBoxes(st) : (st.shop?.boxes || []);
    return (boxes || []).map((b) => {
      let caps = null;
      try { caps = BP.boxPlacementCapabilities(st, b); } catch (e) { caps = { error: String(e) }; }
      return {
        id: b.id ?? null,
        sku: b.skuId ?? null,
        loc: b.loc ?? null,
        surfaceId: b.surfaceId ?? caps?.surfaceId ?? null,
        x: Number.isFinite(b.x) ? +b.x.toFixed(2) : null,
        z: Number.isFinite(b.z) ? +b.z.toFixed(2) : null,
        opened: !!b.opened,
        canUnpack: caps?.canUnpack ?? null,
        placeBox: caps?.placeBox ?? null,
      };
    });
  });

  const out = { atStart: await surveyBoxes() };

  // Every surface the game will let a box rest on, and whether it will then let
  // the player open it. This is the whole rule, stated as data.
  out.surfaces = await page.evaluate(async () => {
    const S = await import('/src/data/boxPlacementSurfaces.js');
    return S.BOX_PLACEMENT_SURFACE_TEMPLATES.map((t) => ({
      id: t.id,
      kind: t.kind,
      placeBox: !!t.capabilities.placeBox,
      canUnpack: !!t.capabilities.canUnpack,
      unpackPolicy: t.unpackPolicy || null,
    }));
  });
  out.placeableButNotOpenable = out.surfaces
    .filter((s) => s.placeBox && !s.canUnpack)
    .map((s) => s.id);

  // A REAL delivery, arrived the way the sim arrives one, then asked the same
  // question at each place the player would naturally put it. The starter save
  // carries no boxes at all — `atStart` above is empty — so "the starter's first
  // box" only exists once an order lands, and the pad is where it lands.
  out.delivery = await page.evaluate(async () => {
    const D = await import('/src/sim/deliveries.js');
    const BP = await import('/src/sim/boxPlacement.js');
    const st = window.__fw.state;
    const IL = await import('/src/sim/inventoryLifecycle.js');
    D.ensureDeliveries(st);
    st.cash = Math.max(st.cash, 50000);
    const before = D.boxesOf(st).length;
    // A REAL order through the player's own path, then arrived without waiting
    // out the lead time. Two lines from one supplier, so this also exercises the
    // multi-line arrival the laptop can produce.
    const placed = IL.submitPurchaseOrders(st, {
      idempotencyKey: `box-open-loop:${st.seed}`,
      lines: [{ skuId: 'balls1', quantity: 24 }, { skuId: 'towel1', quantity: 6 }],
    });
    if (!placed.ok) return { ok: false, reason: `order rejected: ${placed.reason}` };
    const order = st.shop.orders[st.shop.orders.length - 1];
    try { D.arriveOrder(st, order); } catch (e) { return { ok: false, reason: String(e) }; }
    const boxes = D.boxesOf(st);
    if (boxes.length <= before) return { ok: false, reason: 'arriveOrder produced no carton' };
    const box = boxes[boxes.length - 1];
    const caps = (b) => {
      try { return BP.boxPlacementCapabilities(st, b).canUnpack; } catch (e) { return String(e); }
    };
    return {
      ok: true,
      orderLines: order.lines.length,
      orderSkuId: order.skuId,
      cartonsLanded: boxes.length - before,
      skusLanded: [...new Set(boxes.slice(before).map((b) => b.skuId))],
      whereItLanded: { loc: box.loc, surfaceId: box.surfaceId ?? null },
      // The three places a player puts a delivery, in the order they meet them.
      openableWhereItLanded: caps(box),
      openableOnSalesFloor: caps({
        ...box, loc: 'world', surfaceId: 'floor:clubhouse', x: 0.4, z: 1.2, ry: 0,
      }),
      openableOnStockroomFloor: caps({
        ...box, loc: 'world', surfaceId: 'floor:clubhouse', x: 8.65, z: -5.1, ry: 0,
      }),
      openableOnHandTruck: caps({
        ...box, loc: 'equipment', equipmentId: 'delivery_hand_truck', socketId: 'LOAD_ORIGIN',
      }),
    };
  });

  out.ok = out.placeableButNotOpenable.length === 0
    && out.delivery.ok === true
    && out.delivery.openableWhereItLanded === true
    && out.delivery.openableOnSalesFloor === true
    && out.delivery.openableOnStockroomFloor === true
    && out.delivery.openableOnHandTruck === true;
  fs.writeFileSync(path.join(outDir, 'box-open-loop.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
