// P1 (Goal 25 round 2) — TWO QUESTIONS ABOUT THE OUTLINE, ONE RUN.
//
// (a) Does the in-hand fix hold? The book must go dark the moment it leaves the
//     desk, through `raising` and `held`, on the REAL key press.
// (b) What is the outline actually picking out, and how does it LOOK? The owner:
//     "Sixteen shells outlining boards, spine and page block is not subtle. I
//     want a quiet rim on the book's silhouette." That is a judgement by eye, so
//     this photographs it at the default player camera and names the 16 parts.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p1-outline-look.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p1-outline-look');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  const canvas = await page.$('#game') || await page.$('canvas');
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);

  const aimAtBook = (yards) => page.evaluate((dist) => {
    const ch = window.__fw.scene3d.clubhouse();
    const r = ch?.ledgerBook?.root;
    if (!r) return { ok: false };
    r.updateWorldMatrix(true, false);
    const e = r.matrixWorld.elements;
    const w = window.__fw.scene3d.walk.state;
    const c = ch.interior.position;
    let dx = c.x - e[12]; let dz = c.z - e[14];
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    w.x = e[12] + dx * dist; w.z = e[14] + dz * dist; w.vx = 0; w.vz = 0;
    const lx = e[12] - w.x; const lz = e[14] - w.z;
    const h = Math.hypot(lx, lz) || 0.001;
    w.yaw = Math.atan2(-lx / h, -lz / h);
    const eye = window.__fw.scene3d?.camera?.position?.y;
    w.pitch = Math.atan2(e[13] - (Number.isFinite(eye) ? eye : 1.62), h);
    return { ok: true };
  }, yards);

  const read = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const o = ch.debugLedgerOutline?.() ?? null;
    const d = ch.ledgerBook?.diagnostics?.() ?? null;
    return {
      bookState: d?.state ?? null,
      carried: d?.carried ?? null,
      active: o?.active ?? null,
      shellCount: o?.shellCount ?? null,
      shellOwners: o?.shellOwners ?? null,
      shellOwnerSpans: o?.shellOwnerSpans ?? null,
      candidates: o?.candidates ?? null,
      box: o?.box ?? null,
      distinctMaterials: o?.distinctMaterials ?? null,
      materialsCreatedSinceBoot: o?.materialsCreatedSinceBoot ?? null,
    };
  });

  // ---- (b) LOOK AT IT: close, aimed, on the desk ---------------------------
  await aimAtBook(1.05);
  await page.waitForTimeout(1400);
  out.aimedOnDesk = await read();
  await page.screenshot({ path: path.join(OUT, 'outline-aimed-close.png') });

  await aimAtBook(1.9);
  await page.waitForTimeout(1200);
  out.aimedFar = await read();
  await page.screenshot({ path: path.join(OUT, 'outline-aimed-far.png') });

  // ---- (a) THE FIX: raise it and it must go dark ---------------------------
  await aimAtBook(1.05);
  await page.waitForTimeout(1000);
  await page.keyboard.press('k');
  const inHand = [];
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(120);
    inHand.push(await read());
  }
  out.inHandSamples = inHand;
  await page.screenshot({ path: path.join(OUT, 'outline-in-hand.png') });

  const litInHand = inHand.filter((s) => s.bookState !== 'closed' && s.active === true);
  const statesSeen = [...new Set(inHand.map((s) => s.bookState))];

  // A control: if the raise never happened, "nothing was lit in hand" is a green
  // about a book that never left the desk.
  const raiseHappened = statesSeen.some((s) => s && s !== 'closed');

  out.summary = {
    shellCount: out.aimedOnDesk.shellCount,
    shellOwners: out.aimedOnDesk.shellOwners,
    box: out.aimedOnDesk.box,
    distinctMaterials: out.aimedOnDesk.distinctMaterials,
    litOnDeskWhenAimed: out.aimedOnDesk.active === true,
    statesSeenAfterK: statesSeen,
    raiseActuallyHappened: raiseHappened,
    litSamplesInHand: litInHand.length,
    IN_HAND_FIXED: raiseHappened && litInHand.length === 0,
  };
  out.ok = out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'look.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P1-OUTLINE-LOOK', JSON.stringify(out.summary, null, 2));
  return out;
}
