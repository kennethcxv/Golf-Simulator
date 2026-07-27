async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('golfempire:autosave'));
    const holding = raw.holdings.find((entry) => entry.property.id === raw.activeId) || raw.holdings[0];
    holding.property.tierId = 'premiumPrivate';
    holding.state.property.tierId = 'premiumPrivate';
    holding.state.tutorial.complete = true;
    holding.state.tutorial.hidden = true;
    localStorage.setItem('golfempire:autosave', JSON.stringify(raw));
  });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => (
    window.__fw?.scene3d?.clubhouse?.()?.premiumCountryClub?.diagnostics?.().status === 'ready'
  ), null, { timeout: 90000 });
  await page.waitForTimeout(1800);
  return page.evaluate(() => {
    const group = window.__fw.scene3d.clubhouse().group;
    const scene = window.__fw.scene3d.scene;
    const rootFor = (object) => {
      let current = object;
      while (current.parent && current.parent !== group) current = current.parent;
      return current;
    };
    const buckets = new Map();
    group.traverseVisible((object) => {
      if (!object.isMesh) return;
      const root = rootFor(object);
      if (/PremiumCountryClub/i.test(root.name || '')) return;
      const entry = buckets.get(root.uuid) || {
        root: root.name || '(unnamed)',
        rootType: root.type,
        meshCount: 0,
        samples: [],
      };
      entry.meshCount += 1;
      if (entry.samples.length < 24) entry.samples.push(object.name || '(unnamed)');
      buckets.set(root.uuid, entry);
    });
    const meshSummary = (root) => {
      const meshes = [];
      root.traverseVisible((object) => {
        if (!object.isMesh || meshes.length >= 24) return;
        meshes.push({
          name: object.name || '(unnamed)',
          materials: (Array.isArray(object.material) ? object.material : [object.material])
            .filter(Boolean).map((material) => material.name || '(unnamed)').slice(0, 4),
        });
      });
      return meshes;
    };
    const nearbySceneRoots = scene.children.filter((child) => {
      const dx = child.position.x - group.position.x;
      const dz = child.position.z - group.position.z;
      return Math.hypot(dx, dz) < 140;
    }).map((child) => ({
      name: child.name || '(unnamed)',
      uuid: child.uuid,
      type: child.type,
      visible: child.visible,
      position: { x: child.position.x, y: child.position.y, z: child.position.z },
      childCount: child.children.length,
      userDataKeys: Object.keys(child.userData || {}),
      meshSamples: meshSummary(child),
      childRoots: child.children.slice(0, 80).map((entry) => ({
        name: entry.name || '(unnamed)',
        type: entry.type,
        visible: entry.visible,
        childCount: entry.children.length,
        userDataKeys: Object.keys(entry.userData || {}),
        meshSamples: meshSummary(entry).slice(0, 8),
      })),
    }));
    return {
      clubhouseGroupUuid: group.uuid,
      nearbySceneRoots,
      directChildren: group.children.map((child) => ({
        name: child.name || '(unnamed)',
        type: child.type,
        visible: child.visible,
        childCount: child.children.length,
      })),
      visibleNonPremiumRoots: [...buckets.values()].sort((a, b) => b.meshCount - a.meshCount),
    };
  });
}
