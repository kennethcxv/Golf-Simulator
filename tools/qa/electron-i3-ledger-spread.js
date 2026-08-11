// I3 (Goal 23) — WHAT DOES THE OPEN BOOK ACTUALLY LOOK LIKE?
//
// Goal 20's F1, still open: "Rebuild the book's UI to be intuitive and legible.
// Not a tweak. The whole interface: what a page shows, how sections are found,
// the type, the hierarchy. It should be obvious at a glance where I am and how
// to get anywhere else."
//
// Before rebuilding an interface, photograph it. A 3D screenshot of a book on a
// desk cannot answer "is this type legible" — the whole spread is a few hundred
// pixels wide there. So this opens the book and pulls the PAGE CANVASES out at
// native resolution, which is the surface the type is actually drawn on.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-i3-ledger-spread.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/i3-ledger-spread');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3000);

  out.opened = await page.evaluate(() => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    ch.setTimeMood?.(14 * 60);
    const book = ch.ledgerBook;
    if (!book || typeof book.debugSetCoverSwing !== 'function') return { ok: false, why: 'no swing driver' };
    book.debugSetCoverSwing(1);
    return { ok: true };
  });
  await page.waitForTimeout(1200);

  // ASK THE BOOK. The first version traversed ch.interior for canvas textures
  // and found six, none of them the ledger -- the largest was the floor grime
  // map. A probe that hunts the scene graph finds the wrong thing and reports
  // on it. ledgerBook.pageCanvas hands over the actual face.
  const shots = await page.evaluate(() => {
    const book = window.__fw.scene3d.clubhouse().ledgerBook;
    if (!book || typeof book.pageCanvas !== 'function') return [];
    const found = [];
    for (const side of ['left', 'right']) {
      const c = book.pageCanvas(side);
      if (!c || !c.toDataURL) continue;
      found.push({ mesh: 'ledger:' + side, material: 'pageCanvas', w: c.width, h: c.height, url: c.toDataURL('image/png') });
    }
    return found;
  });

  out.files = [];
  for (const shot of shots.slice(0, 6)) {
    const file = 'canvas-' + (out.files.length + 1) + '.png';
    fs.writeFileSync(path.join(OUT, file), Buffer.from(shot.url.split(',')[1], 'base64'));
    out.files.push({ file, mesh: shot.mesh, material: shot.material, size: shot.w + 'x' + shot.h });
  }

  await page.screenshot({ path: path.join(OUT, 'book-open.png') });
  fs.writeFileSync(path.join(OUT, 'spread.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('I3', JSON.stringify({ opened: out.opened, files: out.files }, null, 2));
  return out;
}
