async (page) => {
  // "Screenshot both options visible." Both shipping rows, in the cart, above the
  // confirm button â€” which is the whole point of moving them there.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  const shotDir = path.join(outDir, 'cart-shipping');
  fs.mkdirSync(shotDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async () => {
    localStorage.clear();
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', 20260727))));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);

  // Straight to the ordering desk with a basket already in it â€” the shot is the
  // cart, not the route to it.
  await page.evaluate(() => {
    window.__fw.speedIdx = 0;
    // The hook lives on the walk controller, not on the app.
    window.__fw.scene3d.walk.hooks.openLaptop('supplier');
  });
  await page.waitForTimeout(1200);
  const opened = await page.evaluate(() => !!document.querySelector('.laptop-screen'));
  if (!opened) throw new Error('the laptop did not open');

  // Add two lines so freight is real and the two options actually differ.
  const added = await page.evaluate(() => {
    // Whatever the product card's add control is actually called. The first
    // attempt guessed /add|\+/ inside .lt-grid and matched nothing, which is why
    // the cart stayed empty and the shipping rows â€” which only exist when the
    // basket does â€” were not on screen to photograph.
    const all = [...document.querySelectorAll('.lt-content button')];
    const labels = [...new Set(all.map((b) => (b.textContent || '').trim()))].slice(0, 30);
    const adders = all.filter((b) => !b.disabled
      && /add to (basket|order|cart)|^add|\+ ?1|order it/i.test(b.textContent || ''));
    adders.slice(0, 2).forEach((b) => b.click());
    return { clicked: adders.length, labelsSeen: labels };
  });
  await page.waitForTimeout(600);

  const shoot = async (name) => {
    const cart = await page.$('.lt-cart');
    if (!cart) throw new Error('no cart panel on screen');
    await cart.screenshot({ path: path.join(shotDir, `${name}.png`) });
  };
  const read = () => page.evaluate(() => {
    const cart = document.querySelector('.lt-cart');
    if (!cart) return null;
    const rows = [...cart.querySelectorAll('.lt-shiprow')].map((r) => ({
      name: r.querySelector('.lt-shipname')?.textContent || null,
      trade: r.querySelector('.lt-shiptrade')?.textContent || null,
      fee: r.querySelector('.lt-shipfee')?.textContent || null,
      selected: r.classList.contains('on'),
    }));
    const lines = [...cart.querySelectorAll('.lt-cartline')].map((l) => l.textContent.trim());
    const confirm = cart.querySelector('button.lt-primary, .lt-primary');
    // The whole reason for moving it: the total must be ABOVE the confirm button.
    const totalEl = cart.querySelector('.lt-carttotal');
    const order = totalEl && confirm
      ? (totalEl.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      : null;
    return {
      rows, lines, totalPrecedesConfirm: order, confirmLabel: confirm?.textContent || null,
    };
  });

  const standard = await read();
  await shoot('cart-standard-selected');
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.lt-cart .lt-shiprow')];
    (rows[1] || rows[0])?.click();
  });
  await page.waitForTimeout(500);
  const express = await read();
  await shoot('cart-express-selected');

  const out = {
    productsAdded: added,
    standard,
    express,
    bothOptionsVisible: standard.rows.length === 2 && express.rows.length === 2,
    selectionMoves: standard.rows[0]?.selected === true && express.rows[1]?.selected === true,
    totalAboveConfirm: standard.totalPrecedesConfirm === true,
    // The total must actually respond to the choice, or the row is decoration.
    totalChanged: JSON.stringify(standard.lines) !== JSON.stringify(express.lines),
    shots: shotDir,
  };
  out.ok = out.bothOptionsVisible && out.selectionMoves && out.totalAboveConfirm && out.totalChanged;
  fs.writeFileSync(path.join(outDir, 'cart-shipping.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
