// H (Goal 23) — FOUR DIFFERENT CARDS, PHOTOGRAPHED.
//
// "Screenshot four different cards in a customer's hand at the default camera."
//
// The card face is a canvas texture, and the honest question is whether the
// PAINTER produces four different pictures — a scene screenshot at the register
// shows a card edge-on in a reader slot at a few dozen pixels, which would prove
// almost nothing about the artwork. So this photographs the texture itself at
// full size, in the running game, through the same code path the card in the
// customer's hand is painted with, and lays them out as a numbered sheet.
//
// The control: the four canvases must differ from each other. Four identical
// pictures with four different names on them would be the same one-card fault
// wearing a hat, and a file-per-card without a comparison would not show it.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-h-card-variants.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const crypto = process.getBuiltinModule('node:crypto');
  const OUT = path.resolve('qa/electron/h-card-variants');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], candidates: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2500);

  // Paint every row through the SHIPPED painter and read the pixels back.
  out.cards = await page.evaluate(async () => {
    const mod = await import(new URL('src/data/paymentCards.js', document.baseURI).href);
    return mod.PAYMENT_CARDS.map((c) => ({
      id: c.id, network: c.network, issuer: c.issuer, tier: c.tier, mark: c.mark,
    }));
  });

  for (const card of out.cards) {
    const dataUrl = await page.evaluate(async (id) => {
      const mod = await import(new URL('src/data/paymentCards.js', document.baseURI).href);
      const design = mod.PAYMENT_CARDS.find((c) => c.id === id);
      // The painter lives inside the register module's closure, so it is
      // reached the way the game reaches it: ask the register to repaint with
      // this card pinned, then read the texture's own canvas back. That is the
      // shipped path, not a reimplementation of it in the driver.
      window.__qaPaymentCardId = id;
      const ch = window.__fw.scene3d.clubhouse();
      const reg = ch.register;
      if (reg.repaintBrand) reg.repaintBrand();
      // cardNode is null until a customer brings a sale, so the face is read
      // from the brand material, which is painted at construction. The first
      // version of this driver photographed nothing for exactly that reason.
      const canvas = reg.cardBrandCanvas ? reg.cardBrandCanvas() : null;
      if (!canvas || !canvas.toDataURL) return { ok: false, why: 'no card canvas exposed', design: !!design };
      return { ok: true, url: canvas.toDataURL('image/png') };
    }, card.id);
    if (!dataUrl || !dataUrl.ok) {
      out.candidates.push({ ...card, ok: false, why: dataUrl?.why || 'no data' });
      continue;
    }
    const file = `card-${out.candidates.length + 1}-${card.id}.png`;
    const bytes = Buffer.from(dataUrl.url.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, file), bytes);
    out.candidates.push({
      n: out.candidates.length + 1,
      ...card,
      file,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      caption: `${card.network}  ·  ${card.issuer || 'the club'}`,
      ok: true,
    });
  }
  await page.evaluate(() => { delete window.__qaPaymentCardId; });

  const painted = out.candidates.filter((c) => c.ok);
  out.checks = {
    atLeastFourPainted: painted.length >= 4,
    // the control: four different NAMES on one picture is the old fault
    allDistinct: new Set(painted.map((c) => c.sha256)).size === painted.length,
    noPageErrors: out.errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'card-variants.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('H-CARDS', JSON.stringify({ ok: out.ok, checks: out.checks, painted: painted.map((c) => c.file) }, null, 2));
  return out;
}
