// OWNER-PLAY EDITOR REPRO — he entered the editor while holding the dust
// cleaner and got: his hand and tool still on screen, then a dead surface
// (cursor moves, nothing responds). Real input: F to equip, J to enter,
// then measured: what rig nodes are chain-visible, whether the editor UI
// exists and where clicks land (elementFromPoint through the golf-qa
// caveat), whether courseMode reacts to input, and every pageerror.
//
//   node tools/qa/run-electron.cjs tools/qa/ownerplay-editor-repro.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/ownerplay/editor');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
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
  await page.waitForTimeout(500);

  // equip a tool HIS way — F is the belt key; try presses until one sticks
  const toolAfter = async () => page.evaluate(() => window.__fw.scene3d?.walk?.getTool?.() || null);
  await page.keyboard.press('f');
  await page.waitForTimeout(1200);
  out.toolAfterF1 = await toolAfter();
  if (!out.toolAfterF1) {
    await page.keyboard.press('f');
    await page.waitForTimeout(1200);
    out.toolAfterF2 = await toolAfter();
  }
  if (!(out.toolAfterF1 || out.toolAfterF2)) {
    // fall back to the immediate setter so the DEFECT (J with a tool held)
    // is still exercised even if the belt needs UI steps this driver skips
    out.equipFallback = await page.evaluate(() => {
      const w = window.__fw.scene3d?.walk;
      const eq = w?.setToolImmediate || w?.setTool;
      if (!eq) return 'no setter';
      eq.call(w, 'spray');
      return 'spray-via-api';
    });
    await page.waitForTimeout(1500);
  }
  out.heldTool = await toolAfter();
  await page.screenshot({ path: path.join(OUT, 'held-before-J.png') });

  // J — his entry
  await page.keyboard.press('j');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, 'editor-entered.png') });

  out.afterJ = await page.evaluate(() => {
    const fw = window.__fw;
    const s3 = fw.scene3d;
    // every chain-visible node under the tool rigs / held root
    const rigVisible = [];
    s3.scene.traverse((o) => {
      if (!o.isMesh) return;
      let n = o;
      let inRig = false;
      const names = [];
      while (n) {
        names.push(n.name || n.type);
        if (/held|rig|viewmodel|vm/i.test(n.name || '')) inRig = true;
        n = n.parent;
      }
      if (!inRig) return;
      let vis = true;
      for (let p = o; p; p = p.parent) { if (!p.visible) { vis = false; break; } }
      if (vis && o.layers.mask !== 0 && rigVisible.length < 10) rigVisible.push(names.slice(0, 3).join('/'));
    });
    // ALSO the camera-child viewmodels (rigs ride the camera)
    let camChildrenVisible = 0;
    s3.camera.traverse((o) => {
      if (!o.isMesh) return;
      let vis = true;
      for (let p = o; p && p !== s3.camera; p = p.parent) { if (!p.visible) { vis = false; break; } }
      if (vis && o.layers.mask !== 0) camChildrenVisible += 1;
    });
    const editorRoot = document.querySelector('.course-editor-root, .editor-root, [data-editor-root], .editor-bar, .editor-ui');
    const pointerLocked = !!document.pointerLockElement;
    return {
      courseMode: fw.courseMode,
      heldToolNow: s3.walk?.getTool?.() || null,
      walkActive: s3.walk?.isActive?.() || false,
      rigVisibleChains: rigVisible,
      camChildMeshesVisible: camChildrenVisible,
      editorUiFound: editorRoot ? (editorRoot.className || editorRoot.tagName) : null,
      pointerLocked,
    };
  });

  // does INPUT work? try: click centre (terrain), click a likely UI spot,
  // move the mouse, then Escape — watch courseMode and DOM for any reaction
  const probe = async (label, fn) => {
    const before = await page.evaluate(() => ({
      mode: window.__fw.courseMode,
      toasts: document.querySelectorAll('.toast').length,
      lock: !!document.pointerLockElement,
    }));
    await fn();
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({
      mode: window.__fw.courseMode,
      toasts: document.querySelectorAll('.toast').length,
      lock: !!document.pointerLockElement,
    }));
    out[label] = { before, after, reacted: JSON.stringify(before) !== JSON.stringify(after) };
  };
  await probe('clickCentre', async () => { await page.mouse.click(vp.w / 2, vp.h / 2); });
  await probe('clickTopBar', async () => { await page.mouse.click(vp.w / 2, 40); });
  await probe('mouseSweep', async () => { await page.mouse.move(vp.w / 2 - 300, vp.h / 2); await page.mouse.move(vp.w / 2 + 300, vp.h / 2, { steps: 10 }); });
  // what actually sits under the cursor at centre (the golf-qa caveat noted)
  out.underCursor = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return el ? `${el.tagName}.${String(el.className).slice(0, 60)}` : null;
  });
  await page.screenshot({ path: path.join(OUT, 'editor-after-input.png') });

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'editor-repro.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
