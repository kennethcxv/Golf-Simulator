async (page) => {
  // ROUND 3, IN A REAL BROWSER: fields take whole words, and the results screen is readable.
  //
  //   node tools/qa/run-playwright.cjs tools/qa/laptop-round3.js
  //
  // Two reports, both from the chair on 2026-07-30:
  //   A. "The pro shop product search only accepts one character… it loses focus after every
  //      keystroke." Typed here with the real keyboard, one character at a time, reading
  //      document.activeElement between keystrokes — the only instrument that can tell "the
  //      handler dropped it" apart from "the character never reached a focused element".
  //   B. The results screen: item name primary, path secondary, one row per result, filters
  //      only when they partition, no second page underneath, no stray Open bar.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.join(repo, 'qa', 'laptop-round3');
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

  // --- A. TYPING ----------------------------------------------------------------------------
  //
  // One character at a time, with the real keyboard, reading what holds focus in between.
  // A field that survives reports focused:true for every keystroke and ends holding the word.
  const typeWord = async (selector, word) => {
    await page.locator(selector).first().click({ timeout: 8000 });
    // The two Pro Shop searches share one table state, so the second field opens holding what
    // was typed into the first. What is under test is what THIS typing added.
    const before = await page.evaluate((sel) => document.querySelector(sel)?.value ?? '', selector);
    const focusTrace = [];
    for (const ch of word) {
      await page.keyboard.type(ch, { delay: 60 });
      await page.waitForTimeout(140);
      focusTrace.push(await page.evaluate((sel) => {
        const field = document.querySelector(sel);
        const active = document.activeElement;
        return {
          focused: !!field && active === field,
          activeTag: active ? active.tagName.toLowerCase() : null,
          value: field ? field.value : null,
        };
      }, selector));
    }
    const final = await page.evaluate((sel) => {
      const field = document.querySelector(sel);
      return { value: field ? field.value : null, present: !!field };
    }, selector);
    return {
      word,
      before,
      focusTrace,
      final,
      delivered: String(final.value || '').slice(before.length),
    };
  };

  const toolbar = await typeWord('.laptop-screen input.lt-search', 'kit');

  // Screenshot the results while "kit" is live — this is the frame the report is about.
  await page.waitForTimeout(500);
  const results = await page.evaluate(() => {
    const px = (n) => Math.round(n * 10) / 10;
    const screen = document.querySelector('.laptop-screen');
    const rows = [...document.querySelectorAll('.lt-hit')].map((row) => {
      const name = row.querySelector('.lt-hitname');
      const pathEl = row.querySelector('.lt-hitpath');
      const nameBox = name ? name.getBoundingClientRect() : null;
      const pathBox = pathEl ? pathEl.getBoundingClientRect() : null;
      const rowBox = row.getBoundingClientRect();
      return {
        name: name ? name.textContent : null,
        path: pathEl ? pathEl.textContent.replace(/\s+/g, ' ').trim() : null,
        nameFirst: !!nameBox && !!pathBox && nameBox.top < pathBox.top,
        nameFontPx: name ? parseFloat(getComputedStyle(name).fontSize) : null,
        pathFontPx: pathEl ? parseFloat(getComputedStyle(pathEl).fontSize) : null,
        nameTruncated: !!name && name.scrollWidth > name.clientWidth + 1,
        kindTag: (row.querySelector('.lt-hitkind') || {}).textContent || null,
        hasMark: !!row.querySelector('.lt-hitmark'),
        box: { x: px(rowBox.x), y: px(rowBox.y), w: px(rowBox.width), h: px(rowBox.height) },
      };
    });
    return {
      rows,
      headings: [...document.querySelectorAll('.laptop-screen .lt-h1')].map((n) => n.textContent),
      filterStrips: document.querySelectorAll('.lt-hitfilters').length,
      filterChips: [...document.querySelectorAll('.lt-hitfilters .lt-tab')].map((n) => n.textContent),
      previewPanels: document.querySelectorAll('.lt-searchpreview').length,
      previewBars: document.querySelectorAll('.lt-previewbar').length,
      openButtons: document.querySelectorAll('.lt-hitopen').length,
      railBox: (() => {
        const rail = document.querySelector('.lt-hitrail');
        if (!rail) return null;
        const b = rail.getBoundingClientRect();
        return { x: px(b.x), y: px(b.y), w: px(b.width), h: px(b.height) };
      })(),
      screenBox: screen ? (() => {
        const b = screen.getBoundingClientRect();
        return { w: px(b.width), h: px(b.height) };
      })() : null,
    };
  });
  await page.screenshot({ path: path.join(outDir, 'search-kit-viewport.png') });
  const screenLocator = page.locator('.laptop-screen');
  if (await screenLocator.count()) {
    await screenLocator.first().screenshot({ path: path.join(outDir, 'search-kit-screen.png') }).catch(() => {});
  }

  // Clear the query and go to the Pro Shop's Inventory tab — the reported field.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__fw.laptop.go('shop');
    const tab = [...document.querySelectorAll('.lt-tab')].find((b) => b.textContent.startsWith('Inventory'));
    if (tab) tab.click();
  });
  await page.waitForTimeout(600);

  const product = await typeWord('.laptop-screen [data-lt-field="shop-stock-search"]', 'glove');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, 'product-search-viewport.png') });
  if (await screenLocator.count()) {
    await screenLocator.first().screenshot({ path: path.join(outDir, 'product-search-screen.png') }).catch(() => {});
  }

  // The browse grid's own search, on the ordering tab.
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.lt-tab')].find((b) => b.textContent.startsWith('Orders'));
    if (tab) tab.click();
  });
  await page.waitForTimeout(600);
  const browse = await typeWord('.laptop-screen [data-lt-field="shop-order-search"]', 'towel');

  // Every input the laptop can draw must carry the focus key paint() restores by.
  const unkeyed = await page.evaluate(() => {
    const out = [];
    const pages = ['home', 'reservations', 'shop', 'course', 'upgrades', 'finances', 'settings'];
    for (const id of pages) {
      window.__fw.laptop.go(id);
      const tabs = [...document.querySelectorAll('.lt-tab')];
      const stops = tabs.length ? tabs.map((_, i) => i) : [-1];
      for (const i of stops) {
        if (i >= 0) {
          const live = [...document.querySelectorAll('.lt-tab')][i];
          if (live) live.click();
        }
        for (const input of document.querySelectorAll('.laptop-screen input')) {
          if (!input.getAttribute('data-lt-field')) out.push(`${id}: input[type=${input.type}]`);
        }
      }
    }
    return [...new Set(out)];
  });

  const allFocused = (t) => t.focusTrace.length > 0 && t.focusTrace.every((s) => s.focused === true);
  const kinds = new Set(results.rows.map((r) => r.kindTag));
  const findings = {
    laptopOpened,
    // A — the reported bug
    productSearchTookTheWholeWord: product.delivered === 'glove',
    productSearchKeptFocusThroughout: allFocused(product),
    browseSearchTookTheWholeWord: browse.delivered === 'towel',
    browseSearchKeptFocusThroughout: allFocused(browse),
    toolbarSearchTookTheWholeWord: toolbar.delivered === 'kit',
    toolbarSearchKeptFocusThroughout: allFocused(toolbar),
    everyInputCarriesAFocusKey: unkeyed.length === 0,
    // B — the results screen
    fourResultsForKit: results.rows.length === 4,
    repairKitFirst: results.rows[0]?.name === 'Clubhouse repair components',
    nameIsTheFirstLine: results.rows.length > 0 && results.rows.every((r) => r.nameFirst === true),
    nameIsLargerThanPath: results.rows.length > 0
      && results.rows.every((r) => r.nameFontPx > r.pathFontPx),
    noNameTruncated: results.rows.length > 0 && results.rows.every((r) => r.nameTruncated === false),
    everyRowStillNamesItsPage: results.rows.length > 0 && results.rows.every((r) => !!r.path),
    oneResultPerRow: results.rows.every((r, i) => i === 0
      || r.box.y >= results.rows[i - 1].box.y + results.rows[i - 1].box.h * 0.6),
    rowsSpanTheList: !!results.railBox && results.rows.every((r) => r.box.w >= results.railBox.w * 0.9),
    noFilterStripForOneKind: results.filterStrips === 0,
    noKindTagWhenAllOneKind: kinds.size === 1 && [...kinds][0] === null,
    noKindMarkWhenAllOneKind: results.rows.every((r) => r.hasMark === false),
    onlyTheSearchHeadingOnScreen: results.headings.length === 1 && /^Search — /.test(results.headings[0]),
    noPagePreviewedUnderneath: results.previewPanels === 0,
    noStrayOpenBar: results.previewBars === 0 && results.openButtons === 0,
  };

  const result = {
    what: 'round 3 — every laptop field takes a whole word; the "kit" results read name-first with no second page under them',
    findings,
    typing: { toolbar, product, browse },
    unkeyedInputs: unkeyed,
    results,
    shots: ['search-kit-viewport.png', 'search-kit-screen.png', 'product-search-viewport.png', 'product-search-screen.png'],
    errs: errs.slice(0, 12),
    ok: Object.values(findings).every((v) => v === true) && errs.length === 0,
  };
  fs.writeFileSync(path.join(outDir, 'laptop-round3.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
