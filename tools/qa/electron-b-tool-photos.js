// B (Goal 20) — PHOTOGRAPH THE MOP AND THE BROOM AT THE DEFAULT PLAYER CAMERA.
//
// The solver is proven in simulation; the brief requires a picture. Equipping
// goes through the player's own path (the tool belt radial), never an API, so
// what is photographed is what a player would be holding.
//
// Four frames per tool, because a still cannot show physics:
//   idle       — held, standing still. The yarn must hang and be STILL.
//   strafe     — mid-slide. The yarn must be behind the head.
//   reversed   — one frame after reversing. The yarn must be caught out ahead.
//   planted    — looking down, head on the boards. The yarn must spread.
// Tip statistics are read from the solver alongside each frame so the picture
// and the number are the same instant.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-b-tool-photos.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/b-tool-photos');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // The belt is LOCATION-DEPENDENT. The first two runs of this driver equipped
  // the washer and the hose because it never left the porch, where the belt
  // offers course tools (hands / washer / hose / divot kit / bunker rake) and
  // contains no mop or broom at all. The cleaning tools live indoors. Stated as
  // a concession: this is a development driver, not a verifier, and the honest
  // route in is blocked by the porch task Verifier 3 could not complete either.
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.1;
    // a fresh save ships the mop dry, and a dry mop refuses to work
    const c = app.scene3d.clubhouse()?.cleaningState?.();
    if (c?.mop) { c.mop.charge = c.mop.capacity; c.mop.soil = 0; }
  });
  await page.waitForTimeout(900);
  await page.mouse.click(800, 450); // take the look, the player's own gesture
  await page.waitForTimeout(500);

  const out = { tools: {}, errs };

  // The tips, in the head's own frame, so the numbers describe the YARN and not
  // the player walking. Works for both rigs: the filtered one exposes tipsLocal
  // and so does the solver.
  const tipStats = () => page.evaluate(() => {
    const walk = window.__fw.scene3d.walk;
    const tool = walk.getTool?.();
    const rig = walk.strandRigFor?.(tool);
    if (!rig?.tipsLocal) return null;
    const tips = rig.tipsLocal();
    if (!tips.length) return null;
    const mean = (f) => tips.reduce((a, t) => a + f(t), 0) / tips.length;
    return {
      tool,
      count: tips.length,
      solver: rig.isVerlet ? 'verlet' : 'filter',
      meanX: +mean((t) => t.x).toFixed(5),
      meanY: +mean((t) => t.y).toFixed(5),
      meanZ: +mean((t) => t.z).toFixed(5),
      meanRadius: +mean((t) => Math.hypot(t.x, t.z)).toFixed(5),
      lowest: +Math.min(...tips.map((t) => t.y)).toFixed(5),
    };
  });

  const shoot = async (tool, label) => {
    const stats = await tipStats();
    await page.screenshot({ path: path.join(OUT, `${tool}-${label}.png`) });
    out.tools[tool] = out.tools[tool] || {};
    out.tools[tool][label] = stats;
  };

  const equip = async (name) => {
    const beltKey = await page.evaluate(
      () => window.__fw.preferences?.values?.controls?.bindings?.toolBelt || 'f',
    );
    // TAP CYCLES, HOLD OPENS (main.js beginToolKey: a 230 ms timer). The first
    // run of this driver PRESSED the key and got the washer and the hose — it
    // was cycling the belt, not choosing from it. Hold past the threshold, then
    // release: the wheel stays open and the item is clicked like a player does.
    await page.keyboard.down(beltKey);
    await page.waitForTimeout(500);
    await page.keyboard.up(beltKey);
    await page.waitForTimeout(400);
    const wheel = await page.evaluate(() => {
      const el = document.querySelector('.tool-wheel');
      const nodes = [...document.querySelectorAll('.tool-wheel-item')];
      return {
        wheelFound: !!el,
        wheelVisible: el ? getComputedStyle(el).display !== 'none' : false,
        items: nodes.map((n) => ({
          label: (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          disabled: n.classList.contains('is-disabled'),
          onScreen: !!n.offsetParent,
        })),
      };
    });
    out.wheel = out.wheel || {};
    out.wheel[name] = wheel;
    await page.screenshot({ path: path.join(OUT, `wheel-${name}.png`) });
    // Clicking the radial item does not work under Playwright — the canvas
    // intercepts the pointer — but the wheel labels each tool with its own key
    // ("Mop, M"), which is the faster gesture a player learns from the radial
    // anyway. Read the key off the item and press it.
    const keys = await page.evaluate(() => {
      const map = {};
      for (const n of document.querySelectorAll('.tool-wheel-item')) {
        const m = (n.getAttribute('aria-label') || '').match(/^(.+?),\s*([A-Za-z0-9])$/);
        if (m) map[m[1].trim().toLowerCase()] = m[2].toLowerCase();
      }
      return map;
    });
    out.wheelKeys = keys;
    const key = Object.entries(keys).find(([label]) => new RegExp(name, 'i').test(label))?.[1];
    if (key) {
      await page.keyboard.press(key);
      await page.waitForTimeout(900);
    }
    // the radial took the mouse; the player clicks back into the world
    await page.mouse.click(800, 450);
    await page.waitForTimeout(900);
    return page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null);
  };

  for (const tool of ['mop', 'broom']) {
    const got = await equip(tool);
    out.tools[tool] = { equipped: got };
    if (got !== tool) continue;

    await page.waitForTimeout(1200); // let it settle
    await shoot(tool, 'idle');

    // a second idle frame: the yarn must be IDENTICAL if nothing is moving
    await page.waitForTimeout(600);
    await shoot(tool, 'idle2');

    // slide right, and photograph WHILE moving
    await page.keyboard.down('d');
    await page.waitForTimeout(700);
    await shoot(tool, 'strafe');
    await page.keyboard.up('d');
    // reverse immediately: the yarn should be caught out on the old side
    await page.keyboard.down('a');
    await page.waitForTimeout(160);
    await shoot(tool, 'reversed');
    await page.waitForTimeout(500);
    await page.keyboard.up('a');
    await page.waitForTimeout(900);

    // look down so the head plants on the boards
    for (let i = 0; i < 18; i += 1) await page.mouse.move(800, 300 + i * 20, { steps: 1 });
    await page.waitForTimeout(1200);
    await shoot(tool, 'planted');
    // and back to level for the next tool
    for (let i = 18; i > 0; i -= 1) await page.mouse.move(800, 300 + i * 20, { steps: 1 });
    await page.waitForTimeout(600);
  }

  fs.writeFileSync(path.join(OUT, 'tool-photos.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
