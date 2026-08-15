// Throwaway probe: why did E at the till not open the register in the F1
// driver, and why was the wheel empty? Reads the toast layer, tries the
// direct API, and dumps wheel labels.
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.bringToFront().catch(() => {});
  const out = {};

  // wheel: stage, open, dump labels
  await page.evaluate(() => {
    const inv = window.__fw.state?.shop?.inventory;
    if (inv && inv.vac1 && !(inv.vac1.back >= 1)) inv.vac1.back = 1;
    window.__probeInv = JSON.stringify(Object.keys(inv || {}).slice(0, 10)) + ' vac1:' + JSON.stringify(inv?.vac1 || null);
  });
  out.inv = await page.evaluate(() => window.__probeInv);
  const cbox = await (await page.$('canvas')).boundingBox();
  await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
  await page.waitForTimeout(300);
  await page.keyboard.down('f');
  await page.waitForTimeout(650);
  await page.keyboard.up('f');
  await page.waitForTimeout(500);
  out.wheel = await page.evaluate(() => ({
    open: !!document.querySelector('.tool-wheel') && document.querySelector('.tool-wheel').style.display !== 'none',
    items: [...document.querySelectorAll('.tool-wheel [role="option"]')].map((b) => b.textContent.trim().slice(0, 30)),
  }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // till: teleport, read prompt, press E, read toasts + register state
  const st = await page.evaluate(() => window.__fw.scene3d.walk.stations()[0]);
  await page.evaluate(([s]) => {
    const w = window.__fw.scene3d.walk.state;
    w.x = s.x; w.z = s.z + 1.15;
    w.yaw = Math.atan2(-(s.x - w.x), -(s.z - w.z));
    w.pitch = -0.3;
  }, [st]);
  await page.waitForTimeout(600);
  out.prompt = await page.evaluate(() => document.querySelector('.shop-prompt')?.textContent || '');
  out.inReach = await page.evaluate(() => window.__fw.scene3d.walk.stationInReach());
  await page.keyboard.press('e');
  await page.waitForTimeout(900);
  out.afterE = await page.evaluate(() => ({
    active: !!window.__fw.scene3d.clubhouse().register?.isActive?.(),
    bodyClass: document.body.classList.contains('register-mode'),
    toasts: [...document.querySelectorAll('.toast, .toast-line, [class*="toast"]')]
      .map((t) => t.textContent.trim().slice(0, 80)).filter(Boolean).slice(0, 6),
    facilities: (() => {
      const s = window.__fw.state;
      const f = s.shop?.facilities || s.facilities || null;
      return f ? JSON.stringify(f).slice(0, 200) : 'none-found';
    })(),
  }));
  // direct API attempt
  out.directEnter = await page.evaluate(() => {
    const r = window.__fw.scene3d.clubhouse().register;
    const ok = r.enter();
    return { ok, active: r.isActive() };
  });
  await page.evaluate(() => window.__fw.scene3d.clubhouse().register.leave());
  const fs = process.getBuiltinModule('node:fs');
  fs.writeFileSync('qa/electron/f1-station/probe.json', `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
