// I6 probe — which half is dead: the per-frame path into cleanWithTool, or
// the sweep sim itself? Seeds a pile at the bristles, then:
//   A) calls clubhouseApi.cleanWithTool('broom', ...) MANUALLY at the contact
//      with a forward dir — if the pile moves, the sim works and the per-frame
//      wiring is what broke;
//   B) instruments cleanWithTool with a counting wrapper and sweeps for 1.2 s
//      through the real keys — the count says whether the frame path calls it.
async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);
  await page.mouse.click(640, 360);
  await page.evaluate(() => window.__fw.scene3d.walk.setTool('broom'));
  await page.waitForFunction(() => window.__fw.scene3d.walk.broomDiagnostics?.()?.vmActive === true,
    null, { timeout: 30000 });
  await page.waitForTimeout(2200);

  return page.evaluate(async () => {
    const app = window.__fw;
    const w = app.scene3d.walk;
    const club = app.scene3d.clubhouse();
    const debris = await import(new URL('src/sim/cleaningDebris.js', document.baseURI).href);
    const o = club.interior.position;
    w.clearKeys();
    w.state.x = o.x - 4.2; w.state.z = o.z + 5.0; w.state.yaw = 0; w.state.pitch = -0.42;
    await new Promise((r) => setTimeout(r, 500));

    const g = w.heldToolGeometry();
    const fx = -Math.sin(w.state.yaw); const fz = -Math.cos(w.state.yaw);
    const list = debris.ensureDebris(app.state);
    list.length = 0;
    // THE DEBRIS LIST IS LOCAL to the interior - seeding world coords put the pile ~350 yd outside the room (the original 'pile not swept' mystery)
    list.push({ x: (g.contactWorld.x - o.x) + fx * 0.15, z: (g.contactWorld.z - o.z) + fz * 0.15, a: 1, kind: 'grit' });
    const before = { x: list[0].x, z: list[0].z };

    // A) manual sim call at the bristles
    const manual = club.cleanWithTool('broom', g.contactWorld.x, g.contactWorld.z, fx, fz, 0.5); // world coords are RIGHT for cleanWithTool (it W2Ls internally)
    const afterManual = { x: list[0].x, z: list[0].z };

    // B) count per-frame calls through the real path
    let calls = 0;
    const original = club.cleanWithTool;
    club.cleanWithTool = (...args) => { calls += 1; return original.apply(club, args); };
    w.setSpraying(true);
    await new Promise((r) => setTimeout(r, 1200));
    w.setSpraying(false);
    club.cleanWithTool = original;
    const afterFrames = list[0] ? { x: list[0].x, z: list[0].z } : null;

    return {
      manualResult: manual,
      manualMovedYd: +Math.hypot(afterManual.x - before.x, afterManual.z - before.z).toFixed(4),
      frameCalls: calls,
      framesMovedYd: afterFrames
        ? +Math.hypot(afterFrames.x - afterManual.x, afterFrames.z - afterManual.z).toFixed(4) : null,
      walkSprayingWorks: true,
    };
  });
}
