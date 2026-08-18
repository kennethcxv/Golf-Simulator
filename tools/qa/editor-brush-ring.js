// THE TERRAIN AND PAINT BRUSH RING — IS IT ACTUALLY WHERE HE CAN SEE IT?
//
// "TERRAIN AND PAINT SHOW NO CURSOR AT ALL. I click and I have no idea where
// the edit is landing until after it lands." Those two tools have no ghost
// object to fall back on: the ring is the whole affordance.
//
// The goal-36 driver called this pair PRESENT and ON-SCREEN and it was wrong.
// It projected the ring's centre and checked the frustum. But the editor's tool
// rail is an OPAQUE PANEL over the canvas, and selecting a tool means the mouse
// is ON that panel — so the ray goes through it and hits the ground BEHIND the
// UI. In frustum, and invisible. qa/editor-cursor/fixed1-B02-Terrain.png is that
// frame: one white sliver escaping past the panel's right edge.
//
// So this driver measures OCCLUSION, not projection. It walks the ring's
// circumference, projects every sample, and asks the DOM what is actually on
// top at that pixel. A ring whose visible arc is small is a ring he cannot use.
//
// Steps are exactly his verification list, run twice — once with DOM clicks so
// the physical mouse never moves at all, once with the real mouse on the rail
// the way a player selects a tool:
//
//   select Terrain -> screenshot, mouse untouched
//   select Paint   -> screenshot, mouse untouched
//   change the brush size -> screenshot, and the radius must CHANGE
//
//   node tools/qa/run-electron.cjs \
//     tools/qa/editor-brush-ring.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/editor-brush');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [], failures: [], steps: [] };
  const fail = (why) => { out.failures.push(why); console.log('FAIL:', why); };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);

  out.bootPath = await boot.clickThroughMenu(page, { forceNew: !process.env.QA_RESUME });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  await boot.ownerResolution(page, page.electronApp);
  await page.waitForTimeout(1500);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

  // WHAT THE PLAYER CAN SEE OF THE RING.
  //
  // 64 samples around the circumference. Each is projected by hand through the
  // live camera (no THREE on window) and then handed to elementFromPoint, which
  // is the only thing that knows the tool rail is on top. A sample counts as
  // visible when it is inside the viewport AND the topmost element there is the
  // renderer's own canvas.
  const ring = () => page.evaluate(() => {
    const sc = window.__fw?.scene3d;
    if (!sc?.editorCursorState) return { unavailable: true };
    const st = sc.editorCursorState();
    if (!st.brush) return { ...st, present: false };
    const cam = sc.camera;
    const canvas = sc.renderer.domElement;
    const mul = (m, v) => [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
      m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
    ];
    const rect = canvas.getBoundingClientRect();
    const toPx = (x, z) => {
      const y = sc.heightAt ? sc.heightAt(x, z) : 0;
      const eye = mul(cam.matrixWorldInverse.elements, [x, y, z, 1]);
      const clip = mul(cam.projectionMatrix.elements, eye);
      if (!clip[3] || clip[3] <= 0) return null;
      const nx = clip[0] / clip[3];
      const ny = clip[1] / clip[3];
      const nz = clip[2] / clip[3];
      if (nz < -1 || nz > 1) return null;
      return {
        px: rect.left + ((nx + 1) / 2) * rect.width,
        py: rect.top + ((1 - ny) / 2) * rect.height,
        nx,
        ny,
      };
    };
    const topAt = (px, py) => {
      if (px < 0 || py < 0 || px >= window.innerWidth || py >= window.innerHeight) return 'offscreen';
      const el = document.elementFromPoint(Math.round(px), Math.round(py));
      if (!el) return 'none';
      if (el === canvas || canvas.contains(el)) return 'canvas';
      // name the blocker so a failure says WHICH panel
      for (let p = el; p; p = p.parentElement) {
        if (p.className && typeof p.className === 'string' && /ced-/.test(p.className)) {
          return p.className.split(/\s+/).find((c) => /^ced-/.test(c)) || 'ced';
        }
      }
      return el.tagName.toLowerCase();
    };
    const N = 64;
    const samples = [];
    const blockers = {};
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const p = toPx(st.brush.x + Math.cos(a) * st.brush.radiusYd, st.brush.z + Math.sin(a) * st.brush.radiusYd);
      const who = p ? topAt(p.px, p.py) : 'behind-camera';
      blockers[who] = (blockers[who] || 0) + 1;
      samples.push(who === 'canvas');
    }
    const centre = toPx(st.brush.x, st.brush.z);
    return {
      present: true,
      brush: st.brush,
      centrePx: centre ? { x: Math.round(centre.px), y: Math.round(centre.py) } : null,
      centreTop: centre ? topAt(centre.px, centre.py) : 'behind-camera',
      visibleSamples: samples.filter(Boolean).length,
      totalSamples: N,
      visibleFraction: +(samples.filter(Boolean).length / N).toFixed(3),
      blockers,
      tool: window.__fw?.editorUi?.()?.qa?.tool?.() ?? null,
    };
  });

  // A ring the player can act on has to be MOSTLY on the canvas, not a sliver
  // escaping past a panel edge. Two thirds is generous and still fails the
  // frame that started this.
  const MIN_VISIBLE = 0.66;

  const step = async (name, label) => {
    await page.waitForTimeout(700);
    const r = await ring();
    const shot = `${tag}-${name}.png`;
    await page.screenshot({ path: path.join(OUT, shot) });
    const row = { name, label, shot, ...r };
    out.steps.push(row);
    if (r.unavailable) fail(`${name}: scene.editorCursorState() missing`);
    else if (!r.present) fail(`${name}: NO BRUSH RING AT ALL`);
    else if (r.visibleFraction < MIN_VISIBLE) {
      fail(`${name}: ring only ${Math.round(r.visibleFraction * 100)}% visible — blocked by ${
        Object.entries(r.blockers).filter(([k]) => k !== 'canvas').map(([k, v]) => `${k}x${v}`).join(',')}`);
    }
    console.log(`${name.padEnd(26)} present=${r.present} radius=${r.brush?.radiusYd} `
      + `visible=${r.visibleFraction ?? '-'} centre=${r.centreTop ?? '-'}`);
    return row;
  };

  const clickTool = async (labelRe, withMouse) => {
    if (!withMouse) {
      await page.evaluate((src) => {
        const re = new RegExp(src, 'i');
        [...document.querySelectorAll('.ced-tool')].find((b) => re.test(b.textContent || ''))?.click();
      }, labelRe.source);
      return null;
    }
    const box = await page.evaluate((src) => {
      const re = new RegExp(src, 'i');
      const b = [...document.querySelectorAll('.ced-tool')].find((x) => re.test(x.textContent || ''));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }, labelRe.source);
    if (!box) return null;
    await page.mouse.move(box.x, box.y, { steps: 6 });
    await page.mouse.click(box.x, box.y);
    return box;
  };

  // THE SIZE SLIDER, DRIVEN BY THE REAL MOUSE.
  //
  // Setting .value from script leaves the pointer wherever it was, which is not
  // what changing a brush size is: the mouse has to be ON THE PANEL, over the
  // slider. That is the case this whole goal is about and it has to be the case
  // the driver runs.
  const sliderBox = async () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ced-tool-panel .ced-row')];
    const row = rows.find((r) => /size/i.test(r.querySelector('label')?.textContent || ''));
    const input = row?.querySelector('input[type=range]');
    if (!input) return null;
    const r = input.getBoundingClientRect();
    return {
      left: r.left, right: r.right, y: Math.round(r.top + r.height / 2),
      min: +input.min, max: +input.max,
    };
  });
  const dragSizeTo = async (fraction) => {
    const b = await sliderBox();
    if (!b) return null;
    const x = Math.round(b.left + (b.right - b.left) * fraction);
    await page.mouse.move(x, b.y, { steps: 6 });
    await page.mouse.down();
    await page.mouse.move(x, b.y, { steps: 2 });
    await page.mouse.up();
    return page.evaluate(() => {
      const rows = [...document.querySelectorAll('.ced-tool-panel .ced-row')];
      const row = rows.find((r) => /size/i.test(r.querySelector('label')?.textContent || ''));
      return +(row?.querySelector('input[type=range]')?.value ?? NaN);
    });
  };

  // Somewhere on the chrome that is NOT a control — the tip box. Parking the
  // pointer here is what reading the tool's own hint looks like.
  const parkOnPanel = async () => {
    const b = await page.evaluate(() => {
      const t = document.querySelector('.ced-tip') || document.querySelector('.ced-tool-panel');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (b) await page.mouse.move(b.x, b.y, { steps: 8 });
    return b;
  };

  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw?.courseMode === 'editor'
    && !!document.querySelector('.ced-rail'), null, { timeout: 90000 })
    .catch(() => fail('editor never opened'));
  await page.waitForTimeout(2000);

  // ---- A: not one pointer event ever ---------------------------------------
  await clickTool(/terrain/, false);
  await step('A1-terrain', 'Terrain via DOM click, mouse never moved');
  await clickTool(/paint/, false);
  await step('A2-paint', 'Paint via DOM click, mouse never moved');

  // ---- B: his flow — the mouse goes to the rail and clicks ------------------
  const terrainBox = await clickTool(/terrain/, true);
  out.railBox = terrainBox;
  await step('B1-terrain-from-rail', 'Terrain clicked with the real mouse, pointer left on the rail');
  await clickTool(/paint/, true);
  await step('B2-paint-from-rail', 'Paint clicked with the real mouse, pointer left on the rail');

  // ---- C: the size slider, driven by the real mouse -------------------------
  await clickTool(/terrain/, true);
  out.sizes = [];
  for (const [name, frac] of [['small', 0.02], ['mid', 0.5], ['large', 0.98]]) {
    const applied = await dragSizeTo(frac);
    const row = await step(`C-size-${name}`, `Terrain size dragged to ${name}, pointer on the slider`);
    out.sizes.push({ name, applied, ringRadius: row.brush?.radiusYd ?? null });
  }
  const radii = out.sizes.map((s) => s.ringRadius);
  if (new Set(radii).size !== radii.length) {
    fail(`the ring radius did not track the size slider: ${JSON.stringify(out.sizes)}`);
  }

  // ---- E: the pointer parked on the editor's own chrome ---------------------
  // The rail is drawn OVER the canvas, so a ray through it reaches the ground
  // behind the panel. Whether that ground is in bounds depends on the course
  // seed and the camera — which is why this failure is intermittent in his
  // hands and why the driver must place the pointer deliberately rather than
  // hope. Lower down the panel the ray lands on the fairway every time.
  out.parkedAt = await parkOnPanel();
  await step('E1-parked-on-panel', 'Terrain, pointer parked on the tool panel');

  // ---- D: over the course, where it has always worked -----------------------
  await page.mouse.move(Math.round(vp.w * 0.62), Math.round(vp.h * 0.55), { steps: 10 });
  await step('D1-over-course', 'Terrain, pointer out on the fairway');

  out.summary = {
    steps: out.steps.length,
    absent: out.steps.filter((s) => !s.present).map((s) => s.name),
    occluded: out.steps.filter((s) => s.present && s.visibleFraction < MIN_VISIBLE)
      .map((s) => `${s.name}@${Math.round(s.visibleFraction * 100)}%`),
    radii,
  };
  fs.writeFileSync(path.join(OUT, `${tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log('\n== brush ring ==');
  console.log(JSON.stringify(out.summary, null, 2));
  console.log(`failures ${out.failures.length} · evidence qa/editor-brush/${tag}.json`);
}
