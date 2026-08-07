// B3/B4 — THE HANDS RIDE TOO LOW, AND TWO CONSTRAINTS DECIDE WHERE THEY GO.
//
// Three complaints turned out to be one: the broom's hand "detached" from its
// shaft (it is not — the palm measures 0.035 yd from the pole's axis, which is a
// grip), the vacuum's hands off the bottom of the screen, and the sponge's hand
// before it was fixed. In every case the hand sits at or below the frame's
// bottom edge at a working pitch, so the player sees a sliver and fills in the
// rest.
//
// It cannot be fixed by eye on one number, because moving the hands trades
// against the thing the rig exists to do:
//   FRAMING  the wrist must be far enough above the bottom edge that the whole
//            fist is drawn. Measured as the wrist's own NDC y through the lens
//            that DRAWS this tool.
//   PLANT    the tool's head must still reach the boards. Measured as the
//            contact socket's height above the floor.
// Raise the hands and the plant breaks; drop them and the framing does. So the
// sweep varies BOTH y and z — the broom's own history says depth buys framing
// back without costing drop — and reports the pair for every candidate.
//
// CONTROLS:
//   * a deliberately absurd anchor (y -2.0) must fail framing. If everything
//     passes, the framing test is not testing framing.
//   * the shipped anchor is measured first and last. The two readings must
//     agree, or the rig has drifted under the sweep and no comparison holds.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const TOOL = process.env.SWEEP_TOOL || 'broom';
  const OUT = path.resolve(`qa/electron/hand-framing-${TOOL}`);
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
  await page.waitForTimeout(3500);

  await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.34;
  });
  await page.mouse.click(640, 360);
  // the lock hint is a wide opaque bar exactly where the hand is
  await page.addStyleTag({ content: '.shop-lockhint, .dirt-sense-hint { display: none !important; }' });
  await page.evaluate((t) => window.__fw.scene3d.walk.setTool(t), TOOL);
  await page.waitForTimeout(2200);

  await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const s3 = window.__fw.scene3d;
    const cam = s3.camera;
    const under = (o) => { for (let p = o.parent; p; p = p.parent) if (p === cam) return true; return false; };
    const vis = (o) => { let v = o.visible; for (let p = o.parent; p && v; p = p.parent) v = p.visible; return v; };
    window.__framing = (toolId) => {
      const walk = s3.walk;
      const lens = walk.toolDrawCamera ? walk.toolDrawCamera(toolId) : cam;
      let hand = null;
      let contact = null;
      s3.scene.traverse((o) => {
        if (!vis(o)) return;
        const n = String(o.name || '');
        if (!hand && n === 'FirstPersonRightHand' && under(o)) hand = o;
        // the tool's own cleaning contact, whatever it is called on this tool
        if (!contact && /SOCKET_(FloorContact|DirtIntake|PanIntake|BristleContact|SweepContact)/i.test(n)
          && under(o)) contact = o;
      });
      if (!hand) return { error: 'no hand' };
      cam.updateMatrixWorld(true);
      // THE WRIST, not the hand's bounding box. The box includes the forearm,
      // which trails far back and down whatever the fist is doing, and reading
      // it as "the hand" is what made an earlier probe report the broom's hands
      // spanning eight screen-heights.
      const wrist = hand.getWorldPosition(new THREE.Vector3()).project(lens);
      const floorY = (s3.clubhouse()?.interior?.position?.y ?? 0);
      const head = contact ? contact.getWorldPosition(new THREE.Vector3()) : null;
      return {
        wristNdcY: +wrist.y.toFixed(3),
        wristNdcX: +wrist.x.toFixed(3),
        wristInFront: wrist.z > -1 && wrist.z < 1,
        headAboveFloorYd: head ? +(head.y - floorY).toFixed(3) : null,
        contactName: contact ? contact.name : null,
      };
    };
  });

  const measure = async (name, anchor) => {
    await page.evaluate(({ t, a }) => window.__fw.scene3d.walk.toolRigSetGripAnchor(t, a),
      { t: TOOL, a: anchor });
    await page.waitForTimeout(750);
    const m = await page.evaluate((t) => window.__framing(t), TOOL);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    return { name, anchor, ...m };
  };

  const shipped = await page.evaluate(async (t) => {
    const feel = await import(new URL('src/data/toolFeel.js', document.baseURI).href);
    return feel.TOOL_VM_FEEL[t]?.compose?.gripAnchor || null;
  }, TOOL);

  const rows = [];
  rows.push(await measure('00-shipped-first', null));
  // CONTROL: absurdly low. Must fail framing.
  rows.push(await measure('01-control-far-below', [shipped[0], -2.0, shipped[2]]));
  // the candidates: raise y, and buy the reach back with depth
  const [sx, sy, sz] = shipped;
  const CANDIDATES = [
    ['lift-06', [sx, sy + 0.06, sz]],
    ['lift-12', [sx, sy + 0.12, sz]],
    ['lift-12-deep', [sx * 1.14, sy + 0.12, sz * 1.14]],
    ['lift-18-deep', [sx * 1.22, sy + 0.18, sz * 1.22]],
    ['lift-18-deeper', [sx * 1.34, sy + 0.18, sz * 1.34]],
  ];
  for (const [name, a] of CANDIDATES) rows.push(await measure(name, a));
  rows.push(await measure('99-shipped-again', null));
  await page.evaluate((t) => window.__fw.scene3d.walk.toolRigSetGripAnchor(t, null), TOOL);

  const first = rows.find((r) => r.name === '00-shipped-first');
  const last = rows.find((r) => r.name === '99-shipped-again');
  const control = rows.find((r) => r.name === '01-control-far-below');
  // a wrist at -0.80 leaves roughly a fist's height of frame below it
  const FRAMED = -0.80;
  const scored = rows.filter((r) => !r.name.startsWith('0') && !r.name.startsWith('99')).map((r) => ({
    ...r,
    framed: r.wristNdcY > FRAMED,
    planted: r.headAboveFloorYd != null && r.headAboveFloorYd < 0.14,
  }));

  const out = {
    tool: TOOL, shipped, rows, scored, framedThreshold: FRAMED,
    checks: {
      controlFarBelowFailsFraming: !!control && control.wristNdcY <= FRAMED,
      sweepDidNotDrift: !!first && !!last
        && Math.abs(first.wristNdcY - last.wristNdcY) < 0.05,
      shippedIsUnderFramed: !!first && first.wristNdcY <= FRAMED,
      someCandidateDoesBoth: scored.some((r) => r.framed && r.planted),
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 6),
  };
  out.ok = out.checks.controlFarBelowFailsFraming && out.checks.sweepDidNotDrift;
  fs.writeFileSync(path.join(OUT, 'framing.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
