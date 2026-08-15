async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async () => {
    localStorage.clear();
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    const empire = E.newEmpire('relaxed', 424242);
    empire.cash = 10_000_000;
    const first = empire.market.find((listing) => listing.id === 'willow-creek') || empire.market[0];
    const bought = E.buyProperty(empire, first.id);
    bought.state.tutorial.complete = true;
    bought.state.tutorial.hidden = true;
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(800, 450);
  await page.waitForTimeout(200);

  const probe = await page.evaluate(async () => {
    const app = window.__fw;
    const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = app.scene3d.clubhouse();
    const o = clubhouse.interior.position;
    const w = app.scene3d.walk.state;
    const seat = L.FRONT_DESK.staffChair;
    const laptop = L.FRONT_DESK.laptop;
    w.x = seat.x + o.x;
    w.z = seat.z + o.z;
    const dx = laptop.x - seat.x;
    const dz = laptop.z - seat.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    w.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    w.pitch = Math.atan2(1.06 - 1.62, horizontal);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const names = [];
    clubhouse.interior.traverse((node) => {
      if (/laptop/i.test(node.name || '')) names.push({ name: node.name, visible: node.visible, at: node.getWorldPosition ? node.position.toArray().map((v) => +v.toFixed(2)) : null });
    });
    const promptNodes = [...document.querySelectorAll('.prompt, .hud-prompt, [class*=prompt]')]
      .map((el) => ({ cls: el.className, text: (el.textContent || '').trim().slice(0, 90), visible: el.offsetParent !== null }))
      .filter((entry) => entry.text);
    return {
      variantLaptopAt: laptop,
      seatAt: seat,
      walkAt: { x: +(w.x - o.x).toFixed(2), z: +(w.z - o.z).toFixed(2), yaw: +w.yaw.toFixed(2), pitch: +w.pitch.toFixed(2) },
      laptopNodes: names.slice(0, 10),
      prompts: promptNodes.slice(0, 8),
      laptopOpenApi: typeof app.laptopOpen,
    };
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'greybox-laptop-probe.png') });
  fs.writeFileSync(path.join(outDir, 'greybox-laptop-probe.json'), `${JSON.stringify(probe, null, 2)}\n`);
  return { ok: true, probe };
}
