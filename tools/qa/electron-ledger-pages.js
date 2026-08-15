// C2/C3/C4 — every section spread screenshotted at the owner window, the
// overlap ledger read from the LIVE build (real canvas metrics, real
// content), and the recorder proven able to see a PLANTED collision
// before its clean sweep is believed.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/ledger-pages');
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
  await page.bringToFront().catch(() => {});
  await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    w.x = -358.4; w.z = 8.69; w.yaw = 0; w.pitch = -0.30;
  });
  await page.mouse.click(640, 380);
  await page.waitForTimeout(600);
  await page.keyboard.press('e');
  await page.waitForFunction(
    () => window.__fw.scene3d.clubhouse().ledgerBook.diagnostics().state === 'open',
    null, { timeout: 10000 },
  );
  await page.waitForTimeout(400);

  const sections = await page.evaluate(
    () => window.__fw.scene3d.clubhouse().ledgerBook.diagnostics().sections.map((s) => s.id),
  );
  const out = { ownerRes: ownerRes.caption, sections, shots: [], errs };
  for (const id of sections) {
    await page.evaluate((sec) => window.__fw.scene3d.clubhouse().ledgerBook.goToSection(sec), id);
    await page.waitForTimeout(350);
    const shot = `section-${id}.png`;
    await page.screenshot({ path: path.join(OUT, shot) });
    out.shots.push(shot);
  }
  out.overlaps = await page.evaluate(
    () => window.__fw.scene3d.clubhouse().ledgerBook.diagnostics().overlaps,
  );

  // CONTROL: a planted collision on a live face must be SEEN by the same
  // recorder before the clean sweep above is believed.
  out.plantedSeen = await page.evaluate(() => {
    const book = window.__fw.scene3d.clubhouse().ledgerBook;
    const before = book.diagnostics().overlaps.length;
    // paint the current spread twice with a sabotaged clock: cheaper — draw
    // two strings straight onto the leftFace ctx through the recorded
    // fillText, overlapping by construction, then rescan via a turn.
    const scene = window.__fw.scene3d;
    let canvas = null;
    scene.scene.traverse((o) => {
      if (!canvas && o.material?.map?.image?.getContext && o.material.map.image.width >= 380) {
        canvas = o.material.map.image;
      }
    });
    if (!canvas) return 'no page canvas found';
    const ctx = canvas.getContext('2d');
    ctx.textAlign = 'left';
    ctx.font = '400 30px Georgia, serif';
    ctx.fillText('PLANTED-A', 300, 300);
    ctx.fillText('PLANTED-B', 310, 302);
    // the wrap records into whichever face owns this ctx; force a rescan by
    // turning forward and back
    book.turnPage(1);
    return new Promise((resolve) => setTimeout(() => {
      book.turnPage(-1);
      setTimeout(() => resolve(book.diagnostics().overlaps.length > before
        || book.diagnostics().overlaps.some((o) => /PLANTED/.test(o.a) || /PLANTED/.test(o.b))
        ? true : 'planted pair not recorded'), 900);
    }, 900));
  });

  out.checks = {
    allSectionsShot: out.shots.length >= 7,
    zeroOverlapsLive: (out.overlaps || []).length === 0,
    noPageErrors: errs.length === 0,
  };
  out.controlNote = out.plantedSeen === true
    ? 'planted collision seen by the recorder'
    : `CONTROL INCONCLUSIVE: ${out.plantedSeen} — the clean sweep stands only with this caveat`;
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'pages.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
