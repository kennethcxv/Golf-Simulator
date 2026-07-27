async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const messages = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      messages.push(`console:${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => (
    window.__fw?.scene3d?.clubhouse?.()?.architecturalDoors?.diagnostics?.().ready === true
  ), null, { timeout: 120000 });
  await page.evaluate(async () => {
    const doors = window.__fw.scene3d.clubhouse().architecturalDoors;
    await doors.createStressSet({ visible: true });
    doors.forceStressLod(null);
    const scene = window.__fw.scene3d;
    const clubhouse = scene.clubhouse();
    clubhouse.group.updateWorldMatrix(true, false);
    const at = clubhouse.group.localToWorld(clubhouse.group.position.clone().set(0, 0, -17.5));
    const target = clubhouse.group.localToWorld(clubhouse.group.position.clone().set(0, 0, -27.5));
    scene.walk.clearKeys();
    scene.walk.state.x = at.x;
    scene.walk.state.z = at.z;
    scene.walk.state.yaw = Math.atan2(-(target.x - at.x), -(target.z - at.z));
    scene.walk.state.pitch = -0.04;
  });
  await page.waitForTimeout(2200);
  const result = await page.evaluate(() => {
    const clubhouse = window.__fw.scene3d.clubhouse();
    const root = clubhouse.group.getObjectByName('ArchitecturalDoorStressSet_53');
    const tiers = {};
    let visibleMeshes = 0;
    let shadowMeshes = 0;
    let visibleTriangles = 0;
    let shadowTriangles = 0;
    const levels = {};
    for (const holder of root.children) {
      const tier = holder.userData.architecturalDoorTier;
      const lod = holder.userData.rig?.lodLevel;
      const key = `${tier}:lod${lod}`;
      tiers[key] ||= { instances: 0, visibleMeshes: 0, shadowMeshes: 0, triangles: 0, shadowTriangles: 0 };
      tiers[key].instances += 1;
      holder.traverseVisible((object) => {
        if (!object.isMesh || !object.geometry) return;
        const triangles = object.geometry.index
          ? object.geometry.index.count / 3
          : (object.geometry.attributes?.position?.count || 0) / 3;
        visibleMeshes += 1;
        visibleTriangles += triangles;
        tiers[key].visibleMeshes += 1;
        tiers[key].triangles += triangles;
        if (object.castShadow) {
          shadowMeshes += 1;
          shadowTriangles += triangles;
          tiers[key].shadowMeshes += 1;
          tiers[key].shadowTriangles += triangles;
        }
      });
      levels[lod] = (levels[lod] || 0) + 1;
    }
    return {
      instances: root.children.length,
      levels,
      visibleMeshes,
      shadowMeshes,
      visibleTriangles,
      shadowTriangles,
      tiers,
      renderer: { ...window.__fw.scene3d.renderer.info.render },
    };
  });
  return { ok: messages.length === 0, result, messages };
}
