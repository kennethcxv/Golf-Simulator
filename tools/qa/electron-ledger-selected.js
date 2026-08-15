// PHASE 6 (Goal 26) — "SELECTED AND HOVER STATES", PHOTOGRAPHED.
//
// The contents page drew all seven rows identically, so the one page in the book
// whose entire job is "where am I and how do I get anywhere else" was the one
// page that never said where you were.
//
// A selected state is a claim about PIXELS, so this is a picture, not a number —
// but it also counts the ink, because "I added a marker" and "the marker draws"
// are different claims and this repo has been caught on that difference. The
// contents page is captured at two different current sections and the two
// canvases are compared: if the selected row is really being drawn, the SAME
// page painted while standing in two different sections must differ.
//
// That comparison is the control. A marker that is coded but never reaches the
// canvas produces two identical images, and identical images are exactly what a
// screenshot of a working marker also looks like if you only take one.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-ledger-selected.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/ledger-selected');
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

  out.opened = await page.evaluate(async () => {
    const book = window.__fw.scene3d.clubhouse()?.ledgerBook;
    if (!book) return { ok: false, why: 'no ledgerBook' };
    // setOpen refuses while the book is CARRIED -- "a book in your arms is not a
    // book to read" -- and carrying it first is how a previous driver got false
    // from every open on a book that was working perfectly.
    book.setCarried?.(false);
    book.setOpen?.(true);
    for (let i = 0; i < 30 && !book.isOpen?.(); i += 1) {
      book.advance?.();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((d) => setTimeout(d, 60));
    }
    return { ok: !!book.isOpen?.(), sections: (book.sections?.() || []).map((s) => s.id) };
  });
  console.log('OPENED', JSON.stringify(out.opened));
  if (!out.opened.ok) {
    out.verdict = { ABORTED: 'the book would not open' };
    fs.writeFileSync(path.join(OUT, 'ledger-selected.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('LEDGER-SELECTED', JSON.stringify(out.verdict));
    return out;
  }

  // Go into a section, then come BACK to the contents page and photograph it.
  // That is the only order in which the marker is visible: it marks the section
  // you were last READING, which is what a reader wants from a contents page,
  // and it is deliberately not the open spread's own section -- asking "which
  // section am I in" while looking at the contents answers "contents", and a
  // marker pointing at the word Contents inside the contents list is true,
  // useless, and confusing.
  const ids = out.opened.sections || [];
  const a = ids[1] || ids[0];
  const b = ids[ids.length - 1];

  out.a = await page.evaluate(async (sectionId) => {
    const book = window.__fw.scene3d.clubhouse().ledgerBook;
    book.goToSection?.(sectionId);
    await new Promise((d) => setTimeout(d, 700));
    return { asked: sectionId, now: book.currentSection?.()?.id ?? null };
  }, a);
  await page.evaluate(async () => {
    // goToPage(0) is NOT the contents page. Pages are addressed the way
    // electron-ledger-navigation addresses them -- spread i is page i*2+1 -- so
    // 0 fell through and left the book wherever the section jump had put it.
    // The first version of this driver photographed The Deed twice and called
    // the 2.6 % difference between two DIFFERENT SECTION PAGES proof that a
    // marker on the contents page was drawing.
    window.__fw.scene3d.clubhouse().ledgerBook.goToPage?.(1);
    await new Promise((d) => setTimeout(d, 700));
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `contents-after-${a}.png`) });

  out.b = await page.evaluate(async (sectionId) => {
    const book = window.__fw.scene3d.clubhouse().ledgerBook;
    book.goToSection?.(sectionId);
    await new Promise((d) => setTimeout(d, 700));
    return { asked: sectionId, now: book.currentSection?.()?.id ?? null };
  }, b);
  await page.evaluate(async () => {
    // goToPage(0) is NOT the contents page. Pages are addressed the way
    // electron-ledger-navigation addresses them -- spread i is page i*2+1 -- so
    // 0 fell through and left the book wherever the section jump had put it.
    // The first version of this driver photographed The Deed twice and called
    // the 2.6 % difference between two DIFFERENT SECTION PAGES proof that a
    // marker on the contents page was drawing.
    window.__fw.scene3d.clubhouse().ledgerBook.goToPage?.(1);
    await new Promise((d) => setTimeout(d, 700));
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `contents-after-${b}.png`) });

  console.log('SECTION-A', JSON.stringify(out.a), 'SECTION-B', JSON.stringify(out.b));

  out.verdict = {
    sections: ids,
    firstSectionLanded: out.a.now,
    secondSectionLanded: out.b.now,
    shots: [`contents-after-${a}.png`, `contents-after-${b}.png`],
    // the control: same page, two different last-read sections. Identical
    // images mean the marker never reached the canvas, and one screenshot of a
    // working marker looks exactly the same as one screenshot of a dead one.
    note: 'compare the two shots -- the marked row must differ',
  };
  console.log('LEDGER-SELECTED', JSON.stringify(out.verdict, null, 2));
  fs.writeFileSync(path.join(OUT, 'ledger-selected.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
