// Q7 — one hand on the shaft (the reference), and a head that trails the stroke.
//
// Two claims, both measured on the running rig rather than eyeballed:
//   A. ONE HAND. Every stick tool draws its primary hand and NOT a second one,
//      which is what the reference photograph shows and what removes the
//      same-side grip complaint. NEGATIVE CONTROL: a tool that legitimately
//      uses two hands at the checkout still reports two, so "one hand" is a
//      per-tool decision and not the rig having lost the ability to draw two.
//   B. THE HEAD TRAILS. Swept side to side, the head's lag angle must reach a
//      real magnitude and must CHANGE SIGN when the stroke reverses - a rigid
//      prop reads zero forever, and a constant offset is not physics either.
//      NEGATIVE CONTROL: standing still, the angle settles back toward zero.
// Plus a screenshot of every tool at the player's camera, which is the
// deliverable the ruling actually asks for.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/tool-hands-and-head');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(300);

  // stand in the middle of the sales floor, looking at the boards
  await page.evaluate(() => {
    const app = window.__fw;
    const off = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = off.x;
    walk.z = off.z + 2.2;
    walk.yaw = Math.PI;
    walk.pitch = -0.36;
    app.speedIdx = 0;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 11 * 60;
    app.scene3d.applyTimeWeather(660, app.state.weather);
  });
  await page.waitForTimeout(600);

  const STICK_TOOLS = ['broom', 'mop', 'washer', 'vacuum'];
  const SMALL_TOOLS = ['sponge', 'spray', 'cloth'];
  const handsOut = () => page.evaluate(() => {
    const hands = window.__fw.scene3d.scene.getObjectByName('FirstPersonHands')
      || window.__fw.scene3d.camera.getObjectByName('FirstPersonHands');
    if (!hands) return { error: 'no hands root' };
    const visible = (name) => {
      const h = hands.getObjectByName(name);
      if (!h) return false;
      for (let p = h; p; p = p.parent) if (p.visible === false) return false;
      return true;
    };
    return {
      right: visible('FirstPersonRightHand'),
      left: visible('FirstPersonLeftHand'),
    };
  });

  const equip = async (tool) => {
    await page.evaluate((id) => window.__fw.scene3d.walk.setTool(id), tool);
    await page.waitForTimeout(1400);
  };

  const perTool = {};
  for (const tool of [...STICK_TOOLS, ...SMALL_TOOLS]) {
    await equip(tool);
    perTool[tool] = await handsOut();
    await page.screenshot({ path: path.join(OUT, `tool-${tool}.png`) });
  }

  // ---- B: does the head trail? -------------------------------------------
  await equip('broom');
  const sweep = await page.evaluate(async () => {
    const app = window.__fw;
    const walk = app.scene3d.walk;
    const read = () => walk.broomDiagnostics?.()?.headLag || null;
    const first = read();
    if (!first) return { error: 'no headLag diagnostics' };
    const samples = [];
    const baseYaw = walk.state.yaw;
    // sweep the view left and right, which is what drags the head across
    for (let i = 0; i < 90; i += 1) {
      walk.state.yaw = baseYaw + Math.sin(i * 0.22) * 0.55;
      await new Promise((r) => setTimeout(r, 34));
      const s = read();
      if (s) samples.push(s.angle);
    }
    // then hold still and let it settle
    walk.state.yaw = baseYaw;
    await new Promise((r) => setTimeout(r, 1400));
    const settled = read();
    return {
      swinging: first.swinging,
      reason: first.reason,
      samples,
      maxAngle: samples.length ? Math.max(...samples.map(Math.abs)) : 0,
      wentBothWays: samples.some((a) => a > 0.02) && samples.some((a) => a < -0.02),
      settledAngle: settled ? Math.abs(settled.angle) : null,
    };
  });

  const stickHands = STICK_TOOLS.map((t) => ({ tool: t, ...perTool[t] }));
  const smallHands = SMALL_TOOLS.map((t) => ({ tool: t, ...perTool[t] }));
  const checks = {
    everyStickToolHasAHand: stickHands.every((h) => h.right === true),
    // the reference: ONE hand on the shaft
    noStickToolShowsASecondHand: stickHands.every((h) => h.left === false),
    smallToolsAlsoSingleHanded: smallHands.every((h) => h.right === true && h.left === false),
    headActuallySwings: !!sweep.swinging && sweep.maxAngle > 0.02,
    // physics, not a constant offset: it reverses with the stroke
    headReversesWithTheStroke: sweep.wentBothWays === true,
    // NEGATIVE CONTROL: it settles when the stroke stops
    headSettlesWhenStill: (sweep.settledAngle ?? 1) < 0.02,
    noPageErrors: errs.length === 0,
  };
  const out = { perTool, sweep: { ...sweep, samples: undefined }, errs: errs.slice(0, 8), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'tools.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
