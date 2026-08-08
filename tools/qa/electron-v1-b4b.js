// ADVERSARIAL VERIFIER 1 (throwaway) — B4 broom at CLEAN open-floor staging
// (run 2's b4broom legs were read face-into-a-wall after the debris sweep),
// plus the welded-bristles visibility audit (census saw a visible
// MESH_BroomBristles node; B3 claims the welded slab is hidden) and the
// flat-mode tone-mapped control run 2 skipped.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify-v1');
  fs.mkdirSync(OUT, { recursive: true });
  const { createRequire } = process.getBuiltinModule('node:module');
  const nodeRequire = createRequire(`${process.cwd()}/`);
  const sharp = nodeRequire('sharp');
  const out = { sections: {}, errs: [] };
  const flush = () => fs.writeFileSync(path.join(OUT, 'b4b.json'), `${JSON.stringify(out, null, 2)}\n`);
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  out.menu = await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2200);
  out.ownerRes = (await boot.ownerResolution(page)).caption;
  await page.bringToFront().catch(() => {});
  const cbox = await (await page.$('canvas')).boundingBox();
  const cx = Math.round(cbox.x + cbox.width / 2);
  const cy = Math.round(cbox.y + cbox.height / 2);
  let mx = cx; let my = cy;
  const pauseGuard = async () => {
    for (let i = 0; i < 4; i += 1) {
      const open = await page.evaluate(() => document.body.classList.contains('pause-open'));
      if (!open) return;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
  };
  const lock = async () => {
    await pauseGuard();
    await page.mouse.click(cx, cy);
    mx = cx; my = cy;
    await page.waitForTimeout(380);
  };
  const mmove = async (dx, dy, steps = 3) => { mx += dx; my += dy; await page.mouse.move(mx, my, { steps }); };
  const readPitch = () => page.evaluate(() => window.__fw.scene3d.walk.state.pitch);
  const pitchTo = async (target) => {
    let k = -0.00115; let stall = 0;
    for (let i = 0; i < 26; i += 1) {
      const p = await readPitch();
      const err = target - p;
      if (Math.abs(err) < 0.045) return { reached: true, pitch: +p.toFixed(3), staged: false, iters: i };
      let dy = Math.max(-280, Math.min(280, err / k));
      const room = dy > 0 ? (cbox.y + cbox.height - 12) - my : (cbox.y + 12) - my;
      if ((dy > 0 && room < 24) || (dy < 0 && room > -24)) stall += 1;
      else {
        if (dy > 0) dy = Math.min(dy, room); else dy = Math.max(dy, room);
        await mmove(0, dy, 3);
        await page.waitForTimeout(90);
        const p2 = await readPitch();
        const moved = p2 - p;
        if (Math.abs(moved) < 0.004) stall += 1;
        else { stall = 0; const kk = moved / dy; if (Number.isFinite(kk) && Math.abs(kk) > 1e-5) k = kk; }
      }
      if (stall >= 3) {
        await page.evaluate((t) => { window.__fw.scene3d.walk.state.pitch = t; }, target);
        await page.waitForTimeout(150);
        return { reached: true, pitch: target, staged: true, iters: i };
      }
    }
    const p = await readPitch();
    return { reached: Math.abs(p - target) < 0.1, pitch: +p.toFixed(3), staged: false, iters: 26 };
  };
  const sec = async (name, fn) => {
    try { out.sections[name] = await fn(); } catch (e) { out.sections[name] = { crashed: String(e && e.message ? e.message : e) }; }
    flush();
  };

  await sec('stage', async () => page.evaluate(() => {
    const app = window.__fw;
    const inv = app.state?.shop?.inventory;
    if (inv && !inv.vac1) inv.vac1 = { shelf: 0, back: 1 };
    else if (inv && !(inv.vac1.back > 0)) inv.vac1.back = 1;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.10;
    return { ok: true };
  }));
  await page.waitForTimeout(500);

  await sec('equipBroom', async () => {
    await lock();
    let wheel = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.keyboard.down('f');
      await page.waitForTimeout(attempt === 0 ? 620 : 820);
      await page.keyboard.up('f');
      await page.waitForTimeout(430);
      wheel = await page.evaluate(() => {
        const el = document.querySelector('.tool-wheel');
        if (!el) return null;
        const opts = [...el.querySelectorAll('[role="option"]')];
        const nodes = opts.length ? opts : [...el.querySelectorAll('.tool-wheel-item')];
        return {
          open: document.body.classList.contains('tool-wheel-open'),
          items: nodes.map((b) => (b.querySelector('.tool-wheel-label')?.textContent || b.textContent || '').trim().slice(0, 26)),
        };
      });
      if (wheel?.open) break;
    }
    const idx = wheel?.open ? wheel.items.findIndex((t) => /broom/i.test(t)) : -1;
    if (idx >= 0) {
      await page.keyboard.press(String(idx === 9 ? 0 : idx + 1));
      await page.waitForTimeout(280);
      await page.keyboard.press('Enter').catch(() => {});
    }
    await page.waitForTimeout(700);
    for (let i = 0; i < 3; i += 1) {
      const open = await page.evaluate(() => document.body.classList.contains('tool-wheel-open'));
      if (!open) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    await lock();
    const got = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() ?? null);
    return { open: wheel?.open, idx, got };
  });

  // welded-bristles audit: every node named like BroomBristles, its visibility
  await sec('bristleAudit', async () => page.evaluate(async () => {
    const s3 = window.__fw.scene3d;
    const g = s3.scene.getObjectByName('Tool_broom');
    if (!g) return { found: false };
    const rows = [];
    let strandCount = 0;
    g.traverse((o) => {
      const n = o.name || '';
      if (/BroomBristle/i.test(n) && o.isMesh) {
        // effective visibility = own flag AND every ancestor's flag
        let eff = o.visible; let p = o.parent;
        while (eff && p) { eff = p.visible !== false; p = p.parent; }
        rows.push({ name: n, visible: o.visible, effectiveVisible: eff });
      }
      if (o.isMesh && /^MopStrand_/.test(n) && o.visible) strandCount += 1;
    });
    return { bristleNodes: rows, visibleStrandMeshes: strandCount };
  }));

  // flat paint: welded bristles BLUE, tuft strands GREEN — who is drawn?
  await sec('weldedVsTufts', async () => {
    const aim = await pitchTo(-0.72);
    const painted = await page.evaluate(async () => {
      const s3 = window.__fw.scene3d;
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const g = s3.scene.getObjectByName('Tool_broom');
      if (!g) return 'no group';
      const saved = new Map();
      window.__wvtSaved = saved;
      const r = s3.renderer;
      window.__wvtTone = { tm: r.toneMapping, exp: r.toneMappingExposure };
      r.toneMapping = THREE.NoToneMapping;
      r.toneMappingExposure = 1;
      s3.setPostEnabled?.(false);
      let welded = 0; let tufts = 0;
      g.traverse((o) => {
        if (!o.isMesh) return;
        const n = o.name || '';
        if (/MESH_BroomBristles/i.test(n)) {
          saved.set(o, { mat: o.material, vis: o.visible });
          o.material = new THREE.MeshBasicMaterial({ color: 0x0000ff, fog: false });
          welded += 1;
        } else if (/^MopStrand_/.test(n) && o.visible) {
          saved.set(o, { mat: o.material, vis: o.visible });
          o.material = new THREE.MeshBasicMaterial({ color: 0x00ff00, fog: false });
          tufts += 1;
        }
      });
      return { welded, tufts };
    });
    await page.waitForTimeout(180);
    const shot = path.join(OUT, 'welded-vs-tufts.png');
    await page.screenshot({ path: shot });
    await page.evaluate(() => {
      const s3 = window.__fw.scene3d;
      for (const [mesh, s] of window.__wvtSaved) { mesh.material.dispose?.(); mesh.material = s.mat; mesh.visible = s.vis; }
      window.__wvtSaved.clear();
      const t = window.__wvtTone;
      if (t) { s3.renderer.toneMapping = t.tm; s3.renderer.toneMappingExposure = t.exp; }
      s3.setPostEnabled?.(true);
    });
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    let blue = 0; let green = 0;
    for (let y = 0; y < info.height; y += 3) {
      for (let x = 0; x < info.width; x += 3) {
        const i = (y * info.width + x) * info.channels;
        const r = data[i]; const g2 = data[i + 1]; const b = data[i + 2];
        if (b > 200 && r < 60 && g2 < 60) blue += 1;
        else if (g2 > 200 && r < 60 && b < 60) green += 1;
      }
    }
    return { aim, painted, weldedBluePx: blue, tuftGreenPx: green, shot: 'welded-vs-tufts.png' };
  });

  // tone-mapped control for the flat recipe (proves flat mode load-bearing)
  await sec('flatToneControl', async () => {
    const painted = await page.evaluate(async () => {
      const s3 = window.__fw.scene3d;
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const g = s3.scene.getObjectByName('Tool_broom');
      const saved = new Map();
      window.__ftcSaved = saved;
      let n = 0;
      g.traverse((o) => {
        if (o.isMesh && o.visible && /^MopStrand_/.test(o.name || '')) {
          saved.set(o, o.material);
          o.material = new THREE.MeshBasicMaterial({ color: 0x00ff00, fog: false });
          n += 1;
        }
      });
      // deliberately KEEP tone mapping + post ON
      return n;
    });
    await page.waitForTimeout(180);
    const shot = path.join(OUT, 'flat-tone-control.png');
    await page.screenshot({ path: shot });
    await page.evaluate(() => {
      for (const [mesh, mat] of window.__ftcSaved) { mesh.material.dispose?.(); mesh.material = mat; }
      window.__ftcSaved.clear();
    });
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    let green = 0;
    for (let y = 0; y < info.height; y += 3) {
      for (let x = 0; x < info.width; x += 3) {
        const i = (y * info.width + x) * info.channels;
        if (data[i + 1] > 200 && data[i] < 60 && data[i + 2] < 60) green += 1;
      }
    }
    return { paintedMeshes: painted, pureGreenPxUnderACES: green };
  });

  // B4 ladder at clean mid-floor: real pitch, open lane ahead
  await sec('b4ladder', async () => {
    const res = { rungs: [] };
    res.restage = await page.evaluate(() => {
      const o = window.__fw.scene3d.clubhouse().interior.position;
      const w = window.__fw.scene3d.walk.state;
      w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.10;
      const ch = window.__fw.scene3d.clubhouse();
      const fwd = { x: -Math.sin(w.yaw), z: -Math.cos(w.yaw) };
      const probe = [];
      for (const ahead of [0.8, 1.5, 2.5]) {
        const wx = w.x + fwd.x * ahead; const wz = w.z + fwd.z * ahead;
        probe.push({ ahead, inside: ch.isInside ? ch.isInside(wx, wz, 0.2) : null });
      }
      return { x: +w.x.toFixed(2), z: +w.z.toFixed(2), laneProbe: probe };
    });
    await page.waitForTimeout(450);
    await lock();
    for (const target of [-0.92, -0.72, -0.55, -0.28, 0.0]) {
      const aim = await pitchTo(target);
      await page.waitForTimeout(650);
      const d = await page.evaluate(() => {
        const dd = window.__fw.scene3d.walk.toolRigDiagnostics('broom');
        const w = window.__fw.scene3d.walk.state;
        return dd ? {
          workBlend: dd.workBlend,
          headAboveFloor: dd.headAboveFloor,
          geomSource: dd.geomSource,
          assetHeadWorldY: dd.assetHeadWorldY ?? null,
          gripCamWorldY: dd.gripCamWorldY ?? null,
          px: +w.x.toFixed(2), pz: +w.z.toFixed(2),
        } : null;
      });
      res.rungs.push({ target, aim, ...d });
      if (target === -0.92) await page.screenshot({ path: path.join(OUT, '27-b4b-floor.png') });
      if (target === 0.0) await page.screenshot({ path: path.join(OUT, '28-b4b-horizon.png') });
    }
    // held sweep at horizon: cleaning must stay silent
    await page.mouse.down();
    await page.waitForTimeout(1600);
    res.horizonHeld = await page.evaluate(() => {
      const c = window.__fw.scene3d.walk.cleaningDiagnostics();
      return { using: c.using, result: c.result };
    });
    await page.mouse.up();
    // and at work pitch over the starter debris: positive control
    const backDown = await pitchTo(-0.55);
    res.workAim = backDown;
    await page.waitForTimeout(400);
    await page.mouse.down();
    await page.waitForTimeout(2000);
    res.workHeld = await page.evaluate(() => {
      const c = window.__fw.scene3d.walk.cleaningDiagnostics();
      return { using: c.using, result: c.result };
    });
    await page.mouse.up();
    return res;
  });

  flush();
  return { done: true, sections: Object.keys(out.sections), errs: out.errs.slice(0, 6) };
}
