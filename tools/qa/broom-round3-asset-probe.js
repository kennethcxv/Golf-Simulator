async (page) => {
  // What is the broom rig ACTUALLY made of, in its own local frame?
  //
  //   node tools/qa/run-playwright.cjs tools/qa/broom-round3-asset-probe.js
  //
  // The round-3 solve places the tool using the registry's procedural contact
  // socket (0, -0.215, -1.85). If the authored GLB swapped in with a different
  // scale, a different socket, or its own root offset, that solve is aiming at
  // a point the drawn geometry does not have — which is exactly the symptom:
  // hands land on their anchor, shaft misses them.
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /New game/i }).click();
  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const confirmStart = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirmStart.isVisible({ timeout: 1500 }).catch(() => false)) await confirmStart.click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.mouse.click(640, 360);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForTimeout(2800);

  return page.evaluate(() => {
    const app = window.__fw;
    let tool = null;
    app.scene3d.scene.traverse((o) => { if (o.name === 'Tool_broom') tool = o; });
    if (!tool) return { error: 'Tool_broom not found' };
    const Vec3 = tool.position.constructor;
    const v = new Vec3();

    // every descendant's name/type/scale, and any socket-looking node
    const nodes = [];
    const sockets = {};
    tool.updateWorldMatrix(true, true);
    const inv = tool.matrixWorld.clone().invert();
    tool.traverse((o) => {
      if (o === tool) return;
      o.getWorldPosition(v);
      const local = v.clone().applyMatrix4(inv); // position in TOOL-local space
      const entry = {
        name: o.name || o.type,
        type: o.type,
        isMesh: !!o.isMesh,
        localPos: [+local.x.toFixed(3), +local.y.toFixed(3), +local.z.toFixed(3)],
        scale: o.scale.toArray().map((n) => +n.toFixed(3)),
      };
      if (/SOCKET|Grip|Contact/i.test(o.name || '')) sockets[o.name] = entry.localPos;
      nodes.push(entry);
    });

    // the extent of the drawn geometry in tool-local space: where the shaft
    // really starts and ends
    let lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
    let meshCount = 0;
    tool.traverse((m) => {
      if (!m.isMesh || !m.visible) return;
      // skip the hands/arms — we want the TOOL's own geometry
      for (let p = m; p; p = p.parent) {
        if (['FirstPersonHands', 'BroomRightArm', 'BroomLeftArm'].includes(p.name)) return;
      }
      const pos = m.geometry?.attributes?.position;
      if (!pos) return;
      meshCount += 1;
      const step = Math.max(1, Math.floor(pos.count / 80));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i);
        m.localToWorld(v);
        v.applyMatrix4(inv);
        lo = [Math.min(lo[0], v.x), Math.min(lo[1], v.y), Math.min(lo[2], v.z)];
        hi[0] = Math.max(hi[0], v.x); hi[1] = Math.max(hi[1], v.y); hi[2] = Math.max(hi[2], v.z);
      }
    });

    return {
      toolScale: tool.scale.toArray().map((n) => +n.toFixed(4)),
      toolParent: tool.parent?.name || tool.parent?.type || null,
      parentScale: tool.parent?.scale.toArray().map((n) => +n.toFixed(4)) || null,
      parentPos: tool.parent?.position.toArray().map((n) => +n.toFixed(3)) || null,
      sockets,
      toolGeometryLocalBounds: {
        min: lo.map((n) => +n.toFixed(3)), max: hi.map((n) => +n.toFixed(3)), meshCount,
      },
      nodes: nodes.filter((n) => !n.name.startsWith('Mesh')).slice(0, 30),
    };
  });
}
