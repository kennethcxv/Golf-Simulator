// P1 (Goal 25 round 2) — "THE OUTLINE STAYS LIT WHEN I PICK THE BOOK UP."
//
// The owner named the trap before I could fall into it again: last round I
// tested this with setCarried(true), it did not reproduce, and I reported that
// it did not reproduce. `carried` is the X/Z CARRY flag -- the state you reach
// by picking the book up and walking it somewhere else. The reading gesture
// never sets it. Goal 24's movement lock failed the same way: gated on
// ledgerCarried(), checked by calling setCarried(true), and both were honest
// about a state a player does not enter.
//
// So this driver presses the REAL KEY. K raises the book (keyBindings.js:57,
// id 'ledger'), E opens it. The book's own state machine is
//   closed -> raising -> held -> opening -> open
// and everything between `closed` and `open` is a state neither isOpen() nor
// carried covers. This samples the outline in EVERY one of them, by name.
//
// The sample that matters is `held`: raised, in hand, still shut. That is the
// owner's "stays yellow until I click open book".
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p1-outline-carry-states.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p1-outline-states');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], samples: [] };
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

  // Stand in front of the book and AIM AT IT. Pitch is solved from the live
  // camera height, not a literal 1.62 -- mixing the prop's world Y with a local
  // eye height aimed 46 degrees into the floor last round and produced a green
  // that flipped between runs with no code change.
  const placed = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const r = ch?.ledgerBook?.root;
    if (!r) return { ok: false, why: 'no ledger root' };
    r.updateWorldMatrix(true, false);
    const e = r.matrixWorld.elements;
    const w = window.__fw.scene3d.walk.state;
    const c = ch.interior.position;
    let dx = c.x - e[12]; let dz = c.z - e[14];
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    w.x = e[12] + dx * 1.05; w.z = e[14] + dz * 1.05; w.vx = 0; w.vz = 0;
    const lx = e[12] - w.x; const lz = e[14] - w.z;
    const h = Math.hypot(lx, lz) || 0.001;
    w.yaw = Math.atan2(-lx / h, -lz / h);
    const eye = window.__fw.scene3d?.camera?.position?.y;
    w.pitch = Math.atan2(e[13] - (Number.isFinite(eye) ? eye : 1.62), h);
    return { ok: true };
  });
  out.placed = placed;
  await page.waitForTimeout(1400);

  const sample = async (label) => {
    const s = await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      const o = ch.debugLedgerOutline?.() ?? null;
      const d = ch.ledgerBook?.diagnostics?.() ?? null;
      return {
        bookState: d?.state ?? null,
        open: d?.open ?? null,
        carried: d?.carried ?? null,
        outlineActive: o?.active ?? null,
        shellCount: o?.shellCount ?? null,
        ledgerOpenFlag: window.__fw?.app?.ledgerOpen ?? null,
      };
    });
    const row = { label, ...s };
    out.samples.push(row);
    console.log('P1-OUTLINE', JSON.stringify(row));
    return row;
  };

  out.onDeskAimed = await sample('on-desk-aimed');

  // ---- THE REAL KEY -------------------------------------------------------
  await page.keyboard.press('k');
  // Sample densely through the raise: `raising` is short and `held` is where it
  // rests, and a single sample 2 s later would miss the transient entirely.
  for (let i = 0; i < 14; i += 1) {
    await page.waitForTimeout(110);
    await sample(`after-K-${i}`);
  }

  await page.keyboard.press('e');
  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(140);
    await sample(`after-E-${i}`);
  }

  // ---- THE VERDICT, per state ---------------------------------------------
  // Grouped by the book's OWN state name so the answer is "which state keeps it
  // lit", not "did some sample somewhere show a 1".
  const byState = {};
  for (const s of out.samples) {
    const k = s.bookState || 'unknown';
    byState[k] ||= { samples: 0, litSamples: 0, maxShells: 0 };
    byState[k].samples += 1;
    if (s.outlineActive) byState[k].litSamples += 1;
    byState[k].maxShells = Math.max(byState[k].maxShells, s.shellCount || 0);
  }
  out.byState = byState;

  const litInHand = Object.entries(byState)
    .filter(([state, v]) => state !== 'closed' && v.litSamples > 0)
    .map(([state, v]) => `${state} (${v.litSamples}/${v.samples} lit, ${v.maxShells} shells)`);

  out.summary = {
    outlineLitWhileOnDeskAndAimed: out.onDeskAimed.outlineActive === true,
    statesThatKeepItLitInHand: litInHand,
    REPRODUCED: litInHand.length > 0,
  };
  out.ok = out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'states.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P1-OUTLINE-STATES', JSON.stringify(out.summary, null, 2));
  return out;
}
