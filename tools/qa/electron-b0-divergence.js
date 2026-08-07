// B0 — THE DIVERGENCE INSTRUMENT. Full_Goal_16 says the mop's strands do not
// move and the broom's hand is not on the broom when the player moves, while
// six rounds of instruments measured the opposite. This driver finds out
// WHICH THING each side was true about, in the player's own pixels, through
// the player's own input path, before any geometry or config changes.
//
// Legs (QA_B0_LEG): mop-fresh | broom-fresh | mop-restore | broom-restore |
// mop-beltswap. Restore = reload + Continue + re-equip (the realistic "load
// save, take out the mop" history where a missed rig activation would live).
//
// Staging that is NOT the player's path, declared: ownership of the cleaning
// kit is seeded (state.shop.inventory.vac1.back — the kit is bought from the
// laptop days before the complaint; read-back = the wheel item shows
// available), and the player is teleported to the shop floor once before
// input begins. EVERYTHING ELSE is real input: pointer lock from a real
// click, real F-hold for the wheel, a real click on the wheel item, real
// W/A/D holds, real locked mouse deltas, real button holds for work.
//
// Instruments per leg:
//  1. REPRODUCTION — an in-page rAF loop (registers after the game's, so
//     every sample is post-render, post-every-writer) crops the drawn head's
//     region from the live canvas and accumulates |Δ| between consecutive
//     frames: motion energy in the player's own pixels. Runs still / working
//     / carry-walk; mop adds strands-hidden and skirt-hidden controls.
//  2. TWO-WRITERS SIGNATURE — per frame, drawn group x/rotZ beside
//     userData.cleaningRestPosition: while `using`, a drawn x oscillating
//     about rest.x within the legacy span catches courseScene.js:8679-8686
//     in the act. The broom (exempted by its guard) must NOT show it.
//  3. RIG/CAMERA STATE per frame: toolRigDiagnostics(id).vmActive/geomSource
//     + toolDrawCamera(id).fov — a false vmActive is the legacy pose path.
//  4. HAND/SHAFT PIXEL GAP (broom) — flat-paint hands green / shaft red
//     (NoToneMapping + post off, the fault-44 recipe), real screenshots at
//     rest / walking / turning; min blob gap in pixels. Controls: the
//     tone-mapped flat frame must LOSE the pure colours; hidden hands must
//     count zero green.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const LEG = process.env.QA_B0_LEG || 'mop-fresh';
  const TOOL = LEG.startsWith('mop') ? 'mop' : 'broom';
  const OUT = path.resolve(`qa/electron/b0-divergence/${LEG}`);
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  // declared BEFORE first use — the strand/skirt share step runs earlier in
  // the body than the gap section (fault 47: TDZ crash, stale JSON read)
  const { createRequire } = process.getBuiltinModule('node:module');
  const nodeRequire = createRequire(`${process.cwd()}/`);
  const sharp = nodeRequire('sharp');

  const waitPlayable = async () => {
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
    await page.waitForFunction(() => {
      const v = document.querySelector('.load-veil');
      return !v || getComputedStyle(v).opacity === '0';
    }, null, { timeout: 300000 });
    await page.waitForTimeout(2200);
  };
  await boot.clickThroughMenu(page);
  await waitPlayable();
  const ownerRes = await boot.ownerResolution(page);

  const out = { leg: LEG, tool: TOOL, ownerRes: ownerRes.caption, steps: {}, errs };

  // ---------- injectable helpers (re-run after any reload) ------------------
  const inject = () => page.evaluate(async () => {
    if (window.__b0) return 'already';
    const s3 = window.__fw.scene3d;
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const b0 = {};
    window.__b0 = b0;

    // Verified by the name probe: held groups are named Tool_<id> and ride an
    // unnamed held root that is itself a child of the CAMERA.
    b0.toolGroup = (toolId) => s3.scene.getObjectByName(`Tool_${toolId}`) || null;
    b0.handGroups = () => {
      const groups = [];
      s3.scene.traverse((o) => {
        if (/^FirstPerson(Right|Left)Hand$/.test(o.name || '')) groups.push(o);
      });
      return groups;
    };

    b0.captureRegionDiffs = (toolId, frames, regionHalf = 110) => new Promise((resolve) => {
      const renderer = s3.renderer;
      const SIZE = 220;
      const canvas2d = document.createElement('canvas');
      canvas2d.width = SIZE; canvas2d.height = SIZE;
      const ctx = canvas2d.getContext('2d', { willReadFrequently: true });
      const group = b0.toolGroup(toolId);
      const head = new THREE.Vector3();
      const ndc = new THREE.Vector3();
      let socket = null;
      if (group) {
        group.traverse((o) => {
          if (!socket && /SOCKET_(FloorContact|DirtIntake|contact)/i.test(o.name || '')) socket = o;
        });
      }
      let prev = null;
      const series = [];
      let n = 0;
      const step = () => {
        const diag = s3.walk.toolRigDiagnostics ? s3.walk.toolRigDiagnostics(toolId) : null;
        const cam = s3.walk.toolDrawCamera ? s3.walk.toolDrawCamera(toolId) : s3.camera;
        let sample = { diff: null, offscreen: true };
        if (group && socket) {
          socket.getWorldPosition(head);
          ndc.copy(head).project(cam);
          const onScreen = ndc.x > -1.2 && ndc.x < 1.2 && ndc.y > -1.2 && ndc.y < 1.2 && ndc.z < 1;
          if (onScreen) {
            const w = renderer.domElement.width;
            const h = renderer.domElement.height;
            const cx = Math.round((ndc.x * 0.5 + 0.5) * w);
            const cy = Math.round((-ndc.y * 0.5 + 0.5) * h);
            const px = Math.max(0, Math.min(w - 2 * regionHalf, cx - regionHalf));
            const py = Math.max(0, Math.min(h - 2 * regionHalf, cy - regionHalf));
            ctx.drawImage(renderer.domElement, px, py, regionHalf * 2, regionHalf * 2, 0, 0, SIZE, SIZE);
            const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
            let diff = 0;
            if (prev) {
              for (let i = 0; i < data.length; i += 16) {
                diff += Math.abs(data[i] - prev[i]) + Math.abs(data[i + 1] - prev[i + 1])
                  + Math.abs(data[i + 2] - prev[i + 2]);
              }
            }
            const rest = group.userData?.cleaningRestPosition || null;
            sample = {
              diff: prev ? Math.round(diff / 1000) : 0,
              vmActive: diag ? diag.vmActive : null,
              geomSource: diag ? diag.geomSource : null,
              camFov: cam.fov,
              gx: +group.position.x.toFixed(4),
              grz: +group.rotation.z.toFixed(4),
              restX: rest ? +rest.x.toFixed(4) : null,
              headNdcY: +ndc.y.toFixed(3),
            };
            prev = data.slice(0);
          } else {
            prev = null;
            sample = { diff: null, offscreen: true, vmActive: diag ? diag.vmActive : null, headNdcY: +ndc.y.toFixed(3) };
          }
        }
        series.push(sample);
        n += 1;
        if (n < frames) requestAnimationFrame(step);
        else resolve(series);
      };
      requestAnimationFrame(step);
    });

    // Broom discriminator: WORLD hand-to-grip-socket distance per frame,
    // sampled post-render. If this stays at millimetres while the pixel gap
    // reads hundreds, the split lives in the DRAW path; if it balloons in
    // motion, something overwrites the seat between rig update and render.
    b0.captureHandSocketWorld = (toolId, frames) => new Promise((resolve) => {
      const group = b0.toolGroup(toolId);
      let socket = null;
      if (group) {
        group.traverse((o) => {
          if (!socket && /SOCKET_GripPrimary/i.test(o.name || '')) socket = o;
        });
      }
      let hand = null;
      s3.scene.traverse((o) => {
        if (!hand && o.name === 'FirstPersonRightHand') hand = o;
      });
      const hp = new THREE.Vector3(); const sp = new THREE.Vector3();
      const series = [];
      let n = 0;
      const step = () => {
        if (hand && socket) {
          hand.getWorldPosition(hp); socket.getWorldPosition(sp);
          series.push(+hp.distanceTo(sp).toFixed(4));
        } else series.push(null);
        n += 1;
        if (n < frames) requestAnimationFrame(step);
        else resolve(series);
      };
      requestAnimationFrame(step);
    });

    b0.setStrandRigVisible = (toolId, on) => {
      const g = b0.toolGroup(toolId);
      const rigRoot = g ? g.getObjectByName('MopStrandRig') : null;
      if (!rigRoot) return 'no strand rig';
      rigRoot.visible = !!on;
      return true;
    };
    b0.setMeshVisible = (toolId, namePattern, on) => {
      const g = b0.toolGroup(toolId);
      if (!g) return 'no group';
      const re = new RegExp(namePattern, 'i');
      let hits = 0;
      g.traverse((o) => { if (o.isMesh && re.test(o.name || '')) { o.visible = !!on; hits += 1; } });
      return hits;
    };

    let savedTone = null;
    const savedMats = new Map();
    b0.flatShot = (toolId, on) => {
      const r = s3.renderer;
      if (on) {
        const g = b0.toolGroup(toolId);
        const handMeshes = [];
        for (const hg of b0.handGroups()) hg.traverse((o) => { if (o.isMesh && o.visible) handMeshes.push(o); });
        const shaftMeshes = [];
        if (g) {
          g.traverse((o) => {
            if (o.isMesh && o.visible && !handMeshes.includes(o)
              && /handle|gripwrap|ferrule|buttcap|shaft|pole|griptape|hanghole/i.test(o.name || '')) {
              shaftMeshes.push(o);
            }
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
    b0.retoneOverFlat = () => {
      s3.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      s3.renderer.toneMappingExposure = 1.12;
    };
    b0.setHandsVisible = (on) => {
      for (const hg of b0.handGroups()) hg.visible = !!on;
      return true;
    };
    return 'injected';
  });

  // ---------- staging: ownership + shop floor -------------------------------
  const stage = async () => {
    const seeded = await page.evaluate(() => {
      const app = window.__fw;
      const inv = app.state?.shop?.inventory;
      if (!inv) return { ok: false, reason: 'no inventory' };
      if (!inv.vac1) inv.vac1 = { shelf: 0, back: 1 };
      else if (!(inv.vac1.back > 0)) inv.vac1.back = 1;
      // teleport to the shop floor (staging, declared in the report); input
      // stays real from here on
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk.state;
      w.x = o.x - 5.2; w.z = o.z + 3.0; w.yaw = 0.4; w.pitch = -0.10;
      return { ok: true, vacBack: inv.vac1.back };
    });
    return seeded;
  };
  out.steps.stage = await stage();

  // ---------- real-path equip ------------------------------------------------
  const lockAndEquip = async () => {
    await page.mouse.click(640, 380);
    await page.waitForTimeout(500);
    // HOLD the belt key ≥230 ms so the wheel opens (a tap only cycles).
    const bindings = await page.evaluate(
      () => window.__fw.preferences?.values?.controls?.bindings || {},
    );
    await page.keyboard.down(bindings.toolBelt || 'f');
    await page.waitForTimeout(450);
    await page.keyboard.up(bindings.toolBelt || 'f');
    await page.waitForTimeout(250);
    const wheel = await page.evaluate(() => {
      const el = document.querySelector('.tool-wheel');
      return el ? {
        visible: getComputedStyle(el).display !== 'none',
        items: [...el.querySelectorAll('.tool-wheel-item')].map((b) => ({
          label: b.querySelector('.tool-wheel-label')?.textContent || '',
          disabled: b.classList.contains('is-disabled'),
        })),
      } : null;
    });
    // Select through the wheel's OWN keyboard surface ("letter, number, or
    // arrows · Enter equips") — the wheel holds focus, and the number path is
    // resolution-independent where a coordinate click is not (the first run
    // at the owner window had the canvas intercept the click point).
    const idx = (wheel?.items || []).findIndex((i) => new RegExp(TOOL, 'i').test(i.label));
    if (wheel?.visible && idx >= 0) {
      await page.keyboard.press(String(idx === 9 ? 0 : idx + 1));
      await page.waitForTimeout(250);
      await page.keyboard.press('Enter').catch(() => {});
    }
    await page.waitForTimeout(600);
    await page.mouse.click(640, 380);
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({
      tool: window.__fw.scene3d.walk.getTool ? window.__fw.scene3d.walk.getTool() : null,
      locked: !!document.pointerLockElement,
    }));
    return { wheel, ...state };
  };

  await inject();
  out.steps.equip = await lockAndEquip();
  if (out.steps.equip.tool !== TOOL) {
    out.ok = false;
    out.fail = `could not equip ${TOOL} through the real path (got ${JSON.stringify(out.steps.equip)})`;
    fs.writeFileSync(path.join(OUT, 'b0.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }

  // ---------- session-shape variants ----------------------------------------
  if (LEG.endsWith('-restore')) {
    // the boot/mutation autosave has landed by now; reload and resume
    await page.waitForTimeout(1500);
    await page.reload();
    await boot.clickThroughMenu(page);
    await waitPlayable();
    await inject();
    out.steps.stageAfterRestore = await stage();
    out.steps.equipAfterRestore = await lockAndEquip();
    if (out.steps.equipAfterRestore.tool !== TOOL) {
      out.ok = false;
      out.fail = 'could not re-equip after restore';
      fs.writeFileSync(path.join(OUT, 'b0.json'), `${JSON.stringify(out, null, 2)}\n`);
      return out;
    }
  }
  if (LEG.endsWith('-beltswap')) {
    const bindings = await page.evaluate(
      () => window.__fw.preferences?.values?.controls?.bindings || {},
    );
    const swapTo = TOOL === 'mop' ? /broom/i : /mop/i;
    for (const target of [swapTo, new RegExp(TOOL, 'i')]) {
      await page.keyboard.down(bindings.toolBelt || 'f');
      await page.waitForTimeout(450);
      await page.keyboard.up(bindings.toolBelt || 'f');
      await page.waitForTimeout(250);
      const items = await page.evaluate(() => {
        const el = document.querySelector('.tool-wheel');
        return el ? [...el.querySelectorAll('.tool-wheel-item')]
          .map((b) => b.querySelector('.tool-wheel-label')?.textContent || '') : [];
      });
      const at = items.findIndex((label) => target.test(label));
      if (at >= 0) {
        await page.keyboard.press(String(at === 9 ? 0 : at + 1));
        await page.waitForTimeout(250);
        await page.keyboard.press('Enter').catch(() => {});
      }
      await page.waitForTimeout(500);
    }
    await page.mouse.click(640, 380);
    await page.waitForTimeout(400);
    out.steps.afterBeltSwap = await page.evaluate(() => ({
      tool: window.__fw.scene3d.walk.getTool ? window.__fw.scene3d.walk.getTool() : null,
    }));
  }

  await page.screenshot({ path: path.join(OUT, '01-equipped-default-pitch.png') });

  // ---------- capture runs ----------------------------------------------------
  const capture = async (label, frames, drive) => {
    const seriesPromise = page.evaluate(
      ({ toolId, n }) => window.__b0.captureRegionDiffs(toolId, n),
      { toolId: TOOL, n: frames },
    );
    await drive();
    const series = await seriesPromise;
    const diffs = series.filter((f) => f.diff !== null && !f.offscreen).map((f) => f.diff);
    const sorted = diffs.slice().sort((a, b) => a - b);
    const stats = diffs.length ? {
      frames: diffs.length,
      offscreenFrames: series.length - diffs.length,
      mean: Math.round(diffs.reduce((a, v) => a + v, 0) / diffs.length),
      p90: sorted[Math.floor(sorted.length * 0.9)],
      max: Math.max(...diffs),
      vmActiveAlways: series.every((f) => f.vmActive !== false),
      geomSources: [...new Set(series.map((f) => f.geomSource).filter(Boolean))],
      camFovs: [...new Set(series.map((f) => f.camFov).filter(Boolean))],
      // two-writers signature summary: drawn x relative to rest.x while the
      // series ran (only meaningful on the working run)
      gxMinusRest: (() => {
        const rel = series.filter((f) => f.gx != null && f.restX != null)
          .map((f) => +(f.gx - f.restX).toFixed(4));
        if (!rel.length) return null;
        return {
          min: Math.min(...rel), max: Math.max(...rel),
          span: +(Math.max(...rel) - Math.min(...rel)).toFixed(4),
        };
      })(),
    } : { frames: 0, offscreenFrames: series.length, note: 'head never on screen at this pitch' };
    out.steps[label] = { stats, sampleEvery6th: series.filter((_, i) => i % 6 === 0) };
    return stats;
  };

  const stillStats = await capture('still', 90, async () => { await page.waitForTimeout(1700); });
  const workStats = await capture('working', 150, async () => {
    await page.mouse.down();
    for (let i = 0; i < 24; i += 1) {
      await page.mouse.move(640 + Math.sin(i * 0.5) * 25, 380, { steps: 2 });
      await page.waitForTimeout(60);
    }
    await page.mouse.up();
  });
  const carryStats = await capture('carryWalk', 150, async () => {
    await page.keyboard.down('w');
    for (let i = 0; i < 22; i += 1) {
      await page.mouse.move(640 + Math.sin(i * 0.4) * 40, 380, { steps: 2 });
      await page.waitForTimeout(60);
    }
    await page.keyboard.up('w');
  });

  if (TOOL === 'mop') {
    out.steps.strandRigToggle = await page.evaluate(() => window.__b0.setStrandRigVisible('mop', false));
    const noStrands = await capture('working-strandsHidden', 120, async () => {
      await page.mouse.down();
      for (let i = 0; i < 18; i += 1) {
        await page.mouse.move(640 + Math.sin(i * 0.5) * 25, 380, { steps: 2 });
        await page.waitForTimeout(60);
      }
      await page.mouse.up();
    });
    await page.evaluate(() => window.__b0.setStrandRigVisible('mop', true));
    out.steps.skirtHiddenMeshes = await page.evaluate(() => window.__b0.setMeshVisible('mop', 'MopSkirt', false));
    const noSkirt = await capture('working-skirtHidden', 120, async () => {
      await page.mouse.down();
      for (let i = 0; i < 18; i += 1) {
        await page.mouse.move(640 + Math.sin(i * 0.5) * 25, 380, { steps: 2 });
        await page.waitForTimeout(60);
      }
      await page.mouse.up();
    });
    await page.evaluate(() => window.__b0.setMeshVisible('mop', 'MopSkirt', true));
    await page.screenshot({ path: path.join(OUT, '02-skirt-restored.png') });
    out.summary = {
      stillP90: stillStats.p90 ?? null,
      workingP90: workStats.p90 ?? null,
      carryP90: carryStats.p90 ?? null,
      strandsHiddenP90: noStrands.p90 ?? null,
      skirtHiddenP90: noSkirt.p90 ?? null,
    };
  }

  // MOP ONLY — the occlusion number: what share of the visible skirt is the
  // MOVING part (procedural strands, painted green) vs the welded authored
  // bundle (MESH_MopSkirt, painted red)? Counted in a real screenshot with
  // the fault-44 flat recipe. This is the number that says whether the
  // player's eye ever RECEIVES the strand motion the scene graph measures.
  if (TOOL === 'mop') {
    const share = await page.evaluate(() => {
      const s3 = window.__fw.scene3d;
      const g = window.__b0.toolGroup('mop');
      if (!g) return 'no group';
      const THREE = null; // colours via helper below
      let strands = 0; let skirt = 0;
      g.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        if (/^MopStrand_/.test(o.name || '')) strands += 1;
        if (/MESH_MopSkirt/i.test(o.name || '')) skirt += 1;
      });
      return { strands, skirt };
    });
    out.steps.strandSkirtMeshes = share;
    const painted = await page.evaluate(() => {
      const s3 = window.__fw.scene3d;
      // reuse the flat machinery but with our own selection
      const g = window.__b0.toolGroup('mop');
      const hands = [];
      window.__b0.__shareSaved = new Map();
      const saved = window.__b0.__shareSaved;
      return import(new URL('vendor/three.module.js', document.baseURI).href).then((THREE) => {
        const r = s3.renderer;
        window.__b0.__shareTone = { tm: r.toneMapping, exp: r.toneMappingExposure };
        r.toneMapping = THREE.NoToneMapping;
        r.toneMappingExposure = 1;
        s3.setPostEnabled?.(false);
        let strands = 0; let skirt = 0;
        g.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          if (/^MopStrand_/.test(o.name || '')) {
            saved.set(o, o.material);
            o.material = new THREE.MeshBasicMaterial({ color: 0x00ff00, fog: false });
            strands += 1;
          } else if (/MESH_MopSkirt/i.test(o.name || '')) {
            saved.set(o, o.material);
            o.material = new THREE.MeshBasicMaterial({ color: 0xff0000, fog: false });
            skirt += 1;
          }
        });
        return { strands, skirt };
      });
    });
    await page.waitForTimeout(160);
    const shareShot = path.join(OUT, 'flat-strand-vs-skirt.png');
    await page.screenshot({ path: shareShot });
    await page.evaluate(() => {
      const s3 = window.__fw.scene3d;
      for (const [mesh, mat] of window.__b0.__shareSaved) { mesh.material.dispose?.(); mesh.material = mat; }
      window.__b0.__shareSaved.clear();
      const t = window.__b0.__shareTone;
      if (t) { s3.renderer.toneMapping = t.tm; s3.renderer.toneMappingExposure = t.exp; }
      s3.setPostEnabled?.(true);
    });
    const { data: sd, info: si } = await sharp(shareShot).raw().toBuffer({ resolveWithObject: true });
    let strandPx = 0; let skirtPx = 0;
    for (let y = 0; y < si.height; y += 2) {
      for (let x = 0; x < si.width; x += 2) {
        const i = (y * si.width + x) * si.channels;
        const r = sd[i]; const gg = sd[i + 1]; const b = sd[i + 2];
        if (gg > 200 && r < 60 && b < 60) strandPx += 1;
        else if (r > 200 && gg < 60 && b < 60) skirtPx += 1;
      }
    }
    out.steps.strandSkirtShare = {
      painted,
      strandPx,
      skirtPx,
      strandShare: strandPx + skirtPx > 0 ? +(strandPx / (strandPx + skirtPx)).toFixed(3) : null,
      shot: 'flat-strand-vs-skirt.png',
    };
  }

  // ---------- flat-paint pixel gap -------------------------------------------
  const blobGap = async (label) => {
    const painted = await page.evaluate((toolId) => window.__b0.flatShot(toolId, true), TOOL);
    await page.waitForTimeout(160);
    const shotPath = path.join(OUT, `flat-${label}.png`);
    await page.screenshot({ path: shotPath });
    await page.evaluate((toolId) => window.__b0.flatShot(toolId, false), TOOL);
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
    return { painted, greenPx: green, redPx: red, minGapPx: minGap, shot: `flat-${label}.png` };
  };

  out.steps.gapRest = await blobGap('rest');
  if (TOOL === 'broom') {
    // world-space discriminator during the same real motion the pixel gap
    // samples: is the hand still ON the socket in world units?
    const worldPromise = page.evaluate(
      ({ toolId, n }) => window.__b0.captureHandSocketWorld(toolId, n),
      { toolId: TOOL, n: 160 },
    );
    await page.keyboard.down('w');
    await page.mouse.move(840, 380, { steps: 6 });
    out.steps.gapWalking = await blobGap('walking');
    await page.mouse.move(440, 380, { steps: 6 });
    out.steps.gapTurning = await blobGap('turning');
    await page.keyboard.up('w');
    const worldSeries = await worldPromise;
    const valid = worldSeries.filter((v) => v !== null);
    out.steps.handSocketWorldYd = valid.length ? {
      min: Math.min(...valid),
      max: Math.max(...valid),
      mean: +(valid.reduce((a, v) => a + v, 0) / valid.length).toFixed(4),
      frames: valid.length,
    } : { note: 'hand or socket not found' };
    // control 1: tone mapping re-enabled over the flat paint must destroy the
    // pure colours (proves the flat mode is load-bearing)
    await page.evaluate((toolId) => { window.__b0.flatShot(toolId, true); window.__b0.retoneOverFlat(); }, TOOL);
    await page.waitForTimeout(150);
    const tmShot = path.join(OUT, 'flat-tonemapped-control.png');
    await page.screenshot({ path: tmShot });
    await page.evaluate((toolId) => window.__b0.flatShot(toolId, false), TOOL);
    const { data: tmd, info: tmi } = await sharp(tmShot).raw().toBuffer({ resolveWithObject: true });
    let tmGreen = 0;
    for (let y = 0; y < tmi.height; y += 3) {
      for (let x = 0; x < tmi.width; x += 3) {
        const i = (y * tmi.width + x) * tmi.channels;
        if (tmd[i + 1] > 200 && tmd[i] < 60 && tmd[i + 2] < 60) tmGreen += 1;
      }
    }
    out.steps.toneMappedControl = { greenPx: tmGreen };
    // control 2: hidden hands count zero green
    await page.evaluate(() => window.__b0.setHandsVisible(false));
    out.steps.gapHandsHidden = await blobGap('hands-hidden-control');
    await page.evaluate(() => window.__b0.setHandsVisible(true));
  }

  // ---------- verdicts ---------------------------------------------------------
  const checks = {
    equipped: true,
    headSeenWorking: (out.steps.working?.stats?.frames ?? 0) > 50,
    noPageErrors: errs.length === 0,
  };
  if (TOOL === 'mop') {
    checks.controlsRan = out.summary
      && out.summary.strandsHiddenP90 != null && out.summary.skirtHiddenP90 != null;
  }
  if (TOOL === 'broom') {
    const restGreen = out.steps.gapRest?.greenPx ?? 0;
    checks.flatModeLoadBearing = (out.steps.toneMappedControl?.greenPx ?? 1e9)
      < Math.max(1, restGreen * 0.2);
    checks.hiddenHandsZeroGreen = (out.steps.gapHandsHidden?.greenPx ?? 1e9) === 0;
  }
  out.checks = checks;
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'b0.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
