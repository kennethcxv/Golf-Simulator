async (page) => {
  // Normal-control exterior restoration for the first property. The saved
  // checkpoint is entered through Continue; chores use E and grime changes
  // only while the physical pressure-washer trigger is held on a live hit.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8458/';
  const phase = String(process.env.EXTERIOR_QA_PHASE || 'chores').toLowerCase();
  const out = path.join(repo, 'qa', 'gameplay-progression', 'exterior-restoration');
  fs.mkdirSync(out, { recursive: true });

  const checkpointFiles = {
    chores: path.join(repo, 'qa', 'gameplay-progression', 'opening-orders', 'checkpoint-reopening-orders-scheduled.json'),
    siding: path.join(out, 'checkpoint-exterior-chores-complete.json'),
    gable: path.join(out, 'checkpoint-south-siding-washed.json'),
    porch: path.join(out, 'checkpoint-west-gable-washed.json'),
  };
  const sourceCheckpoint = checkpointFiles[phase];
  if (!fs.existsSync(sourceCheckpoint)) throw new Error(`Missing reopening-order checkpoint: ${sourceCheckpoint}`);

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
    const center = app.scene3d.clubhouse().interior.position;
    return {
      x: walk.x,
      z: walk.z,
      lx: walk.x - center.x,
      lz: walk.z - center.z,
      yaw: walk.yaw,
      pitch: walk.pitch,
      tool: app.scene3d.walk.getTool?.() || null,
      prompt: app.scene3d.walk.getFocusLabel?.() || document.querySelector('.shop-prompt')?.textContent || '',
    };
  });
  const center = () => page.evaluate(() => {
    const origin = window.__fw.scene3d.clubhouse().interior.position;
    return { x: origin.x, z: origin.z };
  });
  const norm = (angle) => {
    let value = angle;
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
  };
  async function turnWorld(x, z) {
    for (let pass = 0; pass < 24; pass += 1) {
      const pose = await readPose();
      const desired = Math.atan2(-(x - pose.x), -(z - pose.z));
      const delta = norm(desired - pose.yaw);
      // The live rental fan is over a yard wide at the wall. Chasing a
      // sub-degree heading with repeated accessibility-key taps adds no useful
      // coverage evidence and is much slower than a player's smooth sweep.
      if (Math.abs(delta) < 0.050) return true;
      await holdKey(
        delta > 0 ? 'ArrowLeft' : 'ArrowRight',
        Math.max(28, Math.min(260, Math.abs(delta) / 1.9 * 720)),
        'turn toward exterior target',
      );
      await page.waitForTimeout(14);
    }
    return false;
  }
  async function setPitch(target) {
    for (let pass = 0; pass < 5; pass += 1) {
      const pose = await readPose();
      const delta = target - pose.pitch;
      if (Math.abs(delta) < 0.040) return true;
      await holdKey(
        delta > 0 ? 'ArrowUp' : 'ArrowDown',
        Math.max(24, Math.min(900, Math.abs(delta) / 1.3 * 1000)),
        'aim at exterior target',
      );
    }
    return false;
  }
  async function goWorld(x, z, stop = 0.58) {
    let prior = Infinity;
    let stalled = 0;
    for (let pass = 0; pass < 38; pass += 1) {
      const pose = await readPose();
      const distance = Math.hypot(x - pose.x, z - pose.z);
      if (distance <= stop) return true;
      await turnWorld(x, z);
      const runMs = Math.max(90, Math.min(720, ((distance - stop) / 5.8) * 1000));
      await page.keyboard.down('Shift');
      await holdKey('w', runMs, 'walk exterior route');
      await page.keyboard.up('Shift');
      const after = await readPose();
      const now = Math.hypot(x - after.x, z - after.z);
      stalled = now >= prior - 0.035 ? stalled + 1 : 0;
      prior = now;
      if (stalled >= 5) return false;
    }
    return false;
  }
  async function goLocal(lx, lz, stop = 0.58) {
    const origin = await center();
    return goWorld(origin.x + lx, origin.z + lz, stop);
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
    return file;
  }

  const checkpoint = JSON.parse(fs.readFileSync(sourceCheckpoint, 'utf8'));
  await page.goto(baseUrl);
  await page.evaluate((record) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(record)) localStorage.setItem(key, value);
  }, checkpoint);
  await page.reload();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => window.__fw?.screen === 'game' && !window.__fw?.prewarming, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.()?.assetsReady?.(), null, { timeout: 90000 });
  await page.waitForTimeout(650);

  async function focusAndUse({ label, terms, lx, lz, stances, pitches }) {
    const wanted = terms.map((entry) => entry.toLowerCase());
    const attempts = [];
    for (const stance of stances) {
      const reached = await goLocal(stance.x, stance.z, 0.40);
      const arrival = await readPose();
      const arrivalPrompt = arrival.prompt.toLowerCase();
      const collisionLimitedButFocused = wanted.every((term) => arrivalPrompt.includes(term));
      if (!reached && !collisionLimitedButFocused
        && Math.hypot(arrival.lx - stance.x, arrival.lz - stance.z) > 0.68) {
        attempts.push({ stance, reached, pose: arrival });
        continue;
      }
      const origin = await center();
      await turnWorld(origin.x + lx, origin.z + lz);
      for (const pitch of pitches) {
        await setPitch(pitch);
        await page.waitForTimeout(130);
        const pose = await readPose();
        attempts.push({ stance, pitch, pose });
        const prompt = pose.prompt.toLowerCase();
        if (!wanted.every((term) => prompt.includes(term))) continue;
        await press('e', label);
        await page.waitForTimeout(260);
        observations.push({ step: 'exterior-chore', label, stance, pitch, prompt: pose.prompt });
        return true;
      }
    }
    throw new Error(`Could not focus ${label}: ${JSON.stringify(attempts.slice(-16))}`);
  }

  if (phase === 'chores') {
  const lowPitches = [-0.30, -0.48, -0.66, -0.84, -1.02];
  await focusAndUse({
    label: 'pull west foundation weeds', terms: ['weeds', 'pull'], lx: -6.6, lz: 7.30,
    stances: [{ x: -6.6, z: 8.30 }, { x: -5.7, z: 7.80 }], pitches: lowPitches,
  });
  await focusAndUse({
    label: 'pull centre foundation weeds', terms: ['weeds', 'pull'], lx: -4.3, lz: 7.15,
    stances: [{ x: -4.3, z: 8.10 }, { x: -3.4, z: 7.65 }], pitches: lowPitches,
  });
  await focusAndUse({
    label: 'pull east foundation weeds', terms: ['weeds', 'pull'], lx: 3.1, lz: 7.25,
    stances: [{ x: 3.1, z: 8.20 }, { x: 4.0, z: 7.75 }], pitches: lowPitches,
  });
  await focusAndUse({
    label: 'pull approach weeds', terms: ['weeds', 'pull'], lx: -1.9, lz: 12.35,
    stances: [{ x: -1.9, z: 13.30 }, { x: -1.0, z: 12.75 }], pitches: lowPitches,
  });
  await focusAndUse({
    label: 'pull drive weeds', terms: ['weeds', 'pull'], lx: 0.5, lz: 14.15,
    stances: [{ x: 0.5, z: 15.10 }, { x: 1.4, z: 14.55 }], pitches: lowPitches,
  });
  await focusAndUse({
    label: 'clear choked downspout', terms: ['gutter', 'clear'], lx: 10.3, lz: 6.95,
    stances: [{ x: 10.3, z: 8.00 }, { x: 9.4, z: 7.55 }],
    pitches: [-0.10, 0.08, 0.26, 0.44, 0.62],
  });
  await focusAndUse({
    label: 'brush porch cobwebs', terms: ['cobwebs', 'brush'], lx: -7.01, lz: 9.85,
    stances: [{ x: -7.0, z: 10.85 }, { x: -6.1, z: 10.25 }],
    pitches: [0.02, 0.20, 0.38, 0.56, 0.74],
  });
  await focusAndUse({
    label: 'replace porch-light bulb', terms: ['porch light', 'bulb'], lx: 0.55, lz: 7.35,
    stances: [{ x: 0.55, z: 8.45 }, { x: 1.45, z: 7.85 }],
    pitches: [-0.08, 0.10, 0.28, 0.46, 0.64],
  });

  const choreState = await page.evaluate(() => ({ ...window.__fw.state.shop.reno.exterior }));
  if (choreState.weeds.some(Boolean) || choreState.gutter || choreState.cobwebs || choreState.light) {
    throw new Error(`Exterior hand chores did not complete: ${JSON.stringify(choreState)}`);
  }
  const checkpointPath = await saveCheckpoint(path.join(out, 'checkpoint-exterior-chores-complete.json'));
  return {
    ok: errors.length === 0,
    qaPhase: phase,
    errors,
    actionCount: actions.length,
    observationCount: observations.length,
    checkpointPath,
    exterior: choreState,
  };
  }

  const choreState = await page.evaluate(() => ({ ...window.__fw.state.shop.reno.exterior }));
  if (choreState.weeds.some(Boolean) || choreState.gutter || choreState.cobwebs || choreState.light) {
    throw new Error(`Saved exterior hand chores are incomplete: ${JSON.stringify(choreState)}`);
  }

  // Equip through the outdoor F belt, then place the pointer on the live canvas
  // so every following left/right hold reaches the production pointer handlers.
  let pose = await readPose();
  for (let attempt = 0; attempt < 5 && pose.tool !== 'washer'; attempt += 1) {
    await press('f', 'cycle outdoor tool belt to pressure washer');
    await page.waitForTimeout(180);
    pose = await readPose();
  }
  if (pose.tool !== 'washer') throw new Error(`Could not equip pressure washer through F: ${JSON.stringify(pose)}`);
  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Game canvas has no input bounds.');
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.waitForTimeout(180);

  async function washSnapshot() {
    return page.evaluate(async () => {
      const W = await import('/src/sim/washing.js');
      const state = window.__fw.state;
      const app = window.__fw;
      const camera = app.scene3d.camera;
      const dir = camera.getWorldDirection(camera.position.clone());
      const hit = app.scene3d.clubhouse().washAim(camera.position, dir);
      return {
        score: W.exteriorWashScore(state),
        surfaces: Object.fromEntries(W.WASH_SURFACES.map((surface) => [surface.id, W.surfaceClean(state, surface.id)])),
        hit: hit ? { id: hit.id, u: hit.u, v: hit.v, dist: hit.dist } : null,
      };
    });
  }

  async function surfaceWorldPoint(id, u, v) {
    return page.evaluate(({ surfaceId, targetU, targetV }) => {
      window.__campaignWashMeshes ||= {};
      let mesh = window.__campaignWashMeshes[surfaceId] || null;
      if (!mesh) {
        window.__fw.scene3d.scene.traverse((entry) => {
          if (!mesh && entry.userData?.washId === surfaceId) mesh = entry;
        });
        if (mesh) window.__campaignWashMeshes[surfaceId] = mesh;
      }
      if (!mesh) return null;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      const point = mesh.position.clone();
      point.set(
        box.min.x + (box.max.x - box.min.x) * targetU,
        box.min.y + (box.max.y - box.min.y) * targetV,
        0,
      );
      mesh.updateWorldMatrix(true, false);
      mesh.localToWorld(point);
      return { x: point.x, y: point.y, z: point.z };
    }, { surfaceId: id, targetU: u, targetV: v });
  }

  let lastStance = null;
  function stanceFor(id, point, origin) {
    const lx = point.x - origin.x;
    const lz = point.z - origin.z;
    if (id === 'trim') {
      return { x: -14.0, z: Math.max(-4.7, Math.min(4.7, Math.round(lz / 3.6) * 3.6)) };
    }
    if (id === 'porch') {
      return { x: Math.max(-6.4, Math.min(4.6, Math.round(lx / 3.6) * 3.6)), z: 11.35 };
    }
    return { x: Math.round(lx / 3.6) * 3.6, z: 8.65 };
  }

  async function aimSurface(id, u, v) {
    const point = await surfaceWorldPoint(id, u, v);
    if (!point) throw new Error(`Wash surface ${id} has no live mesh.`);
    const origin = await center();
    const stance = stanceFor(id, point, origin);
    if (!lastStance || Math.hypot(stance.x - lastStance.x, stance.z - lastStance.z) > 0.65) {
      const reached = await goLocal(stance.x, stance.z, 0.42);
      if (!reached) {
        observations.push({ step: 'wash-stance-blocked', id, u, v, stance, pose: await readPose() });
        return null;
      }
      lastStance = stance;
    }
    await turnWorld(point.x, point.z);
    const cameraY = await page.evaluate(() => window.__fw.scene3d.camera.position.y);
    const current = await readPose();
    const horizontal = Math.max(0.05, Math.hypot(point.x - current.x, point.z - current.z));
    await setPitch(Math.atan2(point.y - cameraY, horizontal));
    await page.waitForTimeout(45);
    const snapshot = await washSnapshot();
    if (snapshot.hit?.id !== id) {
      observations.push({ step: 'wash-hit-missed', id, u, v, stance, point, snapshot, pose: await readPose() });
      return null;
    }
    return snapshot.hit;
  }

  async function trigger(button, ms, label) {
    await page.mouse.down({ button });
    await page.waitForTimeout(ms);
    await page.mouse.up({ button });
    actions.push({ type: 'held-pointer', button, ms, label });
  }

  const values = (count, inset = 0.045) => Array.from(
    { length: count },
    (_, index) => inset + (1 - inset * 2) * (count === 1 ? 0.5 : index / (count - 1)),
  );
  async function workSurface(id, target, { uCount, vCount, heavy = false } = {}) {
    const us = values(uCount);
    const vs = values(vCount, id === 'porch' ? 0.06 : 0.055);
    const points = [];
    for (let row = 0; row < vs.length; row += 1) {
      const rowUs = row % 2 ? [...us].reverse() : us;
      for (const u of rowUs) points.push({ u, v: vs[row] });
    }
    if (heavy) {
      for (const point of points) {
        const hit = await aimSurface(id, point.u, point.v);
        if (hit) await trigger('right', 105, `soap ${id}`);
      }
      await page.waitForTimeout(2200);
      lastStance = null;
    }
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const hit = await aimSurface(id, point.u, point.v);
      if (hit) await trigger('left', 280, `wash ${id}`);
      if (index % 12 === 11 || index === points.length - 1) {
        const snapshot = await washSnapshot();
        observations.push({ step: 'wash-progress', id, index, clean: snapshot.surfaces[id], score: snapshot.score });
        if (snapshot.surfaces[id] >= target) return snapshot;
      }
    }
    return washSnapshot();
  }

  if (phase === 'siding') {
    await workSurface('sidingSW', 0.80, { uCount: 10, vCount: 2 });
    lastStance = null;
    await workSurface('sidingSE', 0.80, { uCount: 11, vCount: 4 });
    const washed = await washSnapshot();
    if (washed.surfaces.sidingSW < 0.78 || washed.surfaces.sidingSE < 0.78) {
      throw new Error(`South siding wash missed its coverage gate: ${JSON.stringify(washed)}`);
    }
    const checkpointPath = await saveCheckpoint(path.join(out, 'checkpoint-south-siding-washed.json'));
    return {
      ok: errors.length === 0,
      qaPhase: phase,
      errors,
      actionCount: actions.length,
      observationCount: observations.length,
      checkpointPath,
      ...washed,
    };
  }

  if (phase === 'gable') {
    await workSurface('trim', 0.80, { uCount: 14, vCount: 4 });
    const washed = await washSnapshot();
    if (washed.surfaces.trim < 0.78) {
      throw new Error(`West-gable wash missed its coverage gate: ${JSON.stringify(washed)}`);
    }
    const checkpointPath = await saveCheckpoint(path.join(out, 'checkpoint-west-gable-washed.json'));
    return {
      ok: errors.length === 0,
      qaPhase: phase,
      errors,
      actionCount: actions.length,
      observationCount: observations.length,
      checkpointPath,
      ...washed,
    };
  }

  if (phase !== 'porch') throw new Error(`Unknown exterior QA phase: ${phase}`);
  await workSurface('porch', 0.62, { uCount: 15, vCount: 4, heavy: true });

  const washed = await washSnapshot();
  if (washed.surfaces.porch < 0.60 || washed.score < 0.65) {
    throw new Error(`Normal pressure-washing did not reach campaign thresholds: ${JSON.stringify(washed)}`);
  }

  await goLocal(-1.0, 12.25, 0.48);
  const origin = await center();
  await turnWorld(origin.x - 1.0, origin.z + 7.1);
  await setPitch(0.12);
  await page.waitForTimeout(420);
  await page.screenshot({ path: path.join(out, '01-washed-clubhouse-and-cleared-grounds.png') });

  const checkpointPath = await saveCheckpoint(path.join(out, 'checkpoint-exterior-restored.json'));

  const result = await page.evaluate(async () => {
    const C = await import('/src/sim/campaign.js');
    const W = await import('/src/sim/washing.js');
    const state = window.__fw.state;
    const view = C.campaignView(state);
    return {
      clockMinutes: state.clock.minutes,
      exterior: structuredClone(state.shop.reno.exterior),
      washScore: W.exteriorWashScore(state),
      surfaceClean: Object.fromEntries(W.WASH_SURFACES.map((surface) => [surface.id, W.surfaceClean(state, surface.id)])),
      objective: view.currentTask,
      completedIds: [...state.campaign.completedObjectiveIds],
      padBoxes: state.shop.deliveries.boxes.filter((box) => box.loc === 'pad').length,
      pendingOrders: state.shop.orders.length,
    };
  });
  return {
    ok: errors.length === 0
      && result.exterior.weeds.every((value) => !value)
      && !result.exterior.gutter
      && !result.exterior.cobwebs
      && !result.exterior.light
      && result.surfaceClean.porch >= 0.60
      && result.washScore >= 0.65,
    errors,
    qaPhase: phase,
    actionCount: actions.length,
    observationCount: observations.length,
    checkpointPath,
    ...result,
  };
}
