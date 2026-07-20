async (page) => {
  // Fresh-save acceptance for the neglected-clubhouse cleaning chapter. State is
  // observed for navigation and assertions only; every mutation comes from trusted
  // keyboard/mouse input through the normal first-person controller.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const out = path.resolve('qa/gameplay-progression/cleanup');
  const phase = String(process.env.CLEANUP_QA_PHASE || 'clutter').toLowerCase();
  fs.mkdirSync(out, { recursive: true });

  const errors = [];
  const actions = [];
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
      yaw: walk.yaw,
      pitch: walk.pitch,
      lx: walk.x - center.x,
      lz: walk.z - center.z,
      prompt: document.querySelector('.shop-prompt')?.textContent || '',
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
    for (let pass = 0; pass < 4; pass += 1) {
      const pose = await readPose();
      const desired = Math.atan2(-(x - pose.x), -(z - pose.z));
      const delta = norm(desired - pose.yaw);
      if (Math.abs(delta) < 0.055) return;
      await holdKey(delta > 0 ? 'ArrowLeft' : 'ArrowRight', Math.min(1350, Math.abs(delta) / 1.9 * 1000), 'turn toward work target');
    }
  }
  async function turnLocal(lx, lz) {
    const c = await center();
    await turnWorld(c.x + lx, c.z + lz);
  }
  async function setPitch(target = -0.28) {
    for (let pass = 0; pass < 3; pass += 1) {
      const pose = await readPose();
      const delta = target - pose.pitch;
      if (Math.abs(delta) < 0.04) return;
      await holdKey(delta > 0 ? 'ArrowUp' : 'ArrowDown', Math.min(900, Math.abs(delta) / 1.3 * 1000), 'aim cleaning tool');
    }
  }
  async function goWorld(x, z, stop = 0.72) {
    let prior = Infinity;
    let stalled = 0;
    for (let pass = 0; pass < 22; pass += 1) {
      const pose = await readPose();
      const distance = Math.hypot(x - pose.x, z - pose.z);
      if (distance <= stop) return true;
      await turnWorld(x, z);
      const runMs = Math.max(90, Math.min(650, ((distance - stop) / 6.12) * 1000));
      await page.keyboard.down('Shift');
      await holdKey('w', runMs, 'walk to work target');
      await page.keyboard.up('Shift');
      const after = await readPose();
      const now = Math.hypot(x - after.x, z - after.z);
      stalled = now >= prior - 0.04 ? stalled + 1 : 0;
      prior = now;
      if (stalled >= 3) return false;
    }
    return false;
  }
  async function goLocalDirect(lx, lz, stop = 0.72) {
    const c = await center();
    return goWorld(c.x + lx, c.z + lz, stop);
  }
  const zoneOf = ({ lx, lz }) => (lx > 5.7 && lz < 2 ? 'stock' : lx > 5.7 ? 'office' : 'hall');
  async function routeLocal(lx, lz, stop = 0.72) {
    const pose = await readPose();
    const from = zoneOf(pose);
    const to = zoneOf({ lx, lz });
    if (from === 'stock' && to !== 'stock') {
      await goLocalDirect(8.9, 1.15, 0.48);
      await turnLocal(8.9, 2.8);
      const prompt = (await readPose()).prompt;
      if (/door/i.test(prompt)) await press('e', 'open stockroom door');
      await goLocalDirect(8.9, 2.75, 0.55);
    } else if (from !== 'stock' && to === 'stock') {
      if (from === 'hall') await goLocalDirect(4.85, 2.75, 0.65);
      await goLocalDirect(8.9, 2.75, 0.55);
      await turnLocal(8.9, 1.15);
      const prompt = (await readPose()).prompt;
      if (/door/i.test(prompt)) await press('e', 'open stockroom door');
      await goLocalDirect(8.9, 1.15, 0.5);
    } else if (from === 'office' && to === 'hall' && lz < 2) {
      await goLocalDirect(4.85, 2.75, 0.65);
    } else if (from === 'hall' && to === 'office') {
      // Stay west of the service partition until south of its endpoint. A
      // diagonal from the north sales floor hits the wall at x=5.7,z<2 and
      // cannot recover by steering harder into it.
      if (pose.lz < 2.35) await goLocalDirect(-0.8, 3.05, 0.58);
      await goLocalDirect(4.55, 3.65, 0.58);
    }
    return goLocalDirect(lx, lz, stop);
  }
  async function interactLocal(lx, lz, expected, stateDone, attempts = 4) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await routeLocal(lx, lz, Math.max(0.82, 1.12 - attempt * 0.08));
      await turnLocal(lx, lz);
      await page.waitForTimeout(180);
      const pose = await readPose();
      if (!expected || expected.test(pose.prompt)) {
        await press('e', pose.prompt || 'interact');
        await page.waitForTimeout(360);
        if (!stateDone || await stateDone()) return true;
      } else {
        await holdKey(attempt % 2 ? 'a' : 'd', 120 + attempt * 40, 'adjust interaction stance');
      }
    }
    return false;
  }
  async function cycleTo(tool) {
    for (let i = 0; i < 12; i += 1) {
      const current = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
      if (current === tool) return true;
      await press('f', `cycle tool toward ${tool || 'hands'}`);
      await page.waitForTimeout(120);
    }
    return false;
  }
  async function useToolAt(lx, lz, ms = 750, facing = 'auto') {
    // Stand at the real authored socket offset for the equipped tool. Long-
    // handled floor tools work ahead of the player; cloths, spray, and bags
    // work at the player's hands/feet and must not inherit that long offset.
    const tool = await page.evaluate(() => window.__fw.scene3d.walk.getTool());
    const contact = {
      vacuum: { forward: 1.58, lateral: 0.50 },
      mop: { forward: 1.76, lateral: 0.50 },
      broom: { forward: 1.71, lateral: 0.51 },
      dustpan: { forward: 1.52, lateral: 0.50 },
      spray: { forward: 0.56, lateral: 0.25 },
      cloth: { forward: 0.46, lateral: 0.26 },
      sponge: { forward: 0.46, lateral: 0.26 },
      trashbag: { forward: 0.56, lateral: 0.30 },
    }[tool] || { forward: 1.25, lateral: 0.30 };
    const northFacing = facing === 'north'
      || (facing === 'auto' && lz + contact.forward <= 6.05);
    const standX = lx + (northFacing ? -contact.lateral : contact.lateral);
    const standZ = lz + (northFacing ? contact.forward : -contact.forward);
    await routeLocal(standX, standZ, 0.22);
    await turnLocal(lx, lz);
    await setPitch(-0.34);
    await page.mouse.move(800, 470);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
    actions.push({ type: 'held-mouse', button: 'left', ms, target: { lx, lz } });
    await page.waitForTimeout(100);
    return northFacing;
  }
  async function useToolLane(x1, z1, x2, z2) {
    await routeLocal(x1, z1, 0.35);
    await turnLocal(x2, z2);
    await setPitch(-0.36);
    await page.mouse.move(800, 470);
    await page.mouse.down();
    const reached = await goLocalDirect(x2, z2, 0.38);
    await page.mouse.up();
    actions.push({ type: 'held-mouse-lane', button: 'left', from: [x1, z1], to: [x2, z2], reached });
    await page.waitForTimeout(80);
    return reached;
  }

  await page.goto('http://localhost:8458/');
  if (phase === 'clutter') {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: 'New Empire — Relaxed' }).click();
    await page.locator('.listing').first().getByRole('button', { name: 'Buy' }).click();
  } else {
    const checkpointFile = {
      debris: 'checkpoint-clutter-cleared.json',
      'grime-retail': 'checkpoint-lobby-cleaned.json',
      'grime-service': 'checkpoint-retail-cleaned.json',
      'grime-windows': 'checkpoint-floor-cleaned.json',
    }[phase] || 'checkpoint-trash-cleared.json';
    const checkpoint = JSON.parse(fs.readFileSync(path.join(out, checkpointFile), 'utf8'));
    await page.evaluate((record) => {
      localStorage.clear();
      for (const [key, value] of Object.entries(record)) localStorage.setItem(key, value);
    }, checkpoint);
    await page.reload();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.waitForFunction(() => window.__fw?.screen === 'game' && !window.__fw?.prewarming, null, { timeout: 90000 });
  const intro = page.getByRole('button', { name: 'Begin restoration' });
  if (await intro.isVisible().catch(() => false)) await intro.click();

  await page.keyboard.down('Shift');
  await holdKey('w', 1500, 'walk to clubhouse');
  await page.keyboard.up('Shift');
  await press('e', 'open main entrance');
  await holdKey('w', 850, 'step into clubhouse');
  await page.waitForTimeout(450);

  // Haul every old pile. Main-hall piles are cleared first so routes become
  // visibly and physically traversable; stockroom piles follow through its door.
  for (let pass = 0; pass < 14; pass += 1) {
    const next = await page.evaluate(() => {
      const piles = window.__fw.state.shop.reno.clutter;
      const walk = window.__fw.scene3d.walk.state;
      const c = window.__fw.scene3d.clubhouse().interior.position;
      const zone = (p) => (p.x > 5.7 && p.z < 2 ? 1 : 0);
      const remaining = piles.map((pile, index) => ({ ...pile, index })).filter((pile) => !pile.cleared);
      remaining.sort((a, b) => zone(a) - zone(b)
        || Math.hypot(a.x - (walk.x - c.x), a.z - (walk.z - c.z))
          - Math.hypot(b.x - (walk.x - c.x), b.z - (walk.z - c.z)));
      return remaining[0] || null;
    });
    if (!next) break;
    const ok = await interactLocal(next.x, next.z, /Old clutter/i, () => page.evaluate((index) => (
      !!window.__fw.state.shop.reno.clutter[index]?.cleared
    ), next.index));
    if (!ok) break;
  }

  if (phase === 'clutter') {
    await routeLocal(-0.8, 5.0, 0.5);
    await turnLocal(-0.8, 1.0);
    await page.screenshot({ path: path.join(out, '02-clutter-cleared-and-routes-open.png') });
    await page.evaluate(() => window.__fw.autosave());
    const savedStorage = await page.evaluate(() => Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index);
        return [key, localStorage.getItem(key)];
      }),
    ));
    fs.writeFileSync(path.join(out, 'checkpoint-clutter-cleared.json'), `${JSON.stringify(savedStorage, null, 2)}\n`);
    const clutter = await page.evaluate(() => ({
      remaining: window.__fw.state.shop.reno.clutter.filter((pile) => !pile.cleared).length,
      events: { ...window.__fw.state.campaign.events },
      campaignPhase: window.__fw.state.campaign.phase,
    }));
    return { ok: errors.length === 0 && clutter.remaining === 0, phase, errors, actions: actions.length, ...clutter };
  }

  const grimePhases = ['grime', 'grime-floor', 'grime-lobby', 'grime-retail', 'grime-service', 'grime-windows'];
  if (grimePhases.includes(phase)) {
    if (phase !== 'grime-windows') {
      if (phase === 'grime' || phase === 'grime-floor' || phase === 'grime-lobby') {
        // Demonstrate the treatment chain on real floor state before using the
        // vacuum for broad coverage. The campaign records only tools that
        // actually changed the authoritative masks.
        await cycleTo('spray');
        await useToolAt(-0.8, 4.4, 850);
        await cycleTo('cloth');
        await useToolAt(-0.8, 4.4, 1150);
        await cycleTo('sponge');
        await useToolAt(1.0, 4.2, 950);
        await cycleTo('mop');
        await useToolAt(-2.2, 4.3, 1150);
      }

      // The previous debris pass has already cleaned whichever floor cells its
      // vacuum mouth crossed. Read the remaining dirt mask and work the
      // dirtiest deficient zone next. State selects the walking target; only
      // held tool input changes it.
      await cycleTo('vacuum');
      const requestedZones = {
        'grime-lobby': ['lobby'],
        'grime-retail': ['retail'],
        'grime-service': ['office', 'stockroom'],
      }[phase] || ['lobby', 'retail', 'office', 'stockroom'];
      const grimeMisses = new Set();
      const maxPasses = requestedZones.length === 1 ? 16 : requestedZones.length === 2 ? 22 : 32;
      for (let pass = 0; pass < maxPasses; pass += 1) {
        const target = await page.evaluate(async ({ excluded, requested }) => {
          const C = await import('/src/sim/campaign.js');
          const S = await import('/src/sim/shop.js');
          const app = window.__fw;
          const zones = C.campaignZoneProgress(app.state);
          const requirements = [
            ['lobby', 0.72, { minX: -10.25, maxX: 5.7, minZ: 2.0, maxZ: 6.5 }],
            ['retail', 0.60, { minX: -10.25, maxX: 5.7, minZ: -6.5, maxZ: 2.0 }],
            ['office', 0.55, { minX: 5.7, maxX: 10.25, minZ: 2.0, maxZ: 6.5 }],
            ['stockroom', 0.45, { minX: 5.7, maxX: 10.25, minZ: -6.5, maxZ: 2.0 }],
          ].filter(([id, threshold]) => requested.includes(id) && zones[id] < threshold)
            .sort((a, b) => (b[1] - zones[b[0]]) - (a[1] - zones[a[0]]));
          if (!requirements.length) return null;
          const [zone, , bounds] = requirements[0];
          const grime = app.state.shop.reno.grime;
          const candidates = [];
          for (let cy = 0; cy < S.RENO.grid.h; cy += 1) {
            for (let cx = 0; cx < S.RENO.grid.w; cx += 1) {
              const x = -S.RENO.room.w / 2 + ((cx + 0.5) / S.RENO.grid.w) * S.RENO.room.w;
              const z = -S.RENO.room.d / 2 + ((cy + 0.5) / S.RENO.grid.h) * S.RENO.room.d;
              if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
              const key = `${cx}:${cy}`;
              if (!excluded.includes(key)) candidates.push({ x, z, dirt: grime[cy * S.RENO.grid.w + cx] || 0, key });
            }
          }
          candidates.sort((a, b) => b.dirt - a.dirt);
          return candidates[0] ? { ...candidates[0], zone, zones } : null;
        }, { excluded: [...grimeMisses], requested: requestedZones });
        if (!target) break;
        await useToolAt(target.x, target.z, 1650);
        const after = await page.evaluate(async (zone) => {
          const C = await import('/src/sim/campaign.js');
          return C.campaignZoneProgress(window.__fw.state)[zone];
        }, target.zone);
        if (after <= target.zones[target.zone] + 0.0005) grimeMisses.add(target.key);
      }

      const checkpoint = {
        'grime-lobby': 'checkpoint-lobby-cleaned.json',
        'grime-retail': 'checkpoint-retail-cleaned.json',
        'grime-service': 'checkpoint-floor-cleaned.json',
        'grime-floor': 'checkpoint-floor-cleaned.json',
        grime: 'checkpoint-floor-cleaned.json',
      }[phase];
      const screenshot = {
        'grime-lobby': '03a-lobby-and-entrance-mat-cleaned.png',
        'grime-retail': '03b-retail-floor-cleaned.png',
        'grime-service': '03c-office-and-stockroom-cleaned.png',
        'grime-floor': '03-deep-cleaned-floor.png',
        grime: '03-deep-cleaned-floor.png',
      }[phase];
      await routeLocal(-0.8, 5.0, 0.5);
      await turnLocal(-0.8, 1.0);
      await setPitch(-0.08);
      await page.screenshot({ path: path.join(out, screenshot) });
      await page.evaluate(() => window.__fw.autosave());
      const savedStorage = await page.evaluate(() => Object.fromEntries(
        Array.from({ length: localStorage.length }, (_, index) => {
          const key = localStorage.key(index);
          return [key, localStorage.getItem(key)];
        }),
      ));
      fs.writeFileSync(path.join(out, checkpoint), `${JSON.stringify(savedStorage, null, 2)}\n`);
      const cleaned = await page.evaluate(async () => {
        const C = await import('/src/sim/campaign.js');
        const app = window.__fw;
        return {
          zones: C.campaignZoneProgress(app.state),
          condition: app.scene3d.clubhouse().condition(),
          tools: { ...app.state.campaign.cleaningToolsUsed },
        };
      });
      const required = {
        'grime-lobby': [['lobby', 0.72]],
        'grime-retail': [['lobby', 0.72], ['retail', 0.60]],
      }[phase] || [['lobby', 0.72], ['retail', 0.60], ['office', 0.55], ['stockroom', 0.45]];
      const used = ['vacuum', 'spray', 'cloth', 'sponge', 'mop'];
      const ok = errors.length === 0
        && required.every(([zone, threshold]) => cleaned.zones[zone] >= threshold)
        && used.every((tool) => cleaned.tools[tool]);
      return { ok, phase, errors, actions: actions.length, ...cleaned };
    }

    // Wipe each pane through its physical E prop. Approach from an authored
    // interior stance rather than asking pathfinding to walk into the wall
    // center; the south snack rack, north lounge, and east wall otherwise hide
    // three valid props from an automated straight-line approach.
    const windows = [
      { target: [-8.3, 6.625], stands: [[-8.3, 5.15], [-7.65, 5.15]] },
      { target: [-4.9, 6.625], stands: [[-4.9, 5.15], [-5.55, 5.15]] },
      { target: [3.0, -6.625], stands: [[1.7, -5.55], [1.8, -5.7]] },
      { target: [10.375, 4.6], stands: [[9.1, 4.6], [9.1, 5.2]] },
    ];
    const windowDiagnostics = [];
    for (let index = 0; index < windows.length; index += 1) {
      const spec = windows[index];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const before = await page.evaluate((i) => window.__fw.state.shop.reno.windows[i] || 0, index);
        if (before <= 0) break;
        const [sx, sz] = spec.stands[attempt % spec.stands.length];
        if (index === 3) {
          await goLocalDirect(-0.8, 3.05, 0.58);
          await goLocalDirect(4.4, 4.8, 0.48);
          await goLocalDirect(6.7, 4.8, 0.48);
        }
        await routeLocal(sx, sz, 0.38);
        await turnLocal(spec.target[0], spec.target[1]);
        await setPitch(0.14);
        await page.waitForTimeout(160);
        const pose = await readPose();
        const prompt = pose.prompt;
        if (/Window/i.test(prompt)) {
          await press('e', prompt);
          await page.waitForTimeout(320);
        } else {
          await holdKey(attempt % 2 ? 'a' : 'd', 120 + attempt * 20, 'adjust window stance');
        }
        const after = await page.evaluate((i) => window.__fw.state.shop.reno.windows[i] || 0, index);
        windowDiagnostics.push({
          index, attempt, before, after, prompt, stand: [sx, sz],
          actual: [pose.lx, pose.lz],
        });
      }
    }

    await routeLocal(-0.8, 5.0, 0.5);
    await turnLocal(-0.8, 1.0);
    await setPitch(-0.08);
    await page.screenshot({ path: path.join(out, '04-key-windows-cleaned.png') });
    await page.evaluate(() => window.__fw.autosave());
    const savedStorage = await page.evaluate(() => Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index);
        return [key, localStorage.getItem(key)];
      }),
    ));
    fs.writeFileSync(path.join(out, 'checkpoint-grime-cleaned.json'), `${JSON.stringify(savedStorage, null, 2)}\n`);
    const cleaned = await page.evaluate(async () => {
      const C = await import('/src/sim/campaign.js');
      const app = window.__fw;
      return {
        zones: C.campaignZoneProgress(app.state),
        condition: app.scene3d.clubhouse().condition(),
        tools: { ...app.state.campaign.cleaningToolsUsed },
        windowDirt: [...app.state.shop.reno.windows],
      };
    });
    const used = ['vacuum', 'spray', 'cloth', 'sponge', 'mop'];
    const ok = errors.length === 0
      && cleaned.zones.office >= 0.55
      && cleaned.zones.lobby >= 0.72
      && cleaned.zones.retail >= 0.60
      && cleaned.zones.stockroom >= 0.45
      && cleaned.zones.windows >= 0.60
      && cleaned.windowDirt.every((value) => value <= 0)
      && used.every((tool) => cleaned.tools[tool]);
    return { ok, phase, errors, actions: actions.length, windowDiagnostics, ...cleaned };
  }

  // Demonstrate the distinct debris verbs before the broad vacuum pass.
  await cycleTo('broom');
  let debris = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const sample = await page.evaluate((index) => {
      const list = window.__fw.state.shop.reno.debris;
      return list.length ? { ...list[index % list.length] } : null;
    }, attempt);
    if (!sample) break;
    await useToolAt(sample.x, sample.z, 1200);
    const swept = await page.evaluate(() => !!window.__fw.state.campaign.cleaningToolsUsed.broom);
    if (swept) break;
  }
  await cycleTo('dustpan');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    debris = await page.evaluate((index) => {
      const list = window.__fw.state.shop.reno.debris;
      return list.length ? { ...list[index % list.length] } : null;
    }, attempt);
    if (!debris) break;
    await useToolAt(debris.x, debris.z, 650);
    const scooped = await page.evaluate(() => !!window.__fw.state.campaign.cleaningToolsUsed.dustpan);
    if (scooped) break;
  }
  await cycleTo('trashbag');
  debris = await page.evaluate(() => window.__fw.state.shop.reno.debris.at(-1) || null);
  if (debris) await useToolAt(debris.x, debris.z, 650);

  // Collect the remaining conserved clumps at their current live positions.
  // The bag's authored contact sits at the player's feet, so this is still a
  // physical walk through every room rather than a simulated pickup shortcut.
  await cycleTo('trashbag');
  const bagMisses = new Set();
  for (let pass = 0; pass < 55; pass += 1) {
    const candidates = await page.evaluate(() => {
      const list = window.__fw.state.shop.reno.debris;
      const walk = window.__fw.scene3d.walk.state;
      const c = window.__fw.scene3d.clubhouse().interior.position;
      return list.map((item) => ({ ...item }))
        .sort((a, b) => Math.hypot(a.x - (walk.x - c.x), a.z - (walk.z - c.z))
          - Math.hypot(b.x - (walk.x - c.x), b.z - (walk.z - c.z)));
    });
    const next = candidates.find((item) => !bagMisses.has(`${item.x}:${item.z}`)) || null;
    if (!next) break;
    const before = await page.evaluate(() => window.__fw.scene3d.clubhouse().debrisTotal());
    const northFacing = await useToolAt(next.x, next.z, 420);
    let after = await page.evaluate(() => window.__fw.scene3d.clubhouse().debrisTotal());
    if (after >= before - 0.005) {
      await useToolAt(next.x, next.z, 520, northFacing ? 'south' : 'north');
      after = await page.evaluate(() => window.__fw.scene3d.clubhouse().debrisTotal());
    }
    if (after >= before - 0.005) bagMisses.add(`${next.x}:${next.z}`);
  }

  // A few clumps can settle under lounge furniture where the bag cannot fit.
  // The inherited vacuum reaches under those edges with its physical mouth.
  await cycleTo('vacuum');
  const vacuumMisses = new Set();
  for (let pass = 0; pass < 36; pass += 1) {
    const candidates = await page.evaluate(() => window.__fw.state.shop.reno.debris
      .map((item) => ({ ...item })));
    const next = candidates.find((item) => !vacuumMisses.has(`${item.x}:${item.z}`)) || null;
    if (!next) break;
    const before = await page.evaluate(() => window.__fw.scene3d.clubhouse().debrisTotal());
    const northFacing = await useToolAt(next.x, next.z, 1000);
    let after = await page.evaluate(() => window.__fw.scene3d.clubhouse().debrisTotal());
    if (after >= before - 0.005) {
      await useToolAt(next.x, next.z, 1250, northFacing ? 'south' : 'north');
      after = await page.evaluate(() => window.__fw.scene3d.clubhouse().debrisTotal());
    }
    if (after >= before - 0.005) vacuumMisses.add(`${next.x}:${next.z}`);
  }

  // Empty the conserved pan load into the bag, then dispose the bag at the
  // authored cleaning bay. These are real E interactions introduced by this pass.
  await cycleTo(null);
  const loads = await page.evaluate(() => ({
    pan: window.__fw.state.shop.reno.pan || 0,
    bag: window.__fw.state.shop.reno.bag || 0,
  }));
  if (loads.pan > 0 || loads.bag > 0) {
    await routeLocal(7.70, 1.20, 1.0);
    await turnLocal(7.70, 1.20);
    for (let i = 0; i < 3; i += 1) {
      const current = await page.evaluate(() => ({
        pan: window.__fw.state.shop.reno.pan || 0,
        bag: window.__fw.state.shop.reno.bag || 0,
      }));
      if (current.pan <= 0 && current.bag <= 0) break;
      await press('e', 'use cleaning disposal');
      await page.waitForTimeout(350);
    }
  }

  await routeLocal(-0.8, 5.0, 0.5);
  await turnLocal(-0.8, 1.0);
  await setPitch(-0.08);
  await page.screenshot({ path: path.join(out, '02-trash-cleared-and-routes-open.png') });

  // Persist through the production autosave path, then export that exact browser
  // storage record so the next isolated QA chapter can prove a real reload.
  await page.evaluate(() => window.__fw.autosave());
  const savedStorage = await page.evaluate(() => Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index);
      return [key, localStorage.getItem(key)];
    }),
  ));
  fs.writeFileSync(path.join(out, 'checkpoint-trash-cleared.json'), `${JSON.stringify(savedStorage, null, 2)}\n`);

  const result = await page.evaluate(async () => {
    const app = window.__fw;
    const C = await import('/src/sim/campaign.js');
    const view = C.campaignView(app.state);
    return {
      zoneProgress: view.zoneProgress,
      phase: view.phase,
      condition: app.scene3d.clubhouse().condition(),
      clutterRemaining: app.state.shop.reno.clutter.filter((pile) => !pile.cleared).length,
      debris: app.scene3d.clubhouse().debrisTotal(),
      debrisCount: app.scene3d.clubhouse().debrisCount(),
      pan: app.scene3d.clubhouse().panLoad(),
      bag: app.scene3d.clubhouse().bagLoad(),
      tools: { ...app.state.campaign.cleaningToolsUsed },
      events: { ...app.state.campaign.events },
      objective: view.currentTask,
      prompt: document.querySelector('.shop-prompt')?.textContent || '',
    };
  });
  const allTools = ['broom', 'dustpan', 'trashbag'];
  const ok = errors.length === 0
    && result.clutterRemaining === 0
    && result.debris <= 0.02
    && result.pan <= 0.001
    && result.bag <= 0.001
    && allTools.every((tool) => result.tools[tool]);
  return { ok, errors, actions: actions.length, ...result };
}
