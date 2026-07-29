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

  // THE GESTURE, through the player's own path: stand in front of the carton,
  // read the prompt the game is showing, press E. Not the sim's verbs and not the
  // prop object — the walk controller's focus and a real keyboard event, because
  // "the player cannot open the box" was never a claim about the sim.
  out.gesture = await page.evaluate(async () => {
    const D = await import('/src/sim/deliveries.js');
    const st = window.__fw.state;
    const box = D.boxesOf(st).find((b) => !b.flat && (b.qty || 0) > 0);
    if (!box) return { ok: false, reason: 'no carton to open' };
    box.loc = 'world';
    box.surfaceId = 'floor:clubhouse';
    box.x = 0.4; box.z = 1.2; box.ry = 0;
    window.__fw.scene3d.clubhouse().rebuildBoxes?.();
    await new Promise((r) => setTimeout(r, 600));
    // Stand a yard south of it, looking NORTH at it. At yaw 0 the walk basis maps
    // forward to -z, so yaw 0 faces the carton; the first run used PI and focused
    // the laptop behind the player instead, then pressed E and opened it.
    const o = window.__fw.scene3d.clubhouse().center;
    const w = window.__fw.scene3d.walk.state;
    w.x = 0.4 + o.x; w.z = 2.3 + o.z; w.yaw = 0; w.pitch = -0.35;
    await new Promise((r) => setTimeout(r, 700));
    const focus = window.__fw.scene3d.walk.getFocus?.();
    const label = window.__fw.scene3d.walk.getFocusLabel?.() ?? null;
    // Refuse to press anything until the carton is what is actually focused. A
    // gesture harness that presses E at whatever happens to be under the
    // crosshair measures the room, not the gesture.
    if (!focus || !/case|carton|tape/i.test(label || '')) {
      return { ok: false, reason: `focused "${label}", not the carton`, label };
    }
    return {
      ok: true, boxId: box.id, focusedLabel: label,
      standing: { x: +(w.x - o.x).toFixed(2), z: +(w.z - o.z).toFixed(2) },
    };
  });

  if (out.gesture.ok) {
    const readState = () => page.evaluate(async () => {
      const D = await import('/src/sim/deliveries.js');
      const st = window.__fw.state;
      const walk = window.__fw.scene3d.walk;
      const box = D.boxesOf(st).find((b) => !b.flat && (b.qty || 0) > 0);
      const focus = walk.getFocus?.();
      return {
        label: walk.getFocusLabel?.() ?? null,
        focused: !!focus,
        // A carton must never ask for a tool again. One property read, and it is
        // the whole point of the change.
        tool: focus?.kind === 'prop' ? (focus.prop.tool ?? null) : null,
        hasDragVerb: focus?.kind === 'prop' ? typeof focus.prop.drag === 'function' : null,
        hasHoldVerb: focus?.kind === 'prop' ? typeof focus.prop.hold === 'function' : null,
        tapeCut: box ? D.tapeCut(box) : null,
        flapsOpen: box ? D.flapsOpen(box) : null,
        carried: st.shop.carry?.qty || 0,
      };
    });

    const steps = [];
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const before = await readState();
      if (!before.focused) { steps.push({ ...before, pressed: false }); break; }
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('e');
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(1500);
      // eslint-disable-next-line no-await-in-loop
      const after = await readState();
      steps.push({
        promptBefore: before.label,
        tool: before.tool,
        hasDragVerb: before.hasDragVerb,
        hasHoldVerb: before.hasHoldVerb,
        tapeCutAfter: after.tapeCut,
        flapsOpenAfter: after.flapsOpen,
        tookSomething: after.carried > before.carried,
      });
      if (after.carried > before.carried) break;
    }
    out.gesture.steps = steps;
    out.gesture.presses = steps.length;
  }

  const g = out.gesture;
  out.threePresses = g.ok && g.presses === 3 && g.steps[2].tookSomething === true;
  out.noToolRequired = g.ok && g.steps.every((s) => s.tool === null);
  out.noDragGesture = g.ok && g.steps.every((s) => !s.hasDragVerb && !s.hasHoldVerb);
  // Each press must name what IT does, and the three must be different.
  out.promptNamesEachStep = g.ok && g.steps.length === 3
    && /tear the tape/i.test(g.steps[0].promptBefore || '')
    && /other flap/i.test(g.steps[1].promptBefore || '')
    && /armful/i.test(g.steps[2].promptBefore || '');
  // And each press must move exactly one mechanical thing.
  out.oneStepPerPress = g.ok && g.steps.length === 3
    && g.steps[0].tapeCutAfter === true && g.steps[0].flapsOpenAfter === false
    && g.steps[1].flapsOpenAfter === true;

  out.ok = out.placeableButNotOpenable.length === 0
    && out.threePresses && out.noToolRequired && out.noDragGesture
    && out.promptNamesEachStep && out.oneStepPerPress
    && out.delivery.ok === true
    && out.delivery.openableWhereItLanded === true
    && out.delivery.openableOnSalesFloor === true
    && out.delivery.openableOnStockroomFloor === true
    && out.delivery.openableOnHandTruck === true;
  fs.writeFileSync(path.join(outDir, 'box-open-loop.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
