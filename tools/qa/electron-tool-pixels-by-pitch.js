// PLAYTEST 5, ITEM 6 — HOW MANY PIXELS OF THE HELD TOOL REACH THE SCREENSHOT.
//
// The question "an equipped tool appears in zero frames" has now defeated two
// weaker instruments, and both failures are worth carrying:
//
//   * a SCENE-GRAPH check says visible/present/counted and cannot tell you
//     whether anything was drawn;
//   * a PROJECTION check (corners of the bounding box inside the frustum) said
//     "in frame at every pitch from +0.2 to -1.3", and its own control — the same
//     measurement with no tool equipped — ALSO said "in frame", because the
//     retired group is still in the scene with a box to project. A metric whose
//     control cannot fail is measuring nothing.
//
// So this counts PIXELS, using the recipe this repo already worked out for the
// hands (tools/qa/electron-hand-pixels.js): paint the tool's meshes flat magenta,
// neutralise ACES and the composer for that frame so the colour survives, take a
// real screenshot, and count. Then "the tool is in the picture" is a number.
//
// THE CONTROL IS THE POINT: the same sweep runs with NO tool equipped and must
// count ~zero at every pitch. If it does not, nothing below means anything.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-tool-pixels-by-pitch.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const sharp = (await import('sharp')).default;
  const OUT = path.resolve('qa/electron/tool-pixels');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], rows: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(3000);

  await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const s3 = window.__fw.scene3d;
    let painted = [];
    let savedTone = null;

    // Everything DRAWN under the held-tool root for the current tool, ancestors
    // checked: a visible mesh under a hidden parent draws nothing, and counting
    // it would inflate the answer in exactly the case being investigated.
    window.__toolMeshes = (tool) => {
      let group = null;
      s3.scene.traverse((o) => { if (!group && o.name === `Tool_${tool}`) group = o; });
      if (!group) return [];
      const list = [];
      group.traverse((o) => {
        if (!(o.isMesh || o.isInstancedMesh) || !o.material || Array.isArray(o.material)) return;
        let vis = o.visible;
        for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
        if (vis && o.layers.mask !== 0) list.push(o);
      });
      return list;
    };

    window.__flatShotMode = (on) => {
      const r = s3.renderer;
      if (on) {
        savedTone = { tm: r.toneMapping, exp: r.toneMappingExposure };
        r.toneMapping = THREE.NoToneMapping;
        r.toneMappingExposure = 1;
        s3.setPostEnabled?.(false);
      } else if (savedTone) {
        r.toneMapping = savedTone.tm;
        r.toneMappingExposure = savedTone.exp;
        savedTone = null;
        s3.setPostEnabled?.(true);
      }
      s3.scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
    };

    window.__paintTool = (tool, on) => {
      if (!on) {
        painted.forEach(({ mesh, mat }) => { mesh.material = mat; });
        painted = [];
        return 0;
      }
      const meshes = window.__toolMeshes(tool);
      const paint = new THREE.MeshBasicMaterial({ color: 0xff00ff, fog: false });
      painted = meshes.map((mesh) => { const mat = mesh.material; mesh.material = paint; return { mesh, mat }; });
      return meshes.length;
    };
  });

  const countMagenta = async (png) => {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    let n = 0;
    for (let i = 0; i < data.length; i += ch) {
      if (Math.abs(data[i] - 255) < 30 && Math.abs(data[i + 1] - 0) < 30 && Math.abs(data[i + 2] - 255) < 30) n += 1;
    }
    return n;
  };

  const setPose = (dx, dz, yaw, pitch) => page.evaluate(([a, b, c, d]) => {
    const app = window.__fw;
    const w = app.scene3d.walk;
    const o = app.scene3d.clubhouse().interior.position;
    w.state.x = o.x + a; w.state.z = o.z + b;
    w.state.yaw = c; w.state.pitch = d;
    w.state.vx = 0; w.state.vz = 0;
  }, [dx, dz, yaw, pitch]);

  // setTool is DEBOUNCED and runs a holster first, so it does not take effect on
  // the calling frame. Waited on rather than slept through: the previous run
  // asked for the broom, moved on after 3.5 s, and measured the mop.
  const equip = async (tool) => {
    await page.evaluate((t) => { window.__fw.scene3d.walk.setTool(t); }, tool);
    if (tool === null) { await page.waitForTimeout(2500); return true; }
    return page.waitForFunction(
      (t) => window.__fw.scene3d.walk.getTool?.() === t && window.__toolMeshes(t).length > 0,
      tool, { timeout: 30000 },
    ).then(() => true).catch(() => false);
  };

  const PITCHES = [0.05, -0.15, -0.3, -0.45, -0.62, -0.8, -1.0, -1.1];
  const measure = async (tool, label) => {
    for (const pitch of PITCHES) {
      // eslint-disable-next-line no-await-in-loop
      await setPose(-5.6, 4.4, -Math.PI / 2, pitch);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(600);
      // RE-ASSERT BEFORE EVERY SAMPLE. The first version of this sweep read 25
      // drawable meshes at the first pitch and ZERO at all seven after it, and
      // concluded the tool leaves frame below -0.15. It does not: the deferred
      // GPU warm-up in main.js had taken the tool out of the player's hands
      // (`walk.tool` is not a function, so its "is anything held?" test is always
      // false and its branch always runs). Every later sample measured an empty
      // hand, and the pitch curve was a fiction.
      if (tool) {
        // eslint-disable-next-line no-await-in-loop
        const held = await page.evaluate((t) => window.__fw.scene3d.walk.getTool?.() === t, tool);
        if (!held) {
          // eslint-disable-next-line no-await-in-loop
          await page.evaluate((t) => { window.__fw.scene3d.walk.setTool(t); }, tool);
          // eslint-disable-next-line no-await-in-loop
          await page.waitForFunction((t) => window.__fw.scene3d.walk.getTool?.() === t
            && window.__toolMeshes(t).length > 0, tool, { timeout: 30000 }).catch(() => {});
        }
      }
      // eslint-disable-next-line no-await-in-loop
      const painted = tool ? await page.evaluate((t) => window.__paintTool(t, true), tool) : 0;
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(() => window.__flatShotMode(true));
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(260);
      const file = path.join(OUT, `${label}-pitch${String(pitch).replace('.', 'p').replace('-', 'm')}.png`);
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({ path: file });
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(() => window.__flatShotMode(false));
      // eslint-disable-next-line no-await-in-loop
      if (tool) await page.evaluate((t) => window.__paintTool(t, false), tool);
      // eslint-disable-next-line no-await-in-loop
      const px = await countMagenta(file);
      out.rows.push({ label, pitch, paintedMeshes: painted, magentaPixels: px });
      console.log('PX', label.padEnd(12), String(pitch).padStart(6), 'meshes', String(painted).padStart(3), 'pixels', px);
    }
  };

  out.equippedMop = await equip('mop');
  await measure('mop', 'mop');

  // ---- THE CONTROL: no tool. Every pitch must count ~zero. ----------------
  await equip(null);
  await measure(null, 'control-none');

  const mopRows = out.rows.filter((r) => r.label === 'mop');
  const ctrlRows = out.rows.filter((r) => r.label === 'control-none');
  const best = mopRows.slice().sort((a, b) => b.magentaPixels - a.magentaPixels)[0] || null;
  out.verdict = {
    equipConfirmed: out.equippedMop,
    pitchesWhereToolIsDrawn: mopRows.filter((r) => r.magentaPixels > 500).map((r) => r.pitch),
    pitchesWhereToolIsInVISIBLE: mopRows.filter((r) => r.magentaPixels <= 500).map((r) => r.pitch),
    bestPitch: best?.pitch ?? null,
    bestPixels: best?.magentaPixels ?? null,
    controlMaxPixels: Math.max(0, ...ctrlRows.map((r) => r.magentaPixels)),
    controlIsClean: ctrlRows.every((r) => r.magentaPixels < 200),
    pageErrors: out.errs.slice(0, 6),
  };
  console.log('TOOL-PIXELS', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'tool-pixels.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
