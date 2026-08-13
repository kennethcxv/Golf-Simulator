// PHASE 3.3 (Goal 25) — THE HOVER OUTLINE CHECK, WRITTEN BEFORE THE FEATURE.
//
// golf-qa's rule is that every fix gets a check watched FAILING on the unfixed
// build. 3.3 is not implemented, so this is expected to fail now, and that failure
// is the evidence. Whoever builds the outline should run this first, see it red,
// then make it green -- rather than writing a check afterwards against the code
// they just wrote, which is how a check ends up asserting the bug.
//
// Five of 3.3's six clauses are numeric. This measures those five. The sixth --
// "clear, tasteful, comparable to the money highlight" -- needs an eye and is
// deliberately NOT scored here; a driver that pretended to judge taste would be
// the more dangerous kind of green.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-p3-ledger-outline.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/p3-ledger-outline');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], notes: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  const canvas = await page.$('#game') || await page.$('canvas');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(600);

  // THE ACCESSOR THIS DEPENDS ON DOES NOT EXIST YET. Its absence is the expected
  // failure, and it is reported as a distinct outcome rather than as a false
  // "outline is wrong" -- an instrument that cannot tell "not built" from
  // "built badly" is worthless for deciding what to do next.
  const readOutline = () => page.evaluate(() => {
    const ch = window.__fw.scene3d?.clubhouse?.();
    const fn = ch?.debugLedgerOutline;
    if (typeof fn !== 'function') return { missing: true };
    try { return { missing: false, ...(fn() || {}) }; } catch (e) { return { missing: false, threw: String(e.message || e) }; }
  });

  const probe = await readOutline();
  if (probe.missing) {
    out.verdict = 'NOT BUILT — ch.debugLedgerOutline() does not exist';
    out.notes.push('Expected on the unfixed build. This is the watched failure for 3.3.');
    out.notes.push('The aim test 3.3 needs is ALREADY solved: courseScene.js:7731 (Goal 24 Decision 3),');
    out.notes.push('which gates on WALK_CROSSHAIR_YD cross-track distance from the aim ray.');
    out.notes.push('Build: shells from that boolean + prompt + this accessor returning');
    out.notes.push('{ active, shellCount, shellOwnerSpans, materialsCreatedSinceBoot }.');
    out.clauses = {
      promptNamesTheLedger: null,
      clearsWhenAimIsLost: null,
      doesNotFrameTheWholeDesk: null,
      survivesOpenAndClose: null,
      doesNotCloneMaterialPerFrame: null,
    };
    out.ok = false;
    fs.writeFileSync(path.join(OUT, 'outline.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('P3-OUTLINE', JSON.stringify(out, null, 2));
    return out;
  }

  // ---- once the accessor exists, these are the five numeric clauses ---------
  const aimAt = async (on) => {
    // sweep to find the book, or deliberately away from it
    await page.mouse.move(cx + (on ? 0 : 600), cy, { steps: 8 });
    await page.waitForTimeout(500);
  };

  await aimAt(true);
  const aimed = await readOutline();
  const promptText = await page.evaluate(() => document.querySelector('.walk-prompt, .prompt')?.textContent || '');

  await aimAt(false);
  const away = await readOutline();

  // material churn: sample twice, several seconds apart, while aimed
  await aimAt(true);
  const m1 = await readOutline();
  await page.waitForTimeout(3000);
  const m2 = await readOutline();

  // open and close, then re-aim: the outline must not be stale
  await page.keyboard.press('k');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await aimAt(true);
  const afterCycle = await readOutline();

  out.samples = { aimed, away, m1, m2, afterCycle, promptText };
  out.clauses = {
    promptNamesTheLedger: /ledger|book/i.test(promptText),
    clearsWhenAimIsLost: away.active === false || (away.shellCount ?? 0) === 0,
    // A COVER IS NOT A DESK. The span of the outlined owner has to be book-sized;
    // framing the whole counter would pass a naive "an outline exists" check.
    doesNotFrameTheWholeDesk: Array.isArray(aimed.shellOwnerSpans)
      && aimed.shellOwnerSpans.length > 0
      && aimed.shellOwnerSpans.every((s) => s != null && s < 2.0),
    survivesOpenAndClose: afterCycle.active === true && (afterCycle.shellCount ?? 0) > 0,
    doesNotCloneMaterialPerFrame:
      m2.materialsCreatedSinceBoot != null && m1.materialsCreatedSinceBoot != null
        ? (m2.materialsCreatedSinceBoot - m1.materialsCreatedSinceBoot) < 5
        : null,
  };
  out.notScored = 'clear, tasteful, comparable to the money highlight — needs an eye, not this driver';
  out.ok = Object.values(out.clauses).every((v) => v === true) && out.errs.length === 0;
  fs.writeFileSync(path.join(OUT, 'outline.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('P3-OUTLINE', JSON.stringify({ clauses: out.clauses, ok: out.ok }, null, 2));
  return out;
}
