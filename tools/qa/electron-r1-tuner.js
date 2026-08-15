// GOAL 17 / REQUIREMENT 1 — DOES THE TUNING OVERLAY ACTUALLY MOVE THE TOOL?
//
// The brief's demand is "it updates the held tool LIVE as I drag". This driver
// proves that with pixels, not with an assertion that a number changed, and it
// carries its own negative controls because a panel that reports success while
// the picture stands still is the exact failure this project has shipped six
// times.
//
// Three measurements, in ascending order of what they are allowed to prove:
//   1. NOISE  — two frames, no input at all. The live scene never holds still
//               (ambient sway, fibre idle shimmer), so this is the floor every
//               other reading has to clear.
//   2. DEAD   — a real mouse drag across the panel's placebo slider, which is
//               wired to nothing. If the tool moves for this, the panel is
//               lying and no reading from it means anything.
//   3. REAL   — the same drag on the hand-anchor-Y slider, which should lift
//               the whole tool up the frame.
//
// Plus a round trip on the typed number box: typing a value must land in the
// live feel AND move the slider, or the box is decoration.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-r1-tuner.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { createRequire } = process.getBuiltinModule('node:module');
  const require2 = createRequire(`${process.cwd().replace(/\\/g, '/')}/package.json`);
  let sharp = null;
  try { sharp = require2('sharp'); } catch { /* verdict cannot be formed without it */ }
  const OUT = path.resolve('qa/electron/r1-tuner');
  fs.mkdirSync(OUT, { recursive: true });
  const W = 1600; const H = 900;
  const PANEL_W = 360; // the tuner is 340 wide + border; exclude it from every diff
  const out = { W, H, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: W, height: H });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // Indoors, because the cleaning kit is an indoor wheel (a wheel opened at
  // spawn lists course tools only — logged fault 64).
  await page.evaluate(() => {
    const app = window.__fw;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.05;
  });
  await page.waitForTimeout(600);

  // Equip the broom through the real wheel, then CLOSE the wheel: a wheel left
  // open is modal and eats everything after it.
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
  const at = items.findIndex((label) => /broom/i.test(label));
  if (at >= 0) await page.keyboard.press(String(at === 9 ? 0 : at + 1));
  await page.waitForTimeout(700);
  out.equipped = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null);
  out.wheelItems = items;

  // F9, on a real keyboard.
  await page.keyboard.press('F9');
  await page.waitForTimeout(500);
  out.panelOpen = await page.evaluate(() => !!window.__fw.toolTuner?.isOpen?.());
  out.groups = await page.evaluate(() => [...document.querySelectorAll('.tool-tuner div')]
    .filter((d) => d.style.borderBottom).map((d) => d.textContent));
  out.paths = await page.evaluate(() => [...document.querySelectorAll('.tool-tuner input[type=range]')]
    .map((i) => i.dataset.path));

  const shot = async (name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    return file;
  };

  // Pixel difference over the GAME half of the frame only. Counting pixels that
  // moved by more than a threshold, rather than summing, so a global tone shift
  // cannot masquerade as a tool that moved.
  // INSTRUMENT FAULT CAUGHT ON THE FIRST RUN (logged as fault 73): a screenshot
  // is in PHYSICAL pixels and setViewportSize speaks CSS pixels. At this
  // machine's 1.5 DPR a 1600x900 viewport files a 2400x1350 png, so a crop
  // written in viewport units measured the top-left 52% of the frame - a patch
  // of static ceiling - and reported 0 moved pixels while the broom swung
  // through the middle of the shot. Every region below is scaled by the image's
  // own metadata, never by the viewport.
  const diff = async (a, b) => {
    if (!sharp) return null;
    const meta = await sharp(a).metadata();
    const s = meta.width / W;
    const region = {
      left: 0, top: 0, width: Math.round((W - PANEL_W) * s), height: meta.height,
    };
    const [ra, rb] = await Promise.all([
      sharp(a).extract(region).raw().toBuffer(),
      sharp(b).extract(region).raw().toBuffer(),
    ]);
    let moved = 0;
    let minX = 1e9; let maxX = -1; let minY = 1e9; let maxY = -1;
    const stride = 3;
    for (let i = 0; i < ra.length; i += stride) {
      if (Math.abs(ra[i] - rb[i]) > 14) {
        moved += 1;
        const px = (i / stride) % region.width;
        const py = Math.floor((i / stride) / region.width);
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
    }
    return { moved, box: maxX < 0 ? null : [minX, minY, maxX, maxY] };
  };

  // A real drag of a real range input: press on the thumb, move, release.
  const dragSlider = async (dataPath, toFraction) => {
    const el = await page.$(`.tool-tuner input[type=range][data-path="${dataPath}"]`);
    if (!el) return { ok: false, why: 'slider not found' };
    const box = await el.boundingBox();
    const before = await el.evaluate((n) => Number(n.value));
    const min = await el.evaluate((n) => Number(n.min));
    const max = await el.evaluate((n) => Number(n.max));
    const fracNow = (before - min) / (max - min);
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * fracNow, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * toFraction, y, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(450);
    const after = await el.evaluate((n) => Number(n.value));
    return { ok: true, before, after, min, max };
  };

  const feelY = () => page.evaluate(
    () => window.__fw.scene3d.walk.toolFeelLive?.('broom')?.compose?.gripAnchor?.[1] ?? null,
  );

  // ---- 1. NOISE: nothing touched -------------------------------------
  const n0 = await shot('01-noise-a');
  await page.waitForTimeout(700);
  const n1 = await shot('02-noise-b');
  out.noise = await diff(n0, n1);

  // ---- 2. DEAD CONTROL: the placebo slider ---------------------------
  const deadDrag = await dragSlider('dead', 0.92);
  const d1 = await shot('03-dead-after');
  out.dead = { drag: deadDrag, diff: await diff(n1, d1) };

  // ---- 3. REAL: hand anchor Y, which lifts the whole tool ------------
  out.anchorYBefore = await feelY();
  const realDrag = await dragSlider('compose.gripAnchor.1', 0.86);
  const r1 = await shot('04-real-after');
  out.anchorYAfter = await feelY();
  out.real = { drag: realDrag, diff: await diff(d1, r1) };

  // ---- 4. the typed box round trip -----------------------------------
  const typed = await page.evaluate(async () => {
    const box = document.querySelector('.tool-tuner input[type=number][data-path-number="compose.gripAnchor.1"]');
    const slider = document.querySelector('.tool-tuner input[type=range][data-path="compose.gripAnchor.1"]');
    if (!box || !slider) return { ok: false, why: 'controls missing' };
    box.value = '-0.317';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    return {
      ok: true,
      slider: Number(slider.value),
      feel: window.__fw.scene3d.walk.toolFeelLive?.('broom')?.compose?.gripAnchor?.[1] ?? null,
    };
  });
  out.typed = typed;

  // ---- 5. revert -------------------------------------------------------
  const reverted = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('.tool-tuner button')]
      .find((b) => b.textContent.trim() === 'Revert');
    if (!btn) return { ok: false, why: 'no revert button' };
    btn.click();
    await new Promise((r) => setTimeout(r, 350));
    return { ok: true, feel: window.__fw.scene3d.walk.toolFeelLive?.('broom')?.compose?.gripAnchor?.[1] ?? null };
  });
  out.revert = reverted;
  await shot('05-after-revert');

  // ---- verdict ---------------------------------------------------------
  const noiseFloor = Math.max(out.noise?.moved ?? 0, out.dead?.diff?.moved ?? 0);
  out.verdict = {
    panelOpened: out.panelOpen === true,
    broomHasFibreRows: (out.paths || []).some((p) => p && p.startsWith('strands')),
    leftElbowRows: (out.paths || []).filter((p) => p && p.includes('elbowOffsetLeft')).length,
    sliderMovedTheTool: !!(out.real?.diff && out.real.diff.moved > Math.max(400, noiseFloor * 4)),
    deadControlInert: !!(out.dead?.diff && out.noise
      && out.dead.diff.moved <= Math.max(out.noise.moved * 3, 300)),
    typedBoxRoundTrips: !!(typed.ok && Math.abs((typed.feel ?? 0) + 0.317) < 0.002
      && Math.abs(typed.slider + 0.317) < 0.002),
    revertRestored: !!(reverted.ok && out.anchorYBefore != null
      && Math.abs(reverted.feel - out.anchorYBefore) < 0.002),
    noiseFloor,
  };
  fs.writeFileSync(path.join(OUT, 'result.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('R1', JSON.stringify(out.verdict));
  console.log('noise', JSON.stringify(out.noise), 'dead', JSON.stringify(out.dead?.diff),
    'real', JSON.stringify(out.real?.diff));
  console.log('anchorY', out.anchorYBefore, '->', out.anchorYAfter, 'typed', JSON.stringify(typed),
    'revert', JSON.stringify(reverted));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 4)));
  return out;
}
