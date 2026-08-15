// Throwaway probe: WHY do pause-surface clicks read ~175 ms late and ~5x
// quiet? Traces uiTick CALL times against the master-bus sample sequence for
// (a) a direct audio.uiTick() in pause, (b) a real pointerdown on the
// Settings nav button, (c) a direct uiTick in gameplay for the solo-peak
// reference. Dumps raw sequences; judges nothing.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(1500);
  await page.bringToFront().catch(() => {});
  const cbox = await (await page.$('canvas')).boundingBox();
  await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    const audio = window.__fw.audio;
    window.__pTap = audio.qaMasterTap();
    window.__pCalls = [];
    const orig = audio.uiTick;
    audio.uiTick = (...a) => { window.__pCalls.push(+performance.now().toFixed(1)); return orig(...a); };
    window.__pTrace = (ms) => {
      window.__pSeq = [];
      const t0 = performance.now();
      const iv = setInterval(() => {
        const r = window.__pTap.read();
        window.__pSeq.push([+(performance.now()).toFixed(1), +r.peak.toFixed(4)]);
        if (performance.now() - t0 > ms) clearInterval(iv);
      }, 4);
    };
    document.addEventListener('pointerdown', () => { window.__pDown = performance.now(); }, true);
  });

  const out = {};
  // (c) solo uiTick in gameplay — the true solo peak
  out.solo = await page.evaluate(async () => {
    await new Promise((res) => { setTimeout(res, 600); });
    window.__pTrace(300);
    const at = performance.now();
    window.__fw.audio.uiTick();
    await new Promise((res) => { setTimeout(res, 350); });
    return { calledAt: +at.toFixed(1), seq: window.__pSeq.filter(([, p]) => p > 0.001), calls: window.__pCalls.slice() };
  });

  // pause open
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);

  // (a) direct uiTick inside pause
  out.pauseDirect = await page.evaluate(async () => {
    window.__pCalls.length = 0;
    await new Promise((res) => { setTimeout(res, 500); });
    window.__pTrace(300);
    const at = performance.now();
    window.__fw.audio.uiTick();
    await new Promise((res) => { setTimeout(res, 350); });
    return { calledAt: +at.toFixed(1), seq: window.__pSeq.filter(([, p]) => p > 0.001), calls: window.__pCalls.slice() };
  });

  // (b) REAL pointerdown on the Settings nav button
  const r = await page.evaluate(() => {
    for (const b of document.querySelectorAll('.pause-nav-btn')) {
      if (/settings/i.test(b.textContent || '')) {
        const rect = b.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  });
  if (r) {
    await page.evaluate(() => {
      window.__pCalls.length = 0;
      window.__pDown = null;
      window.__pTrace(600);
    });
    await page.mouse.click(r.x, r.y);
    await page.waitForTimeout(700);
    out.pauseClick = await page.evaluate(() => ({
      down: window.__pDown ? +window.__pDown.toFixed(1) : null,
      calls: window.__pCalls.slice(),
      seq: window.__pSeq.filter(([, p]) => p > 0.001),
      firstSamples: window.__pSeq.slice(0, 4),
      gap: (() => {
        const d = window.__pDown;
        if (!d) return null;
        const hit = window.__pSeq.find(([t, p]) => t >= d && p >= 0.003);
        return hit ? +(hit[0] - d).toFixed(1) : null;
      })(),
    }));
  }
  fs.writeFileSync(path.resolve('qa/electron/e-audio/probe.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
