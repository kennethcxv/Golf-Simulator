// D1/D2/D3 — CAN YOU FIND THE BOOK, DOES IT OPEN CLEANLY, AND WHAT IS IN IT.
//
// D1 asks for a prompt when you get near the ledger. There already is one
// ("Club register - [E] read"), so the question is whether it ever REACHES the
// player: the book sits inside the front desk's own E zone, and this game's
// convention is that a prompt belongs to whatever you are aiming at. So this
// walks a grid of stand points around the desk and records which prompt wins at
// each one. "Near it" is a distance; the answer has to be about distance.
//
// D2 asks for the open animation to be fixed properly. An animation is not a
// still, so the book is opened and EVERY FRAME of the opening is sampled from
// inside the render loop: the cover angle, the page spread, and the frame time.
// A glitch is either a discontinuity in those numbers or a stall in the frames
// carrying them, and this separates the two.
//
// D3 is the seven sections. Every page is turned and screenshotted.
//
// CONTROL for the prompt grid: at least one stand point must yield the DESK's
// prompt rather than the book's. If every point returned the book, the grid
// would not be measuring a contest at all.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/ledger');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1280, height: 720 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  const book = await page.evaluate(() => {
    const app = window.__fw;
    app.speedIdx = 1;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    if (app.state.shop) app.state.shop.signOpen = true;
    const c = app.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    const ch = app.scene3d.clubhouse();
    const b = ch.ledgerBook;
    if (!b) return null;
    const p = b.root.getWorldPosition(new (Object.getPrototypeOf(app.scene3d.camera.position).constructor)());
    return { x: p.x, y: p.y, z: p.z };
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(800);

  // ---- D1: which prompt wins, and from how far -----------------------------------------
  //
  // AIM AT IT IN THREE DIMENSIONS. The first two passes set yaw from the book's
  // x/z and left pitch at a browsing -0.05/-0.35, and every point returned some
  // other prop — because the book lies on a counter 2.2 yd BELOW the eye and the
  // crosshair never touched it. walkPropFocusScore3d scores cross-track distance
  // from the aim RAY, so a probe that does not pitch at the target is not asking
  // the question. Pitch is derived per stand point now.
  const promptAt = async (dx, dz) => {
    const at = await page.evaluate(({ ax, az }) => {
      const app = window.__fw;
      const s3 = app.scene3d;
      const ch = s3.clubhouse();
      const spot = ch.ledgerBook.position();
      const aimY = ch.interior.position.y + spot.y + 0.03;
      const world = { x: ch.interior.position.x + spot.x, z: ch.interior.position.z + spot.z };
      const w = s3.walk.state;
      w.x = world.x + ax; w.z = world.z + az;
      // forward is (-sin yaw, -cos yaw); aim FROM us TO the book
      w.yaw = Math.atan2(-(world.x - w.x), -(world.z - w.z));
      const flat = Math.hypot(world.x - w.x, world.z - w.z);
      const eyeY = s3.camera.position.y;
      w.pitch = Math.atan2(aimY - eyeY, Math.max(0.001, flat));
      return {
        x: w.x, z: w.z, dist: +Math.hypot(ax, az).toFixed(2),
        yaw: +w.yaw.toFixed(3), pitch: +w.pitch.toFixed(3), aimY: +aimY.toFixed(3), eyeY: +eyeY.toFixed(3),
      };
    }, { ax: dx, az: dz });
    await page.waitForTimeout(420);
    const text = await page.evaluate(() => {
      const el = document.querySelector('.shop-prompt');
      return el && el.style.display !== 'none' ? (el.textContent || '').trim() : '';
    });
    return { dx, dz, ...at, prompt: text };
  };

  const grid = [];
  // BOTH SIDES. The first pass sampled only +z and every point landed on the
  // PORCH: the answers were the door sign and the porch boards, which says
  // nothing about the book. The book sits near the entrance, so the side a
  // player actually approaches from is -z, and a grid that only looks from one
  // side is a grid that has not looked.
  for (const [dx, dz] of [
    [0, 1.2], [0, 1.8], [0, -1.2], [0, -1.8], [0, -2.4],
    [1.2, -1.2], [-1.2, -1.2], [1.2, 1.2], [-1.2, 1.2], [0.8, -2.0], [-0.8, -2.0],
  ]) {
    // face the book from wherever we stand: forward is (-sin yaw, -cos yaw)
    grid.push(await promptAt(dx, dz));
  }
  const sawBook = grid.filter((g) => /register|ledger/i.test(g.prompt));
  const sawDesk = grid.filter((g) => g.prompt && !/register|ledger/i.test(g.prompt));

  // ---- D2: the opening, frame by frame -------------------------------------------------
  // Stand where the book wins the prompt, and DWELL. The prompt callback is
  // what warms the pages, so a probe that teleports and presses E in the same
  // breath measures the un-warmed path and reports the fix as doing nothing.
  await promptAt(0, -1.3);
  await page.waitForTimeout(1500);
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const b = s3.clubhouse().ledgerBook;
    const R = { on: false, rows: [] };
    window.__ledgerRec = R;
    const orig = s3.render;
    s3.render = function ledgerRec(dt, st) {
      const out = orig.call(this, dt, st);
      if (R.on) {
        const d = b.diagnostics ? b.diagnostics() : {};
        R.rows.push({
          dt: Math.round(dt * 10) / 10,
          state: d.state ?? null,
          // `float` is the opening's own 0..1 progress and `cover` is the lid
          // angle as a fraction of PI: between them they describe the swing the
          // complaint is about.
          float: typeof d.float === 'number' ? d.float : null,
          cover: typeof d.cover === 'number' ? d.cover : null,
          spread: typeof d.spread === 'number' ? d.spread : null,
        });
      }
      return out;
    };
    R.start = () => { R.on = true; R.rows = []; };
    R.stop = () => {
      R.on = false;
      const rows = R.rows;
      const dts = rows.map((r) => r.dt);
      // a glitch is a DISCONTINUITY: the largest single-frame jump in the
      // spread, against the median jump. A smooth swing has a flat ratio.
      const spreads = rows.map((r) => r.cover).filter((v) => typeof v === 'number');
      const steps = [];
      for (let i = 1; i < spreads.length; i++) steps.push(Math.abs(spreads[i] - spreads[i - 1]));
      steps.sort((a, b) => a - b);
      const median = steps.length ? steps[Math.floor(steps.length / 2)] : 0;
      const worst = steps.length ? steps[steps.length - 1] : 0;
      return {
        frames: rows.length,
        worstFrameMs: dts.length ? Math.max(...dts) : 0,
        framesOver40ms: dts.filter((v) => v > 40).length,
        coverStart: spreads[0] ?? null,
        coverEnd: spreads[spreads.length - 1] ?? null,
        medianCoverStep: +median.toFixed(4),
        worstCoverStep: +worst.toFixed(4),
        jumpRatio: median > 0 ? +(worst / median).toFixed(1) : null,
        states: [...new Set(rows.map((r) => r.state))],
      };
    };
  });
  await page.evaluate(() => window.__ledgerRec.start());
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(2600);
  const opening = await page.evaluate(() => window.__ledgerRec.stop());
  await page.screenshot({ path: path.join(OUT, 'open-01.png') });

  // ---- D3: every page ------------------------------------------------------------------
  const pages = [];
  const isOpen = await page.evaluate(() => !!window.__fw.ledgerOpen);
  if (isOpen) {
    for (let i = 0; i < 12; i++) {
      const info = await page.evaluate(() => {
        const b = window.__fw.scene3d.clubhouse().ledgerBook;
        const d = b.diagnostics ? b.diagnostics() : {};
        return { page: d.spread ?? null, pageCount: d.spreadCount ?? null, sections: d.sections || [] };
      });
      await page.screenshot({ path: path.join(OUT, `page-${String(i).padStart(2, '0')}.png`) });
      pages.push(info);
      if (info.pageCount && info.page != null && info.page >= info.pageCount - 1) break;
      await page.keyboard.press('KeyD');
      await page.waitForTimeout(700);
    }
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(1200);
  }

  const out = {
    book, grid, opening, pages,
    promptSummary: {
      pointsTried: grid.length,
      sawBook: sawBook.length,
      sawDesk: sawDesk.length,
      nearestBookPrompt: sawBook.length ? Math.min(...sawBook.map((g) => g.dist)) : null,
      furthestBookPrompt: sawBook.length ? Math.max(...sawBook.map((g) => g.dist)) : null,
      distinctPrompts: [...new Set(grid.map((g) => g.prompt).filter(Boolean))],
    },
    checks: {
      bookFound: !!book,
      // CONTROL: the grid must be measuring a contest, not one answer
      controlSomePointGivesADifferentPrompt: sawDesk.length > 0,
      // D1: is the book reachable by prompt at a normal standing distance?
      bookPromptedSomewhere: sawBook.length > 0,
      openingSampled: opening.frames > 20,
      openingHasNoStall: opening.framesOver40ms === 0,
      pagesTurned: pages.length,
      noPageErrors: errs.length === 0,
    },
    errs: errs.slice(0, 8),
  };
  out.ok = out.checks.bookFound && out.checks.openingSampled;
  fs.writeFileSync(path.join(OUT, 'ledger.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
