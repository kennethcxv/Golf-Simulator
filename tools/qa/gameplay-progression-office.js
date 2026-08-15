async (page) => {
  // First-time campaign office restoration. Saved checkpoints are loaded only
  // through the production Continue path; authoritative state is observed for
  // navigation/assertions, while every mutation comes from trusted keyboard
  // input through the first-person controller.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const phase = String(process.env.OFFICE_QA_PHASE || 'unload').toLowerCase();
  const maxBoxes = Math.max(1, Math.min(4, Number.parseInt(process.env.OFFICE_QA_MAX_BOXES || '4', 10) || 4));
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8458/';
  const deliveryOut = path.join(repo, 'qa', 'gameplay-progression', 'deliveries');
  const furnishingOut = path.join(repo, 'qa', 'gameplay-progression', 'furnishing');
  const repairOut = path.join(repo, 'qa', 'gameplay-progression', 'repairs');
  const laptopOut = path.join(repo, 'qa', 'gameplay-progression', 'laptop-unlock');
  for (const dir of [deliveryOut, furnishingOut, repairOut, laptopOut]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const errors = [];
  const actions = [];
  const observations = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  const press = async (key, label = key) => {
    await page.keyboard.press(key);
    actions.push({ type: 'key', key, label });
  };
  const holdKey = async (key, ms, label = key) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    actions.push({ type: 'held-key', key, ms: Math.round(ms), label });
  };
  const readPose = () => page.evaluate(() => {
    const app = window.__fw;
    const walk = app.scene3d.walk.state;
    const clubhouse = app.scene3d.clubhouse();
    const center = clubhouse.interior.position;
    return {
      x: walk.x,
      z: walk.z,
      yaw: walk.yaw,
      pitch: walk.pitch,
      lx: walk.x - center.x,
      lz: walk.z - center.z,
      prompt: app.scene3d.walk.getFocusLabel?.() || document.querySelector('.shop-prompt')?.textContent || '',
      tool: app.scene3d.walk.getTool?.() || null,
      inside: clubhouse.isInside(walk.x, walk.z),
      carry: app.state.shop.carry ? { ...app.state.shop.carry } : null,
      carriedBox: app.state.shop.deliveries.boxes.find((box) => box.loc === 'carried')?.id || null,
    };
  });
  const center = () => page.evaluate(() => {
    const p = window.__fw.scene3d.clubhouse().interior.position;
    return { x: p.x, z: p.z };
  });
  const norm = (angle) => {
    let value = angle;
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
  };
  async function turnWorld(x, z) {
    // Short verified pulses avoid landing on the opposite heading after yaw
    // has accumulated through many exterior trips and crosses several 2pi
    // boundaries. These are the same accessibility arrow controls a player
    // uses; only the feedback loop is automated.
    for (let pass = 0; pass < 22; pass += 1) {
      const pose = await readPose();
      const desired = Math.atan2(-(x - pose.x), -(z - pose.z));
      const delta = norm(desired - pose.yaw);
      if (Math.abs(delta) < 0.045) return true;
      await holdKey(
        delta > 0 ? 'ArrowLeft' : 'ArrowRight',
        Math.max(35, Math.min(260, Math.abs(delta) / 1.9 * 720)),
        'turn toward campaign target',
      );
      await page.waitForTimeout(18);
    }
    return false;
  }
  async function turnLocal(lx, lz) {
    const c = await center();
    return turnWorld(c.x + lx, c.z + lz);
  }
  async function setPitch(target = -0.25) {
    for (let pass = 0; pass < 4; pass += 1) {
      const pose = await readPose();
      const delta = target - pose.pitch;
      if (Math.abs(delta) < 0.035) return true;
      await holdKey(
        delta > 0 ? 'ArrowUp' : 'ArrowDown',
        Math.min(1000, Math.abs(delta) / 1.3 * 1000),
        'aim at campaign target',
      );
    }
    return false;
  }
  async function goWorld(x, z, stop = 0.66) {
    let prior = Infinity;
    let stalled = 0;
    for (let pass = 0; pass < 32; pass += 1) {
      const pose = await readPose();
      const distance = Math.hypot(x - pose.x, z - pose.z);
      if (distance <= stop) return true;
      await turnWorld(x, z);
      const runMs = Math.max(100, Math.min(720, ((distance - stop) / 5.8) * 1000));
      await page.keyboard.down('Shift');
      await holdKey('w', runMs, 'walk campaign route');
      await page.keyboard.up('Shift');
      const after = await readPose();
      const now = Math.hypot(x - after.x, z - after.z);
      stalled = now >= prior - 0.035 ? stalled + 1 : 0;
      prior = now;
      if (stalled >= 4) return false;
    }
    return false;
  }
  async function goLocalDirect(lx, lz, stop = 0.66) {
    const c = await center();
    return goWorld(c.x + lx, c.z + lz, stop);
  }
  const zoneOf = ({ lx, lz }) => (lx > 5.7 && lz < 2 ? 'stock' : lx > 5.7 ? 'office' : 'hall');
  async function routeLocal(lx, lz, stop = 0.66) {
    const pose = await readPose();
    const from = zoneOf(pose);
    const to = zoneOf({ lx, lz });
    if (from === 'stock' && to !== 'stock') {
      await goLocalDirect(8.9, 1.15, 0.46);
      await turnLocal(8.9, 2.75);
      await openFocusedDoor('Stockroom door');
      // Delivery goods now trigger the same physical auto-open path as cartons.
      await page.waitForTimeout(450);
      await goLocalDirect(8.9, 2.78, 0.52);
      // The stock leaf opens south into the office. Step beyond its swept tip
      // before turning west around the newly installed furniture.
      await goLocalDirect(8.75, 3.70, 0.46);
    } else if (from !== 'stock' && to === 'stock') {
      if (from === 'hall') await goLocalDirect(4.85, 2.75, 0.62);
      await goLocalDirect(8.9, 2.75, 0.52);
      await turnLocal(8.9, 1.15);
      await openFocusedDoor('Stockroom door');
      await page.waitForTimeout(450);
      await goLocalDirect(8.9, 1.15, 0.48);
    } else if (from === 'hall' && to === 'office') {
      if (pose.lz < 2.35) await goLocalDirect(-0.8, 3.05, 0.58);
      await goLocalDirect(4.55, 3.65, 0.58);
    } else if (from === 'office' && to === 'hall' && lz < 2) {
      await goLocalDirect(4.85, 2.75, 0.62);
    }
    return goLocalDirect(lx, lz, stop);
  }

  async function openFocusedDoor(name) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.waitForTimeout(180);
      const before = await readPose();
      if (new RegExp(`${name}.*close`, 'i').test(before.prompt)) return true;
      if (new RegExp(`${name}.*open`, 'i').test(before.prompt)) {
        await press('e', `open ${name.toLowerCase()}`);
        await page.waitForTimeout(520);
        const after = await readPose();
        observations.push({ step: 'door-open', name, attempt, before, after });
        if (new RegExp(`${name}.*close`, 'i').test(after.prompt)) return true;
      }
      await holdKey(attempt % 2 ? 'a' : 'd', 90 + attempt * 40, 'adjust door stance');
    }
    return false;
  }

  async function saveCheckpoint(file) {
    await page.evaluate(() => window.__fw.autosave());
    await page.waitForTimeout(250);
    const record = await page.evaluate(() => Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index);
        return [key, localStorage.getItem(key)];
      }),
    ));
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    return record;
  }

  const checkpointByPhase = {
    unload: path.join(repo, 'qa', 'gameplay-progression', 'cleanup', 'checkpoint-grime-cleaned.json'),
    restore: path.join(deliveryOut, 'checkpoint-office-boxes-inside.json'),
    power: path.join(furnishingOut, 'checkpoint-office-furnished.json'),
    evidence: path.join(laptopOut, 'checkpoint-office-restored.json'),
  };
  const checkpointFile = checkpointByPhase[phase];
  if (!checkpointFile || !fs.existsSync(checkpointFile)) {
    throw new Error(`Missing campaign office checkpoint for phase ${phase}: ${checkpointFile}`);
  }

  await page.goto(baseUrl);
  const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  await page.evaluate((record) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(record)) localStorage.setItem(key, value);
  }, checkpoint);
  await page.reload();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => window.__fw?.screen === 'game' && !window.__fw?.prewarming, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.()?.assetsReady?.(), null, { timeout: 90000 });
  await page.waitForTimeout(700);

  // The production walk spawn is outside the porch. Enter through the authored
  // double doors exactly as a continuing player does.
  let entrance = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await goLocalDirect(-0.8, 7.45, 0.38);
    await turnLocal(-0.8, 6.55);
    await setPitch(-0.04);
    await openFocusedDoor('Shop door');
    await goLocalDirect(-0.8, 5.25, 0.50);
    entrance = await readPose();
    if (entrance.inside) break;
  }
  if (!entrance.inside) throw new Error(`Normal-control entrance failed: ${JSON.stringify(entrance)}`);

  async function enterReceivingExterior({ carrying = false } = {}) {
    await routeLocal(8.9, -3.55, 0.55);
    await goLocalDirect(9.15, -3.60, 0.42);
    await turnLocal(10.45, -3.60);
    await setPitch(-0.05);
    await page.waitForTimeout(180);
    if (!carrying) await openFocusedDoor('Receiving door');
    await page.waitForTimeout(650);
    const reached = await goLocalDirect(11.55, -3.60, 0.52);
    if (!reached) throw new Error(`Could not pass receiving door to exterior: ${JSON.stringify(await readPose())}`);
  }

  async function livePadPlans() {
    return page.evaluate(async () => {
      const { planPalletizedPadBoxes } = await import(new URL('src/data/deliveryStaging.js', document.baseURI).href);
      const { SHOP_CATALOG } = await import(new URL('src/data/shopItems.js', document.baseURI).href);
      const boxes = window.__fw.state.shop.deliveries.boxes;
      const byId = new Map(boxes.map((box) => [box.id, box]));
      return planPalletizedPadBoxes(boxes.filter((box) => box.loc === 'pad')).map((plan) => ({
        ...plan,
        skuId: byId.get(plan.boxId)?.skuId,
        productName: SHOP_CATALOG.find((sku) => sku.id === byId.get(plan.boxId)?.skuId)?.name || '',
      }));
    });
  }

  async function pickUpPadBox(plan) {
    // Always begin on the open apron side. A radial approach to the western
    // pallet can leave an empty-handed player close enough to the east wall
    // that the larger carried-freight envelope starts overlapped with it.
    let stances = plan.z < 0
      ? [[[1, 0], 1.08], [[1, 0], 1.42], [[0, 1], 1.08], [[0, 1], 1.42]]
      : [[[0, 1], 1.08], [[1, 0], 1.08], [[0, 1], 1.42], [[1, 0], 1.42]];
    if (plan.dimensions.w < 1.0) {
      // Compact cases can also be worked from the clear lane between the
      // pallets and east wall. This is the usable side of pallet 4 when the
      // pallet jack occupies its apron-facing interaction envelope.
      stances = [...stances, [[0, -1], 1.08], [[0, -1], 1.42]];
    }
    const pitches = [-0.43, -0.58, -0.74, -0.88, -1.00];
    for (let stanceIndex = 0; stanceIndex < stances.length; stanceIndex += 1) {
      const [direction, radius] = stances[stanceIndex];
      const stand = {
        x: plan.x + direction[0] * radius,
        z: plan.z + direction[1] * radius,
      };
      // Approach on orthogonal open-apron lanes. A direct diagonal from the
      // receiving threshold cuts across the fixed empty pallets.
      const current = await readPose();
      const clearEast = await goLocalDirect(15.75, current.lz, 0.52);
      const matchDepth = clearEast && await goLocalDirect(15.75, stand.z, 0.52);
      const reachedStand = matchDepth && await goLocalDirect(stand.x, stand.z, 0.27);
      if (!reachedStand) {
        observations.push({ step: 'pad-stance-blocked', boxId: plan.boxId, stance: stand, pose: await readPose() });
        continue;
      }
      await turnLocal(plan.x, plan.z);
      for (const pitch of pitches) {
        await setPitch(pitch);
        await page.waitForTimeout(180);
        const focus = await readPose();
        observations.push({ step: 'pad-focus', boxId: plan.boxId, stance: stand, pitch, focus });
        if (!/Delivery:.*pick up/i.test(focus.prompt)
          || !focus.prompt.toLowerCase().includes(plan.productName.toLowerCase())) continue;
        await press('e', `pick up inherited ${plan.skuId} carton`);
        await page.waitForTimeout(320);
        const carried = await page.evaluate(() => {
          const box = window.__fw.state.shop.deliveries.boxes.find((entry) => entry.loc === 'carried');
          return box ? { id: box.id, skuId: box.skuId } : null;
        });
        if (carried) {
          // Back away along the exact focus ray before turning. This clears the
          // carried envelope from its pallet and its immediate neighbours.
          await page.keyboard.down('Shift');
          await holdKey('s', 820, 'back away from lifted pallet');
          await page.keyboard.up('Shift');
          return { ok: true, stand, focus, box: carried };
        }
      }
    }
    return { ok: false, pose: await readPose() };
  }

  async function carryIntoStockroom() {
    // Clear the complete receiving-equipment envelope. The coupled pallet jack
    // and the parked delivery-van bay occupy the near-east edge, so loaded
    // freight goes around their outside and returns along the north service
    // lane before aligning with the threshold.
    const trace = [{ label: 'start', pose: await readPose() }];
    const start = trace[0].pose;
    const apronCleared = await goLocalDirect(18.60, start.lz, 0.52);
    trace.push({ label: 'equipment-cleared-east', reached: apronCleared, pose: await readPose() });
    // The service leaf hinges at the north jamb; cross slightly toward the
    // latch side so a freight crate clears the open slab as it would by hand.
    const northOfEquipment = apronCleared && await goLocalDirect(18.60, -4.20, 0.52);
    trace.push({ label: 'equipment-cleared-north', reached: northOfEquipment, pose: await readPose() });
    const doorLane = northOfEquipment && await goLocalDirect(15.75, -4.20, 0.52);
    trace.push({ label: 'door-lane', reached: doorLane, pose: await readPose() });
    // The receiving leaf now opens safely outward along the north jamb. Move
    // south of its sweep before approaching the aperture; a diagonal from the
    // north service lane correctly intersects the open slab.
    const southOfSwing = doorLane && await goLocalDirect(15.75, -3.45, 0.42);
    const southPose = await readPose();
    const southReady = Boolean(doorLane) && (southOfSwing || southPose.lz > -3.82);
    trace.push({ label: 'south-of-door-swing', reached: southOfSwing, ready: southReady, pose: southPose });
    const atThreshold = southReady && await goLocalDirect(11.72, -3.53, 0.38);
    const thresholdPose = await readPose();
    const thresholdReady = Boolean(southReady) && (atThreshold || (
      thresholdPose.lx < 12.05 && thresholdPose.lx > 10.75
      && thresholdPose.lz > -3.90 && thresholdPose.lz < -3.15
    ));
    trace.push({ label: 'threshold', reached: atThreshold, ready: thresholdReady, pose: thresholdPose });
    if (!thresholdReady) {
      throw new Error(`Could not route carried carton around the receiving apron: ${JSON.stringify(trace)}`);
    }
    await page.waitForTimeout(1350); // let the physical receiving leaf reach its stop
    const reached = await goLocalDirect(9.28, -3.53, 0.24);
    if (!reached) throw new Error(`Carried carton did not clear receiving door: ${JSON.stringify(await readPose())}`);
  }

  async function placeCarriedBox(slot) {
    const authored = [
      { target: { x: 6.75, z: -4.75 }, stance: { x: 8.62, z: -4.70 }, lane: 'east' },
      { target: { x: 8.00, z: -5.00 }, stance: { x: 8.62, z: -4.70 }, lane: 'east' },
      // Once the chair is down it can narrow the deep lane by one snap cell.
      // The two remaining fixture cartons use the broad central bay south of
      // the receiving clearway, independent of the desk/chair's exact snaps.
      { target: { x: 6.25, z: -2.25 }, stance: { x: 8.20, z: -3.05 }, lane: 'east' },
      { target: { x: 7.00, z: -2.25 }, stance: { x: 8.50, z: -3.05 }, lane: 'east' },
    ];
    const desired = authored[slot % authored.length];
    const variants = [
      desired,
      { ...desired, target: { x: desired.target.x, z: desired.target.z + 0.22 } },
      { ...desired, stance: { x: desired.stance.x, z: desired.stance.z + 0.30 } },
    ];
    for (const spec of variants) {
      const { target, stance, lane } = spec;
      let reached = false;
      if (lane === 'west') {
        const southOfEquipment = await goLocalDirect(9.35, -2.15, 0.42);
        const inWestLane = southOfEquipment && await goLocalDirect(6.48, -2.15, 0.38);
        reached = inWestLane && await goLocalDirect(stance.x, stance.z, 0.24);
      } else {
        // The east-wall back shelf starts north of the door; move onto the
        // freight-width centreline between that shelf and the hand truck before
        // walking deeper. A direct x=9.25 line correctly collides with the rack.
        const atLaneMouth = await goLocalDirect(8.62, -3.45, 0.38);
        reached = atLaneMouth && await goLocalDirect(stance.x, stance.z, 0.46);
      }
      if (!reached) {
        observations.push({ step: 'placement-stance-blocked', slot, target, stance, pose: await readPose() });
        continue;
      }
      const aimed = await turnLocal(target.x, target.z);
      if (!aimed) {
        observations.push({ step: 'placement-turn-failed', slot, target, stance, pose: await readPose() });
        continue;
      }
      let best = null;
      const pitchCandidates = Array.from({ length: 18 }, (_, index) => -0.46 - index * 0.045);
      for (const pitch of pitchCandidates) {
        await setPitch(pitch);
        await page.waitForTimeout(160);
        const samplePose = await readPose();
        const diagnostics = await page.evaluate(() => (
          window.__fw.scene3d.clubhouse().boxPlacement.diagnostics()
        ));
        observations.push({ step: 'placement-preview', slot, target, stance, pitch, pose: samplePose, diagnostics });
        if (!diagnostics.visible || !diagnostics.legal || diagnostics.surfaceId !== 'floor:clubhouse') continue;
        const miss = Math.hypot(
          diagnostics.target.x - target.x,
          diagnostics.target.z - target.z,
        );
        if (!best || miss < best.miss) best = { pitch, miss, target: diagnostics.target };
      }
      if (best) {
        await setPitch(best.pitch);
        await page.waitForTimeout(320);
        const diagnostics = await page.evaluate(() => (
          window.__fw.scene3d.clubhouse().boxPlacement.diagnostics()
        ));
        observations.push({ step: 'placement-selected', slot, target, stance, best, diagnostics });
        if (diagnostics.visible && diagnostics.legal && diagnostics.surfaceId === 'floor:clubhouse') {
          await press('e', 'place carton on stockroom floor');
          await page.waitForTimeout(350);
          const pose = await readPose();
          if (!pose.carriedBox) return diagnostics.target;
        }
      }
    }
    throw new Error(`No legal stockroom placement for carried carton: ${JSON.stringify({
      pose: await readPose(),
      attempts: observations.filter((entry) => entry.step.startsWith('placement-')).slice(-24),
    })}`);
  }

  async function campaignSnapshot() {
    return page.evaluate(async () => {
      const { SHOP_CATALOG } = await import(new URL('src/data/shopItems.js', document.baseURI).href);
      const state = window.__fw.state;
      return {
        boxes: state.shop.deliveries.boxes.map((box) => ({
          id: box.id,
          skuId: box.skuId,
          productName: SHOP_CATALOG.find((sku) => sku.id === box.skuId)?.name || box.skuId,
          loc: box.loc,
          x: box.x,
          z: box.z,
          tape: Number(box.tape) || 0,
          flaps: [...(box.flapProgress || box.flaps || [])],
          qty: box.qty,
          flat: !!box.flat,
        })),
        carry: state.shop.carry ? { ...state.shop.carry } : null,
        carriedBoxSku: state.shop.deliveries.boxes.find((box) => box.loc === 'carried')?.skuId || null,
        facilities: { ...(state.shop.reno?.facilities || {}) },
        ceilingRemoved: !!state.shop.reno?.repairWork?.ceiling?.removed,
        ceilingRestored: !!state.shop.reno?.architecture?.components?.ceiling?.restored,
        laptopOpened: !!state.campaign?.events?.laptopOpened,
        laptopMode: !!window.__fw.laptopOpen,
      };
    });
  }

  const BOX_STANCES = Object.freeze({
    desk1: [
      { x: 8.05, z: -5.20 }, { x: 8.45, z: -4.55 }, { x: 7.80, z: -5.45 },
    ],
    chair1: [
      { x: 8.72, z: -4.35 }, { x: 8.55, z: -5.75 }, { x: 7.75, z: -3.70 },
    ],
    repairkit1: [
      { x: 8.15, z: -2.25 }, { x: 8.35, z: -1.15 }, { x: 7.80, z: -3.00 },
    ],
    laptop1: [
      { x: 8.20, z: -2.25 }, { x: 8.40, z: -1.15 }, { x: 7.95, z: -3.00 },
    ],
  });

  async function focusLocalTarget({ lx, lz, terms, stances, pitches = null, label }) {
    const wanted = terms.map((term) => String(term).toLowerCase());
    const aimPitches = pitches || [-0.18, -0.34, -0.50, -0.66, -0.82, -0.98, -1.14];
    const attempts = [];
    for (const stance of stances) {
      const reached = await routeLocal(stance.x, stance.z, 0.46);
      if (!reached) {
        attempts.push({ stance, reached: false, pose: await readPose() });
        continue;
      }
      await turnLocal(lx, lz);
      for (const pitch of aimPitches) {
        await setPitch(pitch);
        await page.waitForTimeout(180);
        const pose = await readPose();
        attempts.push({ stance, reached: true, pitch, pose });
        const prompt = String(pose.prompt || '').toLowerCase();
        if (wanted.every((term) => prompt.includes(term))) {
          observations.push({ step: 'focused-target', label, stance, pitch, pose });
          return { stance, pitch, pose };
        }
      }
    }
    throw new Error(`Could not focus ${label}: ${JSON.stringify(attempts.slice(-18))}`);
  }

  async function focusBox(skuId, terms = null) {
    const snapshot = await campaignSnapshot();
    const box = snapshot.boxes.find((entry) => entry.skuId === skuId);
    if (!box || box.loc !== 'world' || !Number.isFinite(box.x) || !Number.isFinite(box.z)) {
      throw new Error(`Expected ${skuId} carton on the stockroom floor: ${JSON.stringify(box)}`);
    }
    if (skuId === 'chair1') {
      await goLocalDirect(8.62, -3.35, 0.48);
    } else if (skuId === 'desk1') {
      // With the chair carton recycled, the east lane opens around the north
      // side of the hand truck. Approach the desk from that clear side.
      await goLocalDirect(8.62, -3.35, 0.48);
      await goLocalDirect(8.62, -4.55, 0.48);
    }
    return focusLocalTarget({
      lx: box.x,
      lz: box.z,
      terms: terms || [box.productName],
      stances: BOX_STANCES[skuId],
      label: `${box.productName} carton`,
    });
  }

  async function unboxToHands(skuId) {
    let snapshot = await campaignSnapshot();
    const initial = snapshot.boxes.find((entry) => entry.skuId === skuId);
    if (!initial) throw new Error(`Missing inherited ${skuId} carton.`);

    // Ported off the box-cutter equip 2026-07-30 — cartons tear on a press, no
    // tool. proshop-box-open-loop.js owns the gesture contract; this driver
    // owns the campaign chain around it.
    await focusBox(skuId);
    const sealedPose = await readPose();
    if (sealedPose.tool !== null) {
      throw new Error(`A carton press must not involve a tool for ${skuId}: ${JSON.stringify(sealedPose)}`);
    }
    await press('e', `tear ${skuId} carton tape`);
    // Press one tears synchronously then animates the wide flap pair; the
    // "other flap" prompt is the settle signal (mid-animation presses are
    // deliberately ignored).
    await page.waitForFunction(
      () => /open the other flap/i.test(window.__fw.scene3d.walk.getFocusLabel() || ''),
      null, { timeout: 6000 },
    );
    const cut = (await campaignSnapshot()).boxes.find((entry) => entry.skuId === skuId);
    if ((cut?.tape || 0) < 0.999) throw new Error(`Tape did not tear on one press for ${skuId}: ${JSON.stringify(cut)}`);

    await focusBox(skuId);
    await press('e', `open ${skuId} carton flaps`);
    await page.waitForTimeout(3100);
    const opened = (await campaignSnapshot()).boxes.find((entry) => entry.skuId === skuId);
    if (!opened?.flaps?.length || opened.flaps.some((flap) => flap < 0.999)) {
      throw new Error(`Carton flaps did not open for ${skuId}: ${JSON.stringify(opened)}`);
    }

    await focusBox(skuId);
    await press('e', `take ${skuId} from carton`);
    await page.waitForTimeout(420);
    snapshot = await campaignSnapshot();
    if (snapshot.carry?.skuId !== skuId || snapshot.carry.qty < 1) {
      throw new Error(`Unpacked ${skuId} did not reach the player's hands: ${JSON.stringify(snapshot)}`);
    }
    actions.push({ type: 'campaign-unbox-complete', skuId, boxId: initial.id });
    return snapshot;
  }

  async function useCampaignSite({ lx, lz, terms, stances, label }) {
    const focused = await focusLocalTarget({ lx, lz, terms, stances, label });
    await press('e', label);
    await page.waitForTimeout(520);
    return focused;
  }

  async function recycleEmptyCarton(skuId) {
    await focusBox(skuId);
    await press('e', `flatten empty ${skuId} carton`);
    await page.waitForTimeout(1050);
    let snapshot = await campaignSnapshot();
    let box = snapshot.boxes.find((entry) => entry.skuId === skuId);
    if (!box?.flat) throw new Error(`Empty ${skuId} carton did not flatten: ${JSON.stringify(box)}`);

    await focusBox(skuId, ['flattened carton']);
    await press('e', `carry flattened ${skuId} carton`);
    await page.waitForTimeout(360);
    snapshot = await campaignSnapshot();
    if (snapshot.carriedBoxSku !== skuId) {
      throw new Error(`Flattened ${skuId} carton was not picked up: ${JSON.stringify(snapshot)}`);
    }
    await focusLocalTarget({
      lx: 9.85, lz: 1.30,
      terms: ['recycling', 'drop'],
      stances: [{ x: 8.75, z: 1.30 }, { x: 9.00, z: 0.55 }],
      pitches: [-0.18, -0.36, -0.54, -0.72, -0.90],
      label: `recycle flattened ${skuId} carton`,
    });
    await press('e', `drop flattened ${skuId} carton in recycling`);
    await page.waitForTimeout(950);
    snapshot = await campaignSnapshot();
    box = snapshot.boxes.find((entry) => entry.skuId === skuId);
    if (snapshot.carriedBoxSku || box) {
      throw new Error(`Flattened ${skuId} carton did not leave authoritative state: ${JSON.stringify(snapshot)}`);
    }
    actions.push({ type: 'campaign-carton-recycled', skuId });
  }

  if (phase === 'unload') {
    await enterReceivingExterior();
    const unloaded = [];
    for (let index = 0; index < maxBoxes; index += 1) {
      const plans = await livePadPlans();
      if (!plans.length) break;
      // Preserve the authored starter order in an easy-to-audit sequence.
      const order = ['desk1', 'chair1', 'repairkit1', 'laptop1'];
      plans.sort((a, b) => order.indexOf(a.skuId) - order.indexOf(b.skuId));
      const plan = plans[0];
      const picked = await pickUpPadBox(plan);
      if (!picked.ok) throw new Error(`Could not pick up pad box ${plan.boxId}: ${JSON.stringify(picked)}`);
      await carryIntoStockroom();
      const placement = await placeCarriedBox(index);
      unloaded.push({ boxId: picked.box.id, skuId: picked.box.skuId, placement });
      if (index < 3) await enterReceivingExterior();
    }

    // Prove the completed four-carton layout still leaves a normal player path
    // between receiving and the stock door. This caught a legal-per-box layout
    // that combined with the packing bench into an impassable room-wide wall.
    const eastLane = await goLocalDirect(8.62, -1.35, 0.48);
    const reachedStockDoor = eastLane && await goLocalDirect(8.88, 1.12, 0.48);
    const returnedThroughLane = reachedStockDoor && await goLocalDirect(8.62, -1.35, 0.48);
    if (!returnedThroughLane) {
      throw new Error(`Completed delivery layout blocks stockroom traversal: ${JSON.stringify({
        eastLane, reachedStockDoor, returnedThroughLane, pose: await readPose(), unloaded,
      })}`);
    }
    await routeLocal(8.15, -3.55, 0.42);
    await turnLocal(8.15, -5.45);
    await setPitch(-0.22);
    await page.screenshot({ path: path.join(deliveryOut, '01-inherited-deliveries-staged-inside.png') });
    const checkpointPath = path.join(deliveryOut, 'checkpoint-office-boxes-inside.json');
    await saveCheckpoint(checkpointPath);
    const result = await page.evaluate(async () => {
      const C = await import(new URL('src/sim/campaign.js', document.baseURI).href);
      const state = window.__fw.state;
      return {
        boxes: state.shop.deliveries.boxes.map((box) => ({
          id: box.id, skuId: box.skuId, loc: box.loc, surfaceId: box.surfaceId,
          x: box.x, z: box.z, tape: box.tape, flaps: [...box.flaps], qty: box.qty,
        })),
        carry: state.shop.carry,
        objective: C.campaignView(state).currentTask,
        phase: C.campaignView(state).phase,
      };
    });
    const stagedBoxes = result.boxes.filter((box) => (
      box.loc === 'world' && box.surfaceId === 'floor:clubhouse'
    ));
    const waitingBoxes = result.boxes.filter((box) => box.loc === 'pad');
    const ok = errors.length === 0
      && result.carry == null
      && result.boxes.length === 4
      && stagedBoxes.length === maxBoxes
      && waitingBoxes.length === 4 - maxBoxes
      && result.boxes.every((box) => stagedBoxes.includes(box) || waitingBoxes.includes(box));
    return {
      ok,
      qaPhase: phase,
      errors,
      actionCount: actions.length,
      observationCount: observations.length,
      unloaded,
      stockroomTraversal: { eastLane, reachedStockDoor, returnedThroughLane },
      checkpointPath,
      ...result,
    };
  }

  if (phase === 'restore' || phase === 'power') {
    let restored = await campaignSnapshot();
    if (phase === 'restore') {
    // Chair first: its east-lane carton is immediately reachable. Recycling
    // the empty shell opens the cross-lane around the hand truck to the desk.
    await unboxToHands('chair1');
    await useCampaignSite({
      lx: 8.65, lz: 3.98,
      terms: ['install', 'office chair'],
      stances: [{ x: 7.45, z: 3.98 }, { x: 8.05, z: 2.90 }],
      label: 'install office chair',
    });
    restored = await campaignSnapshot();
    if (!restored.facilities.officeChair || restored.carry) {
      throw new Error(`Office chair installation failed: ${JSON.stringify(restored)}`);
    }
    await recycleEmptyCarton('chair1');

    // Desk: sealed stockroom carton -> carried flat-pack -> office outline.
    await unboxToHands('desk1');
    await useCampaignSite({
      lx: 9.00, lz: 4.95,
      terms: ['install', 'office desk'],
      stances: [{ x: 7.65, z: 4.95 }, { x: 8.10, z: 5.75 }],
      label: 'install office desk',
    });
    restored = await campaignSnapshot();
    if (!restored.facilities.officeDesk || restored.carry) {
      throw new Error(`Office desk installation failed: ${JSON.stringify(restored)}`);
    }
    await recycleEmptyCarton('desk1');
    await routeLocal(7.55, 4.25, 0.55);
    await turnLocal(9.25, 4.45);
    await setPitch(-0.18);
    await page.screenshot({ path: path.join(furnishingOut, '01-office-desk-and-chair-installed.png') });
    await saveCheckpoint(path.join(furnishingOut, 'checkpoint-office-furnished.json'));
    } else if (!restored.facilities.officeDesk || !restored.facilities.officeChair
      || restored.carry || restored.boxes.some((box) => box.skuId === 'desk1' || box.skuId === 'chair1')) {
      throw new Error(`Furnished office checkpoint is invalid: ${JSON.stringify(restored)}`);
    }

    // Power repair is deliberately two physical E actions: remove damaged
    // material first, then consume the carried repair components.
    await unboxToHands('repairkit1');
    const ceilingSite = {
      lx: 7.15, lz: 3.55,
      terms: ['office power and ceiling'],
      stances: [{ x: 7.55, z: 3.70 }, { x: 7.15, z: 4.35 }, { x: 6.45, z: 3.65 }],
      label: 'remove damaged office ceiling component',
    };
    await useCampaignSite(ceilingSite);
    restored = await campaignSnapshot();
    if (!restored.ceilingRemoved || restored.ceilingRestored || restored.carry?.skuId !== 'repairkit1') {
      throw new Error(`Ceiling removal stage failed: ${JSON.stringify(restored)}`);
    }
    await useCampaignSite({ ...ceilingSite, label: 'install office ceiling repair components' });
    restored = await campaignSnapshot();
    if (!restored.ceilingRestored || restored.carry) {
      throw new Error(`Ceiling repair installation failed: ${JSON.stringify(restored)}`);
    }
    await routeLocal(6.45, 4.05, 0.52);
    await turnLocal(7.15, 3.55);
    await setPitch(-0.62);
    await page.screenshot({ path: path.join(repairOut, '01-office-power-and-ceiling-restored.png') });

    // Laptop: final inherited carton, physical desk placement, then boot the
    // actual in-world machine so the campaign event comes from normal E input.
    await unboxToHands('laptop1');
    await useCampaignSite({
      lx: 9.00, lz: 4.12,
      terms: ['install', 'office laptop'],
      stances: [{ x: 8.05, z: 4.10 }, { x: 8.15, z: 3.30 }],
      label: 'install office laptop',
    });
    restored = await campaignSnapshot();
    if (!restored.facilities.laptop || restored.carry || !restored.ceilingRestored) {
      throw new Error(`Office laptop installation failed: ${JSON.stringify(restored)}`);
    }
    await focusLocalTarget({
      lx: 9.55, lz: 4.50,
      terms: ['laptop', 'open golf simulator'],
      stances: [{ x: 8.10, z: 4.50 }, { x: 8.20, z: 5.15 }],
      pitches: [0.02, -0.12, -0.26, -0.40, -0.56],
      label: 'physical office laptop',
    });
    await press('e', 'open physical office laptop');
    await page.waitForFunction(() => window.__fw?.laptopOpen === true, null, { timeout: 8000 });
    await page.waitForTimeout(1850);
    await page.screenshot({ path: path.join(laptopOut, '01-physical-laptop-unlocked.png') });
    restored = await campaignSnapshot();
    if (!restored.laptopOpened || !restored.laptopMode) {
      throw new Error(`Physical laptop did not unlock the campaign: ${JSON.stringify(restored)}`);
    }
    await press('Escape', 'leave laptop after unlock evidence');
    await page.waitForFunction(() => window.__fw?.laptopOpen === false, null, { timeout: 8000 });
    const checkpointPath = path.join(laptopOut, 'checkpoint-office-restored.json');
    await saveCheckpoint(checkpointPath);
    const result = await campaignSnapshot();
    const ok = errors.length === 0
      && result.carry == null
      && result.facilities.officeDesk === true
      && result.facilities.officeChair === true
      && result.facilities.laptop === true
      && result.ceilingRemoved === true
      && result.ceilingRestored === true
      && result.laptopOpened === true
      && result.boxes.every((box) => box.qty === 0);
    return {
      ok,
      qaPhase: phase,
      errors,
      actionCount: actions.length,
      observationCount: observations.length,
      checkpointPath,
      ...result,
    };
  }

  if (phase === 'evidence') {
    await routeLocal(7.35, 4.30, 0.52);
    await turnLocal(9.10, 4.45);
    await setPitch(0.32);
    await page.waitForTimeout(420);
    await page.screenshot({ path: path.join(repairOut, '01-office-power-and-ceiling-restored.png') });
    const result = await campaignSnapshot();
    return {
      ok: errors.length === 0
        && result.ceilingRestored
        && result.facilities.officeDesk
        && result.facilities.officeChair
        && result.facilities.laptop
        && result.laptopOpened,
      qaPhase: phase,
      errors,
      actionCount: actions.length,
      observationCount: observations.length,
      ...result,
    };
  }

  throw new Error(`Office QA phase ${phase} is not implemented yet.`);
}
