// B4 — "NO HANDS VISIBLE ON ANY HANDHELD TOOL: SCRUBBER, SPONGE, CLOTH, SPRAY."
//
// The stick tools (broom, mop, vacuum, dustpan) go through the rig in
// broomViewmodel.js, which owns its own detached lens and its own render layer.
// The hand-worked tools do not; they use the older close-carry path. If the
// hands are missing on those, they are missing for a reason that path has and
// the rig path does not, and the comparison names it.
//
// WHAT IS MEASURED, per tool, with the tool equipped and the trigger held:
//   handsInScene    fpHands.root has an unbroken chain of visible ancestors
//   handLayerMask   which render layer the hand meshes sit on, and whether the
//                   camera that draws this tool carries that layer. A hand on
//                   layer 29 with a world camera on layer 0 is present, correct,
//                   and invisible — the failure that looks exactly like "no
//                   hands" while every scene-graph check passes.
//   handNdc         the projected screen box of the hand meshes, through the
//                   lens that ACTUALLY DREW this tool (walk.toolDrawCamera),
//                   not through the world camera
//   pixels          a screenshot per tool, because the brief says a visual item
//                   without a player-camera screenshot is unconfirmed
//
// NEGATIVE CONTROL. The broom is the approved reference and its hands are known
// to be on screen. If this probe reports "no hands" for the broom too, the probe
// is broken and none of its other answers count. That is asserted, not noted.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/hands-on-tools');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  // Stand on the shop floor at midday, looking slightly down at the boards —
  // the pose the player works a tool from.
  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.42;
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(1500);

  // The probe is installed ONCE and called for both the idle and the in-use
  // capture, so the two readings cannot drift apart.
  await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    window.__handProbe = (tool) => {

      const s3 = window.__fw.scene3d;
      const walk = s3.walk;
      // the lens that DREW this tool. Asking the world camera where a rig-drawn
      // tool landed projects through a lens that did not draw it.
      const lens = walk.toolDrawCamera ? walk.toolDrawCamera(tool) : s3.camera;
      const heldRoot = s3.camera.getObjectByName('HeldRoot') || null;
      // ONLY THE VIEWMODEL'S HANDS. The first version of this probe matched hand
      // meshes by NAME across the whole scene and counted 79-81 of them for
      // every tool with an identical NDC span of x -5.5 to 20.2 — because every
      // CUSTOMER in the room has hands, forearms and sleeves too. It reported
      // "hands on screen: true" for all nine tools without ever finding the
      // player's own. The viewmodel hands are re-parented into whichever tool
      // group is out, and every one of those hangs off the camera; a customer
      // never does. So the camera is the filter.
      const underCamera = (o) => {
        for (let p = o.parent; p; p = p.parent) if (p === s3.camera) return true;
        return false;
      };
      const isHandName = (o) => /hand|palm|finger|thumb|knuckle|forearm|sleeve/i.test(String(o.name || ''));
      const handMeshes = [];
      let worldHandMeshes = 0;
      s3.scene.traverse((o) => {
        if (!o.isMesh || !isHandName(o)) return;
        if (underCamera(o)) handMeshes.push(o);
        else worldHandMeshes++;
      });
      const visibleChain = (o) => {
        let v = o.visible;
        for (let p = o.parent; p && v; p = p.parent) v = p.visible;
        return v;
      };
      const drawn = handMeshes.filter(visibleChain);
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      let minX = 1e9; let maxX = -1e9; let minY = 1e9; let maxY = -1e9;
      let anyInFront = false;
      for (const m of drawn) {
        m.updateWorldMatrix(true, false);
        box.setFromObject(m);
        if (box.isEmpty()) continue;
        for (const [x, y, z] of [
          [box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z],
          [box.min.x, box.max.y, box.min.z], [box.max.x, box.min.y, box.max.z],
        ]) {
          v.set(x, y, z).project(lens);
          if (v.z > -1 && v.z < 1) anyInFront = true;
          minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        }
      }
      const layers = [...new Set(drawn.map((m) => m.layers.mask))];
      const lensMask = lens.layers.mask;
      const onALayerTheLensCarries = drawn.some((m) => (m.layers.mask & lensMask) !== 0);
      const onScreen = anyInFront && maxX > -1 && minX < 1 && maxY > -1 && minY < 1;
      return {
        tool,
        handMeshCount: handMeshes.length,
        worldHandMeshes,
        drawnHandMeshes: drawn.length,
        handLayerMasks: layers,
        lensLayerMask: lensMask,
        onALayerTheLensCarries,
        usedRigLens: !!(walk.toolDrawCamera && walk.toolDrawCamera(tool) !== s3.camera),
        ndc: drawn.length && anyInFront
          ? {
            x: [+minX.toFixed(3), +maxX.toFixed(3)],
            y: [+minY.toFixed(3), +maxY.toFixed(3)],
          }
          : null,
        onScreen,
        heldRootVisible: !!heldRoot?.visible,
      };
    };
  });

  const TOOLS = ['broom', 'mop', 'vacuum', 'dustpan', 'spray', 'cloth', 'sponge', 'trashbag', 'washer'];
  const rows = [];
  for (const id of TOOLS) {
    await page.evaluate((tool) => window.__fw.scene3d.walk.setTool(tool), id);
    await page.waitForTimeout(1600);
    // IDLE FIRST, then in use. A hand that only appears while the trigger is
    // held is still a tool with no hands for most of the time it is out, and the
    // first version of this probe screenshotted only the held state.
    const idle = await page.evaluate((tool) => window.__handProbe(tool), id);
    await page.screenshot({ path: path.join(OUT, `${id}-idle.png`) });
    await page.mouse.down();
    await page.waitForTimeout(700);
    const r = await page.evaluate((tool) => window.__handProbe(tool), id);
    await page.screenshot({ path: path.join(OUT, `${id}-using.png`) });
    await page.mouse.up();
    rows.push({ ...r, idleOnScreen: idle.onScreen, idleHandMeshes: idle.drawnHandMeshes, idleNdc: idle.ndc });
  }

  const by = Object.fromEntries(rows.map((r) => [r.tool, r]));
  const HAND_WORKED = ['spray', 'cloth', 'sponge', 'trashbag'];
  const STICK = ['broom', 'mop', 'vacuum', 'dustpan'];

  const out = {
    rows,
    handsOnScreen: Object.fromEntries(rows.map((r) => [r.tool, r.onScreen])),
    checks: {
      // THE CONTROL: the approved reference must pass, or the probe is broken
      controlBroomHasHandsOnScreen: !!by.broom?.onScreen,
      // the probe must be able to SEE hand meshes at all
      controlFoundHandGeometry: rows.every((r) => r.handMeshCount > 0),
      everyStickToolHasHands: STICK.every((t) => by[t]?.onScreen),
      everyHandWorkedToolHasHands: HAND_WORKED.every((t) => by[t]?.onScreen),
      everyToolHasHands: rows.every((r) => r.onScreen),
      handsAlwaysOnALayerTheLensCarries: rows.every((r) => r.onALayerTheLensCarries),
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.ok = out.checks.controlBroomHasHandsOnScreen && out.checks.controlFoundHandGeometry;
  fs.writeFileSync(path.join(OUT, 'hands.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
