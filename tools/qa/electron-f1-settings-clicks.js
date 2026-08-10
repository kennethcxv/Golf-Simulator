// F1 (settings surface) — ONE SURFACE, ONE RUN, CLEAN START.
//
// The combined audit could not reach the settings panel: it had already walked
// the pause menu, and `pause` is a toggle, so pressing it again closed what was
// open. Two attempts returned `openedBy: null`. That is a driver-design problem,
// not an audit problem, and the fix is to stop mixing navigation with sweeping.
//
// So this run does one thing: boot, open the pause menu ONCE, click into
// Settings, prove the tab strip is there, and audit only what is on that surface.
//
// The audit logic is lifted unchanged from electron-f1-click-audit.js because it
// is already correct: hook `start` on the source-node prototypes so the count is
// SOUNDS rather than audio-module calls, and keep the dead-space control.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-f1-settings-clicks.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/f1-settings-clicks');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], clicked: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(4000);

  out.hook = await page.evaluate(() => {
    window.__f1 = { total: 0, byName: {} };
    const wrapped = [];
    for (const ctor of ['AudioBufferSourceNode', 'OscillatorNode', 'ConstantSourceNode']) {
      const C = window[ctor];
      if (!C?.prototype?.start) continue;
      const orig = C.prototype.start;
      C.prototype.start = function started(...a) {
        window.__f1.total += 1;
        window.__f1.byName[ctor] = (window.__f1.byName[ctor] || 0) + 1;
        return orig.apply(this, a);
      };
      wrapped.push(ctor);
    }
    return { ok: wrapped.length > 0, wrapped };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));

  const ticks = () => page.evaluate(() => window.__f1?.total ?? -1).catch(() => -1);

  // ONE pause press, from a clean start.
  const keys = await page.evaluate(() => window.__fw.preferences?.values?.controls?.bindings || {});
  await page.keyboard.press(keys.pause || 'p');
  await page.waitForTimeout(1300);

  // Into Settings, by outcome: success is the tab strip existing.
  const tabsPresent = () => page.evaluate(() => !!document.querySelector('.settings-tabs .settings-tab')).catch(() => false);
  out.open = { openedBy: null };
  if (!(await tabsPresent())) {
    const cands = await page.evaluate(() => [...document.querySelectorAll('button')]
      .filter((x) => { const r = x.getBoundingClientRect(); return r.width > 4 && !!x.offsetParent && !x.disabled; })
      .map((x) => { const r = x.getBoundingClientRect(); return { text: (x.textContent || '').trim().slice(0, 24), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })).catch(() => []);
    out.open.candidates = cands.map((c) => c.text);
    // TRY THE LIKELY ONE FIRST, AND NEVER THE DESTRUCTIVE ONES.
    //
    // The candidate list is [Resume, Overview, Save game, Load game, Settings,
    // ...] and this loop went in DOM order -- so it clicked RESUME first, which
    // closes the pause menu, and every later candidate then failed against a
    // menu that was no longer there. Same shape as clicking "Close Laptop":
    // walking a list in document order until something destructive fires.
    //
    // Outcome-checking alone does not save you from this; the first click has
    // already dismantled the surface. So order the list by likelihood and skip
    // the entries whose whole job is to leave.
    const LEAVE = /^(resume|resume game|quit|close|back|exit)$/i;
    cands.sort((a2, b2) => (/setting/i.test(b2.text) ? 1 : 0) - (/setting/i.test(a2.text) ? 1 : 0));
    const usable = cands.filter((c) => !LEAVE.test(c.text));
    out.open.order = usable.map((c) => c.text);
    // element.click(), NOT page.mouse.click. E4 established that this pause
    // entry opens the settings dialog via the element method and that a mouse
    // click at its box does not -- the same asymmetry that made E4 spend three
    // runs before dumping the DOM. Use what was already proved rather than
    // rediscovering it.
    for (const c of usable) {
      const did = await page.evaluate((txt) => {
        const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim().slice(0, 24) === txt);
        if (!btn) return false;
        btn.click();
        return true;
      }, c.text).catch(() => false);
      if (!did) continue;
      await page.waitForTimeout(800);
      if (await tabsPresent()) { out.open.openedBy = c.text; break; }
    }
  } else out.open.openedBy = 'already open';

  // CONTROL: dead space must be silent. Taken AFTER arriving, so it reflects the
  // surface actually under test.
  const d0 = await ticks();
  await page.mouse.click(20, 1340);
  await page.waitForTimeout(400);
  out.deadSpace = { before: d0, after: await ticks() };

  if (out.open.openedBy) {
    // Everything pressable on this surface: the tabs, and the controls inside
    // the shell. Hit-tested, because a bounding box is not a promise the element
    // is on top — E4's lesson.
    const targets = await page.evaluate(() => {
      const shell = document.querySelector('.settings-shell');
      if (!shell) return [];
      return [...shell.querySelectorAll('button, [role=button], input[type=checkbox]')]
        .filter((x) => { const r = x.getBoundingClientRect(); return r.width > 4 && r.height > 4 && !!x.offsetParent && !x.disabled; })
        .slice(0, 18)
        .map((x) => {
          const r = x.getBoundingClientRect();
          const cx = Math.round(r.left + r.width / 2);
          const cy = Math.round(r.top + r.height / 2);
          const top = document.elementFromPoint(cx, cy);
          return {
            text: (x.textContent || '').trim().slice(0, 26),
            cls: String(x.className || '').split(' ')[0] || x.tagName,
            x: cx, y: cy,
            reachable: !!top && (top === x || x.contains(top)),
          };
        });
    }).catch(() => []);
    for (const t of targets) {
      if (!t.reachable) { out.clicked.push({ ...t, skipped: 'covered' }); continue; }
      const b0 = await ticks();
      await page.mouse.click(t.x, t.y);
      await page.waitForTimeout(380);
      const a0 = await ticks();
      out.clicked.push({ ...t, sounded: a0 > b0 });
    }
  }
  await page.screenshot({ path: path.join(OUT, 'f1-settings.png') });

  const tested = out.clicked.filter((c) => !c.skipped);
  out.verdict = {
    openedBy: out.open.openedBy,
    deadSpaceSilent: out.deadSpace ? out.deadSpace.after === out.deadSpace.before : null,
    controlsTested: tested.length,
    controlsSounded: tested.filter((c) => c.sounded).length,
    silent: tested.filter((c) => !c.sounded).map((c) => `${c.cls}:${c.text}`),
    coveredSkipped: out.clicked.filter((c) => c.skipped).length,
  };
  fs.writeFileSync(path.join(OUT, 'f1-settings-clicks.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('F1-SETTINGS', JSON.stringify(out.verdict));
  return out;
}
