// B4 — DOES THE HEAD PLANT ON THE FLOOR WHETHER OR NOT THE HANDLE CAN REACH?
//
// The brief's own words: "the rig plants the tool head on the floor regardless
// of whether the handle can physically reach... the plant number read
// 0.073-0.084 for every candidate in your sweep including one two yards below
// the eye... a head pinned to the floor while the hands sit where the handle
// cannot span means the shaft is drawn between two points that do not belong to
// the same object."
//
// That last sentence names the measurement, and nobody has taken it: **the
// distance from the grip to the head, against the length the handle actually
// is.** If the head is being pinned to the boards while the hands move, that
// distance MUST change - the shaft is being stretched or compressed to span a
// gap it does not have the length for. A plant number alone can never show
// this, which is exactly why six rounds of plant numbers all looked fine.
//
// The sweep moves the hand anchor through its whole range using the SAME live
// door the tuning overlay writes with, and reads back three things per step:
//   * how high the head sits above the boards      (the number that was reported)
//   * the drawn grip-to-head span                   (the number nobody took)
//   * that span against the span at the rest pose   (the tell)
//
// The rig already has a reach cap, but it is gated on `pitch > 0` - it only
// engages while looking UP. Everything below the horizon, which is the entire
// working range, has never been capped at all.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b4-plant');
  fs.mkdirSync(OUT, { recursive: true });
  const TOOL = process.env.B4_TOOL || 'broom';
  const out = { tool: TOOL, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(7000);
  await page.bringToFront().catch(() => {});

  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.35;
  });
  await page.waitForTimeout(600);

  await page.mouse.click(640, 380);
  await page.waitForTimeout(400);
  const bindings = await page.evaluate(
    () => window.__fw.preferences?.values?.controls?.bindings || {},
  );
  await page.keyboard.down(bindings.toolBelt || 'f');
  await page.waitForTimeout(450);
  await page.keyboard.up(bindings.toolBelt || 'f');
  await page.waitForTimeout(300);
  const items = await page.evaluate(() => {
    const el = document.querySelector('.tool-wheel');
    return el ? [...el.querySelectorAll('.tool-wheel-item')]
      .map((b) => b.querySelector('.tool-wheel-label')?.textContent || '') : [];
  });
  const want = TOOL === 'mop' ? /\bmop\b/i : /broom/i;
  const at = items.findIndex((label) => want.test(label));
  if (at >= 0) await page.keyboard.press(String(at === 9 ? 0 : at + 1));
  await page.waitForTimeout(900);
  out.equipped = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null);

  // The AUTHORED span: grip socket to contact socket, in the GLB's own rest
  // pose. This is how long the handle is, and no pose can change it.
  out.authored = await page.evaluate((tool) => {
    const s3 = window.__fw.scene3d;
    const group = s3.scene.getObjectByName(`Tool_${tool}`);
    if (!group) return null;
    const grip = group.getObjectByName('SOCKET_GripPrimary') || group.getObjectByName('SOCKET_Grip');
    const contact = group.getObjectByName('SOCKET_FloorContact')
      || group.getObjectByName('SOCKET_DirtIntake') || group.getObjectByName('SOCKET_PanIntake');
    if (!grip || !contact) return null;
    // local-space separation, which the pose cannot touch
    const V = Object.getPrototypeOf(grip.position).constructor;
    const a = grip.getWorldPosition(new V());
    const b = contact.getWorldPosition(new V());
    return { names: [grip.name, contact.name], drawnNow: +a.distanceTo(b).toFixed(4) };
  }, TOOL);

  const readStep = () => page.evaluate((tool) => {
    const s3 = window.__fw.scene3d;
    const w = s3.walk;
    const group = s3.scene.getObjectByName(`Tool_${tool}`);
    const grip = group?.getObjectByName('SOCKET_GripPrimary') || group?.getObjectByName('SOCKET_Grip');
    const contact = group?.getObjectByName('SOCKET_FloorContact')
      || group?.getObjectByName('SOCKET_DirtIntake') || group?.getObjectByName('SOCKET_PanIntake');
    const d = w.toolRigDiagnostics?.(tool) || null;
    if (!grip || !contact) return null;
    const V = Object.getPrototypeOf(grip.position).constructor;
    const g = grip.getWorldPosition(new V());
    const c = contact.getWorldPosition(new V());
    return {
      headAboveFloor: d?.headAboveFloor ?? null,
      seatError: d?.seatError ?? null,
      gripToHead: +g.distanceTo(c).toFixed(4),
      gripWorldY: +g.y.toFixed(4),
      headWorldY: +c.y.toFixed(4),
    };
  }, TOOL);

  // THE TOOL MUST ACTUALLY BE IN HAND BEFORE ANY OF THIS MEANS ANYTHING.
  // The first run of this driver showed four consecutive anchor values
  // producing a bit-identical pose with seatError exactly 0 and
  // headAboveFloor null - which is equally the signature of a rig that is not
  // running yet. Waiting for the rig to report itself active, and saying so,
  // is what tells a dead zone from an unequipped tool.
  out.rigReady = await page.waitForFunction((tool) => {
    const d = window.__fw.scene3d.walk.toolRigDiagnostics?.(tool);
    return !!(d && d.headAboveFloor != null);
  }, TOOL, { timeout: 20000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(600);

  // Rest reading first, before anything is moved.
  out.rest = await readStep();

  // THE SWEEP. Hand anchor Y from high to very low, through the live feel door.
  const steps = [];
  for (const y of [-0.10, -0.30, -0.44, -0.60, -0.85, -1.10, -1.20]) {
    await page.evaluate((args) => {
      window.__fw.scene3d.walk.toolFeelSet?.(args.tool, 'compose.gripAnchor.1', args.y);
    }, { tool: TOOL, y });
    await page.waitForTimeout(420);
    const r = await readStep();
    steps.push({ anchorY: y, ...r });
  }
  out.steps = steps;

  const spans = steps.map((s) => s.gripToHead).filter((v) => v != null);
  const heads = steps.map((s) => s.headAboveFloor).filter((v) => v != null);
  const spread = (a) => (a.length ? +(Math.max(...a) - Math.min(...a)).toFixed(4) : null);
  out.verdict = {
    // If the handle is a rigid object, this is ~0 however the hands move.
    gripToHeadSpread: spread(spans),
    gripToHeadMin: spans.length ? Math.min(...spans) : null,
    gripToHeadMax: spans.length ? Math.max(...spans) : null,
    // The brief's observation: the plant number barely moves across the sweep.
    headAboveFloorSpread: spread(heads),
    headAboveFloorValues: heads,
    // The defect, stated as a test: the shaft is being stretched to reach.
    shaftIsRigid: spread(spans) != null && spread(spans) < 0.02,
  };
  await page.screenshot({ path: path.join(OUT, `b4-${TOOL}-last.png`) });
  fs.writeFileSync(path.join(OUT, `b4-${TOOL}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`B4[${TOOL}] equipped`, out.equipped, 'rigReady', out.rigReady);
  console.log(`B4[${TOOL}] authored`, JSON.stringify(out.authored));
  console.log(`B4[${TOOL}] verdict`, JSON.stringify(out.verdict));
  console.log(`B4[${TOOL}] steps`, JSON.stringify(steps));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
