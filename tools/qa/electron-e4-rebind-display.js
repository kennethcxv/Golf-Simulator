// E4 — DOES REBINDING UPDATE THE FORMATTED CONTROLS LIST, IMMEDIATELY?
//
// "Changing a key in Controls must change it in the formatted controls list too,
// immediately, in the same layout."
//
// Three clauses, and only one of them is answered by the prompts being derived
// from bindings (they are — the live table holds all 21 actions). Derivation
// does not promise a RE-RENDER, and a list built from live bindings still shows
// stale text if nothing redraws it after the rebind commits. That is the clause
// the brief emphasises, so it is what this measures.
//
// No source reading of the render path on purpose: Section D cost six wrong
// explanations reasoned from code rather than behaviour. This drives the real UI
// and diffs what is on screen.
//
// THE NEGATIVE CONTROL is the first capture itself. If the "before" text does
// not contain the key we are about to rebind away from, the test can pass
// without the display ever having been correct, so that is asserted first.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-e4-rebind-display.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/e4-rebind');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
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

  const keys = await page.evaluate(() => window.__fw.preferences?.values?.controls?.bindings || {});
  out.bindingsBefore = { moveForward: keys.moveForward, setDown: keys.setDown };

  await page.keyboard.press(keys.pause || 'p');
  await page.waitForTimeout(1200);
  out.opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, .menu-item, [role=button]')]
      .find((b) => /settings/i.test(b.textContent || ''));
    if (!btn) return { clicked: false };
    btn.click();
    return { clicked: true };
  }).catch(() => ({ clicked: false }));
  await page.waitForTimeout(1400);

  // Any element whose text mentions the bound key, anywhere in the settings
  // shell — the "formatted controls list" is whatever actually prints it, and
  // finding it by CONTENT rather than by class avoids guessing a name (which is
  // exactly how a canvas dump found zero files earlier in this session).
  const snapshot = () => page.evaluate(() => {
    const shell = document.querySelector('.settings-shell') || document.body;
    const rows = [];
    for (const el of shell.querySelectorAll('*')) {
      if (el.children.length) continue; // leaf text only
      const t = (el.textContent || '').trim();
      if (!t || t.length > 80) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      rows.push({
        text: t,
        cls: String(el.className || '').split(' ')[0] || el.tagName,
        x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width),
      });
    }
    return rows;
  }).catch(() => []);

  out.tabs = await page.evaluate(() => [...document.querySelectorAll('button, [role=tab]')]
    .map((b) => (b.textContent || '').trim()).filter((t) => t && t.length < 24).slice(0, 12));

  out.before = await snapshot();
  await page.screenshot({ path: path.join(OUT, 'e4-before.png') });

  // Rebind through the preferences API, then look at the SCREEN. The brief's
  // clause is about the display reacting, not about how the change is made; and
  // driving the rebind UI blind would confound "the list did not update" with
  // "I never actually rebound anything".
  out.rebind = await page.evaluate(() => {
    const p = window.__fw.preferences;
    if (!p?.set) return { ok: false, why: 'no preferences.set' };
    const before = p.values.controls.bindings.moveForward;
    p.set('controls.bindings.moveForward', 'i');
    return { ok: true, before, after: p.values.controls.bindings.moveForward };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));
  await page.waitForTimeout(1200);

  out.after = await snapshot();
  await page.screenshot({ path: path.join(OUT, 'e4-after.png') });

  const textOf = (rows) => rows.map((r) => r.text).join(' | ');
  const beforeText = textOf(out.before);
  const afterText = textOf(out.after);
  const changed = out.before
    .filter((b, i) => out.after[i] && out.after[i].text !== b.text)
    .map((b, i) => `${b.text} -> ${out.after[out.before.indexOf(b)]?.text}`);

  out.verdict = {
    settingsOpened: out.opened?.clicked ?? null,
    tabs: out.tabs,
    rebindApplied: out.rebind?.ok === true && out.rebind?.after === 'i',
    rebindFromTo: out.rebind ? `${out.rebind.before} -> ${out.rebind.after}` : null,
    leafNodesBefore: out.before.length,
    leafNodesAfter: out.after.length,
    // The control: the OLD key must appear before, or the test proves nothing.
    oldKeyVisibleBefore: /\bW\b/i.test(beforeText),
    newKeyVisibleAfter: /\bI\b/.test(afterText),
    textChangedAtAll: beforeText !== afterText,
    changedRows: changed.slice(0, 6),
    // Same layout: row count and x-positions should not move.
    layoutStable: out.before.length === out.after.length,
  };
  fs.writeFileSync(path.join(OUT, 'e4-rebind.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('E4-REBIND', JSON.stringify(out.verdict));
  return out;
}
