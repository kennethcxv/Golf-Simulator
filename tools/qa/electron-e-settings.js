// SECTION E — VERIFY BEFORE REBUILDING, AND VERIFY AT THE WINDOW THAT SHIPS.
//
// Goal 16 claims to have fixed the scrollbar (E2), the reset-row spacing (E3)
// and the rebind display (E4). The brief still lists all three. Either it is
// describing the state before that work, or the fixes do not hold at the size
// A5 just made default - and that is a real risk, because A5 moved the window
// from 1600x940 to 2560x1370 DIP and FIVE CSS media queries flip state between
// those numbers.
//
// So this measures at the SHIPPED window, with nothing resized:
//
//   E2  which element actually scrolls - the panel, or the section inside it
//   E3  the gap between the reset button and the bottom of the page, plus a
//       sweep for any control whose box touches its container's edge
//   E4  rebind a key for real, then read the FORMATTED CONTROLS LIST and check
//       it shows the new key
//
// E4's negative control: read the list before the rebind too. If it already
// says what we are about to set it to, the check proves nothing.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/e-settings');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(8000);
  await page.bringToFront().catch(() => {});

  out.window = await page.evaluate(() => ({
    css: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio,
  }));

  await page.keyboard.press('p');
  await page.waitForSelector('.pause-panel', { timeout: 15000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('.pause-nav button, .pause-panel button')]
      .find((b) => /settings/i.test(b.textContent))?.click();
  });
  await page.waitForSelector('.settings-shell', { timeout: 15000 });

  const openTab = async (re) => {
    await page.evaluate((pattern) => {
      const rx = new RegExp(pattern, 'i');
      [...document.querySelectorAll('.settings-tab')].find((t) => rx.test(t.textContent))?.click();
    }, re);
    await page.waitForTimeout(450);
  };

  // ---- E2: WHAT ACTUALLY SCROLLS -------------------------------------
  await openTab('camera');
  out.e2 = await page.evaluate(() => {
    const scrollables = [];
    for (const sel of ['.settings-shell', '.settings-page', '.pause-content', '.settings-section']) {
      for (const el of document.querySelectorAll(sel)) {
        const can = el.scrollHeight > el.clientHeight + 1;
        const styles = getComputedStyle(el);
        if (can || /auto|scroll/.test(styles.overflowY)) {
          scrollables.push({
            sel,
            canScroll: can,
            overflowY: styles.overflowY,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
          });
        }
      }
    }
    return scrollables;
  });

  // ---- E3: THE RESET ROW, AND ANYTHING TOUCHING AN EDGE ---------------
  out.e3 = await page.evaluate(() => {
    const page_ = document.querySelector('.settings-page');
    const footer = document.querySelector('.settings-footer');
    const pr = page_?.getBoundingClientRect();
    const fr = footer?.getBoundingClientRect();
    const touching = [];
    if (pr) {
      for (const el of document.querySelectorAll('.settings-page *')) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const gapL = r.left - pr.left;
        const gapR = pr.right - r.right;
        // a control whose box reaches its container's edge
        if (gapL < 1 || gapR < 1) {
          touching.push({
            cls: (el.className || '').toString().slice(0, 40),
            gapL: +gapL.toFixed(1),
            gapR: +gapR.toFixed(1),
          });
        }
      }
    }
    return {
      resetFooterFound: !!footer,
      gapBelowResetRow: pr && fr ? +(pr.bottom - fr.bottom).toFixed(1) : null,
      elementsTouchingAnEdge: touching.length,
      firstFew: touching.slice(0, 5),
    };
  });

  // ---- E4: A REAL REBIND, AND THE LIST THAT SHOULD FOLLOW IT ---------
  await openTab('controls');
  const readControlsText = () => page.evaluate(() => {
    const page_ = document.querySelector('.settings-page');
    return page_ ? page_.textContent.replace(/\s+/g, ' ').slice(0, 4000) : '';
  });
  out.e4 = { before: await readControlsText() };
  // Change a binding through the preference store the panel writes to, then
  // ask the panel to re-render the way a rebind does.
  out.e4.rebind = await page.evaluate(() => {
    const prefs = window.__fw.preferences;
    const before = prefs.values.controls.bindings.moveForward;
    // pick a key the table is not already using
    const taken = new Set(Object.values(prefs.values.controls.bindings));
    const next = ['t', 'y', 'u', 'i', 'o'].find((k) => !taken.has(k)) || 't';
    prefs.set('controls.bindings.moveForward', next);
    return { before, next };
  });
  await page.waitForTimeout(900);
  out.e4.after = await readControlsText();
  const key = out.e4.rebind?.next;
  out.e4.listShowsNewKey = !!(key && new RegExp(`\\b${key}\\b`, 'i').test(out.e4.after));
  out.e4.listShowedItBefore = !!(key && new RegExp(`\\b${key}\\b`, 'i').test(out.e4.before));

  await page.screenshot({ path: path.join(OUT, 'e-controls-after-rebind.png') });
  fs.writeFileSync(path.join(OUT, 'e.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('E window', JSON.stringify(out.window));
  console.log('E2 scrollables', JSON.stringify(out.e2));
  console.log('E3', JSON.stringify(out.e3));
  console.log('E4', JSON.stringify({
    rebind: out.e4.rebind,
    listShowsNewKey: out.e4.listShowsNewKey,
    listShowedItBefore: out.e4.listShowedItBefore,
  }));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
