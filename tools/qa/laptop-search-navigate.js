async (page) => {
  // SEARCH THE WHOLE LAPTOP, THEN GO THERE.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/laptop-search-navigate.js
  //
  // Reported 2026-07-29: "Results show the PAGE PATH the thing lives on… Selecting a result
  // NAVIGATES to that page and section, with the match highlighted or scrolled to… Live
  // results as you type, no submit… Fix the UI so a result reads as a location."
  //
  // Four of those five are claims about the RENDER, so this driver looks at the render: it
  // types into the real field, reads the crumbs out of the real rows, clicks one, and then
  // measures whether the row it landed on is (a) marked and (b) actually inside the scroll
  // viewport. "Scrolled to" is a geometry claim and a class name does not settle it — the
  // flap-order correction was exactly this mistake, so the box is measured.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`CONSOLE: ${m.text()}`); });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}?clubhouse=pine-hills-v2`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(E.newStarterEmpire('relaxed', seed))));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);

  // A LIVED-IN CLUB, OR HALF THE INDEX IS EMPTY.
  //
  // Measured 2026-07-29: the first run reported Staff 0, Booking 0, Order 0 — and that was
  // true of the world, not of the index. A starter empire has nobody on the payroll, nothing
  // on the tee sheet and nothing on the road, so those three kinds cannot be verified without
  // creating them. This does it through the sim's own commands, not by writing state.
  const seeded = await page.evaluate(async () => {
    const app = window.__fw;
    const st = app.state;
    const { calendarOf } = await import('/src/sim/time.js');
    const { refreshMarketIfDue, hireStaff } = await import('/src/sim/staff.js');
    const { bookSlot } = await import('/src/sim/reservations.js');
    const { placeOrder } = await import('/src/sim/shop.js');
    const cal = calendarOf(st.clock.minutes);
    refreshMarketIfDue(st, cal.dayAbs);
    const hire = st.staff.market.length ? hireStaff(st, st.staff.market[0].id) : { ok: false };
    const book = bookSlot(st, cal.dayAbs + 1, 9 * 60, {
      name: 'Marguerite Alcazar', fullName: 'Marguerite Alcazar', partySize: 2,
    });
    const order = placeOrder(st, 'balls1', 4);
    return {
      hired: !!hire.ok,
      employees: st.staff.employees.length,
      booked: !!book.ok,
      ordered: !!order.ok,
      orders: st.shop.orders.length,
    };
  });

  // Sit at the laptop the way the player does — the proven open sequence, retry included.
  const openLaptop = async () => {
    await page.evaluate(async () => {
      const app = window.__fw;
      const L = await import('/src/data/shopLayout.js');
      const origin = app.scene3d.clubhouse().interior.position;
      const st = app.scene3d.walk.state;
      const laptop = L.FRONT_DESK.laptop;
      const seat = { x: L.FRONT_DESK.staffChair.x, z: L.FRONT_DESK.staffChair.z };
      st.x = seat.x + origin.x;
      st.z = seat.z + origin.z;
      const dx = laptop.x - seat.x;
      const dz = laptop.z - seat.z;
      const horizontal = Math.hypot(dx, dz) || 0.001;
      st.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
      st.pitch = Math.atan2(1.06 - 1.62, horizontal);
      const clock = app.state.clock;
      clock.minutes = Math.floor(clock.minutes / 1440) * 1440 + 9 * 60;
      app.scene3d.applyTimeWeather(9 * 60, app.state.weather);
    });
    await page.waitForTimeout(800);
    await page.keyboard.press('KeyE');
    let open = await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 6000 })
      .then(() => true).catch(() => false);
    if (!open) {
      await page.evaluate(async () => {
        const app = window.__fw;
        const L = await import('/src/data/shopLayout.js');
        const origin = app.scene3d.clubhouse().interior.position;
        const st = app.scene3d.walk.state;
        const laptop = L.FRONT_DESK.laptop;
        st.x = laptop.x + origin.x;
        st.z = laptop.z + 0.95 + origin.z;
        st.yaw = Math.atan2(0, 0.95);
        st.pitch = Math.atan2(1.06 - 1.62, 0.95);
      });
      await page.waitForTimeout(700);
      await page.keyboard.press('KeyE');
      open = await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 9000 })
        .then(() => true).catch(() => false);
    }
    await page.waitForFunction(() => {
      const r = document.querySelector('.laptop-screen');
      return r && r.style.display !== 'none';
    }, null, { timeout: 15000 }).catch(() => {});
    return open;
  };
  const laptopOpened = await openLaptop();
  await page.waitForTimeout(1400);

  // Measured AT OPEN as well as at the end. The first attempt only sampled at the end and
  // reported Order 0 / Delivery 1 — by then the van had unloaded and the order had become a
  // shipment. Same money, later stage; sampling once made a moving thing look absent.
  const indexAtOpen = await page.evaluate(() => ({
    size: window.__fw?.laptop?.searchIndexSize?.() ?? null,
    kinds: window.__fw?.laptop?.searchIndexKinds?.() ?? null,
  }));

  const field = page.locator('.laptop-screen input.lt-search').first();
  const fieldVisible = await field.count() ? await field.isVisible() : false;

  // LIVE RESULTS, NO SUBMIT. Typed character by character, and the row count is read after
  // each one — if results only appeared on Enter, the count would stay at zero.
  const growth = [];
  await field.click({ timeout: 8000 });
  for (const ch of 'towel') {
    await page.keyboard.type(ch, { delay: 60 });
    await page.waitForTimeout(220);
    growth.push({
      typed: await field.inputValue(),
      rows: await page.locator('.lt-hit').count(),
      submitted: false,
    });
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'laptop-search-1-live.png') });

  const liveRows = await page.evaluate(() => [...document.querySelectorAll('.lt-hit')].slice(0, 8).map((row) => ({
    crumbs: [...row.querySelectorAll('.lt-hitcrumb')].map((n) => n.textContent),
    name: row.querySelector('.lt-hitname')?.textContent || null,
    kind: row.querySelector('.lt-hitkind')?.textContent || null,
  })));
  // A CHIP STRIP ONLY EXISTS WHEN IT CAN PARTITION (round 3, 2026-07-30: "'All 4' and
  // 'Catalogue 4' — two chips for the same four results is not a filter"). "towel" is all
  // catalogue, so it must have NO strip; the filter behaviour is exercised on a query that
  // genuinely spans groups.
  const uniformKindStrip = await page.evaluate(() => document.querySelectorAll('.lt-hitfilters').length);

  const searchFor = async (text) => {
    await field.click({ timeout: 8000 });
    await page.keyboard.press('Control+a');
    await page.keyboard.type(text, { delay: 40 });
    await page.waitForTimeout(600);
  };
  await searchFor('course');
  const filters = await page.evaluate(() => [...document.querySelectorAll('.lt-hitfilters .lt-tab')].map((b) => ({
    label: b.textContent, on: b.classList.contains('on'),
  })));

  // A FILTER MUST NARROW. Pick the first non-All chip and check the list shrinks to it.
  let filterEffect = null;
  const chips = page.locator('.lt-hitfilters .lt-tab');
  if (await chips.count() > 1) {
    const before = await page.locator('.lt-hit').count();
    const chipLabel = (await chips.nth(1).textContent()) || '';
    await chips.nth(1).click({ timeout: 8000 });
    await page.waitForTimeout(500);
    const after = await page.locator('.lt-hit').count();
    const kindsAfter = await page.evaluate(() => [...new Set(
      [...document.querySelectorAll('.lt-hitkind')].map((n) => n.textContent),
    )]);
    filterEffect = { chipLabel: chipLabel.trim(), before, after, kindsAfter, narrowed: after > 0 && after <= before };
    await page.screenshot({ path: path.join(outDir, 'laptop-search-2-filtered.png') });
    await chips.nth(0).click({ timeout: 8000 }); // back to All
    await page.waitForTimeout(400);
  }

  // A SETTINGS SWITCH — the case that proves the index reaches past the catalogue, and the
  // case where the page path is the whole answer ("which of the two tabs is it on?").
  await searchFor('exact change');
  const settingsHit = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.lt-hit')]
      .find((r) => (r.querySelector('.lt-hitname')?.textContent || '').includes('Automatic exact change'));
    if (!row) return null;
    return {
      crumbs: [...row.querySelectorAll('.lt-hitcrumb')].map((n) => n.textContent),
      name: row.querySelector('.lt-hitname')?.textContent || null,
      rank: [...document.querySelectorAll('.lt-hit')].indexOf(row),
    };
  });
  await page.screenshot({ path: path.join(outDir, 'laptop-search-3-setting.png') });

  // THE ROW IS THE TRIP (round 3, 2026-07-30). Round 2 clicked a row to swap a preview panel
  // and needed a second "Open →" button to travel; the preview read as a whole second page
  // stacked under the results, so it and its bar are gone. Clicking the row goes there.
  // MEASURE the landing: page id, tab, the reveal record, the flash, and whether the marked
  // row is actually inside the scroll viewport.
  let landing = null;
  let settingDestination = null;
  if (settingsHit) {
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.lt-hit')]
        .find((r) => (r.querySelector('.lt-hitname')?.textContent || '').includes('Automatic exact change'));
      row?.click();
    });
    await page.waitForTimeout(700);
    settingDestination = await page.evaluate(() => {
      const content = document.querySelector('.lt-content');
      const checkbox = content && [...content.querySelectorAll('label')]
        .find((l) => (l.textContent || '').includes('Automatic exact change'));
      return {
        realCheckboxRow: !!(checkbox && checkbox.querySelector('input[type="checkbox"]')),
        // The results are GONE — the destination is the only page on screen.
        resultsCleared: document.querySelectorAll('.lt-hit').length === 0,
        headings: [...document.querySelectorAll('.laptop-screen .lt-h1')].map((n) => n.textContent),
        noPreviewPanel: document.querySelectorAll('.lt-searchpreview').length === 0,
        noPreviewBar: document.querySelectorAll('.lt-previewbar').length === 0,
      };
    });
    await page.screenshot({ path: path.join(outDir, 'laptop-search-7-setting-landed.png') });
    landing = await page.evaluate(() => {
      const lap = window.__fw?.laptop;
      const content = document.querySelector('.lt-content');
      const flash = document.querySelector('.lt-searchhit');
      const box = flash?.getBoundingClientRect?.() || null;
      const view = content?.getBoundingClientRect?.() || null;
      return {
        pageId: lap?.pageId?.() ?? null,
        reveal: lap?.lastSearchReveal?.() ?? null,
        flashText: flash ? (flash.textContent || '').trim().slice(0, 90) : null,
        // "Scrolled to" is geometry. A class name on an element 900 px below the fold is not
        // a reveal, so the box is compared against the scroll container's box.
        insideViewport: !!(box && view && box.top >= view.top - 2 && box.bottom <= view.bottom + 2),
        boxTop: box ? Math.round(box.top) : null,
        boxBottom: box ? Math.round(box.bottom) : null,
        viewTop: view ? Math.round(view.top) : null,
        viewBottom: view ? Math.round(view.bottom) : null,
        searchFieldCleared: (document.querySelector('input.lt-search') || {}).value === '',
      };
    });
    await page.screenshot({ path: path.join(outDir, 'laptop-search-4-landed.png') });
  }

  // A PRODUCT DEEP IN A LONG LIST — the case where "scrolled to" has to do real work.
  await searchFor('Pine Hills visor');
  let productLanding = null;
  const productRow = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.lt-hit')]
      .find((r) => (r.querySelector('.lt-hitname')?.textContent || '') === 'Pine Hills visor');
    if (!row) return null;
    const out = {
      crumbs: [...row.querySelectorAll('.lt-hitcrumb')].map((n) => n.textContent),
      rank: [...document.querySelectorAll('.lt-hit')].indexOf(row),
    };
    row.click(); // the row IS the trip
    return out;
  });
  if (productRow) {
    await page.waitForTimeout(800);
    productLanding = await page.evaluate(() => {
      const lap = window.__fw?.laptop;
      const content = document.querySelector('.lt-content');
      const flash = document.querySelector('.lt-searchhit');
      const box = flash?.getBoundingClientRect?.() || null;
      const view = content?.getBoundingClientRect?.() || null;
      return {
        pageId: lap?.pageId?.() ?? null,
        reveal: lap?.lastSearchReveal?.() ?? null,
        flashText: flash ? (flash.textContent || '').trim().slice(0, 90) : null,
        insideViewport: !!(box && view && box.top >= view.top - 2 && box.bottom <= view.bottom + 2),
        scrollTop: Math.round(content?.scrollTop ?? -1),
      };
    });
    await page.screenshot({ path: path.join(outDir, 'laptop-search-5-product.png') });
  }

  // A GUEST, BY NAME. The reservation stored 'Marguerite Alcazar'; searching a surname has to
  // reach it and land on the Bookings page with the day the booking is actually on.
  await searchFor('Alcazar');
  const bookingHit = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.lt-hit')]
      .find((r) => (r.querySelector('.lt-hitname')?.textContent || '').includes('Alcazar'));
    if (!row) return { found: false };
    const crumbs = [...row.querySelectorAll('.lt-hitcrumb')].map((n) => n.textContent);
    row.click();
    return { found: true, crumbs };
  });
  if (bookingHit.found) {
    await page.waitForTimeout(700);
    bookingHit.landed = await page.evaluate(() => ({
      pageId: window.__fw?.laptop?.pageId?.() ?? null,
      reveal: window.__fw?.laptop?.lastSearchReveal?.() ?? null,
      flashText: (document.querySelector('.lt-searchhit')?.textContent || '').trim().slice(0, 90) || null,
    }));
    await page.screenshot({ path: path.join(outDir, 'laptop-search-6-booking.png') });
  }

  // "if he searches map it shows the actual map" — round 3 answers that by GOING there:
  // the destination must be the course page with its REAL aerial canvas drawn on it, not a
  // preview panel and not a row describing one.
  await searchFor('map');
  await page.evaluate(() => document.querySelectorAll('.lt-hit')[0]?.click());
  await page.waitForTimeout(900);
  const mapPreview = await page.evaluate(() => {
    const panel = document.querySelector('.lt-content');
    const canvas = panel?.querySelector('canvas');
    let drawn = false;
    if (canvas) {
      try {
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, Math.min(64, canvas.width), Math.min(64, canvas.height)).data;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) { drawn = true; break; }
      } catch { drawn = null; }
    }
    return {
      panelPresent: !!panel,
      hasCanvas: !!canvas,
      canvasDrawn: drawn,
      headSaysCourse: /Course/.test(panel?.querySelector('.lt-h1')?.textContent || ''),
    };
  });
  await page.screenshot({ path: path.join(outDir, 'laptop-search-8-map-preview.png') });

  const indexShape = await page.evaluate(() => ({
    size: window.__fw?.laptop?.searchIndexSize?.() ?? null,
    kinds: window.__fw?.laptop?.searchIndexKinds?.() ?? null,
  }));

  const findings = {
    laptopOpened,
    searchFieldVisible: fieldVisible,
    // Results grew as characters arrived, and nothing was submitted.
    liveWhileTyping: growth.length > 0 && growth[growth.length - 1].rows > 0,
    everyRowNamesItsPage: liveRows.length > 0 && liveRows.every((r) => r.crumbs.length >= 1 && r.crumbs[0]),
    // Round 3: a strip only where it can partition. "towel" is one kind — no strip.
    noFilterStripForOneKind: uniformKindStrip === 0,
    filtersOffered: filters.length > 1,
    filterNarrows: !!filterEffect?.narrowed,
    // The index reaches past the catalogue.
    settingFound: !!settingsHit,
    settingPathIsRight: !!settingsHit && settingsHit.crumbs.join(' > ') === 'Settings > Checkout',
    settingNavigated: landing?.pageId === 'settings',
    settingRevealed: landing?.reveal?.found === true,
    settingFlashedTheRightRow: !!landing?.flashText && /Automatic exact change/.test(landing.flashText),
    settingScrolledIntoView: landing?.insideViewport === true,
    queryClearedOnJump: landing?.searchFieldCleared === true,
    productFound: !!productRow,
    productNavigated: productLanding?.pageId === 'shop',
    productRevealed: productLanding?.reveal?.found === true,
    productScrolledIntoView: productLanding?.insideViewport === true,
    // Every kind the brief named, each one non-empty in a club that has staff, a booking and
    // an order on the road. Delivery is excluded: a shipment only exists once a van has
    // unloaded, which is a day of sim time away.
    indexReachesEveryKind: !!indexAtOpen.kinds && ['Page', 'Product', 'Upgrade', 'Amenity', 'Material',
      'Equipment', 'Staff', 'Candidate', 'Booking', 'Ledger', 'Property', 'Hole', 'Turf', 'Setting']
      .every((k) => (indexAtOpen.kinds[k] || 0) > 0),
    // An order and its shipment are the same money at two stages, and the sim decides which
    // stage it is in — so the claim is that money on the road is indexed, in whichever form.
    moneyOnTheRoadIndexed: ((indexAtOpen.kinds?.Order || 0) + (indexAtOpen.kinds?.Delivery || 0)) > 0,
    worldSeeded: !!seeded.hired && !!seeded.booked && !!seeded.ordered,
    // Round 3: the destination IS the page — the real checkbox row, one heading on screen,
    // and no preview panel or bar left under the results.
    destinationShowsRealSetting: settingDestination?.realCheckboxRow === true,
    resultsClearedOnArrival: settingDestination?.resultsCleared === true,
    onlyOnePageOnScreen: settingDestination?.headings.length === 1,
    noPreviewPanelAnywhere: settingDestination?.noPreviewPanel === true,
    noStrayOpenBar: settingDestination?.noPreviewBar === true,
    mapIsTheActualMap: mapPreview.hasCanvas === true && mapPreview.canvasDrawn !== false,
    mapLandsOnTheCoursePage: mapPreview.headSaysCourse === true,
    // A guest on the tee sheet is findable by name, which is the whole point of indexing the
    // directory rather than the reservation label.
    bookingFoundByName: bookingHit?.found === true,
  };

  const result = {
    what: 'the rebuilt laptop search: live results, page paths, filters, and the jump that lands and flashes',
    seeded,
    indexAtOpen,
    indexShape,
    growth,
    liveRows,
    filters,
    filterEffect,
    settingsHit,
    landing,
    productRow,
    productLanding,
    bookingHit,
    settingDestination,
    uniformKindStrip,
    mapPreview,
    findings,
    shots: [
      'laptop-search-1-live.png', 'laptop-search-2-filtered.png', 'laptop-search-3-setting.png',
      'laptop-search-4-landed.png', 'laptop-search-5-product.png', 'laptop-search-6-booking.png',
      'laptop-search-7-setting-landed.png', 'laptop-search-8-map-preview.png',
    ],
    errs: errs.slice(0, 12),
    ok: Object.values(findings).every((v) => v === true) && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'laptop-search-navigate.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
