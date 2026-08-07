// B1 — "Reproduce my experience, on video. Real keyboard, real mouse, real
// pointer lock. No API state forcing. The default camera at the default
// pitch. Nothing framed for a probe. Equip the broom. Walk forward. Turn.
// Sweep. Then the same with the mop. Record it. WATCH it."
//
// Run with VIDEO_DIR=qa/electron/b1 so run-electron records the session
// webm. QA_B1_TOOL selects broom|mop (one tool per recording so each clip
// is watchable on its own). The ONLY staging, declared: cleaning-kit
// ownership seeded and one teleport to the shop floor before input begins
// (the player bought the kit days ago and is standing in their own shop) —
// after that every action is the player's own input path: real lock, real
// F-hold wheel, real digits, real W/A/D, real mouse deltas, real button.
// The pitch is wherever the game leaves it. Nothing is framed.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const TOOL = process.env.QA_B1_TOOL || 'broom';
  const OUT = path.resolve(`qa/electron/b1/${TOOL}`);
  fs.mkdirSync(OUT, { recursive: true });
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
  const ownerRes = await boot.ownerResolution(page);

  // staging (declared): ownership + shop floor; input real from here
  await page.evaluate(() => {
    const app = window.__fw;
    const inv = app.state?.shop?.inventory;
    if (inv && !inv.vac1) inv.vac1 = { shelf: 0, back: 1 };
    else if (inv && !(inv.vac1.back > 0)) inv.vac1.back = 1;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4;
    // pitch NOT set: default camera at the default pitch, per the goal
  });

  // real lock + real wheel equip
  await page.mouse.click(640, 380);
  await page.waitForTimeout(600);
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
  const idx = items.findIndex((label) => new RegExp(TOOL === 'broom' ? 'broom' : 'mop', 'i').test(label));
  if (idx >= 0) {
    await page.keyboard.press(String(idx === 9 ? 0 : idx + 1));
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter').catch(() => {});
  }
  await page.waitForTimeout(700);
  await page.mouse.click(640, 380);
  await page.waitForTimeout(600);
  const equipped = await page.evaluate(() => window.__fw.scene3d.walk.getTool());

  // THE SESSION, exactly as the goal words it, slow enough to watch:
  // 1. walk forward (3 s)
  await page.keyboard.down('w');
  await page.waitForTimeout(3000);
  await page.keyboard.up('w');
  await page.waitForTimeout(700);
  // 2. turn — a slow real mouse sweep left then right (like looking around)
  for (let i = 0; i < 30; i += 1) { await page.mouse.move(600 - i * 4, 380, { steps: 2 }); await page.waitForTimeout(45); }
  for (let i = 0; i < 30; i += 1) { await page.mouse.move(480 + i * 8, 380, { steps: 2 }); await page.waitForTimeout(45); }
  await page.waitForTimeout(500);
  // 3. sweep in place (5 s, real held button)
  await page.mouse.down();
  await page.waitForTimeout(5000);
  await page.mouse.up();
  await page.waitForTimeout(800);
  // 4. sweep on the move: hold the button AND walk + turn (the exact state
  //    the owner describes: "when I move")
  await page.mouse.down();
  await page.keyboard.down('w');
  for (let i = 0; i < 26; i += 1) { await page.mouse.move(640 + Math.sin(i * 0.35) * 45, 380, { steps: 2 }); await page.waitForTimeout(90); }
  await page.keyboard.up('w');
  await page.mouse.up();
  await page.waitForTimeout(900);
  // 5. carry-walk with a turn, button released
  await page.keyboard.down('w');
  for (let i = 0; i < 20; i += 1) { await page.mouse.move(640 - Math.sin(i * 0.3) * 50, 380, { steps: 2 }); await page.waitForTimeout(80); }
  await page.keyboard.up('w');
  await page.waitForTimeout(600);

  await page.screenshot({ path: path.join(OUT, 'final-frame.png') });
  const out = {
    tool: TOOL,
    equipped,
    ownerRes: ownerRes.caption,
    sequence: ['walk 3s', 'turn L/R', 'sweep 5s in place', 'sweep on the move', 'carry-walk + turn'],
    note: 'webm recorded by run-electron VIDEO_DIR; watch it before writing a word about it',
    checks: { equipped: equipped === TOOL, noPageErrors: errs.length === 0 },
    errs: errs.slice(0, 5),
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'b1.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
