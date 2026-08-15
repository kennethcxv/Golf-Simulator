// PLAYTEST 5, P0 — THE EDITOR MUST SURVIVE THE SCENE BEING SWAPPED UNDER IT.
//
// The owner's crash.log for the 2026-08-15 playtest session opens with:
//   TypeError: Cannot read properties of null (reading 'setEditorBrush')
//       at updateHoverVisuals (src/ui/courseEditor.js:3288)
//   TypeError: Cannot read properties of null (reading 'renderer')
//       at onPointerDown (src/ui/courseEditor.js:2925)
// `scene()` is `() => app.scene3d`, which is null only between
// destroyCurrentScene() and startGameNow(). A pointerdown that throws on its
// first line cannot reach an editor verb: "I cannot click anything."
//
// THE PLAYER ROUTE, no staging: open the editor with J, open the shared pause
// shell with P (the editor lets P through on purpose), Save game to slot 1,
// then Load game from slot 1. Loading is what tears the course down, and both
// controls are on the shell the editor itself opens. Then move the mouse and
// click DURING the swap and count uncaught errors.
//
// WATCHED FAIL: run against the unfixed build first. Step C must report a
// non-zero error count with the two signatures above. A check born green would
// prove nothing.
//
// NEGATIVE CONTROL: the error tap is proved by one deliberate throw from a rAF
// callback, which it must report. Reported alongside every run.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-editor-survives-scene-swap.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/editor-scene-swap');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, steps: [] };

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  await page.evaluate(() => {
    const tap = { errors: [] };
    window.__errTap = tap;
    window.addEventListener('error', (e) => tap.errors.push({
      msg: String(e.message || '').slice(0, 150),
      at: `${String(e.filename || '').split('/').pop()}:${e.lineno}`,
    }));
    tap.reset = () => { tap.errors = []; };
    tap.summary = () => {
      const by = Object.create(null);
      for (const e of tap.errors) {
        const k = `${e.msg} @ ${e.at}`;
        by[k] = (by[k] || 0) + 1;
      }
      return { total: tap.errors.length, byMsg: by };
    };
  });

  // ------------------------------------------------------- NEGATIVE CONTROL
  await page.evaluate(() => new Promise((r) => {
    window.__errTap.reset();
    requestAnimationFrame(() => { throw new Error('QA-PLANTED-CONTROL-THROW'); });
    setTimeout(r, 300);
  }));
  out.control = await page.evaluate(() => window.__errTap.summary());
  out.controlSaw = JSON.stringify(out.control.byMsg).includes('QA-PLANTED-CONTROL-THROW');
  console.log(`CONTROL planted throw -> ${out.control.total} caught: `
    + `${out.controlSaw ? 'DETECTED — tap works' : 'MISSED — TAP IS BLIND'}`);

  const clickText = async (label, src, { required = true } = {}) => {
    const res = await page.evaluate((s) => {
      const rx = new RegExp(s, 'i');
      const nodes = Array.from(document.querySelectorAll('button, .btn, [role=button], .pause-nav-item, .save-slot-card'));
      const vis = nodes.filter((n) => n.offsetParent !== null);
      const hit = vis.find((n) => rx.test((n.textContent || '').trim()));
      if (!hit) return { found: false, choices: vis.map((n) => (n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 46)) };
      hit.click();
      return { found: true, text: (hit.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 46) };
    }, src);
    console.log(`  ${res.found ? 'click' : 'MISS '} ${label}: ${res.found ? JSON.stringify(res.text) : JSON.stringify(res.choices)}`);
    if (!res.found && required) out.steps.push({ label: `MISSING CONTROL: ${label}`, choices: res.choices });
    await page.waitForTimeout(700);
    return res.found;
  };

  const canvas = await page.$('canvas');
  const b = await canvas.boundingBox();
  const cx = Math.round(b.x + b.width / 2);
  const cy = Math.round(b.y + b.height / 2);

  const wiggleAndClick = async (label, ms = 1400) => {
    await page.evaluate(() => window.__errTap.reset());
    const deadline = Date.now() + ms;
    let i = 0;
    while (Date.now() < deadline) {
      await page.mouse.move(cx - 150 + (i % 12) * 25, cy - 50 + Math.round(Math.sin(i / 2) * 35));
      if (i % 4 === 3) await page.mouse.click(cx, cy + 20);
      i += 1;
      await page.waitForTimeout(35);
    }
    const s = await page.evaluate(() => window.__errTap.summary());
    const step = { label, moves: i, ...s };
    out.steps.push(step);
    console.log(`\n[${label}] ${s.total} uncaught error(s) over ${i} pointer events`);
    for (const [k, n] of Object.entries(s.byMsg)) console.log(`    x${n}  ${k}`);
    return step;
  };

  // -------------------------------------------------- A: editor, live scene
  await page.keyboard.press('KeyJ');
  await page.waitForFunction(() => window.__fw?.courseMode === 'editor', null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, `${tag}-01-editor.png`) });
  await wiggleAndClick('A: editor, live scene');

  // ------------------------------- B: save to slot 1 through the pause shell
  console.log('\nPause shell -> Save game -> slot 1');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(1000);
  await clickText('nav "Save game"', 'Save game');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `${tag}-02-save-panel.png`) });
  await clickText('slot 1 save action', 'Save to this slot|Save here|Save slot|^Save$', { required: false });
  await page.waitForTimeout(900);
  await clickText('confirm replace', 'Replace and save', { required: false });
  await page.waitForTimeout(1800);
  out.savedSlot1 = await page.evaluate(async () => {
    try { return !!(await window.fairwayNative?.readSave?.('slot1')); } catch { return 'unknown'; }
  });
  console.log(`  slot1 present after save: ${out.savedSlot1}`);

  // -------------------- C: load slot 1 — this is what nulls app.scene3d ----
  console.log('\nPause shell -> Load game -> slot 1 -> confirm');
  await clickText('nav "Load game"', 'Load game');
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, `${tag}-03-load-panel.png`) });
  await clickText('slot 1 load action', 'Load this slot|Load here|^Load$', { required: false });
  await page.waitForTimeout(900);

  out.beforeSwap = await page.evaluate(() => ({
    courseMode: window.__fw.courseMode,
    editorRootVisible: (() => {
      const r = document.querySelector('.ced-root');
      return r ? getComputedStyle(r).display !== 'none' : null;
    })(),
  }));
  console.log(`  before the swap: ${JSON.stringify(out.beforeSwap)}`);

  // Confirm, then IMMEDIATELY start using the mouse -- the null window opens on
  // the confirm and closes when the next course finishes building.
  const confirmed = await clickText('confirm "Load game"', '^Load game$', { required: false })
    || await clickText('confirm (fallback)', 'Load game');
  out.confirmedLoad = confirmed;
  const swapStep = await wiggleAndClick('C: DURING the scene swap', 4000);
  await page.screenshot({ path: path.join(OUT, `${tag}-04-during-swap.png`) });

  out.afterSwap = await page.evaluate(() => ({
    scene3dIsNull: window.__fw.scene3d === null,
    courseMode: window.__fw.courseMode,
    screen: window.__fw.screen,
    editorRootVisible: (() => {
      const r = document.querySelector('.ced-root');
      return r ? getComputedStyle(r).display !== 'none' : null;
    })(),
  }));
  console.log(`\nAFTER SWAP ${JSON.stringify(out.afterSwap)}`);

  // ------------------------------------------------------------- the verdict
  const nullSceneThrows = Object.entries(swapStep.byMsg)
    .filter(([k]) => /courseEditor\.js/.test(k) || /setEditorBrush|reading 'renderer'/.test(k));
  out.verdict = {
    duringSwapErrors: swapStep.total,
    editorNullSceneThrows: nullSceneThrows.reduce((n, [, c]) => n + c, 0),
    signatures: nullSceneThrows.map(([k, c]) => `x${c} ${k}`),
    // The editor must not still be painted over the game it no longer draws.
    editorLeftOnScreen: out.afterSwap.editorRootVisible === true,
    pass: swapStep.total === 0 && out.afterSwap.editorRootVisible !== true,
  };
  console.log(`\nVERDICT: ${out.verdict.pass ? 'PASS' : 'FAIL'}  `
    + `(${out.verdict.duringSwapErrors} errors during swap, `
    + `editor left on screen: ${out.verdict.editorLeftOnScreen})`);
  for (const s of out.verdict.signatures) console.log(`   ${s}`);

  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${path.join(OUT, `${tag}-result.json`)}`);
  return out;
}
