// PLAYTEST_BUILD.md — WHAT A STRANGER MEETS, IN THE ORDER THEY MEET IT.
//
// The brief asks what someone can and cannot do in twenty minutes and every
// defect they would hit, ranked by how early. Ranking by how early means the
// path has to be WALKED, in order, on a profile that has never been played —
// not assembled from things noticed at other times.
//
// So this boots cold, then does what the game tells the player to do, in the
// order it tells them, and records at each beat: what the screen says, what the
// prompt offers, what the objective panel wants, and how long the beat took. It
// teleports only where the game itself would not (to reach the shop floor
// quickly); everything else is keys and clicks.
//
// It reads rather than judges. Every "cannot" in the report has a line here.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/first-twenty');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  const consoleErrs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)); });

  const beats = [];
  const t0 = Date.now();
  const beat = async (name, note) => {
    const shot = `${String(beats.length).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: path.join(OUT, shot) });
    const seen = await page.evaluate(() => {
      const txt = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return null;
        return (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 220);
      };
      const app = window.__fw;
      return {
        screen: app?.screen ?? null,
        prompt: txt('.shop-prompt'),
        lockHint: txt('.shop-lockhint'),
        reticle: txt('.dirt-reticle'),
        dirtSense: txt('.dirt-sense-hint'),
        objective: txt('.objectives-panel') || txt('.objective-panel') || txt('.toast-objective'),
        toasts: [...document.querySelectorAll('.toast')].map((n) => n.textContent.trim().replace(/\s+/g, ' ').slice(0, 160)),
        cond: txt('.shop-cond'),
        tool: app?.scene3d?.walk?.getTool?.() ?? null,
        money: txt('.hud-money') || txt('.money'),
        clock: txt('.hud-clock') || txt('.clock'),
      };
    });
    beats.push({ n: beats.length, name, note, atMs: Date.now() - t0, shot, ...seen });
  };

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: path.join(OUT, 'menu.png') });
  const bootStart = Date.now();
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  const walkReadyMs = Date.now() - bootStart;
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  const veilGoneMs = Date.now() - bootStart;
  await page.waitForTimeout(2500);
  await beat('spawn', 'the first frame the player is given');

  await page.mouse.click(640, 360); // "Click to look"
  await page.waitForTimeout(700);
  await beat('pointer-locked', 'after the click-to-look the hint asks for');

  // walk forward the way the hint says, for a few seconds
  await page.keyboard.down('w');
  await page.waitForTimeout(4000);
  await page.keyboard.up('w');
  await beat('walked-forward', 'four seconds of W from the spawn');

  // find the clubhouse and go in — the game's own objective is the shop
  const inside = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const o = ch.interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.5; w.pitch = -0.12;
    return { x: w.x, z: w.z };
  });
  await page.waitForTimeout(2500);
  await beat('inside-the-shop', 'standing on the shop floor');

  // the tool belt: tap F through what the player is given
  const tools = [];
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(900);
    const t = await page.evaluate(() => {
      const app = window.__fw;
      const el = document.querySelector('.shop-prompt');
      return {
        tool: app?.scene3d?.walk?.getTool?.() ?? null,
        prompt: el && getComputedStyle(el).display !== 'none' ? (el.textContent || '').trim().replace(/\s+/g, ' ') : null,
      };
    });
    if (tools.some((x) => x.tool === t.tool) && tools.length > 1) break;
    tools.push(t);
  }
  await beat('tool-belt', `tapped F ${tools.length} times`);

  // use whatever is in hand on the floor
  await page.mouse.down();
  await page.waitForTimeout(2500);
  await page.mouse.up();
  await beat('used-a-tool', 'held the use button for two and a half seconds');

  // the reveal the HUD advertises
  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(1600);
  await beat('dirt-reveal', 'holding the advertised reveal key');
  await page.keyboard.up('KeyQ');

  const out = {
    boot: { walkReadyMs, veilGoneMs },
    beats,
    tools,
    inside,
    pageErrors: errs.slice(0, 10),
    consoleErrors: [...new Set(consoleErrs)].slice(0, 14),
    checks: {
      reachedTheGame: beats[0]?.screen === 'game',
      everyBeatCaptured: beats.length >= 7,
      // a stranger who cannot see a prompt cannot do anything
      somePromptWasOffered: beats.some((b) => b.prompt),
      toolsFound: tools.length,
    },
  };
  out.ok = out.checks.reachedTheGame && out.checks.everyBeatCaptured;
  fs.writeFileSync(path.join(OUT, 'first-twenty.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
