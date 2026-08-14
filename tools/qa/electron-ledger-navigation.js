// PHASE 6 (Goal 26) — THE LEDGER UI: WHERE AM I, AND CAN I GET ANYWHERE ELSE?
//
// I3's original wording, recovered from Full_Goal_22 rather than invented: "the
// whole interface: what a page shows, how sections are found, the type, the
// hierarchy. Obvious at a glance where you are and how to get anywhere else."
//
// Three of Phase 6's clauses are checkable without a human eye, and those are the
// three this measures:
//
//   CURRENT SECTION IDENTITY   the book must be able to say which section the
//                              open spread belongs to, from any page
//   NAVIGATION TO EVERY SECTION FROM ANYWHERE
//                              jump to each section in turn from wherever the
//                              last jump left off -- not from the contents page,
//                              which is the one place navigation is not needed
//   STATE PERSISTENCE          close the book on page N, reopen, still on page N
//
// The remaining clauses (type, hierarchy, spacing at the reading camera) are
// judgements about a picture and are not claimed here.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-ledger-navigation.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/ledger-navigation');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  const openBook = () => page.evaluate(async () => {
    const book = window.__fw.scene3d.clubhouse()?.ledgerBook;
    if (!book) return { ok: false };
    // NOT setCarried. setOpen refuses outright while the book is held --
    // "a book in your arms is not a book to read" -- and my first version
    // carried it first, so every open returned false and the run aborted on a
    // book that was working perfectly.
    book.setCarried?.(false);
    book.setOpen?.(true);
    for (let i = 0; i < 30 && !book.isOpen?.(); i += 1) {
      book.advance?.();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((done) => setTimeout(done, 60));
    }
    return { ok: !!book.isOpen?.(), open: !!book.isOpen?.() };
  });

  out.opened = await openBook();
  console.log('OPENED', JSON.stringify(out.opened));
  if (!out.opened.ok) {
    out.verdict = { ABORTED: 'the book would not open; nothing below would mean anything' };
    fs.writeFileSync(path.join(OUT, 'ledger-nav.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('LEDGER-NAV', JSON.stringify(out.verdict));
    return out;
  }

  out.sections = await page.evaluate(() => {
    const book = window.__fw.scene3d.clubhouse()?.ledgerBook;
    return book?.sections?.() ?? null;
  });
  console.log('SECTIONS', JSON.stringify(out.sections));

  // NAVIGATION FROM ANYWHERE: each jump starts from wherever the previous one
  // landed, so nothing here is reachable only from the contents page.
  out.jumps = [];
  for (const section of (out.sections || [])) {
    // eslint-disable-next-line no-await-in-loop
    const row = await page.evaluate((id) => {
      const book = window.__fw.scene3d.clubhouse()?.ledgerBook;
      const before = book.currentSection?.();
      const jumped = book.goToSection?.(id);
      const after = book.currentSection?.();
      return {
        target: id,
        jumped: !!jumped,
        from: before ? before.id : null,
        landedOn: after ? after.id : null,
        correct: !!jumped && after?.id === id,
      };
    }, section.id);
    out.jumps.push(row);
    console.log('JUMP', JSON.stringify(row));
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(220);
  }

  // BACK AND FORWARD. Jump three times, then walk back and forward again, and
  // check the book lands where it was rather than merely moving.
  out.history = await page.evaluate(async () => {
    const book = window.__fw.scene3d.clubhouse()?.ledgerBook;
    const list = book.sections?.() || [];
    if (list.length < 3) return { ok: false, why: 'not enough sections' };
    const visited = [];
    for (const id of [list[0].id, list[2].id, list[4] ? list[4].id : list[1].id]) {
      book.goToSection?.(id);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((done) => setTimeout(done, 180));
      visited.push(book.currentSection?.()?.id ?? null);
    }
    const depthAfterJumps = book.navDepth?.();
    const back1 = book.navigateBack?.();
    await new Promise((done) => setTimeout(done, 160));
    const afterBack1 = book.currentSection?.()?.id ?? null;
    const back2 = book.navigateBack?.();
    await new Promise((done) => setTimeout(done, 160));
    const afterBack2 = book.currentSection?.()?.id ?? null;
    const fwd = book.navigateForward?.();
    await new Promise((done) => setTimeout(done, 160));
    const afterForward = book.currentSection?.()?.id ?? null;
    return {
      ok: true,
      visited,
      depthAfterJumps,
      back1: !!back1,
      back2: !!back2,
      forward: !!fwd,
      afterBack1,
      afterBack2,
      afterForward,
      // back twice from the third stop should be the first stop; forward once
      // from there should be the second
      backBehaves: afterBack2 === visited[0],
      forwardBehaves: afterForward === visited[1],
    };
  });
  console.log('HISTORY', JSON.stringify(out.history));

  // PERSISTENCE: land somewhere that is not the contents page, close, reopen.
  out.persistence = await page.evaluate(async () => {
    const ch = window.__fw.scene3d.clubhouse();
    const book = ch.ledgerBook;
    const list = book.sections?.() || [];
    const target = list[list.length - 1];
    if (target) book.goToSection?.(target.id);
    await new Promise((done) => setTimeout(done, 300));
    const before = book.currentSection?.();
    book.setOpen?.(false);
    await new Promise((done) => setTimeout(done, 900));
    book.setOpen?.(true);
    for (let i = 0; i < 30 && !book.isOpen?.(); i += 1) {
      book.advance?.();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((done) => setTimeout(done, 60));
    }
    await new Promise((done) => setTimeout(done, 400));
    const after = book.currentSection?.();
    return {
      closedOn: before ? before.id : null,
      reopenedOn: after ? after.id : null,
      persisted: !!before && before.id === after?.id,
    };
  });
  console.log('PERSISTENCE', JSON.stringify(out.persistence));

  const jumps = out.jumps;
  out.verdict = {
    sectionCount: (out.sections || []).length,
    identityWorks: jumps.every((j) => j.landedOn !== null),
    jumpsAttempted: jumps.length,
    jumpsCorrect: jumps.filter((j) => j.correct).length,
    failedJumps: jumps.filter((j) => !j.correct).map((j) => `${j.from || '?'} -> ${j.target} landed ${j.landedOn}`),
    backBehaves: out.history?.backBehaves ?? null,
    forwardBehaves: out.history?.forwardBehaves ?? null,
    persistedAcrossClose: out.persistence.persisted,
    closedOn: out.persistence.closedOn,
    reopenedOn: out.persistence.reopenedOn,
  };
  console.log('LEDGER-NAV', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'ledger-nav.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
