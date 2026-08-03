async (page) => {
  // Revived 2026-07-28 (HARNESS_TRUST.md remediation): BASE_URL was an MCP-REPL-era
  // global no committed runner defines; the committed runner's contract is QA_BASE_URL.
  const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';
  // EVERY PAGE, THROUGH THE GLASS, WITH A REAL MOUSE.
  //
  // Not `laptopUi.go('orders')` — that would prove the page renders, which is not the claim.
  // The claim is that the interface is a physical object you can operate: so the cursor is moved
  // to where the nav button ACTUALLY LANDS on the projected quad, and clicked there. If the
  // matrix3d were off by so much as a nav row, these clicks would land on the wrong application
  // and the run would say so.

  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  const OUT = process.getBuiltinModule('node:path').join(
    process.env.QA_REPO_ROOT || process.cwd(), 'qa', 'laptop', 'pages',
  );
  const log = [];

  await page.goto(BASE_URL);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1200);
  // Continue when the profile has a save; a fresh profile founds an empire and buys the
  // cheapest listed course — the same two clicks a new player makes.
  // The menu itself is the shared boot now (qa-boot.mjs); what stays here is
  // the part that is this driver's own — a fresh profile must also BUY the
  // cheapest listed course before there is anything to tour.
  const { clickThroughMenu } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`);
  const bootMode = await clickThroughMenu(page);
  if (bootMode === 'new-game') {
    await page.waitForTimeout(900);
    const buy = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
        .filter((b) => b.textContent.trim() === 'Buy' && !b.disabled);
      if (!btns.length) return null;
      const r = btns[0].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!buy) throw new Error('marketplace: no affordable Buy button');
    await page.mouse.click(buy.x, buy.y);
  }
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 40000 });
  await page.waitForTimeout(2500);

  // Give the club something to actually manage, so the pages are not all empty states:
  // some closed days on the books, stock, staff, orders, a booking. This is the SIM's own
  // machinery — nothing is written straight onto a screen.
  await page.evaluate(async () => {
    const app = window.__fw;
    const st = app.state;
    const shop = await import('/src/sim/shop.js');
    const staff = await import('/src/sim/staff.js');
    const resv = await import('/src/sim/reservations.js');
    const time = await import('/src/sim/time.js');

    st.cash = 60000;
    st.shop.unlockedTier = 3;
    for (const id of Object.keys(st.shop.inventory)) { st.shop.inventory[id].shelf = 6; st.shop.inventory[id].back = 3; }
    st.shop.inventory.balls1.shelf = 0; st.shop.inventory.balls1.back = 0;   // a real sellout
    st.shop.inventory.glove1.shelf = 1;                                       // a real low line

    // seven closed trading days, so velocity/days-of-supply/best-sellers have real history
    for (let d = 0; d < 7; d++) {
      shop.recordSale(st, 'balls3', 2 + (d % 3));
      shop.recordSale(st, 'glove1', 1);
      if (d % 2 === 0) shop.recordSale(st, 'polo1', 1);
      shop.rollSalesWindow(st);
    }
    st.shop.salesYesterday = { units: 6, revenue: 214 };
    st.shop.lostSalesYesterday = 2;
    st.club.lastRounds = 41;
    st.club.prevRounds = 33;

    // orders on the truck, in different states
    shop.placeOrder(st, 'balls3', 24);
    shop.placeOrder(st, 'polo1', 8);
    shop.placeOrder(st, 'driver1', 2);
    if (st.shop.orders[1]) st.shop.orders[1].status = 'processing';
    if (st.shop.orders[2]) st.shop.orders[2].status = 'out';

    // a hire and a booking
    const cal = time.calendarOf(st.clock.minutes);
    staff.refreshMarketIfDue(st, cal.dayAbs);
    if (st.staff.market[0]) staff.hireStaff(st, st.staff.market[0].id);
    const sheet = resv.daySheet(st, cal.dayAbs);
    const free = sheet.filter((s) => !s.res).slice(0, 3);
    for (const s of free) resv.bookSlot(st, cal.dayAbs, s.minute, `Guest ${100 + s.minute % 90}`);

    // a couple of closed days in the ledger so Finances and the sparkline have something
    if (!st.ledger.history) st.ledger.history = [];
    for (let d = 0; d < 8; d++) {
      st.ledger.history.push({
        label: `Day ${cal.dayAbs - 8 + d}`, dayAbs: cal.dayAbs - 8 + d,
        revenue: { greenFees: 800 + d * 60, shopSales: 180 + (d % 4) * 40, rentals: 54 },
        expenses: { wagesStaff: 300, utilities: 45, shopOrders: d % 3 === 0 ? 420 : 0, rent: d === 6 ? 950 : 0 },
      });
    }

    st.clock.minutes = Math.floor(st.clock.minutes / 1440) * 1440 + 9 * 60 + 20;
    app.scene3d.applyTimeWeather(9 * 60 + 20, st.weather);
  });
  await page.waitForTimeout(900);

  // Sit at the LIVE laptop (2026-07-28): the fixed (8.45, 4.5) office stand
  // predates the laptop's move to the front desk — [E] hit nothing and the
  // tour timed out on laptopOpen. Two-stand retry is fov-parity's proven sit.
  {
    let opened = false;
    for (const stand of ['chair', 'north']) {
      await page.evaluate(async (which) => {
        const app = window.__fw;
        const L = await import('/src/data/shopLayout.js');
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
      await page.waitForTimeout(600);
      await page.keyboard.press('e');
      opened = await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 6000 })
        .then(() => true).catch(() => false);
      if (opened) break;
    }
    if (!opened) throw new Error('laptop did not open from either live stand');
  }
  await page.waitForFunction(() => { const r = document.querySelector('.laptop-screen'); return r && r.style.display !== 'none'; }, null, { timeout: 15000 });
  // the camera is still easing; wait for the projection to STOP MOVING rather than for a clock
  await page.waitForFunction(() => {
    const f = document.querySelector('.lt-frame');
    if (!f) return false;
    const r = f.getBoundingClientRect();
    const prev = window.__settle || {};
    window.__settle = { x: r.left, y: r.top, w: r.width };
    return Math.abs((prev.x ?? 0) - r.left) < 0.05 && Math.abs((prev.w ?? 0) - r.width) < 0.05 && r.width > 100;
  }, null, { timeout: 15000, polling: 120 });
  await page.waitForTimeout(300);

  // every nav destination, clicked where it really is on the glass — the seven pages
  // Live sidebar labels (laptop.js NAV, 2026-07-28): the MCP-era list said
  // Tee Times/Shop/Finances — two of those buttons no longer exist by name.
  const PAGES = [
    'Home', 'Bookings', 'Pro Shop', 'Course', 'Upgrades', 'Business', 'Settings',
  ];

  for (const label of PAGES) {
    const spot = await page.evaluate((lbl) => {
      const btns = [...document.querySelectorAll('.lt-navbtn')];
      const b = btns.find((x) => x.textContent.trim().includes(lbl));
      if (!b) return null;
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    }, label);
    if (!spot) { log.push({ page: label, ok: false, why: 'no nav button' }); continue; }

    await page.mouse.move(spot.x, spot.y);
    await page.waitForTimeout(90);            // let :hover paint
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(420);

    const state = await page.evaluate(() => {
      const h1 = document.querySelector('.lt-h1');
      const err = document.querySelector('.lt-err');
      const c = document.querySelector('.lt-content');
      return {
        title: h1 ? h1.textContent.trim() : null,
        activeNav: (document.querySelector('.lt-navbtn.on') || {}).textContent?.trim() || null,
        // an .lt-err that says "could not be drawn" is the shell catching a page that threw
        crashed: !!(err && /could not be drawn/.test(err.textContent)),
        errText: err ? err.textContent.trim().slice(0, 120) : null,
        thumbs: document.querySelectorAll('.lt-prodimg').length,
        emptyStates: document.querySelectorAll('.lt-empty').length,
        scrollable: c ? c.scrollHeight > c.clientHeight : false,
        nodes: c ? c.querySelectorAll('*').length : 0,
      };
    });
    const slug = label.toLowerCase().replace(/[^a-z]+/g, '-');
    await page.screenshot({ path: `${OUT}/${slug}.png` });
    log.push({
      page: label,
      title: state.title,
      navHighlighted: state.activeNav,
      clickLandedRight: !!(state.activeNav && state.activeNav.includes(label)),
      crashed: state.crashed,
      err: state.crashed ? state.errText : undefined,
      thumbs: state.thumbs,
      nodes: state.nodes,
    });
  }

  return {
    log,
    crashes: log.filter((l) => l.crashed).map((l) => `${l.page}: ${l.err}`),
    misclicks: log.filter((l) => !l.clickLandedRight).map((l) => l.page),
    errs: errs.slice(0, 8),
    errCount: errs.length,
  };
}
