async (page) => {
  // VERIFIER 2 — A3: measure game-min per real-min at 1x; digits 1/2/3/4 must
  // not change the rate; HUD chip must be pause/play only. All real input.
  const out = { ok: true, phase: 'boot', rates: [], faults: [] };
  const ROOTP = process.cwd().replace(/\\/g, '/');
  const shots = `${ROOTP}/qa/electron/verify-v2`;
  const ensureFront = async () => {
    for (let i = 0; i < 6; i += 1) {
      try {
        await page.electronApp.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return;
          if (win.isMinimized()) win.restore();
          win.setAlwaysOnTop(true);
          win.show();
          win.moveTop();
          win.focus();
          win.setAlwaysOnTop(false);
        });
      } catch (_) { /* fall through to CDP */ }
      await page.bringToFront().catch(() => {});
      await page.waitForTimeout(250);
      const focused = await page.evaluate(() => document.hasFocus()).catch(() => false);
      if (focused) return true;
    }
    return false;
  };
  try {
    const boot = await import(`file:///${ROOTP}/tools/qa/lib/qa-boot.mjs`);
    await page.bringToFront();
    out.menuPath = await boot.clickThroughMenu(page);
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive, null, { timeout: 120000 });
    out.focusedAfterBoot = await ensureFront();
    out.windowCaption = (await boot.ownerResolution(page, page.electronApp)).caption;
    await page.waitForTimeout(3000);
    out.rafHealth = await page.evaluate(() => new Promise((resolve) => {
      const ds = [];
      let last = null;
      const finish = () => {
        ds.sort((a, b) => a - b);
        resolve({ n: ds.length, median: ds.length ? +ds[Math.floor(ds.length / 2)].toFixed(1) : null });
      };
      const timer = setTimeout(finish, 3000);
      const loop = (t) => {
        if (last != null) ds.push(t - last);
        last = t;
        if (ds.length >= 40) { clearTimeout(timer); finish(); return; }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }));
    if (!out.rafHealth.n || out.rafHealth.median > 100) {
      out.abort = `window-unfocused: rAF median ${out.rafHealth.median} ms — sim clock would be throttled`;
      return out;
    }

    const clockRead = () => page.evaluate(() => {
      const c = window.__fw.state.clock;
      return {
        raw: JSON.parse(JSON.stringify(c)),
        speedIdx: (typeof window.__fw.speedIdx === 'undefined') ? null : window.__fw.speedIdx,
        focus: document.hasFocus(),
        perf: performance.now(),
      };
    });

    const totalMinutes = (raw) => {
      // Robust total: prefer explicit total fields, else day*1440+minutes.
      if (Number.isFinite(raw.totalMinutes)) return raw.totalMinutes;
      const day = Number.isFinite(raw.day) ? raw.day : 0;
      const minutes = Number.isFinite(raw.minutes) ? raw.minutes : 0;
      return day * 1440 + minutes;
    };

    const rate = async (label, seconds) => {
      const a = await clockRead();
      await page.waitForTimeout(seconds * 1000);
      const b = await clockRead();
      let gm = totalMinutes(b.raw) - totalMinutes(a.raw);
      if (gm < 0 && !Number.isFinite(a.raw.day)) gm += 1440; // midnight wrap, no day field
      const rs = (b.perf - a.perf) / 1000;
      const row = {
        label,
        gameMin: +gm.toFixed(4),
        realSec: +rs.toFixed(2),
        gameMinPerRealSec: +(gm / rs).toFixed(5),
        gameMinPerRealMin: +((gm / rs) * 60).toFixed(4),
        speedIdxBefore: a.speedIdx,
        speedIdxAfter: b.speedIdx,
        focusA: a.focus,
        focusB: b.focus,
        clockAfter: b.raw,
      };
      out.rates.push(row);
      return row;
    };

    out.phase = 'baseline';
    out.clockShape = (await clockRead()).raw;
    const base = await rate('baseline-60s', 60);
    if (base.gameMin === 0) {
      out.faults.push('clock did not advance in baseline — trying Space to unpause, re-measuring');
      await page.keyboard.press('Space');
      await page.waitForTimeout(400);
      await rate('baseline-retry-30s', 30);
    }

    out.phase = 'digits';
    await page.keyboard.press('Digit2');
    await page.waitForTimeout(400);
    await rate('after-digit2-20s', 20);
    await page.keyboard.press('Digit3');
    await page.waitForTimeout(400);
    await rate('after-digit3-20s', 20);
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(400);
    await rate('after-digit1-20s', 20);
    await page.keyboard.press('Digit4');
    await page.waitForTimeout(400);
    await rate('after-digit4-15s', 15);
    await page.screenshot({ path: `${shots}/clock-01-after-digits.png` });

    // ---- HUD chip: find the clock chip, click it for pause, click again.
    out.phase = 'chip';
    const chip = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('button,[class*="chip"],[class*="clock"]')]
        .filter((el) => el.offsetParent !== null);
      const cand = nodes.find((el) => /\d{1,2}:\d{2}/.test(el.textContent || ''))
        || nodes.find((el) => /clock|time/i.test(String(el.className)));
      if (!cand) return null;
      const r = cand.getBoundingClientRect();
      return {
        cls: String(cand.className).slice(0, 100),
        text: (cand.textContent || '').trim().slice(0, 80),
        cx: Math.round(r.x + r.width / 2),
        cy: Math.round(r.y + r.height / 2),
        tag: cand.tagName,
      };
    });
    out.chip = chip;
    if (chip) {
      await page.mouse.click(chip.cx, chip.cy);
      await page.waitForTimeout(500);
      out.chipTextAfterClick = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('button,[class*="chip"],[class*="clock"]')].filter((el) => el.offsetParent !== null);
        const cand = nodes.find((el) => /\d{1,2}:\d{2}/.test(el.textContent || '')) || nodes.find((el) => /clock|time/i.test(String(el.className)));
        return cand ? (cand.textContent || '').trim().slice(0, 80) : null;
      });
      await page.screenshot({ path: `${shots}/clock-02-chip-clicked.png` });
      await rate('chip-clicked-12s', 12);
      await page.mouse.click(chip.cx, chip.cy);
      await page.waitForTimeout(500);
      await rate('chip-clicked-again-12s', 12);
    } else {
      out.faults.push('no HUD clock chip found — dumping visible buttons');
      out.visibleButtons = await page.evaluate(() => [...document.querySelectorAll('button')]
        .filter((b) => b.offsetParent !== null)
        .map((b) => ({ cls: String(b.className).slice(0, 80), text: (b.textContent || '').trim().slice(0, 60) })));
    }

    // ---- Space pause: the probe's positive control.
    out.phase = 'space';
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    await rate('space-paused-10s', 10);
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    await rate('space-resumed-10s', 10);

    // ---- Any speed UI anywhere on screen?
    out.phase = 'speed-ui-scan';
    out.speedUiScan = await page.evaluate(() => [...document.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && el.offsetParent !== null
        && /([234]\s*x\b|\bx\s*[234]\b|speed|fast)/i.test(el.textContent || '')
        && (el.textContent || '').length < 60)
      .slice(0, 12)
      .map((el) => ({ cls: String(el.className).slice(0, 60), text: (el.textContent || '').trim().slice(0, 60) })));

    // Clock raw dump at end — any rung/speed field?
    out.clockAtEnd = (await clockRead()).raw;
    out.phase = 'done';
  } catch (error) {
    out.error = `${out.phase}: ${String((error && error.message) || error)}`;
    try { await page.screenshot({ path: `${shots}/clock-fail-${out.phase}.png` }); } catch (_) { /* best effort */ }
  }
  return out;
}
