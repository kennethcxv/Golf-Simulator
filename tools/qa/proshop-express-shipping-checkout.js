async (page) => {
  // WALK FINDING 5 â€” deliveries too slow, and express shipping as a paid option.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/proshop-express-shipping-checkout.js
  //
  // Drives the real checkout: open the laptop's Shop tab, add products, read
  // both shipping cards as the player sees them, pick express, and place the
  // order. The claim being tested is legibility as much as arithmetic â€” the
  // cards have to state the arrival and the premium without the player doing
  // sums â€” so the reported values are the rendered STRINGS, not the sim's
  // numbers.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const shotDir = path.join(outDir, 'express-shipping');
  fs.mkdirSync(shotDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import(new URL('src/sim/empire.js', document.baseURI).href);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  // Cash enough that affordability never masks a rendering failure.
  await page.evaluate(() => { window.__fw.state.cash = 250000; window.__fw.speedIdx = 0; });

  // Sit at the LIVE laptop, the two-stand retry laptop-tour.js proved out: the
  // laptop moved to the front desk and a fixed office stand hits nothing.
  {
    let opened = false;
    for (const stand of ['chair', 'north']) {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(async (which) => {
        const app = window.__fw;
        const L = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
        const o = app.scene3d.clubhouse().interior.position;
        const w = app.scene3d.walk.state;
        const laptop = L.FRONT_DESK.laptop;
        const seat = which === 'north'
          ? { x: laptop.x, z: laptop.z + 0.95 }
          : { x: L.FRONT_DESK.staffChair.x, z: L.FRONT_DESK.staffChair.z };
        w.x = seat.x + o.x;
        w.z = seat.z + o.z;
        const dx = laptop.x - seat.x;
        const dz = laptop.z - seat.z;
        const horizontal = Math.hypot(dx, dz) || 0.001;
        w.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
        w.pitch = Math.atan2(1.06 - 1.62, horizontal);
      }, stand);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(600);
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('e');
      // eslint-disable-next-line no-await-in-loop
      opened = await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 6000 })
        .then(() => true).catch(() => false);
      if (opened) break;
    }
    if (!opened) throw new Error('laptop did not open from either live stand');
  }
  await page.waitForFunction(() => document.querySelectorAll('.lt-navbtn').length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.lt-navbtn')]
      .find((b) => /pro shop|shop/i.test(b.getAttribute('title') || b.textContent || ''));
    btn?.click();
  });
  await page.waitForTimeout(700);
  // The Pro Shop page has its own tabs; the basket lives on the ordering one.
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.lt-tab, .lt-navbtn, button')]
      .find((b) => /^\s*(order|ordering|catalog|buy)/i.test(b.textContent || ''));
    tab?.click();
  });
  await page.waitForTimeout(700);

  // Two same-supplier lines, so this also exercises a genuine multi-line cart.
  const added = await page.evaluate(() => {
    const names = [...document.querySelectorAll('.lt-product')].map((n) => ({
      name: n.querySelector('.lt-prodname')?.textContent || '',
      plus: n.querySelectorAll('.lt-qbtn')[1] || null,
    }));
    const want = names.filter((n) => /ball|tee/i.test(n.name) && n.plus).slice(0, 2);
    for (const w of want) for (let i = 0; i < 3; i += 1) w.plus.click();
    return want.map((w) => w.name);
  });
  await page.waitForTimeout(400);

  const readCards = () => page.evaluate(() => {
    const opts = [...document.querySelectorAll('.lt-shipopt')].map((n) => ({
      name: n.querySelector('.lt-shipname')?.textContent || null,
      eta: n.querySelector('.lt-shipeta')?.textContent || null,
      fee: n.querySelector('.lt-shipfee')?.textContent || null,
      delta: n.querySelector('.lt-shipdelta')?.textContent || null,
      selected: n.classList.contains('on'),
    }));
    const summary = document.querySelector('.lt-ordersummary');
    return {
      options: opts,
      summary: summary ? summary.textContent.replace(/\s+/g, ' ').trim() : null,
    };
  });

  const out = { addedProducts: added, standardSelected: await readCards() };
  await page.screenshot({ path: path.join(shotDir, '1-standard.png') });

  // Choose express the way a player does.
  await page.evaluate(() => {
    const express = [...document.querySelectorAll('.lt-shipopt')]
      .find((n) => /express/i.test(n.querySelector('.lt-shipname')?.textContent || ''));
    express?.click();
  });
  await page.waitForTimeout(400);
  out.expressSelected = await readCards();
  await page.screenshot({ path: path.join(shotDir, '2-express.png') });

  // Place it, and read what the sim actually recorded.
  const ordersBefore = await page.evaluate(() => window.__fw.state.shop.orders.length);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /place order/i.test(b.textContent || ''));
    btn?.click();
  });
  await page.waitForTimeout(600);
  // A confirmation dialog may stand in the way; take it.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => /place the order|confirm|yes/i.test(b.textContent || ''));
    btn?.click();
  });
  await page.waitForTimeout(800);
  out.placed = await page.evaluate((before) => {
    const orders = window.__fw.state.shop.orders;
    if (orders.length <= before) return { ok: false, reason: 'no order was created' };
    const o = orders[orders.length - 1];
    return {
      ok: true,
      lines: o.lines.length,
      shippingSpeed: o.shippingSpeed,
      leadDays: o.leadDays,
      standardLeadDays: o.standardLeadDays,
      shippingCost: o.shippingCost,
    };
  }, ordersBefore);
  await page.screenshot({ path: path.join(shotDir, '3-placed.png') });

  const std = out.standardSelected.options.find((o) => /standard/i.test(o.name || ''));
  const exp = out.expressSelected.options.find((o) => /express/i.test(o.name || ''));
  out.ok = out.standardSelected.options.length === 2
    && !!std && !!exp
    && /arrives/i.test(std.eta || '')
    && /arrives/i.test(exp.eta || '')
    && /sooner for/i.test(exp.delta || '')   // the trade, spelled out
    && exp.selected === true
    && out.placed.ok === true
    && out.placed.shippingSpeed === 'express'
    && out.placed.leadDays === out.placed.standardLeadDays - 1;
  fs.writeFileSync(path.join(outDir, 'express-shipping-checkout.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
