async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => (
    window.__fw?.scene3d?.clubhouse?.()?.architecturalDoors?.diagnostics?.().ready === true
  ), null, { timeout: 120000 });
  const results = await page.evaluate(async () => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    clubhouse.clearWalkins();
    const routes = [
      ['Shop door', [[-0.8, 8.3], [-0.8, 7.7], [-0.8, 7.13], [-0.8, 6.5]]],
      ['Stockroom door', [[8.9, 3.2], [8.9, 2.55], [8.9, 2.0], [8.9, 1.25]]],
      ['Receiving door', [[12.4, -3.6], [11.85, -3.6], [11.36, -3.6], [10.6, -3.6]]],
    ];
    const samples = [];
    for (const [name, localPoints] of routes) {
      const actor = clubhouse.debugSpawn(true);
      actor.stops = [{ kind: 'walk', x: actor.mesh.position.x + 100, z: actor.mesh.position.z + 100 }];
      actor.stopIdx = 0;
      actor.speed = 0;
      const worldPoints = localPoints.map(([x, z]) => {
        const point = clubhouse.group.localToWorld(clubhouse.group.position.clone().set(x, 0, z));
        return [point.x, point.z];
      });
      const door = clubhouse.doors.find((entry) => entry.name === name);
      let maxAngle = 0;
      const steps = [];
      for (const [x, z] of worldPoints) {
        actor.mesh.position.set(x, actor.mesh.position.y, z);
        await new Promise((resolve) => setTimeout(resolve, 180));
        maxAngle = Math.max(maxAngle, Math.abs(door.angle));
        steps.push({ customerCount: clubhouse.customers.length, open: door.open, angle: door.angle });
      }
      samples.push({ name, maxAngle, steps, ok: maxAngle > 0.2 });
      clubhouse.clearWalkins();
      door.open = false;
      if (door.desiredOpen !== undefined) door.desiredOpen = false;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    return samples;
  });
  return { ok: results.every((entry) => entry.ok), results };
}
