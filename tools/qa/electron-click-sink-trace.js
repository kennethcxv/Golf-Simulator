// 1.4 diagnosis — A MOUSE CLICK ACTIVATES THE CONTROL AND MAKES NO SOUND.
//
// The inventory measured every enabled menu control at 0 sound events on a real
// mouse click and 1 on keyboard Enter, while the controls plainly worked (the
// settings tabs advanced through Audio, Camera, Controls, Display, Language,
// Accessibility as they were clicked). Two paths, two answers, which is shape 1 --
// the same decision made in two places, with the check having measured the one
// that works.
//
// Rather than reason further about which listener should fire, this counts each
// hop of the chain during ONE real press:
//
//   pointerdown seen at the document (capture)   -- did the event happen at all?
//   pointerdown seen on the button itself        -- did it reach the factory hook?
//   __fwUiClick invoked                          -- did the sink get called?
//   audio.ready at that moment                   -- did the sink bail on the guard?
//   uiTick invoked                               -- did the cue get as far as audio?
//   buffer started                               -- did anything reach the speakers?
//
// The first hop that reads zero is the answer, and no step is inferred from the
// step before it.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-click-sink-trace.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/click-sink-trace');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.waitForFunction(() => !!document.querySelector('.menu-screen button'), null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  const wake = await page.$('.menu-screen button:not([disabled])');
  if (wake) await wake.click();
  await page.waitForTimeout(1800);

  out.trace = await page.evaluate(() => {
    const a = window.__fw?.audio;
    const ctx = a?.qaContext?.();
    window.__cs = {
      docPointerDown: 0, btnPointerDown: 0, sinkCalls: 0, uiTickCalls: 0, buffers: 0,
      readyAtSink: null, sinkExists: typeof window.__fwUiClick === 'function',
      lastTargetTag: null, lastClosestButton: null, hadClickCue: null,
    };
    document.addEventListener('pointerdown', (e) => {
      window.__cs.docPointerDown += 1;
      const t = e.target;
      window.__cs.lastTargetTag = t?.tagName || null;
      const btn = t?.closest ? t.closest('button') : null;
      window.__cs.lastClosestButton = btn ? (btn.textContent || '').trim().slice(0, 30) : null;
      window.__cs.hadClickCue = btn ? !!btn.__fwClickCue : null;
    }, true);
    // wrap the sink
    const realSink = window.__fwUiClick;
    if (typeof realSink === 'function') {
      window.__fwUiClick = (node) => {
        window.__cs.sinkCalls += 1;
        window.__cs.readyAtSink = !!a?.ready;
        return realSink(node);
      };
    }
    // wrap uiTick on the audio surface
    if (a && typeof a.uiTick === 'function') {
      const realTick = a.uiTick.bind(a);
      a.uiTick = (...args) => { window.__cs.uiTickCalls += 1; return realTick(...args); };
    }
    if (ctx && !ctx.__csSpied) {
      const mk = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = () => {
        const n = mk();
        const s = n.start.bind(n);
        n.start = (...args) => { window.__cs.buffers += 1; return s(...args); };
        return n;
      };
      ctx.__csSpied = true;
    }
    return { installed: true, sinkExists: window.__cs.sinkExists };
  });
  console.log('INSTALLED', JSON.stringify(out.trace));

  // Attach a listener to ONE real button so "did it reach the factory hook" is
  // answered on the same node the click lands on.
  const target = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.menu-screen button')].find((n) => !n.disabled);
    if (!b) return null;
    b.addEventListener('pointerdown', () => { window.__cs.btnPointerDown += 1; }, true);
    const r = b.getBoundingClientRect();
    return {
      label: (b.textContent || '').trim().slice(0, 40),
      hasClickCue: !!b.__fwClickCue,
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
    };
  });
  console.log('TARGET', JSON.stringify(target));
  if (!target) { console.log('ABORTED: no enabled menu button'); return out; }

  await page.evaluate(() => {
    Object.assign(window.__cs, { docPointerDown: 0, btnPointerDown: 0, sinkCalls: 0, uiTickCalls: 0, buffers: 0 });
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(500);
  out.afterMouse = await page.evaluate(() => ({ ...window.__cs }));
  console.log('AFTER-MOUSE', JSON.stringify(out.afterMouse));

  fs.writeFileSync(path.join(OUT, 'click-sink-trace.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
