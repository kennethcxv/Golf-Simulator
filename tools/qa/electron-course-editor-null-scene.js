// PLAYTEST 5, P0 — WHY THE COURSE EDITOR CANNOT BE CLICKED.
//
// The owner's own crash.log (%APPDATA%/GOLF EMPIRE/logs/crash.log, session
// 2026-08-15T07:11:54Z, the FIRST fault of his playtest session) says:
//
//   TypeError: Cannot read properties of null (reading 'setEditorBrush')
//       at updateHoverVisuals (src/ui/courseEditor.js:3288)
//   TypeError: Cannot read properties of null (reading 'renderer')
//       at onPointerDown (src/ui/courseEditor.js:2925)
//
// `scene()` is `() => app.scene3d`. Both handlers dereference it unguarded, so
// app.scene3d was NULL while the editor was still `active` and still receiving
// window-level capture-phase pointer events. A pointerdown that throws on its
// first line cannot click anything, which is the report verbatim.
//
// app.scene3d is only ever null between destroyCurrentScene() and
// startGameNow(). HYPOTHESIS UNDER TEST: exitToMenu() tears the scene down and
// never calls exitEditor(), so quitting to the menu from inside the editor
// leaves the editor active with live listeners over a dead scene.
//
// This driver counts UNCAUGHT ERRORS, which is the instrument the first pass
// lacked -- it measured frame time and found the editor healthy while the real
// fault was throwing every frame without moving the frame clock at all.
//
// NEGATIVE CONTROL: the error tap is proved by throwing one deliberate error
// from a rAF callback and requiring the tap to report exactly it. A tap that
// counts zero through a planted throw would report a healthy editor forever.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-course-editor-null-scene.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/course-editor-null-scene');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { steps: [] };

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  // -------------------------------------------------------------- the error tap
  await page.evaluate(() => {
    const tap = { errors: [] };
    window.__errTap = tap;
    window.addEventListener('error', (e) => {
      tap.errors.push({
        msg: String(e.message || '').slice(0, 160),
        at: `${String(e.filename || '').split('/').pop()}:${e.lineno}`,
      });
    });
    tap.reset = () => { tap.errors = []; };
    tap.summary = () => {
      const byMsg = Object.create(null);
      for (const e of tap.errors) {
        const k = `${e.msg} @ ${e.at}`;
        byMsg[k] = (byMsg[k] || 0) + 1;
      }
      return { total: tap.errors.length, byMsg };
    };
  });

  // ------------------------------------------------------- NEGATIVE CONTROL
  await page.evaluate(() => new Promise((resolve) => {
    window.__errTap.reset();
    requestAnimationFrame(() => { throw new Error('QA-PLANTED-CONTROL-THROW'); });
    setTimeout(resolve, 300);
  }));
  out.control = await page.evaluate(() => window.__errTap.summary());
  out.controlSaw = JSON.stringify(out.control.byMsg).includes('QA-PLANTED-CONTROL-THROW');
  console.log(`CONTROL planted throw -> tap saw ${out.control.total} error(s): `
    + `${out.controlSaw ? 'DETECTED — tap works' : 'MISSED — TAP IS BLIND'}`);

  const canvas = await page.$('canvas');
  const box = await canvas.boundingBox();
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);

  const wiggleAndClick = async (label) => {
    await page.evaluate(() => window.__errTap.reset());
    const t0 = Date.now();
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.move(cx - 160 + i * 26, cy - 60 + Math.round(Math.sin(i / 2) * 40));
      await page.waitForTimeout(40);
    }
    await page.mouse.click(cx, cy + 30);
    await page.waitForTimeout(700);
    const summary = await page.evaluate(() => window.__errTap.summary());
    const step = { label, wallMs: Date.now() - t0, ...summary };
    out.steps.push(step);
    console.log(`\n[${label}] ${summary.total} uncaught error(s) from 12 moves + 1 click`);
    for (const [k, n] of Object.entries(summary.byMsg)) console.log(`    x${n}  ${k}`);
    return step;
  };

  // ------------------------------------------------- A: editor, healthy scene
  await page.keyboard.press('KeyJ');
  await page.waitForFunction(() => window.__fw?.courseMode === 'editor', null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, '01-editor-healthy.png') });
  await wiggleAndClick('A: editor with a live scene');

  // ------------------------- B: quit to menu FROM the editor, then use the mouse
  out.beforeQuit = await page.evaluate(() => ({
    screen: window.__fw.screen, courseMode: window.__fw.courseMode, scene3d: !!window.__fw.scene3d,
  }));
  // The player's own route out: P opens the shared pause shell, which carries
  // the quit. Fall back to the app's exitToMenu if the shell's button moved.
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '02-pause-over-editor.png') });
  const clickByText = (re) => page.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    const btns = Array.from(document.querySelectorAll('button, .btn, [role=button]'));
    const hit = btns.filter((b) => b.offsetParent !== null).find((b) => rx.test((b.textContent || '').trim()));
    if (!hit) {
      return { found: false, choices: btns.filter((b) => b.offsetParent !== null).map((b) => (b.textContent || '').trim().slice(0, 40)) };
    }
    hit.click();
    return { found: true, text: (hit.textContent || '').trim().slice(0, 48) };
  }, re);
  out.quitButton = await clickByText('Return to main menu');
  console.log(`\n"Return to main menu" -> ${JSON.stringify(out.quitButton)}`);
  await page.waitForTimeout(1200);
  out.confirmButton = await clickByText('^Save and return$');
  console.log(`"Save and return"      -> ${JSON.stringify(out.confirmButton)}`);
  await page.waitForTimeout(3000);

  out.afterQuit = await page.evaluate(() => ({
    screen: window.__fw.screen,
    courseMode: window.__fw.courseMode,
    scene3dIsNull: window.__fw.scene3d === null,
    // THE CLAIM: the editor was never told the scene died. `.ced-root` is the
    // editor's own root element and its display is the only thing hide() moves.
    editorRootVisible: (() => {
      const root = document.querySelector('.ced-root');
      return root ? getComputedStyle(root).display !== 'none' : null;
    })(),
  }));
  console.log('AFTER QUIT', JSON.stringify(out.afterQuit));
  await page.screenshot({ path: path.join(OUT, '03-after-quit-to-menu.png') });

  await wiggleAndClick('B: menu, after quitting FROM the editor');

  fs.writeFileSync(path.join(OUT, 'result.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${path.join(OUT, 'result.json')}`);
  return out;
}
