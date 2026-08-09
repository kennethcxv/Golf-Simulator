// C8 — WHAT DOES A LEDGER PAGE ACTUALLY LOOK LIKE?
//
// "Make the pages look better. Typography, ruling, ink weight, margins, paper.
// It reads as a canvas with text on it rather than a page from a book."
//
// That is a claim about a picture, so the first move is the picture — at the
// DEFAULT camera, which the RULES require, and on several spreads rather than
// one, because "typography, ruling, ink weight, margins, paper" are different
// faults and different pages will show them differently.
//
// The open is TWO presses (C1): closed -> held on the first, held -> open on the
// second. A driver that presses once waits forever for a state it cannot reach —
// that is how the turn-cost driver spent this session throwing.
//
// Page turns go through the real key, and each capture records the spread it
// caught so a reader is never guessing which page they are looking at. The page
// canvases are also dumped straight to PNG where reachable: the 3D capture shows
// what the player sees, and the flat canvas shows the typography without the
// book's curvature and lighting on top of it. Both matter for C8 and they answer
// different halves of it.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-c8-page-look.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/c8-page-look');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], shots: [], midTurn: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(5000);

  // Stand at the book by derivation, then CONFIRM the focus before pressing.
  // The interior sits at a different world offset every run, so pasted absolute
  // coordinates point at the book only by luck.
  out.stand = await page.evaluate(async () => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const walk = fw.scene3d.walk;
    const st = walk.state;
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 1.3;
    st.z = book.z + (to.z / len) * 1.3;
    const base = Math.atan2(-(book.x - st.x), -(book.z - st.z));
    const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
    for (const dp of [-0.3, -0.15, 0]) {
      for (let k = 0; k < 10; k += 1) {
        st.yaw = base + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.2);
        st.pitch = dp;
        await sleep(100);
        const label = walk.getFocusLabel ? String(walk.getFocusLabel() || '') : '';
        if (/ledger|read/i.test(label)) return { hit: true, label: label.slice(0, 80) };
      }
    }
    return { hit: false, label: String(walk.getFocusLabel?.() || '').slice(0, 80) };
  });

  const diag = () => page.evaluate(() => {
    try {
      const d = window.__fw.scene3d.clubhouse().ledgerBook.diagnostics();
      return { state: d.state, spread: d.spread ?? null, spreadCount: d.spreadCount ?? null, pageCount: d.pageCount ?? null };
    } catch (e) { return { threw: String(e && e.message) }; }
  }).catch(() => null);

  await page.keyboard.press('e');
  await page.waitForTimeout(1100);
  out.afterFirstPress = await diag();
  await page.keyboard.press('e');
  // WAIT FOR THE STATE, NOT FOR A GUESS AT HOW LONG IT TAKES.
  //
  // A fixed 1600 ms lost a whole run: the book had not reached `open` yet, the
  // capture loop broke on its first check, and the artifact came back with zero
  // shots and zero misses — the loop body never executed at all.
  //
  // That is C1's own first-open stall, measured earlier this session at 0.3-3.5 s
  // in three runs out of ten. A driver that waits less than the known worst case
  // for a known-intermittent stall is a driver that fails a third of the time for
  // a reason already written down. Ten seconds is comfortably past it, and
  // arriving early costs nothing because this returns as soon as the state flips.
  await page.waitForFunction(
    () => {
      try { return window.__fw.scene3d.clubhouse().ledgerBook.diagnostics().state === 'open'; }
      catch { return false; }
    },
    null,
    { timeout: 10000 },
  ).catch(() => {});
  await page.waitForTimeout(400);
  out.afterSecondPress = await diag();

  out.camera = await page.evaluate(() => ({
    fov: window.__fw?.scene3d?.camera?.fov ?? null,
    css: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio,
  })).catch(() => null);

  // Several spreads. Each shot records the spread it actually caught, because a
  // turn that silently refused would otherwise produce N identical pictures
  // filed under N different names.
  for (let i = 0; i < 5; i += 1) {
    const d = await diag();
    if (d?.state !== 'open') { out.shots.push({ i, skipped: d }); break; }
    const name = `c8-spread-${i}-page${d.spread}.png`;
    await page.screenshot({ path: path.join(OUT, name) });
    out.shots.push({ i, name, ...d });
    // The real key, not a direct call, so this is the player's page turn.
    await page.keyboard.press('d');
    // C4 — MID-TURN, WHICH IS THE ONLY MOMENT THE DEFECT EXISTS.
    //
    // "The page-turn animation phases through the previous page. Flipping shows
    // a slice of the last page through the turning leaf." A settled spread
    // cannot show that; the leaf has to be caught in flight. Three samples
    // across the turn, because the slice is a depth-sort artefact and which
    // angles expose it is exactly what is unknown.
    // SIX SAMPLES ACROSS THE WHOLE TURN, not three trailing off past its end.
    // The first cut waited 160/200/220 ms and caught the leaf once per turn and
    // missed eleven times out of fifteen -- the turn completes in under 360 ms,
    // so two of every three samples were shot at a settled spread. A defect that
    // exists only at some angles cannot be ruled out by a sampler that visits one
    // angle. These cluster inside the flight instead.
    for (const [k, wait] of [[0, 55], [1, 55], [2, 55], [3, 55], [4, 55], [5, 55]]) {
      await page.waitForTimeout(wait);
      const t = await page.evaluate(() => {
        try {
          const d = window.__fw.scene3d.clubhouse().ledgerBook.diagnostics();
          return { turning: d.turning ?? null, spread: d.spread ?? null };
        } catch { return null; }
      }).catch(() => null);
      if (t?.turning) {
        const nm = `c4-midturn-${i}-${k}.png`;
        await page.screenshot({ path: path.join(OUT, nm) });
        out.midTurn.push({ i, k, name: nm, ...t });
      } else {
        out.midTurn.push({ i, k, missed: t });
      }
    }
    await page.waitForTimeout(900);
  }

  // The flat canvases, straight out of the CanvasTexture — the typography with
  // no curvature, no lighting and no perspective on top of it. This is what a
  // designer needs to judge ruling, ink weight and margins; the 3D shots are
  // what the player sees. Different questions, both of them C8's.
  out.canvases = await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const found = [];
    const seen = new Set();
    s3.scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        const t = m.map;
        if (!t || !t.image || t.image.tagName !== 'CANVAS' || seen.has(t.uuid)) continue;
        // Page canvases are large and roughly page-shaped; skip signage.

        let label = o.name || '';
        let p = o.parent;
        while (!label && p) { label = p.name || ''; p = p.parent; }
        // NO NAME FILTER. The first cut required /ledger|page|book/ in the
        // owner's name and wrote zero files — the ledger's page meshes are
        // GLB-generated layers with names like `LB_LayerR0_3`, which match none
        // of those words. A filter built from what a thing is CALLED rather than
        // what it IS is how this driver reported "canvasesWritten: 0" while
        // sitting in front of three page canvases.
        //
        // The page canvases are 768x512 (PAGE_W x PAGE_H); that shape is the
        // identity, so match on it and cap the count so a scene full of signage
        // cannot flood the output.
        if (t.image.width !== 768 || t.image.height !== 512) continue;
        if (found.length >= 6) continue;
        seen.add(t.uuid);
        try {
          found.push({ label, w: t.image.width, h: t.image.height, data: t.image.toDataURL('image/png') });
        } catch (e) { found.push({ label, w: t.image.width, h: t.image.height, err: String(e && e.message) }); }
      }
    });
    return found;
  }).catch((e) => ({ threw: String(e && e.message) }));

  let written = 0;
  for (const c of (Array.isArray(out.canvases) ? out.canvases : [])) {
    if (!c.data) continue;
    const file = path.join(OUT, `c8-canvas-${written}-${c.label.replace(/[^\w]+/g, '_').slice(0, 30)}.png`);
    fs.writeFileSync(file, Buffer.from(c.data.split(',')[1], 'base64'));
    c.file = path.basename(file);
    delete c.data;
    written += 1;
  }

  out.verdict = {
    focused: out.stand?.hit ?? null,
    opened: out.afterSecondPress?.state === 'open',
    spreadCount: out.afterSecondPress?.spreadCount ?? null,
    shots: out.shots.filter((s) => s.name).map((s) => s.name),
    spreadsSeen: [...new Set(out.shots.filter((s) => s.name).map((s) => s.spread))],
    canvasesWritten: written,
    midTurnShots: out.midTurn.filter((m) => m.name).map((m) => m.name),
    midTurnMissed: out.midTurn.filter((m) => !m.name).length,
    camera: out.camera,
  };
  fs.writeFileSync(path.join(OUT, 'c8-page-look.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('C8-LOOK', JSON.stringify(out.verdict));
  return out;
}
