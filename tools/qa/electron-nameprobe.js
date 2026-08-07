// throwaway probe #4: what did buildHeadLag actually wrap? If the contact
// socket's parent is the GLB root, the "head siblings" sweep grabbed the
// ENTIRE tool — and every swing of headLag rotates the whole drawn mesh
// about the contact point while the sockets (and the hand glued to them)
// stay put. That is the rest-fine / motion-detached signature measured in
// pixels and world units tonight.
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const app = window.__fw;
    const inv = app.state?.shop?.inventory;
    if (inv && !inv.vac1) inv.vac1 = { shelf: 0, back: 1 };
    else if (inv && !(inv.vac1.back > 0)) inv.vac1.back = 1;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.10;
    app.scene3d.walk.setTool('broom');
  });
  await page.waitForTimeout(4000);
  return page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const out = {};
    for (const tool of ['broom', 'mop']) {
      if (tool === 'mop') s3.walk.setTool('mop');
      const g = s3.scene.getObjectByName(`Tool_${tool}`);
      const pivot = g?.getObjectByName('ToolHeadLagPivot');
      const contact = g?.getObjectByName(tool === 'mop' ? 'SOCKET_FloorContact' : 'SOCKET_FloorContact');
      const diag = s3.walk.toolRigDiagnostics ? s3.walk.toolRigDiagnostics(tool) : null;
      const names = [];
      pivot?.traverse((o) => { if (o.isMesh) names.push(o.name || '(unnamed)'); });
      out[tool] = {
        headLagReason: diag?.headLag?.reason ?? null,
        contactParent: contact?.parent?.name || `(${contact?.parent?.type})`,
        pivotDirectChildren: (pivot?.children || []).map((c) => c.name || `(${c.type})`),
        pivotMeshCount: names.length,
        pivotMeshes: names.slice(0, 24),
        totalMeshesInGroup: (() => { let n = 0; g?.traverse((o) => { if (o.isMesh) n += 1; }); return n; })(),
      };
    }
    return out;
  });
}
