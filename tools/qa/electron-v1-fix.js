// ADVERSARIAL VERIFIER 1 (throwaway) — rerun of the legs run 1 invalidated:
// F1 (till approach), broom B0/B3 (bristles, hand-on-shaft through turns),
// debris push, B4 broom. Fixes vs run 1: pause-open guard (body class),
// wheel must actually be open before digits, till approach probes free
// stand points and records per-tap telemetry, debris falls back to the
// filthy starter's own clusters if seeding lands nothing.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify-v1');
  fs.mkdirSync(OUT, { recursive: true });
  const { createRequire } = process.getBuiltinModule('node:module');
  const nodeRequire = createRequire(`${process.cwd()}/`);
  const sharp = nodeRequire('sharp');
  const out = { sections: {}, errs: [] };
  const flush = () => fs.writeFileSync(path.join(OUT, 'fix.json'), `${JSON.stringify(out, null, 2)}\n`);
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

  const pauseOpen = () => page.evaluate(() => document.body.classList.contains('pause-open'));
  const pauseGuard = async () => {
    for (let i = 0; i < 4; i += 1) {
      if (!(await pauseOpen())) return i;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    return await pauseOpen() ? 'stuck' : 4;
  };
  const lock = async () => {
    await pauseGuard();
    await page.mouse.click(cx, cy);
    mx = cx; my = cy;
    await page.waitForTimeout(380);
  };
  const mmove = async (dx, dy, steps = 3) => {
    mx += dx; my += dy;
    await page.mouse.move(mx, my, { steps });
  };
  const readPitch = () => page.evaluate(() => window.__fw.scene3d.walk.state.pitch);
  const pitchTo = async (target) => {
    let k = -0.00115;
    let stall = 0;
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

  await page.evaluate(async () => {
    if (window.__v1) return;
    const s3 = window.__fw.scene3d;
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const v1 = { THREE };
    window.__v1 = v1;
    v1.toolGroup = (id) => s3.scene.getObjectByName(`Tool_${id}`) || null;
    v1.handGroups = () => {
      const groups = [];
      s3.scene.traverse((o) => { if (/^FirstPerson(Right|Left)Hand$/.test(o.name || '')) groups.push(o); });
      return groups;
    };
    v1.census = (id) => {
      const g = v1.toolGroup(id);
      if (!g) return { found: false };
      const res = { found: true, skirt: null, bristles: null, strandMeshes: 0, strandVisible: 0, pivot: null, sockets: [] };
      g.traverse((o) => {
        const n = o.name || '';
        if (o.isMesh) {
          if (/MESH_MopSkirt/i.test(n)) res.skirt = { visible: o.visible };
          if (/MESH_BroomBristles/i.test(n)) res.bristles = { visible: o.visible };
          if (/^MopStrand_/.test(n)) { res.strandMeshes += 1; if (o.visible) res.strandVisible += 1; }
        }
        if (/^SOCKET_/.test(n)) res.sockets.push(n);
        if (n === 'ToolHeadLagPivot') res.pivot = { kids: o.children.map((c) => c.name || c.type) };
      });
      return res;
    };
    v1.capture = (toolId, ms) => new Promise((resolve) => {
      const walk = s3.walk;
      const group = v1.toolGroup(toolId);
      let sockGrip = null; let pivot = null;
      if (group) {
        group.traverse((o) => {
          if (!sockGrip && /SOCKET_GripPrimary/i.test(o.name || '')) sockGrip = o;
          if (!pivot && o.name === 'ToolHeadLagPivot') pivot = o;
        });
      }
      let hand = null;
      s3.scene.traverse((o) => { if (!hand && o.name === 'FirstPersonRightHand') hand = o; });
      const hp = new THREE.Vector3(); const sp = new THREE.Vector3();
      const t0 = performance.now();
      const series = [];
      const step = () => {
        const t = performance.now() - t0;
        const diag = walk.toolRigDiagnostics ? walk.toolRigDiagnostics(toolId) : null;
        let hs = null;
        if (hand && sockGrip) { hand.getWorldPosition(hp); sockGrip.getWorldPosition(sp); hs = +hp.distanceTo(sp).toFixed(4); }
        series.push({
          t: Math.round(t),
          grz: group ? +group.rotation.z.toFixed(4) : null,
          hs,
          piv: pivot ? +Math.hypot(pivot.rotation.x, pivot.rotation.y, pivot.rotation.z).toFixed(4) : null,
          vm: diag ? diag.vmActive : null,
          gs: diag ? (diag.geomSource ?? null) : null,
          yaw: +walk.state.yaw.toFixed(3),
        });
        if (t < ms) requestAnimationFrame(step);
        else {
          const col = (k) => series.map((r) => r[k]).filter((x) => x != null && Number.isFinite(x));
          const span = (a) => (a.length ? +(Math.max(...a) - Math.min(...a)).toFixed(4) : null);
          const hsArr = col('hs');
          resolve({
            frames: series.length,
            stats: {
              grzSpan: span(col('grz')),
              handSock: hsArr.length ? {
                min: Math.min(...hsArr),
                max: Math.max(...hsArr),
                mean: +(hsArr.reduce((a, x) => a + x, 0) / hsArr.length).toFixed(4),
              } : null,
              pivotRotMax: col('piv').length ? Math.max(...col('piv')) : null,
              vmAlways: series.every((r) => r.vm !== false),
              geomSources: [...new Set(series.map((r) => r.gs).filter(Boolean))],
              yawSpan: span(col('yaw')),
            },
          });
        }
      };
      requestAnimationFrame(step);
    });
    let savedTone = null;
    const savedMats = new Map();
    v1.flat = (toolId, on) => {
      const r = s3.renderer;
      if (on) {
        const g = v1.toolGroup(toolId);
        const handMeshes = [];
        for (const hg of v1.handGroups()) hg.traverse((o) => { if (o.isMesh && o.visible) handMeshes.push(o); });
        const shaftMeshes = [];
        if (g) {
          g.traverse((o) => {
            if (o.isMesh && o.visible && !handMeshes.includes(o)
              && /handle|gripwrap|ferrule|buttcap|shaft|pole|griptape|hanghole/i.test(o.name || '')) shaftMeshes.push(o);
          });
        }
        savedTone = { tm: r.toneMapping, exp: r.toneMappingExposure };
        r.toneMapping = THREE.NoToneMapping;
        r.toneMappingExposure = 1;
        s3.setPostEnabled?.(false);
        const paint = (mesh, color) => {
          savedMats.set(mesh, mesh.material);
          mesh.material = new THREE.MeshBasicMaterial({ color, fog: false });
        };
        for (const m of handMeshes) paint(m, 0x00ff00);
        for (const m of shaftMeshes) paint(m, 0xff0000);
        return { hands: handMeshes.length, shaft: shaftMeshes.length };
      }
      for (const [mesh, mat] of savedMats) { mesh.material.dispose?.(); mesh.material = mat; }
      savedMats.clear();
      if (savedTone) {
        r.toneMapping = savedTone.tm; r.toneMappingExposure = savedTone.exp;
        s3.setPostEnabled?.(true);
        savedTone = null;
      }
      return true;
    };
    const strandSaved = new Map();
    let strandTone = null;
    v1.paintStrands = (toolId, on) => {
      const r = s3.renderer;
      const g = v1.toolGroup(toolId);
      if (on) {
        if (!g) return 'no group';
        strandTone = { tm: r.toneMapping, exp: r.toneMappingExposure };
        r.toneMapping = THREE.NoToneMapping;
        r.toneMappingExposure = 1;
        s3.setPostEnabled?.(false);
        let n = 0;
        g.traverse((o) => {
          if (o.isMesh && o.visible && /^MopStrand_/.test(o.name || '')) {
            strandSaved.set(o, o.material);
            o.material = new THREE.MeshBasicMaterial({ color: 0x00ff00, fog: false });
            n += 1;
          }
        });
        return n;
      }
      for (const [mesh, mat] of strandSaved) { mesh.material.dispose?.(); mesh.material = mat; }
      strandSaved.clear();
      if (strandTone) {
        r.toneMapping = strandTone.tm; r.toneMappingExposure = strandTone.exp;
        s3.setPostEnabled?.(true);
        strandTone = null;
      }
      return true;
    };
    return 'ok';
  });

  const countPix = async (shotPath) => {
    const { data, info } = await sharp(shotPath).raw().toBuffer({ resolveWithObject: true });
    let green = 0; let red = 0;
    const greens = []; const reds = [];
    for (let y = 0; y < info.height; y += 3) {
      for (let x = 0; x < info.width; x += 3) {
        const i = (y * info.width + x) * info.channels;
        const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
        if (g > 200 && r < 60 && b < 60) { green += 1; greens.push([x, y]); }
        else if (r > 200 && g < 60 && b < 60) { red += 1; reds.push([x, y]); }
      }
    }
    let minGap = null;
    if (greens.length && reds.length) {
      let best = Infinity;
      for (const [gx, gy] of greens) {
        for (const [rx, ry] of reds) {
          const d2 = (gx - rx) * (gx - rx) + (gy - ry) * (gy - ry);
          if (d2 < best) best = d2;
        }
      }
      minGap = +Math.sqrt(best).toFixed(1);
    }
    return { greenPx: green, redPx: red, minGapPx: minGap };
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
    return { vacBack: inv?.vac1?.back ?? null };
  }));
  await page.waitForTimeout(500);

  const equip = async (tool) => {
    await pauseGuard();
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
    const idx = wheel?.open ? wheel.items.findIndex((t) => new RegExp(tool, 'i').test(t)) : -1;
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
    return { wheelOpen: wheel?.open ?? null, items: wheel?.items ?? null, idx, got };
  };

  await sec('equipMop', async () => equip('mop'));

  // =================== F1, corrected approach ================================
  await sec('f1', async () => {
    const res = { taps: [] };
    const stations = await page.evaluate(() => window.__fw.scene3d.walk.stations());
    res.stations = stations;
    let till = null;
    for (const st of stations) {
      await page.evaluate(([s]) => {
        const w = window.__fw.scene3d.walk.state;
        w.x = s.x; w.z = s.z + 1.2;
        w.yaw = Math.atan2(-(s.x - w.x), -(s.z - w.z));
        w.pitch = -0.1;
      }, [st]);
      await page.waitForTimeout(500);
      const prompt = await page.evaluate(() => document.querySelector('.shop-prompt')?.textContent || '');
      if (/desk|register|till|serve|check|arrival/i.test(prompt) && !/ledger/i.test(prompt)) { till = { ...st, prompt: prompt.slice(0, 70) }; break; }
    }
    res.till = till;
    if (!till) return res;
    // probe stand candidates for a FREE spot with a clear lane
    const stand = await page.evaluate(([s]) => {
      const walk = window.__fw.scene3d.walk;
      const cands = [
        { dx: 0, dz: 1.9 }, { dx: 0, dz: 1.6 }, { dx: 0.9, dz: 1.5 }, { dx: -0.9, dz: 1.5 }, { dx: 0, dz: 1.3 },
      ];
      for (const c of cands) {
        const x = s.x + c.dx; const z = s.z + c.dz;
        if (!walk.isFree || walk.isFree(x, z)) return { x, z, cand: c };
      }
      return { x: s.x, z: s.z + 1.3, cand: null };
    }, [till]);
    res.stand = stand;
    await page.evaluate(([s, st2]) => {
      const w = window.__fw.scene3d.walk.state;
      w.x = st2.x; w.z = st2.z;
      w.yaw = Math.atan2(-(s.x - w.x), -(s.z - w.z));
      w.pitch = -0.1;
    }, [till, stand]);
    await page.waitForTimeout(450);
    await lock();
    res.pitch = await pitchTo(-0.55);
    // real W taps until the station scan bites
    let inReach = await page.evaluate(() => window.__fw.scene3d.walk.stationInReach());
    for (let i = 0; i < 6 && !inReach; i += 1) {
      await page.keyboard.down('w');
      await page.waitForTimeout(140);
      await page.keyboard.up('w');
      await page.waitForTimeout(200);
      const tel = await page.evaluate(() => {
        const w = window.__fw.scene3d.walk.state;
        return { x: +w.x.toFixed(2), z: +w.z.toFixed(2), inReach: window.__fw.scene3d.walk.stationInReach() };
      });
      res.taps.push(tel);
      inReach = tel.inReach;
    }
    res.inReachBefore = inReach;
    res.promptBefore = await page.evaluate(() => (document.querySelector('.shop-prompt')?.textContent || '').slice(0, 90));
    await page.screenshot({ path: path.join(OUT, '17-f1-at-till.png') });
    await page.keyboard.press('e');
    await page.waitForTimeout(1100);
    res.afterE = await page.evaluate(() => ({
      registerActive: !!window.__fw.scene3d.clubhouse().register?.isActive?.(),
      bodyRegisterMode: document.body.classList.contains('register-mode'),
      courseMode: window.__fw.courseMode,
      tool: window.__fw.scene3d.walk.getTool?.() ?? null,
    }));
    await page.screenshot({ path: path.join(OUT, '18-f1-register-open.png') });
    // E again with the register open must not fall through to the editor
    await page.keyboard.press('e');
    await page.waitForTimeout(700);
    res.afterSecondE = await page.evaluate(() => ({
      registerActive: !!window.__fw.scene3d.clubhouse().register?.isActive?.(),
      courseMode: window.__fw.courseMode,
    }));
    // REAL Escape leaves
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    res.afterEscape = await page.evaluate(() => ({
      registerActive: !!window.__fw.scene3d.clubhouse().register?.isActive?.(),
      bodyRegisterMode: document.body.classList.contains('register-mode'),
      pauseOpen: document.body.classList.contains('pause-open'),
      tool: window.__fw.scene3d.walk.getTool?.() ?? null,
      walkActive: !!window.__fw.scene3d.walk.isActive?.(),
    }));
    await page.screenshot({ path: path.join(OUT, '19-f1-after-escape.png') });
    await pauseGuard();
    // negative: open floor, E does nothing
    await page.evaluate(() => {
      const o = window.__fw.scene3d.clubhouse().interior.position;
      const w = window.__fw.scene3d.walk.state;
      w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.4;
    });
    await page.waitForTimeout(500);
    res.openFloorBefore = await page.evaluate(() => ({
      inReach: window.__fw.scene3d.walk.stationInReach(),
      prompt: (document.querySelector('.shop-prompt')?.textContent || '').slice(0, 60),
    }));
    await page.keyboard.press('e');
    await page.waitForTimeout(800);
    res.openFloorAfter = await page.evaluate(() => ({
      registerActive: !!window.__fw.scene3d.clubhouse().register?.isActive?.(),
      courseMode: window.__fw.courseMode,
      bodyClass: document.body.className,
    }));
    await page.screenshot({ path: path.join(OUT, '20-f1-openfloor.png') });
    await pauseGuard();
    return res;
  });

  // =================== BROOM =================================================
  await sec('equipBroom', async () => equip('broom'));
  const broomOk = () => page.evaluate(() => window.__fw.scene3d.walk.getTool?.() === 'broom');

  await sec('broomCensus', async () => {
    if (!(await broomOk())) return { skipped: 'broom not equipped' };
    return page.evaluate(() => window.__v1.census('broom'));
  });

  await sec('broomBristleShot', async () => {
    if (!(await broomOk())) return { skipped: 'broom not equipped' };
    const aim = await pitchTo(-0.72);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, '21-broom-low-pitch.png') });
    const n = await page.evaluate((id) => window.__v1.paintStrands(id, true), 'broom');
    await page.waitForTimeout(170);
    await page.screenshot({ path: path.join(OUT, 'broom-strands-green2.png') });
    await page.evaluate((id) => window.__v1.paintStrands(id, false), 'broom');
    const pix = await countPix(path.join(OUT, 'broom-strands-green2.png'));
    return { aim, paintedTufts: n, greenPx: pix.greenPx };
  });

  await sec('broomTurn', async () => {
    if (!(await broomOk())) return { skipped: 'broom not equipped' };
    const sampler = page.evaluate(({ id, ms }) => window.__v1.capture(id, ms), { id: 'broom', ms: 7000 });
    await page.keyboard.down('w');
    const swings = [420, -840, 840, -840, 420];
    for (let i = 0; i < swings.length; i += 1) {
      await mmove(swings[i], 0, 2);
      if (i === 2) await page.screenshot({ path: path.join(OUT, '22-broom-midturn.png') });
      await page.waitForTimeout(420);
    }
    await page.keyboard.up('w');
    return sampler;
  });

  await sec('broomPureTurn', async () => {
    if (!(await broomOk())) return { skipped: 'broom not equipped' };
    const sampler = page.evaluate(({ id, ms }) => window.__v1.capture(id, ms), { id: 'broom', ms: 3000 });
    for (const dx of [500, -1000, 1000, -500]) {
      await mmove(dx, 0, 2);
      await page.waitForTimeout(320);
    }
    return sampler;
  });

  await sec('broomFlat', async () => {
    if (!(await broomOk())) return { skipped: 'broom not equipped' };
    const res = {};
    const painted = await page.evaluate((id) => window.__v1.flat(id, true), 'broom');
    await page.waitForTimeout(170);
    await page.screenshot({ path: path.join(OUT, 'flat2-broom-rest.png') });
    res.rest = { painted, ...(await countPix(path.join(OUT, 'flat2-broom-rest.png'))) };
    await page.keyboard.down('w');
    await mmove(700, 0, 4);
    await page.screenshot({ path: path.join(OUT, 'flat2-broom-walking.png') });
    res.walking = await countPix(path.join(OUT, 'flat2-broom-walking.png'));
    await mmove(-900, 0, 2);
    await page.screenshot({ path: path.join(OUT, 'flat2-broom-turning.png') });
    res.turning = await countPix(path.join(OUT, 'flat2-broom-turning.png'));
    await page.keyboard.up('w');
    await page.evaluate(() => window.__v1.setHandsVisible?.(true));
    // control: hidden hands count zero green
    const hidden = await page.evaluate((id) => {
      const groups = [];
      window.__fw.scene3d.scene.traverse((o) => { if (/^FirstPerson(Right|Left)Hand$/.test(o.name || '')) groups.push(o); });
      for (const g of groups) g.visible = false;
      return groups.length;
    }, 'broom');
    await page.waitForTimeout(160);
    await page.screenshot({ path: path.join(OUT, 'flat2-broom-hands-hidden.png') });
    res.handsHiddenControl = { hiddenGroups: hidden, ...(await countPix(path.join(OUT, 'flat2-broom-hands-hidden.png'))) };
    await page.evaluate(() => {
      window.__fw.scene3d.scene.traverse((o) => { if (/^FirstPerson(Right|Left)Hand$/.test(o.name || '')) o.visible = true; });
    });
    await page.evaluate((id) => window.__v1.flat(id, false), 'broom');
    return res;
  });

  // =================== DEBRIS push ===========================================
  await sec('debris', async () => {
    if (!(await broomOk())) return { skipped: 'broom not equipped' };
    const res = {};
    // find the debris-richest aim: nearest existing cluster to the stand point
    res.setup = await page.evaluate(() => {
      const app = window.__fw;
      const s3 = app.scene3d;
      const ch = s3.clubhouse();
      const o = ch.interior.position;
      const w = s3.walk.state;
      const list = app.state.shop.reno.debris;
      const stand = { x: o.x - 5.2, z: o.z + 3.0 };
      let best = null;
      for (const d of list) {
        const p = ch.localToWorld(d.x, d.z);
        const dist = Math.hypot(p.x - stand.x, p.z - stand.z);
        if (!best || dist < best.dist) best = { p, dist, a: d.a };
      }
      if (!best) return { clusters: 0 };
      // stand 1.35 yd back from the cluster, facing it
      const dx = best.p.x - stand.x; const dz = best.p.z - stand.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len; const uz = dz / len;
      w.x = best.p.x - ux * 1.35; w.z = best.p.z - uz * 1.35;
      w.yaw = Math.atan2(-ux, -uz);
      w.pitch = -0.1;
      const fwd = { x: -Math.sin(w.yaw), z: -Math.cos(w.yaw) };
      window.__v1.debrisRef = { x: w.x, z: w.z, fx: fwd.x, fz: fwd.z, aim: { x: best.p.x, z: best.p.z } };
      // seed a couple more in the lane so the push has a pile to work
      let seeded = 0;
      for (const ahead of [1.0, 1.35, 1.7]) {
        for (const side of [-0.2, 0.2]) {
          const wx = w.x + fwd.x * ahead + fwd.z * side;
          const wz = w.z + fwd.z * ahead - fwd.x * side;
          if (ch.isInside && !ch.isInside(wx, wz, 0.2)) continue;
          const l = ch.worldToLocal(wx, wz);
          list.push({ x: +l.x.toFixed(3), z: +l.z.toFixed(3), a: 0.2, kind: 'grit' });
          seeded += 1;
        }
      }
      return {
        clusters: list.length,
        nearest: { x: +best.p.x.toFixed(2), z: +best.p.z.toFixed(2), dist: +best.dist.toFixed(2) },
        seeded,
        standNow: { x: +w.x.toFixed(2), z: +w.z.toFixed(2) },
        isInsideStand: ch.isInside ? ch.isInside(w.x, w.z, 0) : 'n/a',
      };
    });
    await page.waitForTimeout(450);
    await lock();
    res.aim = await pitchTo(-0.55);
    const measure = () => page.evaluate(() => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const ref = window.__v1.debrisRef;
      const list = app.state.shop.reno.debris;
      let wsum = 0; let along = 0; let n = 0;
      for (const d of list) {
        const p = ch.localToWorld(d.x, d.z);
        const dx = p.x - ref.x; const dz = p.z - ref.z;
        const a = dx * ref.fx + dz * ref.fz;
        const lat = dx * ref.fz - dz * ref.fx;
        if (a > -0.5 && a < 5 && Math.abs(lat) < 1.6) { wsum += d.a; along += a * d.a; n += 1; }
      }
      return {
        clusters: list.length,
        total: +list.reduce((s, d) => s + d.a, 0).toFixed(3),
        zoneClusters: n,
        zoneAmount: +wsum.toFixed(3),
        centroidAlong: wsum > 0 ? +(along / wsum).toFixed(3) : null,
      };
    });
    res.before = await measure();
    await page.screenshot({ path: path.join(OUT, '23-debris-before.png') });
    const didSeen = [];
    await page.mouse.down();
    for (let i = 0; i < 12; i += 1) {
      await mmove(i % 2 === 0 ? 110 : -110, 0, 3);
      if (i % 3 === 2) {
        await page.keyboard.down('w');
        await page.waitForTimeout(140);
        await page.keyboard.up('w');
      }
      await page.waitForTimeout(260);
      didSeen.push(await page.evaluate(() => {
        const c = window.__fw.scene3d.walk.cleaningDiagnostics();
        return c.result ? { did: +(c.result.did ?? 0).toFixed(4), kind: c.result.kind, reason: c.result.reason ?? null } : null;
      }));
    }
    await page.mouse.up();
    res.didSeen = didSeen;
    res.after = await measure();
    await page.screenshot({ path: path.join(OUT, '24-debris-after.png') });
    res.pushedYd = res.before.centroidAlong != null && res.after.centroidAlong != null
      ? +(res.after.centroidAlong - res.before.centroidAlong).toFixed(3) : null;
    res.conservedDelta = +((res.after.total ?? 0) - (res.before.total ?? 0)).toFixed(4);
    return res;
  });

  // =================== B4 broom ==============================================
  await sec('b4broom', async () => {
    if (!(await broomOk())) return { skipped: 'broom not equipped' };
    const res = {};
    res.floorAim = await pitchTo(-0.92);
    await page.waitForTimeout(700);
    res.floor = await page.evaluate(() => {
      const d = window.__fw.scene3d.walk.toolRigDiagnostics('broom');
      return d ? { workBlend: d.workBlend, headAboveFloor: d.headAboveFloor, geomSource: d.geomSource } : null;
    });
    await page.screenshot({ path: path.join(OUT, '25-b4-broom-floor.png') });
    res.horizonAim = await pitchTo(0.0);
    await page.waitForTimeout(700);
    res.horizon = await page.evaluate(() => {
      const d = window.__fw.scene3d.walk.toolRigDiagnostics('broom');
      return d ? { workBlend: d.workBlend, headAboveFloor: d.headAboveFloor, geomSource: d.geomSource } : null;
    });
    await page.screenshot({ path: path.join(OUT, '26-b4-broom-horizon.png') });
    await page.mouse.down();
    await page.waitForTimeout(1800);
    res.horizonHeld = await page.evaluate(() => {
      const c = window.__fw.scene3d.walk.cleaningDiagnostics();
      const d = window.__fw.scene3d.walk.toolRigDiagnostics('broom');
      return { using: c.using, result: c.result, workBlend: d?.workBlend };
    });
    await page.mouse.up();
    return res;
  });

  flush();
  return { done: true, sections: Object.keys(out.sections), errs: out.errs.slice(0, 6) };
}
