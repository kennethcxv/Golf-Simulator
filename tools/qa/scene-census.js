async (page) => {
  // Who is actually in this scene graph? Counts per subtree so optimization aims at the
  // real weight, not a guess.
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  return page.evaluate(() => {
    const scene = window.__fw.scene3d.post.composer.passes[0].scene;
    let total = 0; let meshes = 0; let instanced = 0; let autoUpdate = 0;
    scene.traverse((o) => {
      total++;
      if (o.isInstancedMesh) instanced++;
      else if (o.isMesh) meshes++;
      if (o.matrixAutoUpdate) autoUpdate++;
    });
    const groups = scene.children.map((c) => {
      let n = 0; let m = 0;
      c.traverse((o) => { n++; if (o.isMesh) m++; });
      return { name: c.name || c.type, kids: n, meshes: m };
    }).sort((a, b) => b.kids - a.kids).slice(0, 14);
    // also look one level into the biggest group
    const biggest = scene.children.slice().sort((a, b) => {
      let na = 0; let nb = 0;
      a.traverse(() => na++); b.traverse(() => nb++);
      return nb - na;
    })[0];
    const inner = biggest ? biggest.children.map((c) => {
      let n = 0;
      c.traverse(() => n++);
      return { name: c.name || c.type, kids: n };
    }).sort((a, b) => b.kids - a.kids).slice(0, 10) : [];
    return { total, meshes, instanced, autoUpdate, groups, biggestName: biggest && (biggest.name || biggest.type), inner };
  });
}
