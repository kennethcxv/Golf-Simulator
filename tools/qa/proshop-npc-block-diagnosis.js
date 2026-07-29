async (page) => {
  // BLOCKER 9 — customers stall against the player and push forever instead of
  // repathing. The recovery ladder exists; the question is why it never fires.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-npc-block-diagnosis.js
  //
  // 1x ONLY (SIM-TIME-001): NPC locomotion is wall-rate, so a block is a
  // wall-time phenomenon and a faster clock measures nothing about it.
  //
  // The method is to stand IN a walker's way and then watch the ladder's own
  // inputs — the per-frame step, the displacement it actually achieved, the
  // stuck timer, and the escalation counter — rather than watching the walker
  // and guessing. The ladder's trigger is a comparison between `moved` and
  // `step`; if it never fires, one of those two numbers is not what the ladder
  // assumes it is, and the log will say which.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);
  const WATCH_WALL_S = Number(process.env.NPC_BLOCK_WATCH_S || 40);

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
  // 1x. Never 16x for an NPC claim.
  await page.evaluate(() => { window.__fw.speedIdx = 1; });

  const customersOf = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const list = typeof ch.customers === 'function' ? ch.customers() : ch.customers;
    return (list || []).map((c) => ({
      id: c.customerId ?? c.id ?? c.name,
      x: +c.mesh.position.x.toFixed(3),
      z: +c.mesh.position.z.toFixed(3),
      stopIdx: c.stopIdx,
      stopKind: c.stops?.[c.stopIdx]?.kind ?? null,
      stopX: c.stops?.[c.stopIdx]?.x ?? null,
      stopZ: c.stops?.[c.stopIdx]?.z ?? null,
      stuckT: c.stuckT ?? null,
      escalation: c.stuckEscalation ?? null,
      speed: c.speed ?? null,
    }));
  });

  // Wait for somebody to be walking to a stop, then step into their line.
  let victim = null;
  for (let attempt = 0; attempt < 40 && !victim; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const list = await customersOf();
    victim = list.find((c) => c.stopX !== null
      && Math.hypot(c.stopX - c.x, c.stopZ - c.z) > 1.4);
    // eslint-disable-next-line no-await-in-loop
    if (!victim) await page.waitForTimeout(1000);
  }
  if (!victim) {
    return { ok: false, reason: 'no walker with a distant stop appeared within 40 s' };
  }

  // Stand one body-length in front of them, ON the line to their stop.
  await page.evaluate((v) => {
    const w = window.__fw.scene3d.walk.state;
    const dx = v.stopX - v.x;
    const dz = v.stopZ - v.z;
    const len = Math.hypot(dx, dz) || 1;
    w.x = v.x + (dx / len) * 0.85;
    w.z = v.z + (dz / len) * 0.85;
    w.yaw = Math.atan2(-(v.x - w.x), -(v.z - w.z));
    w.pitch = 0;
  }, victim);

  // Sample the ladder's own inputs every 250 ms of WALL time.
  const samples = [];
  const started = Date.now();
  let held = { x: null, z: null };
  while ((Date.now() - started) / 1000 < WATCH_WALL_S) {
    // eslint-disable-next-line no-await-in-loop
    const row = await page.evaluate((id) => {
      const ch = window.__fw.scene3d.clubhouse();
      const list = typeof ch.customers === 'function' ? ch.customers() : ch.customers;
      const c = (list || []).find((x) => (x.customerId ?? x.id ?? x.name) === id);
      if (!c) return null;
      const w = window.__fw.scene3d.walk.state;
      const stop = c.stops?.[c.stopIdx] || null;
      return {
        x: +c.mesh.position.x.toFixed(4),
        z: +c.mesh.position.z.toFixed(4),
        toPlayer: +Math.hypot(c.mesh.position.x - w.x, c.mesh.position.z - w.z).toFixed(3),
        toStop: stop ? +Math.hypot(c.mesh.position.x - stop.x, c.mesh.position.z - stop.z).toFixed(3) : null,
        stuckT: c.stuckT ?? 0,
        escalation: c.stuckEscalation ?? 0,
        repathed: !!c.repathed,
        stopIdx: c.stopIdx,
      };
    }, victim.id);
    if (!row) break;
    // Keep the player planted: a drifting blocker measures nothing.
    // eslint-disable-next-line no-await-in-loop
    if (held.x === null) {
      // eslint-disable-next-line no-await-in-loop
      held = await page.evaluate(() => ({ x: window.__fw.scene3d.walk.state.x, z: window.__fw.scene3d.walk.state.z }));
    } else {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate((h) => {
        const w = window.__fw.scene3d.walk.state;
        w.x = h.x; w.z = h.z;
      }, held);
    }
    samples.push({ t: +((Date.now() - started) / 1000).toFixed(2), ...row });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(250);
  }

  // What the ladder saw.
  const moved = [];
  for (let i = 1; i < samples.length; i += 1) {
    moved.push(+Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z).toFixed(4));
  }
  const blockedWindow = samples.filter((s) => s.toPlayer < 0.95);
  const progress = samples.length > 1 && samples[0].toStop !== null
    ? +(samples[0].toStop - samples[samples.length - 1].toStop).toFixed(3)
    : null;

  const out = {
    speed: '1x',
    victim: victim.id,
    watchedWallS: WATCH_WALL_S,
    samples: samples.length,
    // THE ANSWER: with the player planted in the way, did the ladder ever run?
    maxStuckT: Math.max(0, ...samples.map((s) => s.stuckT || 0)),
    maxEscalation: Math.max(0, ...samples.map((s) => s.escalation || 0)),
    everRepathed: samples.some((s) => s.repathed),
    stopAdvanced: samples.length > 1 && samples[samples.length - 1].stopIdx !== samples[0].stopIdx,
    // and was it actually blocked, and did it actually get anywhere?
    framesWithinOneBody: blockedWindow.length,
    netProgressTowardStopYd: progress,
    totalDistanceWalkedYd: +moved.reduce((a, b) => a + b, 0).toFixed(3),
    navBlocksLogged: await page.evaluate(() => window.__fw.scene3d.clubhouse().navBlockDiagnostics?.().total ?? null),
    samplesTail: samples.slice(-24),
  };
  // A walker that covers ground while getting no closer to its goal is the
  // reported symptom: pushing forever instead of repathing.
  out.walkedWithoutArriving = out.totalDistanceWalkedYd > 1.0
    && (out.netProgressTowardStopYd === null || out.netProgressTowardStopYd < 0.5);
  fs.writeFileSync(path.join(outDir, 'npc-block-diagnosis.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
