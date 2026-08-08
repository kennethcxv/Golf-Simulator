// ADVERSARIAL VERIFIER 1 (throwaway) — TOOLS on real input.
// Attacks OVERNIGHT_REPORT_16 claims B0/B3/B4/B5 (mop+broom drawn behaviour),
// F1 (station outranks tool prompt), through the player's own input path.
// Staging (declared): cleaning-kit ownership seeded, teleports to stand
// points, and pitch falls back to staged ONLY if real mouse pitch stalls
// (recorded per aim). Every interaction is real page.keyboard/page.mouse.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify-v1');
  fs.mkdirSync(OUT, { recursive: true });
  const { createRequire } = process.getBuiltinModule('node:module');
  const nodeRequire = createRequire(`${process.cwd()}/`);
  const sharp = nodeRequire('sharp');
  const out = { sections: {}, errs: [] };
  const flush = () => fs.writeFileSync(path.join(OUT, 'tools.json'), `${JSON.stringify(out, null, 2)}\n`);
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
  const ownerRes = await boot.ownerResolution(page);
  out.ownerRes = ownerRes.caption;
  await page.bringToFront().catch(() => {});
  const cbox = await (await page.$('canvas')).boundingBox();
  const cx = Math.round(cbox.x + cbox.width / 2);
  const cy = Math.round(cbox.y + cbox.height / 2);
  let mx = cx; let my = cy;

  const lock = async () => {
    await page.mouse.click(cx, cy);
    mx = cx; my = cy;
    await page.waitForTimeout(380);
  };
  const mmove = async (dx, dy, steps = 3) => {
    mx += dx; my += dy;
    await page.mouse.move(mx, my, { steps });
  };
  const readPitch = () => page.evaluate(() => window.__fw.scene3d.walk.state.pitch);
  // real-input pitch: measured rad-per-pixel adapts each iteration; falls
  // back to staged pitch (declared in output) only after 3 stalls
  const pitchTo = async (target) => {
    let k = -0.00115; // rad per +px (down)
    let stall = 0;
    for (let i = 0; i < 26; i += 1) {
      const p = await readPitch();
      const err = target - p;
      if (Math.abs(err) < 0.045) return { reached: true, pitch: +p.toFixed(3), staged: false, iters: i };
      let dy = Math.max(-280, Math.min(280, err / k));
      const room = dy > 0 ? (cbox.y + cbox.height - 12) - my : (cbox.y + 12) - my;
      if ((dy > 0 && room < 24) || (dy < 0 && room > -24)) {
        stall += 1;
      } else {
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

  // ---------- in-page instrument ------------------------------------------
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
      const res = {
        found: true,
        skirt: null, bristles: null, strandMeshes: 0, strandVisible: 0,
        pivot: null, sockets: [], meshNames: [],
      };
      g.traverse((o) => {
        const n = o.name || '';
        if (o.isMesh) {
          res.meshNames.push(n + (o.visible ? '' : ' [hidden]'));
          if (/MESH_MopSkirt/i.test(n)) res.skirt = { visible: o.visible };
          if (/MESH_BroomBristles/i.test(n)) res.bristles = { visible: o.visible };
          if (/^MopStrand_/.test(n)) { res.strandMeshes += 1; if (o.visible) res.strandVisible += 1; }
        }
        if (/^SOCKET_/.test(n)) res.sockets.push(n);
        if (n === 'ToolHeadLagPivot') {
          res.pivot = {
            kids: o.children.map((c) => c.name || c.type),
            rot: [+o.rotation.x.toFixed(4), +o.rotation.y.toFixed(4), +o.rotation.z.toFixed(4)],
          };
        }
      });
      if (res.meshNames.length > 60) res.meshNames = res.meshNames.slice(0, 60);
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
        const rest = group?.userData?.cleaningRestPosition || null;
        let hs = null;
        if (hand && sockGrip) { hand.getWorldPosition(hp); sockGrip.getWorldPosition(sp); hs = +hp.distanceTo(sp).toFixed(4); }
        series.push({
          t: Math.round(t),
          gx: group ? +group.position.x.toFixed(4) : null,
          grz: group ? +group.rotation.z.toFixed(4) : null,
          restX: rest ? +rest.x.toFixed(4) : null,
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
          const rel = series.filter((r) => r.gx != null && r.restX != null).map((r) => +(r.gx - r.restX).toFixed(4));
          const hsArr = col('hs');
          resolve({
            frames: series.length,
            stats: {
              grzSpan: span(col('grz')),
              grzMin: col('grz').length ? Math.min(...col('grz')) : null,
              grzMax: col('grz').length ? Math.max(...col('grz')) : null,
              gxRel: rel.length ? { min: Math.min(...rel), max: Math.max(...rel), span: span(rel) } : null,
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
            every6th: series.filter((_, i) => i % 6 === 0),
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
    v1.setHandsVisible = (on) => { for (const hg of v1.handGroups()) hg.visible = !!on; return true; };
    v1.retone = () => {
      s3.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      s3.renderer.toneMappingExposure = 1.12;
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
    try {
      out.sections[name] = await fn();
    } catch (e) {
      out.sections[name] = { crashed: String(e && e.message ? e.message : e) };
    }
    flush();
  };

  // ---------- stage indoors + seed kit --------------------------------------
  await sec('stage', async () => page.evaluate(() => {
    const app = window.__fw;
    const inv = app.state?.shop?.inventory;
    if (inv && !inv.vac1) inv.vac1 = { shelf: 0, back: 1 };
    else if (inv && !(inv.vac1.back > 0)) inv.vac1.back = 1;
    const o = app.scene3d.clubhouse().interior.position;
    const w = app.scene3d.walk.state;
    w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.10;
    return { vacBack: inv?.vac1?.back ?? null, x: +w.x.toFixed(2), z: +w.z.toFixed(2) };
  }));
  await page.waitForTimeout(500);

  const equip = async (tool) => {
    await lock();
    await page.keyboard.down('f');
    await page.waitForTimeout(620);
    await page.keyboard.up('f');
    await page.waitForTimeout(420);
    const wheel = await page.evaluate(() => {
      const el = document.querySelector('.tool-wheel');
      if (!el) return null;
      const opts = [...el.querySelectorAll('[role="option"]')];
      const nodes = opts.length ? opts : [...el.querySelectorAll('.tool-wheel-item')];
      return {
        open: document.body.classList.contains('tool-wheel-open'),
        items: nodes.map((b) => (b.querySelector('.tool-wheel-label')?.textContent || b.textContent || '').trim().slice(0, 26)),
      };
    });
    const idx = (wheel?.items || []).findIndex((t) => new RegExp(tool, 'i').test(t));
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
    return { wheelItems: wheel?.items || null, idx, got };
  };

  // =================== MOP ====================================================
  await sec('equipMop', async () => {
    let r = await equip('mop');
    if (r.got !== 'mop') r = { retry: true, ...(await equip('mop')) };
    await page.screenshot({ path: path.join(OUT, '01-mop-equipped.png') });
    return r;
  });

  await sec('mopCensus', async () => page.evaluate(() => window.__v1.census('mop')));

  // claim 1: hold LMB and mop 5 s while REALLY turning the view
  await sec('mopWorkPitch', async () => pitchTo(-0.55));
  await sec('mopTurn', async () => {
    const sampler = page.evaluate(({ id, ms }) => window.__v1.capture(id, ms), { id: 'mop', ms: 8000 });
    await page.mouse.down();
    const swings = [420, -840, 840, -840, 640, -420];
    for (let i = 0; i < swings.length; i += 1) {
      await mmove(swings[i], 0, 2);
      if (i === 1) await page.screenshot({ path: path.join(OUT, '02-mop-midturn-a.png') });
      if (i === 3) await page.screenshot({ path: path.join(OUT, '03-mop-midturn-b.png') });
      await page.waitForTimeout(430);
    }
    await page.mouse.up();
    const res = await sampler;
    await page.screenshot({ path: path.join(OUT, '04-mop-rest-after.png') });
    return res;
  });

  // pure turn (no buttons): does a camera turn swing the pivot?
  await sec('mopPureTurn', async () => {
    const sampler = page.evaluate(({ id, ms }) => window.__v1.capture(id, ms), { id: 'mop', ms: 3000 });
    for (const dx of [500, -1000, 1000, -500]) {
      await mmove(dx, 0, 2);
      await page.waitForTimeout(320);
    }
    return sampler;
  });

  // flat-paint pixel gap hand<->shaft at rest and mid-turn while mopping
  await sec('mopFlat', async () => {
    const res = {};
    let painted = await page.evaluate((id) => window.__v1.flat(id, true), 'mop');
    await page.waitForTimeout(170);
    await page.screenshot({ path: path.join(OUT, 'flat-mop-rest.png') });
    res.rest = { painted, ...(await countPix(path.join(OUT, 'flat-mop-rest.png'))) };
    await page.mouse.down();
    await mmove(700, 0, 2);
    await page.screenshot({ path: path.join(OUT, 'flat-mop-turning.png') });
    await mmove(-700, 0, 2);
    await page.mouse.up();
    res.turning = await countPix(path.join(OUT, 'flat-mop-turning.png'));
    await page.evaluate((id) => window.__v1.flat(id, false), 'mop');
    return res;
  });

  // are the fibres actually the visible skirt? (paint strands green, count)
  await sec('mopStrandPixels', async () => {
    const n = await page.evaluate((id) => window.__v1.paintStrands(id, true), 'mop');
    await page.waitForTimeout(170);
    await page.screenshot({ path: path.join(OUT, 'mop-strands-green.png') });
    await page.evaluate((id) => window.__v1.paintStrands(id, false), 'mop');
    const pix = await countPix(path.join(OUT, 'mop-strands-green.png'));
    return { paintedMeshes: n, greenPx: pix.greenPx };
  });

  // B4 with the mop on REAL aim: floor plants, horizon hovers
  await sec('b4mop', async () => {
    const res = {};
    res.floorAim = await pitchTo(-0.92);
    await page.waitForTimeout(700);
    res.floor = await page.evaluate(() => {
      const d = window.__fw.scene3d.walk.toolRigDiagnostics('mop');
      return d ? { workBlend: d.workBlend, headAboveFloor: d.headAboveFloor, planted: d.planted ?? null, geomSource: d.geomSource } : null;
    });
    await page.screenshot({ path: path.join(OUT, '05-b4-mop-floor.png') });
    res.horizonAim = await pitchTo(0.0);
    await page.waitForTimeout(700);
    res.horizon = await page.evaluate(() => {
      const d = window.__fw.scene3d.walk.toolRigDiagnostics('mop');
      return d ? { workBlend: d.workBlend, headAboveFloor: d.headAboveFloor, planted: d.planted ?? null, geomSource: d.geomSource } : null;
    });
    await page.screenshot({ path: path.join(OUT, '06-b4-mop-horizon.png') });
    // held button at horizon: cleaning result must not land
    await page.mouse.down();
    await page.waitForTimeout(1800);
    res.horizonHeld = await page.evaluate(() => {
      const c = window.__fw.scene3d.walk.cleaningDiagnostics();
      const d = window.__fw.scene3d.walk.toolRigDiagnostics('mop');
      return { using: c.using, result: c.result, workBlend: d?.workBlend };
    });
    await page.mouse.up();
    // mid pitch hover-gap shot
    res.midAim = await pitchTo(-0.28);
    await page.waitForTimeout(600);
    res.mid = await page.evaluate(() => {
      const d = window.__fw.scene3d.walk.toolRigDiagnostics('mop');
      return d ? { workBlend: d.workBlend, headAboveFloor: d.headAboveFloor } : null;
    });
    await page.screenshot({ path: path.join(OUT, '06b-b4-mop-hovergap.png') });
    return res;
  });

  // =================== F1 — mop out, till, one E =============================
  await sec('f1', async () => {
    const res = {};
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
      if (/desk|register|till|serve|check|arrival/i.test(prompt) && !/ledger/i.test(prompt)) { till = { ...st, prompt }; break; }
    }
    res.till = till;
    if (!till) return res;
    // stand 2.4 yd off, face it, REAL mouse to mopping pitch, REAL walk in
    await page.evaluate(([s]) => {
      const w = window.__fw.scene3d.walk.state;
      w.x = s.x; w.z = s.z + 2.4;
      w.yaw = Math.atan2(-(s.x - w.x), -(s.z - w.z));
      w.pitch = -0.1;
    }, [till]);
    await page.waitForTimeout(400);
    await lock();
    res.pitch = await pitchTo(-0.55);
    let inReach = null;
    for (let i = 0; i < 8; i += 1) {
      inReach = await page.evaluate(() => window.__fw.scene3d.walk.stationInReach());
      if (inReach) break;
      await page.keyboard.down('w');
      await page.waitForTimeout(160);
      await page.keyboard.up('w');
      await page.waitForTimeout(160);
    }
    res.inReachBefore = inReach;
    res.promptBefore = await page.evaluate(() => document.querySelector('.shop-prompt')?.textContent || '');
    await page.screenshot({ path: path.join(OUT, '07-f1-at-till.png') });
    await page.keyboard.press('e');
    await page.waitForTimeout(1000);
    res.afterE = await page.evaluate(() => ({
      registerActive: !!window.__fw.scene3d.clubhouse().register?.isActive?.(),
      bodyRegisterMode: document.body.classList.contains('register-mode'),
      courseMode: window.__fw.courseMode,
      tool: window.__fw.scene3d.walk.getTool?.() ?? null,
    }));
    await page.screenshot({ path: path.join(OUT, '08-f1-after-E.png') });
    // leave with REAL Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    res.afterEscape = await page.evaluate(() => ({
      registerActive: !!window.__fw.scene3d.clubhouse().register?.isActive?.(),
      bodyRegisterMode: document.body.classList.contains('register-mode'),
      pauseOpen: !!document.querySelector('.pause-menu, .pause-shell, [data-pause-menu]'),
      tool: window.__fw.scene3d.walk.getTool?.() ?? null,
      walkActive: !!window.__fw.scene3d.walk.isActive?.(),
    }));
    await page.screenshot({ path: path.join(OUT, '09-f1-after-escape.png') });
    // if Escape opened a pause surface instead, close it and note it
    if (res.afterEscape.pauseOpen) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    }
    // negative: open floor E does nothing
    await page.evaluate(() => {
      const o = window.__fw.scene3d.clubhouse().interior.position;
      const w = window.__fw.scene3d.walk.state;
      w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.4;
    });
    await page.waitForTimeout(500);
    res.openFloorBefore = await page.evaluate(() => ({
      inReach: window.__fw.scene3d.walk.stationInReach(),
      courseMode: window.__fw.courseMode,
    }));
    await page.keyboard.press('e');
    await page.waitForTimeout(800);
    res.openFloorAfter = await page.evaluate(() => ({
      registerActive: !!window.__fw.scene3d.clubhouse().register?.isActive?.(),
      courseMode: window.__fw.courseMode,
      editorOpen: window.__fw.courseMode === 'editor',
      anyModal: document.body.className,
    }));
    await page.screenshot({ path: path.join(OUT, '10-f1-openfloor-E.png') });
    return res;
  });

  // =================== BROOM ==================================================
  await sec('equipBroom', async () => {
    let r = await equip('broom');
    if (r.got !== 'broom') r = { retry: true, ...(await equip('broom')) };
    return r;
  });

  await sec('broomCensus', async () => page.evaluate(() => window.__v1.census('broom')));

  // bristle rows visible from a low pitch
  await sec('broomBristleShot', async () => {
    const aim = await pitchTo(-0.72);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, '11-broom-low-pitch.png') });
    const n = await page.evaluate((id) => window.__v1.paintStrands(id, true), 'broom');
    await page.waitForTimeout(170);
    await page.screenshot({ path: path.join(OUT, 'broom-strands-green.png') });
    await page.evaluate((id) => window.__v1.paintStrands(id, false), 'broom');
    const pix = await countPix(path.join(OUT, 'broom-strands-green.png'));
    return { aim, paintedTufts: n, greenPx: pix.greenPx };
  });

  // hand stays on the broom through walk + fast turns
  await sec('broomTurn', async () => {
    const sampler = page.evaluate(({ id, ms }) => window.__v1.capture(id, ms), { id: 'broom', ms: 7000 });
    await page.keyboard.down('w');
    const swings = [420, -840, 840, -840, 420];
    for (let i = 0; i < swings.length; i += 1) {
      await mmove(swings[i], 0, 2);
      if (i === 2) await page.screenshot({ path: path.join(OUT, '12-broom-midturn.png') });
      await page.waitForTimeout(420);
    }
    await page.keyboard.up('w');
    return sampler;
  });

  await sec('broomPureTurn', async () => {
    const sampler = page.evaluate(({ id, ms }) => window.__v1.capture(id, ms), { id: 'broom', ms: 3000 });
    for (const dx of [500, -1000, 1000, -500]) {
      await mmove(dx, 0, 2);
      await page.waitForTimeout(320);
    }
    return sampler;
  });

  await sec('broomFlat', async () => {
    const res = {};
    const painted = await page.evaluate((id) => window.__v1.flat(id, true), 'broom');
    await page.waitForTimeout(170);
    await page.screenshot({ path: path.join(OUT, 'flat-broom-rest.png') });
    res.rest = { painted, ...(await countPix(path.join(OUT, 'flat-broom-rest.png'))) };
    await page.keyboard.down('w');
    await mmove(700, 0, 4);
    await page.screenshot({ path: path.join(OUT, 'flat-broom-walking.png') });
    res.walking = await countPix(path.join(OUT, 'flat-broom-walking.png'));
    await mmove(-900, 0, 2);
    await page.screenshot({ path: path.join(OUT, 'flat-broom-turning.png') });
    res.turning = await countPix(path.join(OUT, 'flat-broom-turning.png'));
    await page.keyboard.up('w');
    // control 1: retone over flat must kill pure green
    await page.evaluate((id) => { window.__v1.flat(id, true); window.__v1.retone(); }, 'broom');
    await page.waitForTimeout(160);
    await page.screenshot({ path: path.join(OUT, 'flat-broom-tonemapped-control.png') });
    await page.evaluate((id) => window.__v1.flat(id, false), 'broom');
    res.toneMappedControl = await countPix(path.join(OUT, 'flat-broom-tonemapped-control.png'));
    // control 2: hidden hands count zero green
    await page.evaluate(() => window.__v1.setHandsVisible(false));
    const painted2 = await page.evaluate((id) => window.__v1.flat(id, true), 'broom');
    await page.waitForTimeout(160);
    await page.screenshot({ path: path.join(OUT, 'flat-broom-hands-hidden.png') });
    await page.evaluate((id) => window.__v1.flat(id, false), 'broom');
    await page.evaluate(() => window.__v1.setHandsVisible(true));
    res.handsHiddenControl = { painted: painted2, ...(await countPix(path.join(OUT, 'flat-broom-hands-hidden.png'))) };
    return res;
  });

  // sweeping pushes debris forward and deletes nothing
  await sec('debris', async () => {
    const res = {};
    res.aim = await pitchTo(-0.55);
    res.seed = await page.evaluate(() => {
      const app = window.__fw;
      const s3 = app.scene3d;
      const ch = s3.clubhouse();
      const w = s3.walk.state;
      const fwd = { x: -Math.sin(w.yaw), z: -Math.cos(w.yaw) };
      const list = app.state.shop.reno.debris;
      window.__v1.debrisRef = { x: w.x, z: w.z, fx: fwd.x, fz: fwd.z, startLen: list.length };
      const seeds = [];
      for (let i = 0; i < 9; i += 1) {
        const ahead = 0.8 + i * 0.16;
        const side = ((i % 3) - 1) * 0.26;
        const wx = w.x + fwd.x * ahead + fwd.z * side;
        const wz = w.z + fwd.z * ahead - fwd.x * side;
        if (ch.isInside && !ch.isInside(wx, wz, 0.4)) continue;
        const l = ch.worldToLocal(wx, wz);
        list.push({ x: +l.x.toFixed(3), z: +l.z.toFixed(3), a: 0.22, kind: 'grit' });
        seeds.push({ wx: +wx.toFixed(2), wz: +wz.toFixed(2) });
      }
      return { seeds: seeds.length, listLen: list.length, total: +list.reduce((s, d) => s + d.a, 0).toFixed(3) };
    });
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
        centroidAlong: wsum > 0 ? +(along / wsum).toFixed(3) : null,
      };
    });
    res.before = await measure();
    await page.screenshot({ path: path.join(OUT, '13-debris-before.png') });
    // real sweep: LMB held, small lateral strokes, three short W nudges
    const didSeen = [];
    await page.mouse.down();
    for (let i = 0; i < 10; i += 1) {
      await mmove(i % 2 === 0 ? 120 : -120, 0, 3);
      if (i % 3 === 2) {
        await page.keyboard.down('w');
        await page.waitForTimeout(150);
        await page.keyboard.up('w');
      }
      await page.waitForTimeout(280);
      didSeen.push(await page.evaluate(() => {
        const c = window.__fw.scene3d.walk.cleaningDiagnostics();
        return c.result ? +(c.result.did ?? 0).toFixed(4) : null;
      }));
    }
    await page.mouse.up();
    res.didSeen = didSeen;
    res.after = await measure();
    await page.screenshot({ path: path.join(OUT, '14-debris-after.png') });
    res.pushedYd = res.before.centroidAlong != null && res.after.centroidAlong != null
      ? +(res.after.centroidAlong - res.before.centroidAlong).toFixed(3) : null;
    res.conserved = Math.abs((res.after.total ?? 0) - (res.before.total ?? 0)) < 0.03;
    return res;
  });

  // B4 on the broom via real aim
  await sec('b4broom', async () => {
    const res = {};
    res.floorAim = await pitchTo(-0.92);
    await page.waitForTimeout(700);
    res.floor = await page.evaluate(() => {
      const d = window.__fw.scene3d.walk.toolRigDiagnostics('broom');
      return d ? { workBlend: d.workBlend, headAboveFloor: d.headAboveFloor, geomSource: d.geomSource } : null;
    });
    await page.screenshot({ path: path.join(OUT, '15-b4-broom-floor.png') });
    res.horizonAim = await pitchTo(0.0);
    await page.waitForTimeout(700);
    res.horizon = await page.evaluate(() => {
      const d = window.__fw.scene3d.walk.toolRigDiagnostics('broom');
      return d ? { workBlend: d.workBlend, headAboveFloor: d.headAboveFloor, geomSource: d.geomSource } : null;
    });
    await page.screenshot({ path: path.join(OUT, '16-b4-broom-horizon.png') });
    await page.mouse.down();
    await page.waitForTimeout(1800);
    res.horizonHeld = await page.evaluate(() => {
      const c = window.__fw.scene3d.walk.cleaningDiagnostics();
      return { using: c.using, result: c.result };
    });
    await page.mouse.up();
    return res;
  });

  flush();
  return { done: true, sections: Object.keys(out.sections), errs: out.errs.slice(0, 6) };
}
