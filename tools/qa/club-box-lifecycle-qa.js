async (page) => {
  // Reference-48 long golf-club carton production probe.
  //
  // The documented fixture below establishes one repeatable delivery and fixed
  // player-camera poses. Every lifecycle transition after staging is exercised
  // through the game's normal pointer/keyboard path: three E presses open the
  // carton (press one tears the tape and swings the wide flap pair, press two
  // folds the other pair, press three takes an armful), tap E to
  // flatten/carry/recycle, and hold E at the real club rack to stock.
  // It also records a matched pre/post three-cycle resource and performance
  // profile after pre-warming every evidence camera and permanent prop family.
  // (Ported off the box-cutter equip 2026-07-30 — cartons tear on a press;
  // proshop-box-open-loop.js owns the gesture contract.)

  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const sampleMs = Math.max(2000, Number.parseInt(process.env.BOX_QA_SAMPLE_MS || '5000', 10));
  // Default output is the fixed production evidence path. Asset authors may
  // opt into a disposable candidate pass while Blender revisions are active.
  const phase = process.env.CLUB_BOX_QA_CANDIDATE === '1' ? 'candidate' : 'after';
  const iteration = 1;

  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const iterationName = `iteration-${String(iteration).padStart(2, '0')}`;
  const out = path.join(repo, 'qa', 'box_system_master', 'club_box_lifecycle', phase, iterationName);
  fs.mkdirSync(out, { recursive: true });

  // The runner's --bootstrap document only seeds localStorage. Drain its async
  // model requests before the intentional fixture reload so old-document
  // cancellations cannot masquerade as failures in this measured run.
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(750);

  const diagnostics = [];
  const diagnosticCounts = { consoleError: 0, consoleWarning: 0, pageError: 0, requestFailed: 0 };
  let probeReady = false;
  const noteDiagnostic = (kind, text) => {
    diagnosticCounts[kind] += 1;
    if (diagnostics.length < 100) diagnostics.push({ kind, text: String(text), atMs: Date.now() });
  };
  page.on('console', (message) => {
    if (message.type() === 'error') noteDiagnostic('consoleError', message.text());
    if (message.type() === 'warning') noteDiagnostic('consoleWarning', message.text());
  });
  page.on('pageerror', (error) => noteDiagnostic('pageError', error.message));
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || 'unknown';
    // The runner bootstraps once before this probe loads its fixed fixture.
    // In-flight assets from that old document are expected to abort at this
    // deliberate navigation and are not failures of the measured scene.
    if (!probeReady && /ERR_ABORTED/i.test(errorText)) return;
    noteDiagnostic('requestFailed', `${request.url()} (${errorText})`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      noteDiagnostic('requestFailed', `${response.url()} (HTTP ${response.status()})`);
    }
  });

  const cameras = Object.freeze({
    // This remains the established exterior start for the straight-W doorway
    // probe. Delivery cartons now land on the five-pallet apron at z ~= 0, so
    // pickup uses a separate pose derived from the delivered carton below.
    receivingDoorExterior: { x: 12.55, z: -3.60, yaw: Math.PI / 2, pitch: -0.22 },
    box: { x: 8.25, z: -0.43, yaw: 0, pitch: -0.58 },
    boxOpen: { x: 8.25, z: -0.43, yaw: 0, pitch: -0.78 },
    clubRack: { x: -8.35, z: -3.2, yaw: Math.PI / 2, pitch: -0.12 },
    packingBench: { x: 6.9, z: 0.28, yaw: 0, pitch: -0.52 },
    recycling: { x: 9.05, z: 1.3, yaw: -Math.PI / 2, pitch: -0.40 },
  });
  // Clean working aisle beside the stockroom packing bench: label faces the
  // player, the top seam is unobstructed, and no dressing carton shares frame.
  const fixtureSpot = Object.freeze({ x: 8.25, z: -1.7, ry: 0 });
  const fixtureOrderId = 950048;
  const fixtureQty = 2; // one honest long-club armful exposes the exact 2 -> 0 contract.

  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.()?.assetsReady?.(), null, { timeout: 90000 });
  await page.waitForTimeout(750);
  probeReady = true;

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 0;
    app.scene3d.walk.clearKeys?.();
    const day = Math.floor(app.state.clock.minutes / 1440) * 1440;
    app.state.clock.minutes = day + 14 * 60;
    if (app.state.weather) app.state.weather.locked = true;
    app.scene3d.applyTimeWeather?.(14 * 60, app.state.weather);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins?.(false);
    clubhouse.clearWalkins?.();
  });

  const viewportContract = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }));
  if (viewportContract.innerWidth !== 1600 || viewportContract.innerHeight !== 900 || viewportContract.devicePixelRatio !== 1) {
    throw new Error(`Fixed viewport contract failed: ${JSON.stringify(viewportContract)}.`);
  }

  // Exercise the real pointer path once. The fixed camera fixture is used after
  // this click so screenshots remain pixel-comparable between iterations.
  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 30000 });
  await page.bringToFront();
  await page.mouse.move(800, 450);
  await canvas.click({ position: { x: 800, y: 450 }, force: true });
  await page.waitForFunction((target) => document.pointerLockElement === target, await canvas.elementHandle(), { timeout: 7000 });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  // Fail with a machine-readable ref-48 blocker before normal-control timing
  // begins. This makes an unintegrated branch red for the right reason instead
  // of timing out later while waiting for authored nodes that cannot exist.
  const integrationContract = await page.evaluate(async () => {
    const B = await import(new URL('src/data/boxes.js', document.baseURI).href);
    const V = await import(new URL('src/render3d/clubhouse/deliveryBoxVisual.js', document.baseURI).href);
    return {
      dimensions: B.boxDims('clubbox'),
      unitsPerBox: B.unitsPerBox({ id: 'driver1', cat: 'clubs' }),
      model: V.DELIVERY_MODEL_BY_BOX_KIND.clubbox || null,
      expected: {
        dimensions: { w: 1.25, h: 0.18, d: 0.18 },
        unitsPerBox: 2,
        model: 'delivery_golf_club_box',
      },
    };
  });
  const integrationReady = integrationContract.dimensions.w === 1.25
    && integrationContract.dimensions.h === 0.18
    && integrationContract.dimensions.d === 0.18
    && integrationContract.unitsPerBox === 2
    && integrationContract.model === 'delivery_golf_club_box';
  if (!integrationReady) {
    const blockerFrame = path.join(out, '00-runtime-integration-blocker.png');
    await page.screenshot({ path: blockerFrame });
    const blockerResult = {
      ok: false,
      phase,
      iteration,
      outputDirectory: out,
      launch: 'node tools/qa/run-playwright.cjs tools/qa/club-box-lifecycle-qa.js --bootstrap',
      blocker: 'Ref-48 runtime integration does not yet match the exact long club-carton contract.',
      integrationContract,
      evidence: [blockerFrame],
      diagnostics: { counts: diagnosticCounts, entries: diagnostics },
    };
    fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(blockerResult, null, 2)}\n`);
    fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
      status: 'blocked', phase, iteration, blocker: blockerResult.blocker,
      result: path.join(out, 'result.json'), captures: blockerResult.evidence,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    return blockerResult;
  }

  async function setCamera(pose) {
    await page.evaluate((next) => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk;
      walk.clearKeys?.();
      walk.state.x = origin.x + next.x;
      walk.state.z = origin.z + next.z;
      walk.state.yaw = next.yaw;
      walk.state.pitch = next.pitch;
    }, pose);
    await page.waitForTimeout(280);
  }

  async function deliveredBoxPickupCamera(boxId) {
    const pickup = await page.evaluate(async (id) => {
      const S = await import(new URL('src/data/deliveryStaging.js', document.baseURI).href);
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const scene = app.scene3d.scene;
      const box = app.state.shop.deliveries.boxes.find((candidate) => candidate.id === id);
      const plan = S.planPalletizedPadBoxes(
        app.state.shop.deliveries.boxes.filter((candidate) => candidate.loc === 'pad'),
      ).find((entry) => entry.boxId === id);
      const root = scene.getObjectByName(`DeliveryBox_${id}`)
        || scene.getObjectByName(`DeliveryBoxFallback_${id}`);
      if (!box || !plan || !root) return null;

      root.updateWorldMatrix(true, true);
      const rendered = root.getWorldPosition(root.position.clone());
      // Approach the delivered carton from the apron-facing north edge. The
      // 1.03 m offset is the validated normal-pickup range used by ref-44, but
      // X/Z are always anchored to this carton's live rendered/pallet pose.
      const camera = {
        x: rendered.x - origin.x,
        z: rendered.z - origin.z + 1.03,
        yaw: 0,
        pitch: -0.34,
      };
      return {
        camera,
        boxId: id,
        palletIndex: plan.palletIndex,
        renderedLocal: {
          x: +(rendered.x - origin.x).toFixed(4),
          z: +(rendered.z - origin.z).toFixed(4),
        },
        plannedLocal: { x: +plan.x.toFixed(4), z: +plan.z.toFixed(4) },
      };
    }, boxId);
    if (!pickup) throw new Error(`Cannot derive the receiving-apron pickup camera for box ${boxId}.`);
    return pickup;
  }

  async function focusInfo() {
    return page.evaluate(() => ({
      label: window.__fw.scene3d.walk.getFocusLabel?.() || null,
      tool: window.__fw.scene3d.walk.getTool?.() || null,
    }));
  }

  async function waitForFocus(pattern, timeout = 7000) {
    const source = pattern.source;
    const flags = pattern.flags;
    await page.waitForFunction(({ source: reSource, flags: reFlags }) => {
      const label = window.__fw?.scene3d?.walk?.getFocusLabel?.() || '';
      return new RegExp(reSource, reFlags).test(label);
    }, { source, flags }, { timeout });
    return focusInfo();
  }

  async function boxSnapshot(id) {
    return page.evaluate(async (boxId) => {
      const D = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
      const box = D.findBox(window.__fw.state, boxId);
      if (!box) {
        const delivery = window.__fw.state.shop.deliveries;
        return {
          exists: false,
          lifecycle: 'DISCARDED',
          recycled: delivery.recycled || 0,
          trash: delivery.trash || 0,
        };
      }
      return {
        exists: true,
        id: box.id,
        state: D.boxState(box),
        lifecycle: D.boxLifecycleState(box),
        loc: box.loc,
        skuId: box.skuId,
        boxKind: box.box,
        qty: box.qty,
        cap: box.cap,
        cutProgress: box.cutProgress ?? box.tape ?? 0,
        tapeSegments: { ...(box.tapeSegments || {}) },
        flapProgress: [...(box.flapProgress || box.flaps || [])],
        openingProgress: box.openingProgress || 0,
        flattenProgress: box.flattenProgress || 0,
        flat: !!box.flat,
      };
    }, id);
  }

  async function waitForBox(id, condition, timeout = 6000) {
    await page.waitForFunction(({ boxId, condition: wanted }) => {
      const box = window.__fw?.state?.shop?.deliveries?.boxes?.find((candidate) => candidate.id === boxId);
      if (wanted === 'gone') return !box;
      if (!box) return false;
      if (wanted === 'cut') return (box.cutProgress ?? box.tape ?? 0) >= 1;
      if (wanted === 'opening') return (box.openingProgress || 0) > 0.05 && (box.openingProgress || 0) < 0.95;
      if (wanted === 'open') return (box.flapProgress || []).length === 4 && box.flapProgress.every((value) => value >= 0.999);
      if (wanted === 'flat') return box.flat && (box.flattenProgress || 0) >= 0.999;
      if (wanted.startsWith('qty:')) return box.qty === Number(wanted.slice(4));
      if (wanted.startsWith('loc:')) return box.loc === wanted.slice(4);
      return false;
    }, { boxId: id, condition }, { timeout });
  }

  async function waitCarry(expectedQty, timeout = 5000) {
    await page.waitForFunction((qty) => {
      const carry = window.__fw?.state?.shop?.carry;
      return qty === 0 ? !carry : !!carry && carry.skuId === 'driver1' && carry.qty === qty;
    }, expectedQty, { timeout });
  }

  async function stageClubBox({ orderId, qty, resetDelivery, spot = fixtureSpot, atPad = false }) {
    const staged = await page.evaluate(async ({ orderId: id, qty: units, spot, reset, pad }) => {
      const D = await import(new URL('src/sim/deliveries.js', document.baseURI).href);
      const state = window.__fw.state;
      D.ensureDeliveries(state);
      const delivery = state.shop.deliveries;
      if (reset) {
        delivery.boxes = [];
        delivery.shipments = [];
        delivery.arrivedOrderIds = [];
        delivery.nextBoxId = 1;
        delivery.trash = 0;
        delivery.recycled = 0;
      }
      state.shop.carry = null;
      state.shop.inventory.driver1.shelf = 0;
      state.shop.inventory.driver1.back = 0;
      if (state.shop.reno) {
        state.shop.reno.grime.fill(0);
        state.shop.reno.clutter = [];
      }
      if (state.notifications) {
        state.notifications.items = [];
        state.notifications.nextId = 1;
      }
      const manifest = {
        supplierId: 'fairline-clubs-qa',
        supplier: 'Fairline Clubs',
        boxes: [{ kind: 'clubbox', qty: units, w: 1.25, h: 0.18, d: 0.18, lb: +(units * 0.80).toFixed(2), fragile: false }],
        boxCount: 1,
        weight: +(units * 0.80).toFixed(2),
        fee: 9,
      };
      const [box] = D.arriveOrder(state, { id, skuId: 'driver1', qty: units, manifest });
      if (!box) throw new Error(`Fixture failed to create order ${id}.`);
      if (!pad) {
        D.pickUpBox(state, box.id);
        D.putDownBox(state, box.id, spot);
      }
      const clubhouse = window.__fw.scene3d.clubhouse();
      clubhouse.rebuildReno?.();
      clubhouse.refreshCondition?.();
      clubhouse.rebuildStock?.();
      clubhouse.rebuildBoxes();
      const B = await import(new URL('src/data/boxes.js', document.baseURI).href);
      const V = await import(new URL('src/render3d/clubhouse/deliveryBoxVisual.js', document.baseURI).href);
      return {
        id: box.id,
        orderId: id,
        skuId: box.skuId,
        qty: box.qty,
        cap: box.cap,
        boxKind: box.box,
        dimensions: B.boxDims(box.box),
        model: V.DELIVERY_MODEL_BY_BOX_KIND[box.box] || null,
        loc: box.loc,
      };
    }, { orderId, qty, spot, reset: resetDelivery, pad: atPad });

    await page.waitForFunction((id) => {
      const scene = window.__fw?.scene3d?.scene;
      const root = scene?.getObjectByName(`DeliveryBox_${id}`);
      const names = [];
      root?.traverse((object) => { if (object.name) names.push(object.name); });
      return !!(
        root
        && root.getObjectByName('BOX_FLAP_FRONT')
        && root.getObjectByName('BOX_FLAP_BACK')
        && root.getObjectByName('BOX_FLAP_LEFT')
        && root.getObjectByName('BOX_FLAP_RIGHT')
        && root.getObjectByName('BOX_WALL_FRONT')
        && root.getObjectByName('CONTENT_SLOT_01')
        && names.some((name) => name.startsWith('TAPE_') && !name.includes('PEELED'))
      );
    }, staged.id, { timeout: 30000 });
    return staged;
  }

  async function assetContract(id) {
    return page.evaluate((boxId) => {
      const scene = window.__fw.scene3d.scene;
      const root = scene.getObjectByName(`DeliveryBox_${boxId}`);
      const recycling = scene.getObjectByName('DeliveryRecyclingStationAuthored');
      const names = [];
      let authoredAssetMetadata = null;
      root?.traverse((object) => {
        if (object.name) names.push(object.name);
        if (object.userData?.asset_id === 'delivery_golf_club_box') authoredAssetMetadata = { ...object.userData };
      });
      const requiredNodes = [
        'BOX_BASE',
        'BOX_WALL_FRONT', 'BOX_WALL_BACK', 'BOX_WALL_LEFT', 'BOX_WALL_RIGHT',
        'BOX_FLAP_FRONT', 'BOX_FLAP_BACK', 'BOX_FLAP_LEFT', 'BOX_FLAP_RIGHT',
        'FLAP_TOP_FRONT', 'FLAP_TOP_BACK', 'FLAP_TOP_LEFT', 'FLAP_TOP_RIGHT',
        'TAPE_CENTER',
        ...Array.from({ length: 12 }, (_, index) => `TAPE_CENTER_SEG_${String(index + 1).padStart(2, '0')}`),
        'LABEL_MAIN', 'LABEL_SHIPPING', 'LABEL_DYNAMIC',
        'INSERT_BOTTOM', 'INSERT_SIDE_FRONT', 'INSERT_SIDE_BACK',
        'END_PADDING_LEFT', 'END_PADDING_RIGHT',
        'SHAFT_SUPPORT_01', 'SHAFT_SUPPORT_02', 'HEAD_SUPPORT_01', 'HEAD_SUPPORT_02',
        'COLLISION_CLOSED', 'COLLISION_OPEN',
        'INTERACTION_TARGET', 'CUT_PATH', 'VOLUME_CONTENTS',
        'BOX_FLAT_BUNDLE', 'FLAT_PANEL_BASE', 'FLAT_PANEL_FRONT',
        'FLAT_PANEL_BACK', 'FLAT_PANEL_LEFT', 'FLAT_PANEL_RIGHT', 'FLAT_LABEL',
      ];
      const slots = Array.from({ length: 2 }, (_, index) => `CONTENT_SLOT_${String(index + 1).padStart(2, '0')}`);
      const slotMetadata = slots.map((name) => {
        const slot = root?.getObjectByName(name);
        return {
          name,
          exists: !!slot,
          allowedCategory: slot?.userData?.allowed_category ?? null,
          maxW: slot?.userData?.max_w ?? null,
          maxD: slot?.userData?.max_d ?? null,
          maxH: slot?.userData?.max_h ?? null,
          stackOrder: slot?.userData?.stack_order ?? null,
          visibilityThreshold: slot?.userData?.visibility_threshold ?? null,
          removalOrder: slot?.userData?.removal_order ?? null,
        };
      });
      const actualClubNames = names.filter((name) => /^BOX_CONTENT_\d{2}_driver1$/.test(name));
      return {
        authoredBox: !!root,
        authoredAssetRoot: !!root?.getObjectByName('delivery_golf_club_box') || !!authoredAssetMetadata,
        authoredAssetMetadata,
        authoredRecycling: !!recycling,
        requiredNodes,
        missingRequiredNodes: requiredNodes.filter((name) => !root?.getObjectByName(name)),
        flatBundle: !!root?.getObjectByName('BOX_FLAT_BUNDLE'),
        fourFlaps: ['FRONT', 'BACK', 'LEFT', 'RIGHT'].every((side) => !!root?.getObjectByName(`BOX_FLAP_${side}`)),
        fourWalls: ['FRONT', 'BACK', 'LEFT', 'RIGHT'].every((side) => !!root?.getObjectByName(`BOX_WALL_${side}`)),
        contentSlots: names.filter((name) => name.startsWith('CONTENT_SLOT_')).length,
        slotMetadata,
        actualProducts: names.filter((name) => name.startsWith('BOX_CONTENT_')).length,
        actualClubProducts: actualClubNames.length,
        actualClubNames,
        endTapeReturns: names.filter((name) => /^TAPE_(END|SIDE)_/.test(name)).length,
        tapeSegments: names.filter((name) => name.startsWith('TAPE_') && !name.includes('PEELED')).length,
        shippingLabel: names.some((name) => name.includes('LABEL_DYNAMIC') || name.includes('LABEL_SHIPPING')),
        sceneNames: names,
      };
    }, id);
  }

  async function openCartonByPresses(id) {
    // Press one tears the tape in a single press and swings the wide flap pair
    // open; press two folds the other pair. No tool, no equip, no drag —
    // proshop-box-open-loop.js owns the gesture contract.
    await waitForFocus(/tear the tape open/i);
    await page.keyboard.press('e');
    await waitForBox(id, 'cut', 5000);
    await waitForFocus(/open the other flap/i);
    await page.keyboard.press('e');
    await waitForBox(id, 'open', 5000);
  }

  async function waitForStableScene() {
    await page.evaluate(() => { delete window.__clubBoxStableScene; });
    await page.waitForFunction(() => {
      const scene = window.__fw?.scene3d?.scene;
      if (!scene) return false;
      const counts = { objects: 0, meshes: 0, materials: new Set(), geometries: new Set() };
      scene.traverseVisible((object) => {
        counts.objects += 1;
        if (!object.isMesh) return;
        counts.meshes += 1;
        if (object.geometry) counts.geometries.add(object.geometry.uuid);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if (material) counts.materials.add(material.uuid);
      });
      const signature = `${counts.objects}|${counts.meshes}|${counts.geometries.size}|${counts.materials.size}`;
      const prior = window.__clubBoxStableScene || { signature: '', repeats: 0 };
      window.__clubBoxStableScene = signature === prior.signature
        ? { signature, repeats: prior.repeats + 1 }
        : { signature, repeats: 0 };
      return window.__clubBoxStableScene.repeats >= 5;
    }, null, { timeout: 20000, polling: 250 });
  }

  async function stockCurrentArmful() {
    await setCamera(cameras.clubRack);
    const before = await waitForFocus(/Drivers & woods.*hold \[E\] to stock/i);
    await page.keyboard.down('e');
    try {
      await waitCarry(0, 5000);
    } finally {
      await page.keyboard.up('e').catch(() => {});
    }
    await page.waitForTimeout(650); // let the authored stock-flight settle into its slots
    return { fixtureId: 'rack_drivers', before, after: await focusInfo() };
  }

  async function chooseRecyclingFocus() {
    const candidates = [
      cameras.recycling,
      { x: 9.10, z: 1.3, yaw: -Math.PI / 2, pitch: -0.46 },
      { x: 9.85, z: -0.15, yaw: Math.PI, pitch: -0.42 },
    ];
    for (const pose of candidates) {
      await setCamera(pose);
      const info = await focusInfo();
      if (/Recycling.*drop the flattened carton/i.test(info.label || '')) return { pose, info };
    }
    throw new Error(`Could not focus the recycling-bin drop action; last focus was ${JSON.stringify(await focusInfo())}.`);
  }

  async function sampleStableLongCarryPose(id) {
    await page.waitForTimeout(900);
    return page.evaluate(async (boxId) => {
      const scene3d = window.__fw.scene3d;
      const root = scene3d.scene.getObjectByName(`DeliveryBox_${boxId}`);
      const hands = scene3d.camera.getObjectByName('DeliveryBoxCarryHands');
      if (!root || !hands) return { stable: false, reason: 'carried carton or two-hand rig missing' };
      const samples = [];
      for (let index = 0; index < 18; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        samples.push({
          x: root.position.x, y: root.position.y, z: root.position.z,
          rx: root.rotation.x, ry: root.rotation.y, rz: root.rotation.z,
          handY: hands.position.y,
        });
      }
      const range = (key) => Math.max(...samples.map((sample) => sample[key]))
        - Math.min(...samples.map((sample) => sample[key]));
      const ranges = Object.fromEntries(['x', 'y', 'z', 'rx', 'ry', 'rz', 'handY']
        .map((key) => [key, +range(key).toFixed(5)]));
      const localPose = {
        position: { x: +root.position.x.toFixed(4), y: +root.position.y.toFixed(4), z: +root.position.z.toFixed(4) },
        rotation: { x: +root.rotation.x.toFixed(4), y: +root.rotation.y.toFixed(4), z: +root.rotation.z.toFixed(4) },
      };
      const handPositions = hands.children.map((hand) => ({
        side: Number(hand.userData.side),
        x: +hand.position.x.toFixed(4),
        y: +hand.position.y.toFixed(4),
        z: +hand.position.z.toFixed(4),
      }));
      const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
      const flat = !!box?.flat;
      const sealedState = !flat && box?.loc === 'carried'
        && (box.cutProgress ?? box.tape ?? 0) === 0
        && (box.flapProgress || []).every((value) => value === 0);
      const lifecycleStateMatches = flat ? box?.loc === 'carried' : sealedState;
      const exactProfile = root.userData.deliveryRuntimeCarryProfile === 'long-two-hand-diagonal';
      const parentedToCamera = root.parent === scene3d.camera && hands.parent === scene3d.camera;
      const poseMatches = Math.abs(localPose.position.x) <= 0.001
        && Math.abs(localPose.position.y - (flat ? -0.28 : -0.58)) <= 0.013
        && Math.abs(localPose.position.z + (flat ? 1.28 : 1.30)) <= 0.002
        && Math.abs(localPose.rotation.x - (flat ? 1.12 : 0.02)) <= 0.002
        && Math.abs(localPose.rotation.y - (flat ? 0.08 : 0.78)) <= 0.002
        && Math.abs(localPose.rotation.z + (flat ? 0.14 : 0.16)) <= 0.002;
      const frameStable = ranges.x <= 0.001 && ranges.z <= 0.001
        && ranges.rx <= 0.001 && ranges.ry <= 0.001 && ranges.rz <= 0.001
        && ranges.y <= 0.026 && ranges.handY <= 0.026;
      const handsBraceLongCase = hands.visible && hands.children.length === 2
        && handPositions.every((hand) => Math.abs(
          hand.x - hand.side * (flat ? 0.425 : 0.2375),
        ) <= 0.004)
        && handPositions.every((hand) => Math.abs(
          hand.z - (flat ? -0.91 : -1.30 - hand.side * 0.24),
        ) <= 0.004);
      return {
        stable: exactProfile && parentedToCamera && poseMatches && frameStable
          && handsBraceLongCase && lifecycleStateMatches,
        sampleCount: samples.length,
        mode: flat ? 'flat' : 'sealed',
        profile: root.userData.deliveryRuntimeCarryProfile || null,
        parentedToCamera,
        localPose,
        ranges,
        hands: { visible: hands.visible, count: hands.children.length, positions: handPositions },
        lifecycle: {
          loc: box?.loc || null,
          flat,
          cutProgress: box?.cutProgress ?? box?.tape ?? null,
          flapProgress: [...(box?.flapProgress || [])],
          stateMatches: lifecycleStateMatches,
        },
        contracts: {
          root: flat
            ? 'camera-local (0, -0.28±0.012 bob, -1.28), rotation (1.12, 0.08, -0.14)'
            : 'camera-local (0, -0.58±0.012 bob, -1.30), rotation (0.02, 0.78, -0.16)',
          hands: flat
            ? 'two visible camera-local braces at ±0.425 m X and -0.91 m Z'
            : 'two visible lengthwise braces at ±0.2375 m X and -1.30∓0.24 m Z',
          stability: '18 consecutive animation frames; only bounded carry bob may vary',
        },
      };
    }, id);
  }

  async function traverseReceivingDoorWithSealedCarton() {
    const staged = await stageClubBox({
      orderId: fixtureOrderId - 1,
      qty: fixtureQty,
      resetDelivery: true,
      atPad: true,
    });
    const pickup = await deliveredBoxPickupCamera(staged.id);
    await setCamera(pickup.camera);
    // Every surface opens a carton now, the pad included, so E on the sealed
    // case would tear the tape. X is the carry verb; Z is its inverse.
    pickup.focus = await waitForFocus(/Fairline driver case.*tear the tape open/i);
    await page.keyboard.press('x');
    await waitForBox(staged.id, 'loc:carried');
    await page.waitForFunction((boxId) => {
      const root = window.__fw?.scene3d?.scene?.getObjectByName(`DeliveryBox_${boxId}`);
      return root?.parent === window.__fw.scene3d.camera
        && root.userData.deliveryRuntimeCarryProfile === 'long-two-hand-diagonal';
    }, staged.id, { timeout: 5000 });

    // The apron pickup and doorway traversal are deliberately separate. Put
    // the carried carton at the unchanged exterior lane start, then measure
    // only normal straight-W input across the same threshold as before.
    await setCamera(cameras.receivingDoorExterior);
    const start = await page.evaluate(() => {
      const origin = window.__fw.scene3d.clubhouse().interior.position;
      const walk = window.__fw.scene3d.walk.state;
      return { x: walk.x - origin.x, z: walk.z - origin.z };
    });

    await page.evaluate(() => {
      window.__clubDoorPath = [];
      let frame = 0;
      const sample = () => {
        const app = window.__fw;
        const origin = app.scene3d.clubhouse().interior.position;
        const walk = app.scene3d.walk.state;
        if (frame % 3 === 0) {
          window.__clubDoorPath.push({
            x: +(walk.x - origin.x).toFixed(4),
            z: +(walk.z - origin.z).toFixed(4),
            pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
          });
        }
        frame += 1;
        window.__clubDoorPathRaf = requestAnimationFrame(sample);
      };
      sample();
    });
    let reachedInside = false;
    await page.keyboard.down('w');
    try {
      await page.waitForFunction(() => {
        const app = window.__fw;
        const origin = app.scene3d.clubhouse().interior.position;
        return app.scene3d.walk.state.x - origin.x <= 9.45;
      }, null, { timeout: 10000 });
      reachedInside = true;
    } catch (error) {
      if (!/Timeout/i.test(String(error?.message || error))) throw error;
    } finally {
      await page.keyboard.up('w').catch(() => {});
    }
    await page.evaluate(() => cancelAnimationFrame(window.__clubDoorPathRaf));
    const end = await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      return {
        x: +(walk.x - origin.x).toFixed(4),
        z: +(walk.z - origin.z).toFixed(4),
        pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
        path: window.__clubDoorPath || [],
        carryCollisionRadius: app.scene3d.clubhouse().carryCollisionRadius?.() ?? null,
      };
    });
    const stablePose = await sampleStableLongCarryPose(staged.id);
    await capture(
      '00-receiving-doorway-carried-sealed.png',
      staged.id,
      reachedInside
        ? 'Straight normal W carries the sealed 1.25 m carton lengthwise through the centered 1.50 m receiving doorway; the two-hand pose is stable.'
        : 'Runtime blocker: straight normal W leaves the lengthwise sealed 1.25 m carton stopped outside the open 1.50 m receiving doorway.',
      'straight normal-W receiving-door traversal',
    );
    if (reachedInside) {
      await waitForFocus(/Carrying Fairline driver/i);
      await page.keyboard.press('z'); // Z sets the carried carton down one pace ahead
      await page.waitForFunction((boxId) => {
        const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
        return box?.loc === 'world';
      }, staged.id, { timeout: 5000 });
    }
    const path = end.path;
    const doorLaneSamples = path.filter((sample) => sample.x <= 10.75 && sample.x >= 9.45);
    return {
      boxId: staged.id,
      apronPickup: pickup,
      controls: ['pointer lock', 'X pick up', 'straight W through doorway', 'Z set down'],
      movementInput: 'keyboard-only straight W; no camera-position mutation during traversal',
      start: { x: +start.x.toFixed(4), z: +start.z.toFixed(4) },
      end: { x: end.x, z: end.z },
      samples: path,
      sampleCount: path.length,
      reachedInside,
      crossedReceivingWall: reachedInside && start.x > 10.25 && end.x < 10.25
        && path.some((sample) => sample.x > 10.25)
        && path.some((sample) => sample.x < 10.25),
      safeDoorSampleCount: doorLaneSamples.length,
      stayedInDoorLane: doorLaneSamples.length >= 2
        && doorLaneSamples.every((sample) => Math.abs(sample.z + 3.60) <= 0.08),
      onlyKeyboardMovement: true,
      pointerLockHeld: end.pointerLocked && path.every((sample) => sample.pointerLocked),
      carryCollisionRadius: end.carryCollisionRadius,
      stablePose,
    };
  }

  async function warmExactFixtureResidencyAndRestore(staged) {
    const sealedSnapshot = await page.evaluate((boxId) => {
      const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
      return JSON.parse(JSON.stringify(box));
    }, staged.id);

    await setCamera(cameras.box);
    await openCartonByPresses(staged.id);
    await setCamera(cameras.boxOpen);
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    await page.waitForTimeout(450);

    await waitForFocus(/take an armful/i);
    await page.keyboard.press('e');
    await waitForBox(staged.id, 'qty:0');
    await waitCarry(2);
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    await page.waitForTimeout(450);
    await stockCurrentArmful();
    await page.waitForTimeout(900);

    await setCamera(cameras.boxOpen);
    await waitForFocus(/Empty Fairline driver box.*flatten/i);
    await page.keyboard.press('e');
    await waitForBox(staged.id, 'flat', 4000);
    await page.waitForTimeout(450);
    await page.keyboard.press('e');
    await waitForBox(staged.id, 'loc:carried');
    await chooseRecyclingFocus();
    await page.waitForTimeout(450);

    const rendererMemoryAfterWarm = await page.evaluate(() => ({
      geometries: window.__fw.scene3d.renderer.info.memory.geometries,
      textures: window.__fw.scene3d.renderer.info.memory.textures,
      programs: window.__fw.scene3d.renderer.info.programs?.length ?? null,
    }));
    await page.evaluate(({ boxId, snapshot }) => {
      const app = window.__fw;
      const state = app.state;
      const box = state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
      for (const key of Object.keys(box)) delete box[key];
      Object.assign(box, snapshot);
      state.shop.carry = null;
      state.shop.inventory.driver1.shelf = 0;
      state.shop.inventory.driver1.back = 0;
      state.shop.deliveries.recycled = 0;
      state.shop.deliveries.trash = 0;
      const clubhouse = app.scene3d.clubhouse();
      clubhouse.rebuildStock?.();
      clubhouse.rebuildBoxes();
    }, { boxId: staged.id, snapshot: sealedSnapshot });
    await waitForBox(staged.id, 'loc:world');
    await setCamera(cameras.box);
    await waitForFocus(/tear the tape open/i);
    await waitForStableScene();
    return {
      boxId: staged.id,
      restoredSameBoxView: true,
      preBaselineRenderedStates: [
        'open-qty-2-boxOpen-450ms',
        'carried-two-clubs-450ms',
        'flat-bundle-450ms',
        'carried-flat-at-recycling-450ms',
      ],
      rendererMemoryAfterWarm,
      restored: await boxSnapshot(staged.id),
    };
  }

  // Count actual WebGL calls across every pass by wrapping draw entry points.
  // This deliberately does not read or reset renderer.info, which EffectComposer
  // resets between passes and can otherwise report only its final fullscreen quad.
  await page.evaluate(() => {
    const renderer = window.__fw.scene3d.renderer;
    const gl = renderer.getContext();
    if (window.__clubBoxDrawProbe) return;
    const probe = {
      active: false,
      calls: 0,
      triangles: 0,
      frames: [],
      begin() { this.active = true; this.calls = 0; this.triangles = 0; this.frames = []; },
      end() { this.active = false; return this.frames.slice(4); },
    };
    const trianglesFor = (mode, count, instances) => {
      const n = Math.max(0, Number(count) || 0);
      const copies = Math.max(1, Number(instances) || 1);
      if (mode === gl.TRIANGLES) return Math.floor(n / 3) * copies;
      if (mode === gl.TRIANGLE_STRIP || mode === gl.TRIANGLE_FAN) return Math.max(0, n - 2) * copies;
      return 0;
    };
    const wrap = (name, countIndex, modeIndex, instanceIndex = -1) => {
      const original = gl[name];
      if (typeof original !== 'function') return;
      gl[name] = function wrappedDraw(...args) {
        if (probe.active) {
          probe.calls += 1;
          probe.triangles += trianglesFor(args[modeIndex], args[countIndex], instanceIndex >= 0 ? args[instanceIndex] : 1);
        }
        return original.apply(this, args);
      };
    };
    wrap('drawArrays', 2, 0);
    wrap('drawElements', 1, 0);
    wrap('drawArraysInstanced', 2, 0, 3);
    wrap('drawElementsInstanced', 1, 0, 4);
    const rollFrame = () => {
      if (probe.active) {
        probe.frames.push({ calls: probe.calls, triangles: probe.triangles });
        probe.calls = 0;
        probe.triangles = 0;
      }
      requestAnimationFrame(rollFrame);
    };
    requestAnimationFrame(rollFrame);
    window.__clubBoxDrawProbe = probe;
  });

  async function domCounters() {
    const counters = await cdp.send('Memory.getDOMCounters');
    const performanceMetrics = await cdp.send('Performance.getMetrics');
    const byName = Object.fromEntries(performanceMetrics.metrics.map((entry) => [entry.name, entry.value]));
    return {
      documents: counters.documents,
      domNodes: counters.nodes,
      jsEventListeners: counters.jsEventListeners,
      jsHeapUsedBytes: Number.isFinite(byName.JSHeapUsedSize) ? byName.JSHeapUsedSize : null,
      jsHeapTotalBytes: Number.isFinite(byName.JSHeapTotalSize) ? byName.JSHeapTotalSize : null,
      source: 'Chrome DevTools Protocol Memory.getDOMCounters + Performance.getMetrics',
    };
  }

  async function collectGarbage() {
    // Heap deltas are intended to detect retained lifecycle resources, not
    // whether V8 happened to collect short-lived render/QA allocations before
    // one of the two samples. CDP collection makes the strict 8 MiB gate
    // repeatable while leaving the live scene and its resources untouched.
    await cdp.send('HeapProfiler.enable').catch(() => {});
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  }

  async function startMeasurement() {
    await page.evaluate(() => {
      const targets = ['.shop-prompt', '.topbar', '.hud-min', '.toast-wrap']
        .map((selector) => ({ selector, node: document.querySelector(selector) }))
        .filter((entry) => entry.node);
      const ui = { records: 0, callbacks: 0, targets: targets.map((entry) => entry.selector), observers: [] };
      for (const entry of targets) {
        const observer = new MutationObserver((records) => { ui.callbacks += 1; ui.records += records.length; });
        observer.observe(entry.node, { attributes: true, childList: true, characterData: true, subtree: true });
        ui.observers.push(observer);
      }
      const frame = { deltas: [], last: performance.now(), running: true };
      const tick = (time) => {
        if (!frame.running) return;
        frame.deltas.push(time - frame.last);
        frame.last = time;
        requestAnimationFrame(tick);
      };
      window.__clubBoxDrawProbe.begin();
      requestAnimationFrame(tick);
      window.__clubBoxMetric = { ui, frame, startedAt: performance.now() };
    });
  }

  async function stopMeasurement() {
    return page.evaluate(() => {
      const metric = window.__clubBoxMetric;
      metric.frame.running = false;
      metric.ui.observers.forEach((observer) => observer.disconnect());
      const elapsedMs = performance.now() - metric.startedAt;
      const deltas = metric.frame.deltas.slice(5).sort((a, b) => a - b);
      const avg = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
      const worstCount = Math.max(1, Math.ceil(deltas.length * 0.01));
      const lowWindowMs = deltas.slice(-worstCount).reduce((sum, value) => sum + value, 0) / worstCount;
      const drawFrames = window.__clubBoxDrawProbe.end();
      const drawAvg = (key) => drawFrames.reduce((sum, frame) => sum + frame[key], 0) / Math.max(1, drawFrames.length);
      const drawMax = (key) => drawFrames.reduce((greatest, frame) => Math.max(greatest, frame[key]), 0);

      const scene = window.__fw.scene3d.scene;
      const renderer = window.__fw.scene3d.renderer;
      const geometries = new Set();
      const materials = new Set();
      const textures = new Map();
      let meshes = 0;
      let visibleSceneTriangles = 0;
      const rememberTexture = (texture) => {
        if (!texture?.isTexture || textures.has(texture.uuid)) return;
        const data = texture.source?.data ?? texture.image;
        const images = Array.isArray(data) ? data : [data];
        let bytes = 0;
        for (const image of images) {
          const width = image?.videoWidth || image?.naturalWidth || image?.width || 0;
          const height = image?.videoHeight || image?.naturalHeight || image?.height || 0;
          if (width && height) bytes += width * height * 4 * (texture.generateMipmaps === false ? 1 : 4 / 3);
        }
        textures.set(texture.uuid, Math.round(bytes));
      };
      scene.traverseVisible((object) => {
        if (!object.isMesh && !object.isPoints && !object.isLine) return;
        meshes += 1;
        if (object.geometry) {
          geometries.add(object.geometry.uuid);
          const count = object.geometry.index?.count || object.geometry.attributes?.position?.count || 0;
          const copies = object.isInstancedMesh ? object.count : 1;
          if (object.isMesh) visibleSceneTriangles += Math.floor(count / 3) * copies;
        }
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const value of Object.values(material)) rememberTexture(value);
        }
      });
      const estimatedTextureBytes = [...textures.values()].reduce((sum, value) => sum + value, 0);
      return {
        elapsedMs,
        frames: deltas.length,
        avgFps: +(1000 / avg).toFixed(2),
        low1Fps: +(1000 / lowWindowMs).toFixed(2),
        avgFrameMs: +avg.toFixed(3),
        worstFrameMs: deltas.length ? +deltas[deltas.length - 1].toFixed(3) : null,
        p95FrameMs: deltas.length ? +deltas[Math.floor((deltas.length - 1) * 0.95)].toFixed(3) : null,
        framesOver33ms: deltas.filter((value) => value > 33.334).length,
        actualGlDrawCallsPerFrame: +drawAvg('calls').toFixed(2),
        maxGlDrawCallsInFrame: drawMax('calls'),
        actualGlTrianglesPerFrame: Math.round(drawAvg('triangles')),
        maxGlTrianglesInFrame: drawMax('triangles'),
        drawProbeFrames: drawFrames.length,
        visibleSceneMeshes: meshes,
        visibleSceneGeometries: geometries.size,
        visibleSceneTriangles: Math.round(visibleSceneTriangles),
        visibleSceneMaterials: materials.size,
        visibleSceneTextures: textures.size,
        estimatedVisibleTextureBytesRGBA8: estimatedTextureBytes,
        rendererGeometriesInMemory: renderer.info.memory.geometries,
        rendererTexturesInMemory: renderer.info.memory.textures,
        rendererProgramsInMemory: renderer.info.programs?.length ?? null,
        uiMutationRecords: metric.ui.records,
        uiMutationCallbacks: metric.ui.callbacks,
        uiMutationRecordsPerSecond: +(metric.ui.records / Math.max(0.001, elapsedMs / 1000)).toFixed(2),
        uiTargets: metric.ui.targets,
      };
    });
  }

  async function measure(name) {
    await page.waitForTimeout(900);
    await collectGarbage();
    const countersBefore = await domCounters();
    await startMeasurement();
    await page.waitForTimeout(sampleMs);
    const browser = await stopMeasurement();
    await collectGarbage();
    const countersAfter = await domCounters();
    return { name, sampleMs, ...browser, countersBefore, countersAfter };
  }

  const median = (values) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  async function measureMatchedPair(name) {
    const runs = [];
    for (let index = 1; index <= 2; index += 1) {
      runs.push(await measure(`${name}-run-${index}`));
    }
    const aggregate = {
      name,
      methodology: 'Median of two consecutive matched fixed-camera samples; each run uses the same sampleMs and scene state.',
      sampleMs,
      runs,
    };
    for (const key of Object.keys(runs[0])) {
      if (runs.every((run) => Number.isFinite(run[key]))) aggregate[key] = median(runs.map((run) => run[key]));
    }
    const aggregateCounters = (key) => {
      const samples = runs.map((run) => run[key]);
      const combined = { source: samples[0].source };
      for (const field of Object.keys(samples[0])) {
        if (samples.every((entry) => Number.isFinite(entry[field]))) combined[field] = median(samples.map((entry) => entry[field]));
      }
      return combined;
    };
    aggregate.countersBefore = aggregateCounters('countersBefore');
    aggregate.countersAfter = aggregateCounters('countersAfter');
    aggregate.uiTargets = runs[runs.length - 1].uiTargets;
    return aggregate;
  }

  const captures = [];
  async function capture(fileName, boxId, note, cameraName) {
    const filePath = path.join(out, fileName);
    await page.screenshot({ path: filePath });
    const actualCamera = await page.evaluate(() => {
      const app = window.__fw;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      return {
        x: +(walk.x - origin.x).toFixed(3),
        z: +(walk.z - origin.z).toFixed(3),
        yaw: +walk.yaw.toFixed(4),
        pitch: +walk.pitch.toFixed(4),
        pointerLocked: document.pointerLockElement === document.querySelector('canvas'),
      };
    });
    const visual = boxId == null ? null : await page.evaluate((id) => {
      const root = window.__fw.scene3d.scene.getObjectByName(`DeliveryBox_${id}`);
      if (!root) return null;
      const products = [];
      root.updateWorldMatrix(true, true);
      root.traverse((object) => {
        if (!object.name?.startsWith('BOX_CONTENT_')) return;
        const world = object.getWorldPosition({
          x: 0, y: 0, z: 0,
          set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
          setFromMatrixPosition(matrix) {
            const elements = matrix.elements;
            this.x = elements[12]; this.y = elements[13]; this.z = elements[14];
            return this;
          },
        });
        products.push({ name: object.name, visible: object.visible, worldY: +world.y.toFixed(3) });
      });
      return {
        productsTotal: products.length,
        productsVisible: products.filter((product) => product.visible).length,
        products,
      };
    }, boxId);
    const stockState = await page.evaluate(() => ({
      carry: window.__fw.state.shop.carry ? { ...window.__fw.state.shop.carry } : null,
      shelf: window.__fw.state.shop.inventory.driver1.shelf,
      back: window.__fw.state.shop.inventory.driver1.back,
    }));
    captures.push({
      file: filePath,
      note,
      camera: cameraName,
      actualCamera,
      visual,
      stockState,
      focus: await focusInfo(),
      box: boxId == null ? null : await boxSnapshot(boxId),
    });
    fs.writeFileSync(path.join(out, 'run-state.json'), JSON.stringify({
      status: 'running', phase, iteration, captures, updatedAt: new Date().toISOString(),
    }, null, 2));
  }

  const receivingDoorTraversal = await traverseReceivingDoorWithSealedCarton();

  // Warm every ref-48 state on the exact box view used by the baseline, then
  // restore that same object to its sealed snapshot. Recycling a throwaway warm
  // box would dispose its catalog-proxy geometries and create a false +N GPU
  // growth result when the post-cycle fixture is rendered.
  const fixtureCase = await stageClubBox({
    orderId: fixtureOrderId,
    qty: fixtureQty,
    resetDelivery: true,
  });
  const residencyWarmCycle = await warmExactFixtureResidencyAndRestore(fixtureCase);
  for (const pose of [
    cameras.packingBench,
    cameras.clubRack,
    cameras.recycling,
    cameras.boxOpen,
    cameras.box,
  ]) {
    await setCamera(pose);
    await page.waitForTimeout(420);
  }
  await waitForStableScene();
  await page.waitForTimeout(1800);
  const assets = await assetContract(fixtureCase.id);
  await setCamera(cameras.box);
  await waitForFocus(/tear the tape open/i);
  await capture(
    '01-sealed-long-club-carton.png',
    fixtureCase.id,
    'Sealed authored 1.25 × 0.18 × 0.18 m Fairline two-club carton at the clean stockroom fixture; the focus prompt offers the first press: tear the tape.',
    'box',
  );

  const performance = {};
  performance.preCycle = await measureMatchedPair('identical-sealed-club-carton-before-cycles');
  await waitForFocus(/tear the tape open/i);
  await page.keyboard.press('e');
  await waitForBox(fixtureCase.id, 'cut', 5000);
  await capture(
    '02-tape-press.png',
    fixtureCase.id,
    'The first E press tears the full segmented 1.25 m tape run in one motion — no tool is equipped.',
    'box',
  );

  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flapProgress?.[2] || 0) > 0.25;
  }, fixtureCase.id, { timeout: 4000 });
  await capture(
    '03-wide-pair-opening.png',
    fixtureCase.id,
    'The same first press swings the wide facing flap pair on its authored hinges.',
    'box',
  );
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flapProgress?.[2] || 0) >= 0.999 && (box?.flapProgress?.[3] || 0) >= 0.999
      && (box?.flapProgress?.[0] || 0) < 0.001;
  }, fixtureCase.id, { timeout: 4000 });
  await capture(
    '04-wide-pair-open.png',
    fixtureCase.id,
    'Press one complete: tape torn and the wide pair open; the narrow pair still closes the carton.',
    'box',
  );

  await setCamera(cameras.boxOpen);
  await waitForFocus(/open the other flap/i);
  await page.keyboard.press('e');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flapProgress?.[0] || 0) > 0.25;
  }, fixtureCase.id, { timeout: 4000 });
  await capture(
    '05-other-flap-press.png',
    fixtureCase.id,
    'The second E press folds the narrow flap pair on its authored hinges.',
    'boxOpen',
  );
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flapProgress?.[0] || 0) > 0.78;
  }, fixtureCase.id, { timeout: 4000 });
  await capture(
    '06-narrow-pair-opening.png',
    fixtureCase.id,
    'The narrow pair clears the two club sockets as the second press finishes.',
    'boxOpen',
  );
  await waitForBox(fixtureCase.id, 'open', 4000);
  await setCamera(cameras.boxOpen);
  await capture(
    '07-open-two-clubs.png',
    fixtureCase.id,
    'Open authored carton exposes exactly two actual Fairline driver catalog proxies in the long sockets.',
    'boxOpen',
  );

  // The third press takes the full category armful: the honest quantity and
  // visible authored-product contract is exactly 2 -> 0.
  await waitForFocus(/take an armful/i);
  await page.keyboard.press('e');
  await waitForBox(fixtureCase.id, 'qty:0');
  await waitCarry(2);
  await capture(
    '08-qty-zero-long-club-armful.png',
    fixtureCase.id,
    'Both real driver proxies leave the carton in one honest two-club armful; the open carton shows zero.',
    'boxOpen',
  );
  const clubRackStocking = await stockCurrentArmful();
  await capture(
    '09-two-clubs-stocked-drivers-rack.png',
    fixtureCase.id,
    'The two-club armful lands on the real Drivers & woods fixture through the normal hold-E stock path.',
    'clubRack',
  );

  await setCamera(cameras.boxOpen);
  await waitForFocus(/Empty Fairline driver box.*flatten/i);
  await capture(
    '10-empty-long-carton.png',
    fixtureCase.id,
    'The empty reinforced long carton persists after both clubs are stocked.',
    'boxOpen',
  );
  await page.waitForTimeout(2200);
  await page.keyboard.press('e');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    return (box?.flattenProgress || 0) >= 0.52 && (box?.flattenProgress || 0) < 0.92;
  }, fixtureCase.id, { timeout: 2500 });
  await capture(
    '11-flattening-long-carton.png',
    fixtureCase.id,
    'Long walls and four flaps are partway through the authored flattening animation.',
    'boxOpen',
  );
  await waitForBox(fixtureCase.id, 'flat', 4000);
  await page.waitForTimeout(1800);
  await capture(
    '12-flat-long-carton.png',
    fixtureCase.id,
    'The 1.25 m carton is fully folded into its authored long flat bundle.',
    'boxOpen',
  );

  await page.keyboard.press('e');
  await waitForBox(fixtureCase.id, 'loc:carried');
  const stableFlatCarry = await sampleStableLongCarryPose(fixtureCase.id);
  await capture(
    '13-long-flat-carton-carried.png',
    fixtureCase.id,
    'The authored long flat bundle is carried at full scale in the two-hand long-carton pose.',
    'boxOpen',
  );
  const recyclingFocus = await chooseRecyclingFocus();
  await capture(
    '14-long-flat-carton-recycling-ready.png',
    fixtureCase.id,
    'The carried long flat bundle is aligned with the physical recycling station.',
    'recycling',
  );
  await page.keyboard.press('e');
  await page.waitForFunction((boxId) => {
    const box = window.__fw.state.shop.deliveries.boxes.find((candidate) => candidate.id === boxId);
    const root = window.__fw.scene3d.scene.getObjectByName(`DeliveryBox_${boxId}`);
    return !!box && box.loc === 'carried' && !!root && root.position.y < -0.58;
  }, fixtureCase.id, { timeout: 2500 });
  await capture(
    '15-long-flat-carton-recycling-drop.png',
    fixtureCase.id,
    'The long flat bundle visibly descends into the authored recycling station.',
    'recycling',
  );
  await waitForBox(fixtureCase.id, 'gone', 4000);
  await page.waitForTimeout(2200);
  await capture(
    '16-long-carton-recycled.png',
    fixtureCase.id,
    'The ref-48 carton is gone only after the normal recycling-bin action.',
    'recycling',
  );

  const mainRoute = await page.evaluate(() => ({
    shelf: window.__fw.state.shop.inventory.driver1.shelf,
    back: window.__fw.state.shop.inventory.driver1.back,
    carry: window.__fw.state.shop.carry,
    liveBoxes: window.__fw.state.shop.deliveries.boxes.length,
    recycled: window.__fw.state.shop.deliveries.recycled || 0,
    trash: window.__fw.state.shop.deliveries.trash || 0,
  }));

  async function runCompactNormalCycle(index, resetDelivery = index === 1, units = fixtureQty) {
    const orderId = 950100 + index;
    const staged = await stageClubBox({ orderId, qty: units, resetDelivery });
    await setCamera(cameras.box);
    await openCartonByPresses(staged.id);
    await waitForFocus(/take an armful/i);
    await page.keyboard.press('e');
    await waitForBox(staged.id, 'qty:0');
    await waitCarry(2);
    await stockCurrentArmful();
    await setCamera(cameras.boxOpen);
    await waitForFocus(/Empty Fairline driver box.*flatten/i);
    await page.keyboard.press('e');
    await waitForBox(staged.id, 'flat', 4000);
    await page.keyboard.press('e');
    await waitForBox(staged.id, 'loc:carried');
    await chooseRecyclingFocus();
    await page.keyboard.press('e');
    await waitForBox(staged.id, 'gone', 4000);
    return {
      index,
      orderId,
      units,
      quantityPath: [2, 0],
      stockedTo: 'rack_drivers',
      recycled: true,
    };
  }

  await collectGarbage();
  const countersBeforeStress = await domCounters();
  const stressCycles = [];
  for (let index = 1; index <= 3; index += 1) {
    stressCycles.push(await runCompactNormalCycle(index));
  }
  const stressState = await page.evaluate(() => ({
    liveBoxes: window.__fw.state.shop.deliveries.boxes.length,
    recycled: window.__fw.state.shop.deliveries.recycled || 0,
    trash: window.__fw.state.shop.deliveries.trash || 0,
    carry: window.__fw.state.shop.carry,
  }));
  await collectGarbage();
  const countersAfterStress = await domCounters();

  // Recreate the exact sealed ref-48 fixture and camera used by preCycle. Any
  // retained listeners, views, or GPU resources now appear as matched growth.
  const postFixture = await stageClubBox({
    orderId: fixtureOrderId,
    qty: fixtureQty,
    resetDelivery: true,
  });
  await setCamera(cameras.box);
  await waitForFocus(/tear the tape open/i);
  await waitForStableScene();
  performance.postThreeCycles = await measureMatchedPair('identical-sealed-club-carton-after-3-normal-cycles');
  await capture(
    '17-post-3-cycles-identical-sealed.png',
    postFixture.id,
    'Matched sealed ref-48 fixture after three full normal-control long-carton lifecycles.',
    'box',
  );

  const qualityContract = await page.evaluate(() => {
    const scene3d = window.__fw.scene3d;
    const renderer = scene3d.renderer;
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const size = renderer.getSize({ set(x, y) { this.x = x; this.y = y; return this; } });
    return {
      userAgent: navigator.userAgent,
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'masked',
      rendererPixelRatio: renderer.getPixelRatio(),
      rendererWidth: size.x,
      rendererHeight: size.y,
      gtao: scene3d.post?.gtao?.enabled ?? null,
      bloom: scene3d.post?.bloom?.enabled ?? null,
      clockMinutes: window.__fw.state.clock.minutes,
      speedIndex: window.__fw.speedIdx,
    };
  });

  function numericDelta(before, after) {
    if (!Number.isFinite(before) || !Number.isFinite(after)) return { before, after, absolute: null, percent: null };
    const absolute = after - before;
    return {
      before,
      after,
      absolute: +absolute.toFixed(3),
      percent: before === 0 ? null : +((absolute / before) * 100).toFixed(2),
    };
  }

  const comparableMetrics = [
    'avgFps', 'low1Fps', 'avgFrameMs', 'worstFrameMs',
    'actualGlDrawCallsPerFrame', 'actualGlTrianglesPerFrame',
    'visibleSceneGeometries', 'visibleSceneMaterials', 'visibleSceneTextures', 'estimatedVisibleTextureBytesRGBA8',
    'rendererGeometriesInMemory', 'rendererTexturesInMemory', 'rendererProgramsInMemory',
    'uiMutationRecordsPerSecond',
  ];
  const postCycleGrowth = Object.fromEntries(comparableMetrics.map((key) => [
    key,
    numericDelta(performance.preCycle[key], performance.postThreeCycles[key]),
  ]));
  postCycleGrowth.jsHeapUsedBytes = numericDelta(
    performance.preCycle.countersAfter.jsHeapUsedBytes,
    performance.postThreeCycles.countersAfter.jsHeapUsedBytes,
  );
  postCycleGrowth.jsEventListeners = numericDelta(
    performance.preCycle.countersAfter.jsEventListeners,
    performance.postThreeCycles.countersAfter.jsEventListeners,
  );

  const worstFrameAllowance = Math.max(2, performance.preCycle.worstFrameMs * 0.15);
  const regressionGate = {
    avgFps: performance.postThreeCycles.avgFps >= performance.preCycle.avgFps * 0.95,
    low1Fps: performance.postThreeCycles.low1Fps >= performance.preCycle.low1Fps * 0.90,
    worstFrameMs: performance.postThreeCycles.worstFrameMs <= performance.preCycle.worstFrameMs + worstFrameAllowance,
    drawCalls: performance.postThreeCycles.actualGlDrawCallsPerFrame <= performance.preCycle.actualGlDrawCallsPerFrame + 10,
    triangles: performance.postThreeCycles.actualGlTrianglesPerFrame <= performance.preCycle.actualGlTrianglesPerFrame * 1.15,
    textureMemory: performance.postThreeCycles.estimatedVisibleTextureBytesRGBA8
      <= performance.preCycle.estimatedVisibleTextureBytesRGBA8 + 16 * 1024 * 1024,
    visibleGeometries: performance.postThreeCycles.visibleSceneGeometries
      <= performance.preCycle.visibleSceneGeometries,
    visibleMaterials: performance.postThreeCycles.visibleSceneMaterials
      <= performance.preCycle.visibleSceneMaterials,
    visibleTextures: performance.postThreeCycles.visibleSceneTextures
      <= performance.preCycle.visibleSceneTextures,
    rendererGeometries: performance.postThreeCycles.rendererGeometriesInMemory
      <= performance.preCycle.rendererGeometriesInMemory,
    rendererTextures: performance.postThreeCycles.rendererTexturesInMemory
      <= performance.preCycle.rendererTexturesInMemory,
    rendererPrograms: performance.postThreeCycles.rendererProgramsInMemory
      <= performance.preCycle.rendererProgramsInMemory,
    heap: postCycleGrowth.jsHeapUsedBytes.absolute <= 8 * 1024 * 1024,
    listeners: postCycleGrowth.jsEventListeners.absolute <= 0,
    uiMutations: performance.postThreeCycles.uiMutationRecordsPerSecond
      <= performance.preCycle.uiMutationRecordsPerSecond + 0.25,
  };

  const metadataDimensions = Array.from(assets.authoredAssetMetadata?.target_dimensions_m || [], Number);
  const assertions = {
    viewport1600x900Dpr1: viewportContract.innerWidth === 1600 && viewportContract.innerHeight === 900 && viewportContract.devicePixelRatio === 1,
    authoredAssets: assets.authoredBox && assets.authoredRecycling && assets.flatBundle
      && assets.authoredAssetRoot && assets.fourFlaps && assets.fourWalls
      && assets.missingRequiredNodes.length === 0
      && assets.contentSlots === 2 && assets.actualProducts === 2 && assets.actualClubProducts === 2
      && assets.actualClubNames.every((name) => /^BOX_CONTENT_\d{2}_driver1$/.test(name))
      && metadataDimensions.length === 3
      && metadataDimensions[0] === 1.25 && metadataDimensions[1] === 0.18 && metadataDimensions[2] === 0.18
      && assets.slotMetadata.every((slot) => slot.exists && /clubs?/i.test(slot.allowedCategory || '')
        && Number(slot.maxW) >= 1.18 && Number(slot.maxW) <= 1.25
        && Number(slot.maxD) > 0 && Number(slot.maxD) <= 0.16
        && Number(slot.maxH) > 0 && Number(slot.maxH) <= 0.16
        && Number.isInteger(Number(slot.stackOrder))
        && Number(slot.visibilityThreshold) >= 0 && Number(slot.visibilityThreshold) <= 1
        && Number.isInteger(Number(slot.removalOrder)))
      && assets.tapeSegments >= 15 && assets.endTapeReturns >= 2 && assets.shippingLabel,
    exactClubFixtureContract: fixtureCase.skuId === 'driver1' && fixtureCase.boxKind === 'clubbox'
      && fixtureCase.qty === 2 && fixtureCase.cap === 2
      && fixtureCase.dimensions.w === 1.25 && fixtureCase.dimensions.h === 0.18 && fixtureCase.dimensions.d === 0.18
      && fixtureCase.model === 'delivery_golf_club_box',
    receivingDoorNormalTraversal: receivingDoorTraversal.crossedReceivingWall
      && receivingDoorTraversal.stayedInDoorLane
      && receivingDoorTraversal.onlyKeyboardMovement
      && receivingDoorTraversal.pointerLockHeld
      && receivingDoorTraversal.safeDoorSampleCount >= 2
      && receivingDoorTraversal.sampleCount >= 8
      && Math.abs(receivingDoorTraversal.carryCollisionRadius - 0.53) <= 0.001,
    stableSealedLongCarryPose: receivingDoorTraversal.stablePose.stable
      && receivingDoorTraversal.stablePose.mode === 'sealed'
      && receivingDoorTraversal.stablePose.sampleCount === 18,
    stableFlatLongCarryPose: stableFlatCarry.stable
      && stableFlatCarry.mode === 'flat'
      && stableFlatCarry.sampleCount === 18,
    preBaselineResidencyWarm: residencyWarmCycle.restoredSameBoxView
      && residencyWarmCycle.boxId === fixtureCase.id
      && residencyWarmCycle.restored.lifecycle === 'SEALED'
      && residencyWarmCycle.restored.qty === 2
      && residencyWarmCycle.preBaselineRenderedStates.join('|')
        === 'open-qty-2-boxOpen-450ms|carried-two-clubs-450ms|flat-bundle-450ms|carried-flat-at-recycling-450ms',
    pressPromptOffered: /tear the tape/i.test(
      captures.find((entry) => entry.file.endsWith('01-sealed-long-club-carton.png'))?.focus?.label || '',
    ),
    noToolInvolved: captures.length > 0
      && captures.every((entry) => (entry.focus?.tool ?? null) === null),
    quantityVisuals: [
      ['07-open-two-clubs.png', 2],
      ['08-qty-zero-long-club-armful.png', 0],
    ].every(([file, expected]) => captures.find((entry) => entry.file.endsWith(file))?.visual?.productsVisible === expected),
    honestTwoClubArmful: (() => {
      const carry = captures.find((entry) => entry.file.endsWith('08-qty-zero-long-club-armful.png'))?.stockState?.carry;
      return carry?.skuId === 'driver1' && carry.qty === 2;
    })(),
    honestDriversRackStocking: (() => {
      const state = captures.find((entry) => entry.file.endsWith('09-two-clubs-stocked-drivers-rack.png'))?.stockState;
      return clubRackStocking.fixtureId === 'rack_drivers'
        && /Drivers & woods.*hold \[E\] to stock/i.test(clubRackStocking.before.label || '')
        && state && !state.carry && state.shelf === 2 && state.back === 0;
    })(),
    pointerLockHeldThroughout: captures.every((entry) => entry.actualCamera.pointerLocked),
    mainRouteConservedUnits: mainRoute.shelf === fixtureQty && mainRoute.back === 0 && !mainRoute.carry,
    mainRouteDisposedExactlyOnce: mainRoute.liveBoxes === 0 && mainRoute.recycled === 1 && mainRoute.trash === 0,
    threeStressCyclesDisposed: stressCycles.length === 3
      && stressCycles.every((cycle) => cycle.units === 2
        && cycle.quantityPath.join('>') === '2>0'
        && cycle.stockedTo === 'rack_drivers' && cycle.recycled)
      && stressState.liveBoxes === 0 && stressState.recycled === 3
      && stressState.trash === 0 && !stressState.carry,
    noListenerGrowthAfterThreeCycles: countersAfterStress.jsEventListeners <= countersBeforeStress.jsEventListeners,
    performanceRegressionGate: Object.values(regressionGate).every(Boolean),
    noConsoleOrPageErrors: diagnosticCounts.consoleError === 0 && diagnosticCounts.pageError === 0,
    noFailedRequestsDuringProbe: diagnosticCounts.requestFailed === 0,
  };

  const metricSources = {
    frameTime: 'requestAnimationFrame deltas in milliseconds; five settling frames removed; 1% low uses mean of slowest 1% frame times.',
    drawCallsAndTriangles: 'Actual WebGL drawArrays/drawElements/instanced calls across all passes, wrapped once at the context; renderer.info is neither read nor reset.',
    sceneResources: 'THREE.Scene.traverseVisible UUID census; visible triangles are geometry indices/positions times instance count.',
    textureMemory: 'Estimated visible RGBA8 source bytes with a 4/3 mip factor when generateMipmaps is enabled; actual driver/GPU allocation is unavailable and therefore explicitly unmeasured.',
    heapAndListeners: 'Chrome DevTools Protocol HeapProfiler.collectGarbage, Performance.getMetrics, and Memory.getDOMCounters; retained bytes and active JS event-listener count.',
    uiFrequency: 'MutationObserver records per second for the available shop prompt/topbar/HUD/toast nodes.',
  };

  const result = {
    ok: Object.values(assertions).every(Boolean),
    phase,
    iteration,
    outputDirectory: out,
    launch: 'node tools/qa/run-playwright.cjs tools/qa/club-box-lifecycle-qa.js --bootstrap',
    viewportContract,
    qualityContract,
    fixedCameras: cameras,
    fixture: {
      skuId: 'driver1',
      orderId: fixtureOrderId,
      qty: fixtureQty,
      boxKind: 'clubbox',
      dimensions: { w: 1.25, h: 0.18, d: 0.18 },
      spot: fixtureSpot,
    },
    integrationContract,
    assets,
    receivingDoorTraversal,
    stableFlatCarry,
    clubRackStocking,
    residencyWarmCycle,
    captures,
    mainRoute,
    recyclingFocus,
    stress: { cycles: stressCycles, state: stressState, countersBefore: countersBeforeStress, countersAfter: countersAfterStress },
    performance,
    postCycleGrowth,
    regressionGate,
    metricSources,
    regressionGateThresholds: {
      avgFps: 'no more than 5% lower',
      low1Fps: 'no more than 10% lower',
      worstFrameMs: 'no more than 2 ms or 15% higher, whichever is larger',
      drawCalls: 'no more than 10 additional actual GL calls per frame',
      triangles: 'no more than 15% higher unless the reviewed authored silhouette requires it',
      textureMemory: 'no more than 16 MiB additional estimated visible RGBA8 source memory',
      visibleGeometries: 'zero growth at the identical sealed-case scene state',
      visibleMaterials: 'zero growth at the identical sealed-case scene state',
      visibleTextures: 'zero growth at the identical sealed-case scene state',
      rendererGeometries: 'zero retained renderer-geometry growth after all evidence cameras are pre-warmed',
      rendererTextures: 'zero retained renderer-texture growth after all evidence cameras are pre-warmed',
      rendererPrograms: 'zero retained renderer-program growth after all lifecycle states and evidence cameras are pre-warmed',
      heapAfterThreeCycles: 'no more than 8 MiB growth',
      listenersAfterThreeCycles: 'zero growth',
      uiUpdates: 'no more than 0.25 additional mutation records per second in the identical static scene',
    },
    unmeasured: [
      'Actual driver/GPU texture allocation bytes (the result reports a labeled RGBA8 source estimate and renderer texture count).',
      'Audio waveform quality (functional playback belongs in the final recorded-gameplay review).',
    ],
    assertions,
    diagnostics: { counts: diagnosticCounts, entries: diagnostics },
  };
  fs.writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'run-state.json'), `${JSON.stringify({
    status: result.ok ? 'passed' : 'failed', phase, iteration, result: path.join(out, 'result.json'),
    captures: captures.map((entry) => entry.file), updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  return result;
}
