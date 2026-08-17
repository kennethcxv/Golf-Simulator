// THE EDITOR VIEWMODEL, MEASURED IN PIXELS — because the scene-graph probe lied.
//
// ownerplay-editor-repro.js reported "no viewmodel visible" while the owner's
// screenshot showed his hand and tool in the bottom third. Post-mortem on the
// instrument: its name regex matched the "rig" inside "DoorRight" (ten false
// positives filled its own 10-entry cap), and its camera-child scan ran before
// anything re-armed the tool. This probe measures what the CAMERA RENDERS:
// every held-tool mesh is painted emissive magenta (toneMapped:false, so
// neither lighting nor ACES can hide it), a REAL screenshot is taken through
// the full pipeline, and sharp counts the magenta. Scene flags are recorded
// only as mechanism evidence, never as the verdict.
//
// Controls (golf-qa law 1), both in walk mode where the tool IS drawn:
//   noise floor — no paint, count must be ~0 (the world contains no magenta)
//   detection   — painted, count must be large (the instrument sees the tool
//                 through composer + GTAO + output pass, or it is void)
//
// Legs:
//   A. F equip -> J. (The old driver's path; measured clean before.)
//   B. F equip -> laptop (tool stows) -> "Open Course Editor" -> confirm.
//      Suspected mechanism: syncStationToolStow's restore branch ticks every
//      frame in every mode and calls walkSetTool(tool) with no walk-active
//      check, re-arming heldRoot AND the rig pass one frame after entry.
//
//   node tools/qa/run-electron.cjs tools/qa/goal32-editor-viewmodel-pixels.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const sharp = (await import('sharp')).default;
  const OUT = path.resolve('qa/goal32');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { tag: process.env.QA_TAG || 'editor-vm-pixels', errs: [], failures: [] };
  const fail = (why) => out.failures.push(why);
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(5000);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(400);

  // ---- the paint: heldRoot found structurally (the camera-child group that
  // contains the stable 'HeldWasher' name), never by regex over the scene ----
  const setPaint = (on) => page.evaluate((paintOn) => {
    const s3 = window.__fw.scene3d;
    const W = window;
    if (!W.__vmPaint) W.__vmPaint = { stash: [] };
    const P = W.__vmPaint;
    const findHeldRoot = () => {
      for (const child of s3.camera.children) {
        let hit = false;
        child.traverse?.((o) => { if (o.name === 'HeldWasher') hit = true; });
        if (hit) return child;
      }
      return null;
    };
    const root = findHeldRoot();
    if (!root) return { ok: false, why: 'heldRoot not found under camera' };
    if (paintOn) {
      let painted = 0;
      root.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const repl = mats.map((orig) => {
          const m = new orig.constructor();
          if (m.emissive) { m.color?.set?.(0x000000); m.emissive.set(0xff00ff); m.emissiveIntensity = 4; }
          else m.color?.set?.(0xff00ff);
          m.toneMapped = false;
          m.fog = false;
          m.transparent = false;
          m.opacity = 1;
          m.side = orig.side;
          return m;
        });
        P.stash.push({ mesh: o, original: o.material });
        o.material = Array.isArray(o.material) ? repl : repl[0];
        painted += 1;
      });
      return { ok: true, painted };
    }
    for (const { mesh, original } of P.stash) mesh.material = original;
    const n = P.stash.length;
    P.stash = [];
    return { ok: true, restored: n };
  }, on);

  const countMagenta = async (label) => {
    const file = path.join(OUT, `${label}.png`);
    const buf = await page.screenshot({ path: file });
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] >= 140 && data[i + 1] <= 100 && data[i + 2] >= 140) n += 1;
    }
    return { label, magenta: n, file };
  };

  const diag = () => page.evaluate(() => ({
    courseMode: window.__fw.courseMode,
    walk: window.__fw.scene3d.walk.diagnostics(),
    held: window.__fw.scene3d.walk.heldToolDiagnostics(),
  }));

  // ---- equip a tool with the real belt key --------------------------------------
  await page.keyboard.press('f');
  await page.waitForTimeout(1500);
  out.tool = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null);
  if (!out.tool) { await page.keyboard.press('f'); await page.waitForTimeout(1500); out.tool = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null); }
  if (!out.tool) fail('no tool equipped after two F presses - cannot exercise the defect');

  // ---- instrument controls, in walk where the tool is legitimately drawn --------
  out.noiseFloor = await countMagenta('00-walk-noise');
  out.paintOnWalk = await setPaint(true);
  await page.waitForTimeout(250);
  out.walkPainted = await countMagenta('01-walk-painted');
  await setPaint(false);
  await page.waitForTimeout(150);
  if (out.noiseFloor.magenta > 80) fail(`noise floor is ${out.noiseFloor.magenta} px - the world already contains magenta, counting is void`);
  if (out.walkPainted.magenta < 1500) fail(`walk control: painted tool shows only ${out.walkPainted.magenta} px - the instrument cannot see the viewmodel, void`);

  // ---- leg A: F -> J --------------------------------------------------------------
  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.courseMode === 'editor', null, { timeout: 15000 });
  await page.waitForTimeout(1800); // give any deferred re-arm its frames
  out.legA = { diag: await diag() };
  out.legA.clean = await countMagenta('02a-legA-editor-clean');
  await setPaint(true);
  await page.waitForTimeout(250);
  out.legA.painted = await countMagenta('02b-legA-editor-painted');
  await setPaint(false);
  await page.waitForTimeout(150);

  // ---- exit the editor through its own Exit button --------------------------------
  const exitClicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Exit\s*$/.test((x.textContent || '').trim()));
    if (!b) return false;
    b.click();
    return true;
  });
  if (!exitClicked) fail('editor Exit button not found in DOM');
  await page.waitForFunction(() => window.__fw.courseMode === 'walk', null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  out.toolAfterExit = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null);
  if (!out.toolAfterExit) {
    await page.mouse.click(vp.w / 2, vp.h / 2);
    await page.keyboard.press('f');
    await page.waitForTimeout(1500);
    out.toolAfterExit = await page.evaluate(() => window.__fw.scene3d.walk.getTool?.() || null);
  }

  // ---- leg B: laptop (stow) -> Open Course Editor -> confirm ----------------------
  await page.evaluate(() => { window.__fw.scene3d.walk.hooks.openLaptop?.(null); });
  await page.waitForFunction(() => document.body.classList.contains('laptop-mode'), null, { timeout: 30000 });
  await page.waitForTimeout(3000); // lid + boot theater + first render
  out.legB = { stowedDiag: await diag() };
  await countMagenta('03-legB-laptop-open');
  const navigated = await page.evaluate(() => {
    const course = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Course');
    if (!course) return { nav: false };
    course.click();
    return { nav: true };
  });
  out.legB.navigated = navigated;
  await page.waitForTimeout(600);
  const opened = await page.evaluate(() => {
    const open = [...document.querySelectorAll('button')].find((x) => /Open Course Editor/i.test(x.textContent || ''));
    if (!open) return { open: false };
    open.click();
    return { open: true };
  });
  out.legB.opened = opened;
  await page.waitForTimeout(500);
  const confirmed = await page.evaluate(() => {
    const yes = [...document.querySelectorAll('button')].find((x) => /Open the editor/i.test(x.textContent || ''));
    if (!yes) return { confirm: false };
    yes.click();
    return { confirm: true };
  });
  out.legB.confirmed = confirmed;
  if (!(navigated.nav && opened.open && confirmed.confirm)) fail(`laptop route incomplete: ${JSON.stringify({ navigated, opened, confirmed })}`);
  await page.waitForFunction(() => window.__fw.courseMode === 'editor', null, { timeout: 15000 });
  await page.waitForTimeout(1800); // the frame(s) in which the stow restore would re-arm
  out.legB.diag = await diag();
  out.legB.clean = await countMagenta('04a-legB-editor-clean');
  await setPaint(true);
  await page.waitForTimeout(250);
  out.legB.painted = await countMagenta('04b-legB-editor-painted');
  await setPaint(false);

  // ---- verdict: pixels decide ------------------------------------------------------
  const DRAWN = 200;
  out.legADrawn = out.legA.painted.magenta > DRAWN;
  out.legBDrawn = out.legB.painted.magenta > DRAWN;
  if (out.legADrawn) fail(`leg A (F->J): held tool IS DRAWN in the editor (${out.legA.painted.magenta} magenta px)`);
  if (out.legBDrawn) fail(`leg B (laptop->editor): held tool IS DRAWN in the editor (${out.legB.painted.magenta} magenta px)`);

  out.verdict = out.failures.length ? 'FAIL' : 'PASS';
  console.log(JSON.stringify({
    tag: out.tag,
    verdict: out.verdict,
    failures: out.failures,
    tool: out.tool,
    controls: { noise: out.noiseFloor.magenta, walkPainted: out.walkPainted.magenta },
    legA: { magenta: out.legA?.painted?.magenta, held: out.legA?.diag?.held },
    legB: { magenta: out.legB?.painted?.magenta, held: out.legB?.diag?.held },
  }, null, 2));
  fs.writeFileSync(path.join(OUT, `${out.tag}.json`), `${JSON.stringify(out, null, 2)}\n`);
  if (out.failures.length) process.exitCode = 1;
  return out;
}
