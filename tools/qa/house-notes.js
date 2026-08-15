// L4 — the lamp repair teaches itself FROM THE WORLD, and the register's
// HOUSE NOTES page is the readable half of that teaching. The starter seeds
// PANEL-02 flicker + PANEL-07 dead behind an UNPOWERED office circuit, so
// the teaching has an order and the book must follow it:
//   1. a FRESH boot's register lists both panel notes in the desk's dry
//      hand - and the dead panel's note names the CIRCUIT, the gate the
//      player is actually behind (repair-light refuses until power is on)
//   2. restoring office power (repair-component: ceiling) and repairing
//      PANEL-02 the sim-true way (kits consumed) removes its line; the
//      still-dead PANEL-07's note now blames the FITTING, because claiming
//      "the circuit is dead" after the player repaired it would be a lie
//   3. NEGATIVE CONTROL: with both panels repaired their notes are gone
//      (the page keeps the untouched structural notes - a fresh profile is
//      a dilapidated house, not an empty one)
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/house-notes-l4');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const VIEWPORT = { width: 1600, height: 900 };
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize(VIEWPORT);
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(300);

  const standAtLedger = () => page.evaluate(async () => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const club = app.scene3d.clubhouse();
    const off = club.interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const book = club.ledgerBook.position();
    const dx = (book.x + off.x) - walk.x;
    const dz = (book.z + off.z) - walk.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    const eyeY = app.scene3d.camera.position.y;
    walk.pitch = Math.atan2((book.y + off.y) - eyeY, horizontal);
  });

  const openToNotes = async () => {
    await standAtLedger();
    await page.waitForTimeout(500);
    await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await page.waitForTimeout(400);
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.ledgerOpen === true, null, { timeout: 10000 });
    // the journal rises and the cover swings before the pages are readable
    await page.waitForFunction(() => (
      window.__fw.scene3d.clubhouse().ledgerBook.diagnostics().state === 'open'
    ), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    // the journal has sections now - jump straight to HOUSE NOTES
    await page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.goToSection('house'));
    await page.waitForTimeout(400);
    return page.evaluate(() => window.__fw.scene3d.clubhouse().ledgerBook.diagnostics());
  };
  const closeBook = async () => {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.ledgerOpen === false, null, { timeout: 8000 });
    await page.waitForTimeout(400);
  };
  const notesTexts = () => page.evaluate(async () => {
    const { houseNotes } = await import(new URL('src/sim/clubRoster.js', document.baseURI).href);
    return houseNotes(window.__fw.state);
  });

  // ---- 1: fresh boot, the back page lists the two panels -------------------
  const freshNotes = await notesTexts();
  const freshDiag = await openToNotes();
  await page.screenshot({ path: path.join(OUT, '01-fresh-notes.png') });
  await closeBook();

  // ---- 2: power the circuit, then repair PANEL-02, all sim-true ------------
  const repair = await page.evaluate(async () => {
    const app = window.__fw;
    const R = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    const inv = app.state.shop.inventory;
    if (!inv[R.ARCHITECTURE_REPAIR_SKU]) inv[R.ARCHITECTURE_REPAIR_SKU] = { shelf: 0, back: 0 };
    inv[R.ARCHITECTURE_REPAIR_SKU].back += 4; // circuit + two panels, with one spare
    const brief = (r) => (r && typeof r === 'object'
      ? { ok: r.ok !== false, changed: r.changed === true, reason: r.reason ?? null }
      : { raw: String(r) });
    // the gate itself is part of the teaching: a panel repair on a dead ring
    // must REFUSE and say why
    const refused = R.restorationAction(app.state, { type: 'repair-light', targetId: 'ceiling:panel-02' });
    const power = R.restorationAction(app.state, { type: 'repair-component', component: 'ceiling', progress: 1 });
    const first = R.restorationAction(app.state, { type: 'repair-light', targetId: 'ceiling:panel-02' });
    return {
      refused: brief(refused),
      power: brief(power),
      first: brief(first),
      panels: { ...app.state.shop.reno.lightPanels },
    };
  });
  const midNotes = await notesTexts();
  const midDiag = await openToNotes();
  await page.screenshot({ path: path.join(OUT, '02-after-panel02-repair.png') });
  await closeBook();

  // ---- 3: repair PANEL-07 too - the page goes quiet (all-clear control) ----
  await page.evaluate(async () => {
    const app = window.__fw;
    const R = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    R.restorationAction(app.state, { type: 'repair-light', targetId: 'ceiling:panel-07' });
  });
  const clearNotes = await notesTexts();
  const clearDiag = await openToNotes();
  await page.screenshot({ path: path.join(OUT, '03-all-clear.png') });
  await closeBook();

  const hasNote = (notes, id) => notes.some((n) => n.id === id);
  const noteText = (notes, id) => notes.find((n) => n.id === id)?.text || '';
  const checks = {
    // the fresh profile carries unrestored architecture notes too - the claim
    // is that BOTH panel notes are present and worded for their live fault:
    // PANEL-02 flickers, PANEL-07 is dead behind the unpowered circuit
    freshListsBothPanels: hasNote(freshNotes, 'light:panel-02')
      && /flickers/.test(noteText(freshNotes, 'light:panel-02'))
      && hasNote(freshNotes, 'light:panel-07')
      && /circuit is dead/.test(noteText(freshNotes, 'light:panel-07')),
    freshPagePainted: (freshDiag.notes ?? 0) === freshNotes.length
      && freshDiag.contentReady === true && freshDiag.state === 'open',
    // every model note is INKED somewhere on the house spread - the section
    // paginates rather than silently truncating (the fresh profile's 9 notes
    // overflow a single 7-line page)
    freshHousePagesShowEveryNote: freshDiag.painted === freshNotes.length,
    // the gate is the first lesson: a panel repair on the dead ring refuses
    gateRefusesBeforePower: repair.refused.ok === false
      && /circuit/i.test(String(repair.refused.reason)),
    repairTookEffect: repair.power.ok === true && repair.power.changed === true
      && repair.first.ok === true && repair.first.changed === true
      && repair.panels['panel-02'] === 'working',
    panel02NoteGone: !hasNote(midNotes, 'light:panel-02')
      && hasNote(midNotes, 'light:panel-07'),
    // the honesty fix, observed in the running build: with power restored the
    // still-dead panel blames the fitting, not the circuit the player fixed
    deadNoteBlamesFittingOncePowered: /fitting itself/.test(noteText(midNotes, 'light:panel-07'))
      && !/circuit is dead/.test(noteText(midNotes, 'light:panel-07')),
    midPagePainted: (midDiag.notes ?? 0) === midNotes.length,
    bothPanelNotesGone: !hasNote(clearNotes, 'light:panel-02')
      && !hasNote(clearNotes, 'light:panel-07'),
    clearPagePainted: (clearDiag.notes ?? 0) === clearNotes.length,
    noPageErrors: errs.length === 0,
  };
  const out = { freshNotes, freshDiag, repair, midNotes, midDiag, clearNotes, clearDiag, errs: errs.slice(0, 10), checks };
  out.ok = Object.values(checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'house-notes.json'), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}
