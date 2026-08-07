// B5 — the tuning loop's camera. Applies a candidate value-set through the
// SAME live-feel door the F9 overlay drives (walk.toolFeelSet), then
// screenshots each tool at the poses that matter: level-look carry, work
// pitch mid-sweep, and a mid-turn frame. The frames are read by a human
// (me), values adjusted, re-run — and the final set is SAVED through the
// overlay's own ship path so what was tuned is what ships.
//
//   QA_B5_SET='{"broom":{"compose.carryHover":0.44},...}'  candidate values
//   QA_B5_SAVE=1                                           save after apply
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b5-tune');
  fs.mkdirSync(OUT, { recursive: true });
  const SET = JSON.parse(process.env.QA_B5_SET || '{}');
  const SAVE = process.env.QA_B5_SAVE === '1';
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    const app = window.__fw;
    const inv = app.state?.shop?.inventory;
    if (inv && !inv.vac1) inv.vac1 = { shelf: 0, back: 1 };
    else if (inv && !(inv.vac1.back > 0)) inv.vac1.back = 1;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.02;
  });

  const equip = async (tool) => {
    await page.mouse.click(640, 380);
    await page.waitForTimeout(400);
    const bindings = await page.evaluate(
      () => window.__fw.preferences?.values?.controls?.bindings || {},
    );
    await page.keyboard.down(bindings.toolBelt || 'f');
    await page.waitForTimeout(450);
    await page.keyboard.up(bindings.toolBelt || 'f');
    await page.waitForTimeout(250);
    const items = await page.evaluate(() => {
      const el = document.querySelector('.tool-wheel');
      return el ? [...el.querySelectorAll('.tool-wheel-item')]
        .map((b) => b.querySelector('.tool-wheel-label')?.textContent || '') : [];
    });
    const at = items.findIndex((label) => new RegExp(tool, 'i').test(label));
    if (at >= 0) {
      await page.keyboard.press(String(at === 9 ? 0 : at + 1));
      await page.waitForTimeout(200);
      await page.keyboard.press('Enter').catch(() => {});
    }
    await page.waitForTimeout(500);
    await page.mouse.click(640, 380);
    await page.waitForTimeout(500);
    return page.evaluate(() => window.__fw.scene3d.walk.getTool());
  };

  // apply the candidate set through the overlay's own door
  const applied = await page.evaluate((set) => {
    const walk = window.__fw.scene3d.walk;
    const done = {};
    for (const [tool, values] of Object.entries(set)) {
      done[tool] = {};
      for (const [p, v] of Object.entries(values)) {
        done[tool][p] = walk.toolFeelSet(tool, p, v);
      }
    }
    return done;
  }, SET);

  const shoot = async (tool) => {
    const got = await equip(tool);
    if (got !== tool) return { tool, fail: `equip got ${got}` };
    // level carry
    await page.evaluate(() => { window.__fw.scene3d.walk.state.pitch = -0.02; });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, `${tool}-level.png`) });
    // work pitch, mid-sweep
    await page.evaluate(() => { window.__fw.scene3d.walk.state.pitch = -0.55; });
    await page.waitForTimeout(600);
    await page.mouse.down();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(OUT, `${tool}-work-sweep.png`) });
    await page.mouse.up();
    // mid-turn carry (real deltas while locked)
    await page.evaluate(() => { window.__fw.scene3d.walk.state.pitch = -0.15; });
    await page.keyboard.down('w');
    await page.mouse.move(880, 380, { steps: 5 });
    await page.screenshot({ path: path.join(OUT, `${tool}-turning.png`) });
    await page.keyboard.up('w');
    await page.waitForTimeout(300);
    const d = await page.evaluate(
      (id) => window.__fw.scene3d.walk.toolRigDiagnostics(id), tool,
    );
    return {
      tool,
      headAboveFloor: d?.headAboveFloor,
      headNdc: d?.headNdc,
      handNdcUpper: d?.handNdcUpper,
      workBlend: d?.workBlend,
    };
  };

  const out = { set: SET, applied, shots: {}, errs };
  out.shots.broom = await shoot('broom');
  out.shots.mop = await shoot('mop');

  if (SAVE) {
    out.saved = await page.evaluate(async () => {
      const snap = window.__fw.scene3d.walk.toolFeelSnapshot();
      const res = await window.fairwayNative?.saveToolFeel?.({ mop: snap.mop, broom: snap.broom });
      return res || null;
    });
  }
  out.ok = !out.shots.broom.fail && !out.shots.mop.fail && errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'b5.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
