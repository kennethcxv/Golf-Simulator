// E0 (Goal 19) — WHY IS strandRigFor('mop') NULL IN A QA BOOT?
//
// The accessor reads the right group (heldGroups spreads the registry's own
// group objects). So either the authored GLB never adopts in a QA boot, or
// the collar/skirt nodes the rig hangs from are missing. This probe equips
// the mop, waits, then reports: every node name under the held-mop group,
// the adoption markers, the rig handle, and any console error the loader
// printed.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-e0-strand-handle.js --clubhouse=pine-hills-v2
async (page) => {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 160));
  });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__fw.scene3d.walk.setTool('mop'); });
  // give adoption a generous but bounded window, checking each second
  let rig = false;
  for (let i = 0; i < 30; i += 1) {
    await page.waitForTimeout(1000);
    rig = await page.evaluate(() => !!window.__fw.scene3d.walk.strandRigFor?.('mop'));
    if (rig) break;
  }
  const probe = await page.evaluate(() => {
    const app = window.__fw;
    const walk = app.scene3d.walk;
    const scene = app.scene3d.camera.parent || null;
    const names = [];
    let mopGroup = null;
    const root = scene && scene.isScene ? scene : app.scene3d.clubhouse().interior.parent;
    (root || app.scene3d.clubhouse().interior).traverse((o) => {
      if (/mop/i.test(o.name || '')) names.push(`${o.name}${o.visible ? '' : ' [hidden]'}`);
      if (o.name === 'HeldMop' || /HeldToolAuthored:.*mop/i.test(o.name || '')) mopGroup = o;
    });
    return {
      rig: !!walk.strandRigFor?.('mop'),
      rigDiag: walk.toolRigDiagnostics ? walk.toolRigDiagnostics('mop') : null,
      mopNames: names.slice(0, 30),
      heldTool: walk.getTool ? walk.getTool() : null,
    };
  });
  console.log('E0-HANDLE', JSON.stringify({ rigAppeared: rig, ...probe, consoleErrors: errors.slice(0, 8) }));
}
