// EDITOR RESPONSIVENESS, MEASURED ON REAL AXES — the first repro judged
// "dead" on {courseMode, toasts, pointerlock}, none of which a working
// editor click changes (selecting a tree changes NONE of them). This one
// reads the editor's own reaction channels: the rig camera state for
// right-drag and wheel, the DOM for tool-button clicks, and it enters the
// editor THE OWNER'S WAY — J pressed while the spray is mid-use with the
// button held down.
//
//   node tools/qa/run-electron.cjs tools/qa/ownerplay-editor-repro2.js --clubhouse=pine-hills-v2
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

  // HIS shape: spray in hand, actively using it when J lands
  out.equip = await page.evaluate(() => {
    const w = window.__fw.scene3d?.walk;
    const eq = w?.setToolImmediate || w?.setTool;
    if (!eq) return 'no setter';
    eq.call(w, 'spray');
    return 'spray';
  });
  await page.waitForTimeout(1500);
  await page.mouse.down();           // spraying...
  await page.waitForTimeout(600);
  await page.keyboard.press('j');    // ...and J mid-use
  await page.waitForTimeout(1200);
  await page.mouse.up();             // released after the transition, like a startled hand
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'editor-midspray-entered.png') });

  out.stateAfterJ = await page.evaluate(() => {
    const fw = window.__fw;
    const s3 = fw.scene3d;
    let camVisible = 0;
    s3.camera.traverse((o) => {
      if (!o.isMesh) return;
      let vis = true;
      for (let p = o; p && p !== s3.camera; p = p.parent) { if (!p.visible) { vis = false; break; } }
      if (vis && o.layers.mask !== 0) camVisible += 1;
    });
    return {
      courseMode: fw.courseMode,
      heldTool: s3.walk?.getTool?.() || null,
      camChildMeshesVisible: camVisible,
      pointerLocked: !!document.pointerLockElement,
      rig: { yaw: +s3.rig.yaw.toFixed(3), pitch: +s3.rig.pitch.toFixed(3), dist: +s3.rig.dist.toFixed(1) },
    };
  });

  const rig = () => page.evaluate(() => {
    const r = window.__fw.scene3d.rig;
    return { yaw: +r.yaw.toFixed(3), pitch: +r.pitch.toFixed(3), dist: +r.dist.toFixed(1) };
  });

  // RIGHT-DRAG must rotate the editor camera
  const r0 = await rig();
  await page.mouse.move(vp.w / 2, vp.h / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(vp.w / 2 + 420, vp.h / 2 + 120, { steps: 12 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);
  const r1 = await rig();
  out.rightDrag = { before: r0, after: r1, reacted: r0.yaw !== r1.yaw || r0.pitch !== r1.pitch };

  // WHEEL must zoom
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(500);
  const r2 = await rig();
  out.wheel = { before: r1, after: r2, reacted: r1.dist !== r2.dist };

  // a TOOL BUTTON click must switch the tool panel (DOM reaction)
  const paint = page.locator('button', { hasText: 'Paint' }).first();
  const paintVisible = await paint.isVisible({ timeout: 1500 }).catch(() => false);
  if (paintVisible) {
    await paint.click();
    await page.waitForTimeout(600);
    out.toolButton = await page.evaluate(() => {
      const active = document.querySelector('.ced-tool-active, [data-tool].active, button[aria-pressed="true"]');
      const panelText = [...document.querySelectorAll('h3, h4, .ced-section-title, legend')].map((h) => h.textContent).join('|').slice(0, 120);
      return { activeButton: active ? active.textContent.trim().slice(0, 20) : null, panelText };
    });
  } else {
    out.toolButton = 'Paint button not found';
  }

  // LEFT-CLICK the terrain with Select: does ANY selection/panel state change
  await page.screenshot({ path: path.join(OUT, 'editor-after-inputs.png') });

  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'editor-repro2.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
