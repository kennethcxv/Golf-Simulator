// GOAL 27 — THE PAGE TURN'S FRAME COST, FINALLY MEASURED ON A REAL SPREAD.
//
// A fresh world's ledger holds one spread and turnPage rightly refuses, so
// no census could ever measure the turn. This driver makes the world real
// first: the golden capture's proven sale staging (sendToCounter + aimed
// click-to-bag) puts transactions in the ledger, THEN the book opens via
// its own advance() path and turns SIX times, sampling every rAF. The
// metric is the MEDIAN worst-frame per turn — robust against the driver's
// rare giant stalls documented tonight.
//
// Baseline expectation from ledgerBook.js's own probe chain: one fixed
// ~55 ms canvas->texture sync frame per turn.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-page-turn-cost.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/page-turn-cost');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(5000);

  // ---- stage a sale so the ledger has spreads (golden-capture's recipe) ----
  await page.evaluate(async ([skuIds]) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const ch = app.scene3d.clubhouse();
    ch.setOrganicWalkins(false);
    for (const id of skuIds) {
      const inv = app.state.shop.inventory[id];
      if (inv) inv.shelf = Math.max(inv.shelf, 12);
    }
    ch.rebuildStock();
    const w = app.scene3d.walk.state;
    const off = ch.interior.position;
    w.x = REGISTER.stand.x + off.x;
    w.z = REGISTER.stand.z + off.z;
    return ch.sendToCounter(skuIds, 'card');
  }, [['balls1', 'water1', 'sportdrink2']]);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 }).catch(() => {});
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // aimed multi-point click-to-bag, verified by the packed count
  const staged = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const packedNow = () => {
      let count = 0;
      ch.interior.traverse((o) => { if (o.userData?.checkoutVisualState === 'packed-in-bag') count += 1; });
      return count;
    };
    const uids = ch.register.getTx().items.map((i) => i.uid);
    window.__ptcPack = { uids, packedNow, THREE };
    return { uids: uids.length, packed: packedNow() };
  });
  out.saleItems = staged.uids;
  for (let i = 0; i < staged.uids; i += 1) {
    const pts = await page.evaluate(async (idx) => {
      const { uids, THREE } = window.__ptcPack;
      const app = window.__fw;
      let found = null;
      app.scene3d.clubhouse().interior.traverse((o) => {
        if (!found && o.visible && o.userData?.kind === 'item' && o.userData?.uid === uids[idx]) found = o;
      });
      if (!found) return null;
      const box = new THREE.Box3().setFromObject(found);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const w = app.scene3d.walk.state;
      const cam = app.scene3d.camera.getWorldPosition(new THREE.Vector3());
      const dx = c.x - cam.x; const dy = c.y - cam.y; const dz = c.z - cam.z;
      const h = Math.hypot(dx, dz) || 0.001;
      w.yaw = Math.atan2(-dx / h, -dz / h);
      w.pitch = Math.atan2(dy, h);
      return true;
    }, i);
    if (!pts) continue;
    await page.waitForTimeout(300);
    const clicks = await page.evaluate(async (idx) => {
      const { uids, THREE } = window.__ptcPack;
      const app = window.__fw;
      let found = null;
      app.scene3d.clubhouse().interior.traverse((o) => {
        if (!found && o.visible && o.userData?.kind === 'item' && o.userData?.uid === uids[idx]) found = o;
      });
      if (!found) return [];
      const box = new THREE.Box3().setFromObject(found);
      const rect = document.querySelector('canvas').getBoundingClientRect();
      const toScreen = (v) => {
        const p = v.clone().project(app.scene3d.camera);
        return {
          x: rect.left + ((p.x + 1) / 2) * rect.width,
          y: rect.top + ((-p.y + 1) / 2) * rect.height,
          ok: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1,
        };
      };
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      return [
        toScreen(c),
        toScreen(c.clone().add(new THREE.Vector3(0, size.y * 0.3, 0))),
        toScreen(c.clone().add(new THREE.Vector3(size.x * 0.25, 0, 0))),
      ].filter((p) => p.ok);
    }, i);
    for (const p of clicks) {
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(350);
      const packed = await page.evaluate(() => window.__ptcPack.packedNow());
      if (packed > i) break;
    }
  }
  out.packed = await page.evaluate(() => window.__ptcPack.packedNow());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);

  // ---- open the book (its own advance path) and measure six turns ----------
  const turns = await page.evaluate(() => new Promise((resolve) => {
    const lb = window.__fw.scene3d.clubhouse().ledgerBook;
    if (!lb?.advance || !lb?.turnPage) { resolve({ error: 'no book api' }); return; }
    const results = [];
    let advanced = 0;
    const t0 = performance.now();
    let sampling = null;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      if (sampling) sampling.push(+(now - last).toFixed(1));
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    let dir = 1;
    const drive = () => {
      const now = performance.now();
      if (now - t0 > 40000) { resolve({ results, timedOut: true }); return; }
      // float === 1 is bookState 'open'; isOpen() goes true while the cover
      // is still swinging (measured: refusals at float 0.17 with 5 spreads)
      const settled = (lb.diagnostics?.()?.float ?? 0) === 1;
      if (!settled) {
        if (advanced < 4 && now - t0 > advanced * 700) { lb.advance(); advanced += 1; }
        requestAnimationFrame(drive);
        return;
      }
      if (results.length >= 6) { resolve({ results }); return; }
      if (!sampling) {
        sampling = [];
        last = performance.now();
        const turned = lb.turnPage(dir);
        if (turned !== true) {
          // end of spreads — reverse direction; a single-spread save reports so
          if (dir === 1) { dir = -1; sampling = null; requestAnimationFrame(drive); return; }
          const d = lb.diagnostics?.() || {};
          resolve({
            results,
            refused: true,
            gate: {
              spread: d.spread, spreadCount: d.spreadCount, pageCount: d.pageCount,
              turning: d.turning, float: d.float,
            },
          });
          return;
        }
        setTimeout(() => {
          const worst = Math.max(...sampling);
          results.push({ dir, worstMs: +worst.toFixed(1), frames: sampling.length });
          if (results.length % 2 === 0) dir = -dir;
          sampling = null;
          requestAnimationFrame(drive);
        }, 900);
        return;
      }
      requestAnimationFrame(drive);
    };
    requestAnimationFrame(drive);
  }));
  out.turns = turns;
  const worsts = (turns.results || []).map((r) => r.worstMs).sort((a, b) => a - b);
  out.medianWorstMs = worsts.length ? worsts[Math.floor(worsts.length / 2)] : null;
  out.allWorsts = worsts;

  console.log(JSON.stringify({
    packed: out.packed, turnCount: (turns.results || []).length,
    medianWorstMs: out.medianWorstMs, allWorsts: out.allWorsts,
    refused: turns.refused || false, timedOut: turns.timedOut || false,
  }, null, 2));
  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
