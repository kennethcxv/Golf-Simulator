// 1.4 diagnosis, second pass — DOES THE MENU'S OWN PRESS HANDLER RUN?
//
// Established so far: menu buttons activate on click and produce no sound; the
// same buttons produce a uiTick on keyboard Enter; and clicking by element handle
// rather than by coordinate did not change it, so the earlier devicePixelRatio
// theory is dead. menu.js attaches `pressSound` to the document in the capture
// phase at construction, so on paper it should run.
//
// This asks the three questions that remain, on ONE real element-handle press,
// and reports the target the handler actually received rather than the one the
// geometry suggests:
//
//   does a pointerdown reach the document capture phase, and on what target
//   is window.__fw.audio the SAME OBJECT the menu closed over (shape 1: two
//     populations -- a second makeAudio() would have its own AudioContext and
//     every event would land in a graph this probe is not watching)
//   do uiTick/uiConfirm get called, and does a buffer start
//
//   node tools/qa/run-electron.cjs tools/qa/electron-menu-press-trace.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/menu-press-trace');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.waitForFunction(() => !!document.querySelector('.menu-screen button'), null, { timeout: 180000 });
  await page.waitForTimeout(2000);

  out.before = await page.evaluate(() => {
    const a = window.__fw?.audio;
    return {
      hasFwAudio: !!a,
      ready: !!a?.ready,
      hasCtx: !!a?.qaContext?.(),
      ctxState: a?.qaContext?.()?.state ?? null,
      bank: a?.qaSampleBankDiagnostics?.()?.loaded ?? null,
    };
  });
  console.log('BEFORE', JSON.stringify(out.before));

  await page.evaluate(() => {
    const a = window.__fw?.audio;
    window.__mp = {
      docPointerDown: 0, targets: [], uiTick: 0, uiConfirm: 0, buffers: 0, oscs: 0,
      ctxStateAtPress: null, readyAtPress: null,
    };
    document.addEventListener('pointerdown', (e) => {
      window.__mp.docPointerDown += 1;
      const t = e.target;
      const btn = t?.closest ? t.closest('button') : null;
      window.__mp.targets.push({
        tag: t?.tagName || null,
        cls: String(t?.className || '').slice(0, 40),
        closestButton: btn ? (btn.textContent || '').trim().slice(0, 24) : null,
        btnDisabled: btn ? !!btn.disabled : null,
      });
      window.__mp.readyAtPress = !!a?.ready;
      window.__mp.ctxStateAtPress = a?.qaContext?.()?.state ?? null;
    }, true);
    if (a) {
      for (const name of ['uiTick', 'uiConfirm']) {
        const real = a[name];
        if (typeof real === 'function') {
          a[name] = (...args) => { window.__mp[name] += 1; return real.apply(a, args); };
        }
      }
    }
    const ctx = a?.qaContext?.();
    if (ctx && !ctx.__mpSpied) {
      const mkB = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = () => {
        const n = mkB(); const s = n.start.bind(n);
        n.start = (...x) => { window.__mp.buffers += 1; return s(...x); };
        return n;
      };
      const mkO = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = () => {
        const n = mkO(); const s = n.start.bind(n);
        n.start = (...x) => { window.__mp.oscs += 1; return s(...x); };
        return n;
      };
      ctx.__mpSpied = true;
    }
  });

  const handle = await page.$('.menu-screen button:not([disabled])');
  out.pressed = await handle.evaluate((n) => (n.textContent || '').trim().slice(0, 40));
  await handle.click({ timeout: 5000 }).catch((e) => { out.errs.push(String(e.message)); });
  await page.waitForTimeout(900);
  out.after = await page.evaluate(() => ({ ...window.__mp }));
  console.log('PRESSED', JSON.stringify(out.pressed));
  console.log('AFTER', JSON.stringify(out.after));

  // If the context only appears AFTER the press, then the very first press can
  // never be heard -- the graph it would have played into did not exist yet.
  out.afterState = await page.evaluate(() => {
    const a = window.__fw?.audio;
    return { ready: !!a?.ready, ctxState: a?.qaContext?.()?.state ?? null, bank: a?.qaSampleBankDiagnostics?.()?.loaded ?? null };
  });
  console.log('AFTER-STATE', JSON.stringify(out.afterState));

  // A SECOND press, now that the context certainly exists. If this one sounds and
  // the first did not, the finding is "the first click of the session is silent",
  // which is a different defect from "the menu is silent".
  await page.evaluate(() => { Object.assign(window.__mp, { uiTick: 0, uiConfirm: 0, buffers: 0, oscs: 0 }); });
  const handle2 = await page.$('.menu-screen button:not([disabled])');
  if (handle2) await handle2.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(900);
  out.secondPress = await page.evaluate(() => ({ ...window.__mp }));
  console.log('SECOND-PRESS', JSON.stringify(out.secondPress));

  fs.writeFileSync(path.join(OUT, 'menu-press-trace.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
