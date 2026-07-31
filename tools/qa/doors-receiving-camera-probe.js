async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repoRoot = process.env.QA_REPO_ROOT || process.cwd();
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = path.join(repoRoot, 'qa', 'doors', 'camera-probe');
  fs.mkdirSync(out, { recursive: true });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.()?.architecturalDoors?.diagnostics?.().ready, null, { timeout: 120000 });
  await page.addStyleTag({ content: '.toast-wrap, .notification-center, .shop-lockhint { display: none !important; }' });
  await page.evaluate(async () => {
    const finishes = await import('/src/sim/constructionFinishes.js');
    const state = window.__fw.state;
    state.cash = Math.max(Number(state.cash) || 0, 10_000_000);
    const construction = finishes.ensureConstructionFinishes(state);
    const selectionId = 'doors:hollow-core:high-end';
    if (!construction.owned.includes(selectionId)) construction.owned.push(selectionId);
    finishes.installConstructionFinish(state, 'doors', 'hollow-core', 'high-end');
    await window.__fw.scene3d.clubhouse().architecturalDoors.sync();
    const door = window.__fw.scene3d.clubhouse().doors.find((entry) => entry.name === 'Receiving door');
    door.open = false;
    door.angle = 0;
  });
  await page.waitForTimeout(900);

  async function setPose(at, target) {
    await page.evaluate(({ atLocal, targetLocal }) => {
      const scene = window.__fw.scene3d;
      const clubhouse = scene.clubhouse();
      clubhouse.group.updateWorldMatrix(true, false);
      const atWorld = clubhouse.group.localToWorld(clubhouse.group.position.clone().set(atLocal[0], 0, atLocal[1]));
      const targetWorld = clubhouse.group.localToWorld(clubhouse.group.position.clone().set(targetLocal[0], 0, targetLocal[1]));
      scene.walk.clearKeys();
      scene.walk.state.x = atWorld.x;
      scene.walk.state.z = atWorld.z;
      scene.walk.state.yaw = Math.atan2(-(targetWorld.x - atWorld.x), -(targetWorld.z - atWorld.z));
      scene.walk.state.pitch = -0.08;
      const day = Math.floor(window.__fw.state.clock.minutes / 1440);
      window.__fw.state.clock.minutes = day * 1440 + 14 * 60;
      scene.applyTimeWeather(14 * 60, window.__fw.state.weather);
    }, { atLocal: at, targetLocal: target });
    await page.waitForTimeout(400);
  }

  const candidates = [
    ['a-straight', [9.35, -3.60]],
    ['b-north-near', [9.75, -2.75]],
    ['c-south-near', [9.75, -4.45]],
    ['d-north-wide', [9.05, -2.45]],
    ['e-south-wide', [9.05, -4.75]],
    ['f-north-tight', [10.10, -2.90]],
    ['g-south-tight', [10.10, -4.30]],
    ['h-exterior-front', [13.60, -3.60]],
    ['i-exterior-south', [12.90, -4.35]],
    ['j-exterior-north', [12.90, -2.85]],
    ['k-exterior-wide', [14.10, -4.55]],
  ];
  for (const [name, at] of candidates) {
    await setPose(at, [11.36, -3.60]);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  }
  const sign = await page.evaluate(() => {
    const root = window.__fw.scene3d.clubhouse().group;
    const node = root.getObjectByName('DeliveryReceivingExteriorSign');
    return node ? {
      y: node.position.y,
      offsetY: node.userData.architecturalDoorOffsetY,
      tier: node.userData.architecturalDoorClearanceTier,
    } : null;
  });
  const result = { ok: true, candidates: candidates.map(([name, at]) => ({ name, at })), sign };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}
