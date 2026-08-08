// G2 — SWEEP EVERY SCREEN FOR OVERLAPPING TEXT AND CRAMPED EDGES.
//
// The brief, after naming the tee-time screen: "Then sweep every screen in the
// game for overlapping text and cramped edges and fix all of it — front desk,
// laptop, ledger, HUD, menus, register glass. Report every one you found with
// the screen and the strings."
//
// The front desk and the ledger are CANVAS and have their own recorders. This
// covers the DOM screens, where the only honest measurement is real layout:
// getBoundingClientRect after the browser has laid the page out.
//
// WHAT COUNTS AS AN OVERLAP. Only LEAF text nodes are compared — an element
// containing another element overlaps it by definition, and reporting that is
// noise. Two leaves whose rects intersect by more than a couple of pixels in
// both axes are drawing on top of each other.
//
// WHAT COUNTS AS A CRAMPED EDGE. A visible leaf whose box comes within
// EDGE_MIN px of its scroll container's padding box, on a side that is not
// meant to be flush. Deliberately full-bleed elements (a header bar, a
// backdrop) are excluded by a size test: something as wide as its container is
// meant to be.
//
// NEGATIVE CONTROLS, both required before any clean result means anything:
//   1. a planted pair of absolutely-positioned overlapping spans MUST be found
//   2. a planted element flush against its container's edge MUST be found
// If either plant is missed the sweep is blind and its zeros are worthless.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/g2-screensweep');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], screens: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(8000);

  out.window = await page.evaluate(() => ({
    css: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio,
  }));

  // The measurement, run inside the page against real layout.
  await page.evaluate(() => {
    const EDGE_MIN = 8;      // closer than this to a container edge is cramped
    const OVERLAP_MIN = 3;   // px in BOTH axes before two leaves count as stacked

    const isLeafText = (el) => {
      if (!el.textContent || !el.textContent.trim()) return false;
      // a leaf for our purposes: no element child that itself carries text
      for (const child of el.children) {
        if (child.textContent && child.textContent.trim()) return false;
      }
      return true;
    };
    const visible = (el, r) => {
      if (r.width < 3 || r.height < 3) return false;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') return false;
      if (Number(s.opacity) < 0.05) return false;
      return true;
    };

    window.__g2sweep = (screen, rootSel) => {
      const root = rootSel ? document.querySelector(rootSel) : document.body;
      if (!root) return { screen, missing: rootSel, leaves: 0, overlaps: [], cramped: [] };
      const leaves = [];
      for (const el of root.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (!visible(el, r)) continue;
        if (!isLeafText(el)) continue;
        leaves.push({
          el,
          r,
          text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 46),
          cls: (el.className || '').toString().slice(0, 30),
        });
      }

      const overlaps = [];
      for (let i = 0; i < leaves.length; i += 1) {
        for (let j = i + 1; j < leaves.length; j += 1) {
          const a = leaves[i];
          const b = leaves[j];
          // an ancestor/descendant pair is not an overlap
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (ox > OVERLAP_MIN && oy > OVERLAP_MIN) {
            overlaps.push({
              a: a.text, b: b.text, aCls: a.cls, bCls: b.cls,
              overlapW: Math.round(ox), overlapH: Math.round(oy),
              at: `${Math.round(Math.max(a.r.left, b.r.left))},${Math.round(Math.max(a.r.top, b.r.top))}`,
            });
          }
        }
      }

      const cramped = [];
      for (const leaf of leaves) {
        // the nearest ancestor that actually bounds it
        let host = leaf.el.parentElement;
        while (host && host !== root) {
          const hs = getComputedStyle(host);
          if (/auto|scroll|hidden/.test(hs.overflowY) || /auto|scroll|hidden/.test(hs.overflowX)) break;
          host = host.parentElement;
        }
        if (!host || host === leaf.el) continue;
        const hr = host.getBoundingClientRect();
        if (hr.width < 20 || hr.height < 20) continue;
        // full-bleed by design: as wide as its host
        if (leaf.r.width >= hr.width - 2) continue;
        // MEASURE THE INK, NOT THE BOX. A tab button flush against its panel is
        // not cramped if the button carries its own padding - the TEXT inside is
        // still clear of the edge. Measuring the element rect reported 41 tab
        // buttons as cramped when nothing was touching anything. Subtract the
        // leaf's own padding and the host's, so both sides are content boxes.
        const ls = getComputedStyle(leaf.el);
        const ink = {
          left: leaf.r.left + parseFloat(ls.paddingLeft || 0),
          right: leaf.r.right - parseFloat(ls.paddingRight || 0),
          top: leaf.r.top + parseFloat(ls.paddingTop || 0),
          bottom: leaf.r.bottom - parseFloat(ls.paddingBottom || 0),
        };
        // AGAINST THE HOST'S BORDER BOX, NOT ITS CONTENT BOX.
        //
        // Subtracting the host padding too made this worse, not better: it
        // reported every left-aligned heading in a padded panel, because aligned
        // content sits at exactly 0 from the content edge BY DESIGN. What
        // "cramped" actually means is that the panel has no breathing room at
        // all - so the gap that matters is from the text's ink to the inside of
        // the panel's border. A host with 16px of padding reads 16 and passes;
        // a host with none reads 0 and is the defect.
        const gaps = {
          left: ink.left - hr.left,
          right: hr.right - ink.right,
          top: ink.top - hr.top,
          bottom: hr.bottom - ink.bottom,
        };
        // A SCROLL VIEWPORT'S EDGE IS NOT A CRAMPED EDGE.
        //
        // In a container with more content than height, whatever sits at the
        // bottom is being CLIPPED BY SCROLL, not squeezed by a missing padding -
        // scrolling reveals it and the layout was never wrong. Reporting it puts
        // every long list in the laptop on the defect list. The along-scroll
        // edges are therefore only judged when the container cannot scroll.
        const scrollsY = host.scrollHeight > host.clientHeight + 1;
        const scrollsX = host.scrollWidth > host.clientWidth + 1;
        for (const [side, gap] of Object.entries(gaps)) {
          if ((side === 'top' || side === 'bottom') && scrollsY) continue;
          if ((side === 'left' || side === 'right') && scrollsX) continue;
          if (gap >= 0 && gap < EDGE_MIN) {
            cramped.push({
              text: leaf.text, cls: leaf.cls, side, gap: Math.round(gap),
              host: (host.className || host.tagName || '').toString().slice(0, 30),
            });
          }
        }
      }
      // INVARIANT 2: NO TEXT IS EVER CUT OFF.
      //
      // Three ways a DOM node loses its text, and all three are silent:
      //   * ellipsis  - text-overflow clips it and draws a "..."
      //   * clipped   - overflow hidden and the content is wider than the box
      //   * squashed  - the box is shorter than one line of its own text
      // A node that SCROLLS is not cut off: the text is reachable.
      const truncated = [];
      for (const leaf of leaves) {
        const st = getComputedStyle(leaf.el);
        const el = leaf.el;
        const overflowsX = el.scrollWidth > el.clientWidth + 1;
        const overflowsY = el.scrollHeight > el.clientHeight + 1;
        const canScrollX = /auto|scroll/.test(st.overflowX);
        const canScrollY = /auto|scroll/.test(st.overflowY);
        let why = null;
        if (overflowsX && st.textOverflow === 'ellipsis') why = 'ellipsis';
        else if (overflowsX && st.overflowX === 'hidden') why = 'clipped-x';
        else if (overflowsY && st.overflowY === 'hidden') why = 'clipped-y';
        if (why && !(canScrollX || canScrollY)) {
          truncated.push({
            text: leaf.text, cls: leaf.cls, why,
            shownPx: Math.round(el.clientWidth),
            neededPx: Math.round(el.scrollWidth),
          });
        }
      }

      return {
        screen, leaves: leaves.length,
        overlaps: overlaps.slice(0, 25),
        overlapCount: overlaps.length,
        cramped: cramped.slice(0, 25),
        crampedCount: cramped.length,
        truncated: truncated.slice(0, 25),
        truncatedCount: truncated.length,
      };
    };
  });

  const sweep = (screen, rootSel = null) => page.evaluate(
    ([s, r]) => window.__g2sweep(s, r), [screen, rootSel],
  );

  // ---- THE CONTROLS, before anything else ----------------------------------
  out.controls = await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = '__g2control';
    host.style.cssText = 'position:fixed;left:60px;top:60px;width:300px;height:200px;'
      + 'overflow:auto;background:#fff;z-index:99999;';
    // 1. two spans deliberately stacked
    const a = document.createElement('span');
    a.textContent = 'PLANTED OVERLAP A';
    a.style.cssText = 'position:absolute;left:20px;top:40px;';
    const b = document.createElement('span');
    b.textContent = 'PLANTED OVERLAP B';
    b.style.cssText = 'position:absolute;left:24px;top:44px;';
    // 2. one element flush against the host's left edge
    const c = document.createElement('span');
    c.textContent = 'PLANTED FLUSH EDGE';
    c.style.cssText = 'position:absolute;left:0px;top:150px;padding:0;';
    host.append(a, b, c);
    document.body.appendChild(host);
    // 3. a node whose text cannot fit and is clipped with no way to scroll
    const t = document.createElement('div');
    t.textContent = 'PLANTED TRUNCATION that is far too long for its box';
    t.style.cssText = 'position:absolute;left:10px;top:100px;width:60px;'
      + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    host.appendChild(t);
    const found = window.__g2sweep('control', '#__g2control');
    document.body.removeChild(host);
    return {
      plantedOverlapFound: found.overlaps.some(
        (o) => /PLANTED OVERLAP/.test(o.a) && /PLANTED OVERLAP/.test(o.b),
      ),
      plantedEdgeFound: found.cramped.some((c2) => /PLANTED FLUSH EDGE/.test(c2.text)),
      plantedTruncationFound: (found.truncated || []).some((t2) => /PLANTED TRUNCATION/.test(t2.text)),
      raw: { overlaps: found.overlapCount, cramped: found.crampedCount, truncated: found.truncatedCount },
    };
  });

  // ---- THE SCREENS ---------------------------------------------------------
  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `g2-${name}.png`) });
  };

  // 1. the HUD, as the player stands in the room
  out.screens.push(await sweep('hud'));
  await shot('hud');

  // 2. the pause menu
  await page.keyboard.press('p');
  await page.waitForSelector('.pause-panel', { timeout: 15000 });
  out.screens.push(await sweep('pause', '.pause-panel'));
  await shot('pause');

  // 3. settings, every tab
  await page.evaluate(() => {
    [...document.querySelectorAll('.pause-nav button, .pause-panel button')]
      .find((b) => /settings/i.test(b.textContent))?.click();
  });
  await page.waitForSelector('.settings-shell', { timeout: 15000 }).catch(() => {});
  for (const tab of ['display', 'camera', 'audio', 'controls', 'accessibility', 'gameplay']) {
    const opened = await page.evaluate((pattern) => {
      const rx = new RegExp(pattern, 'i');
      const t = [...document.querySelectorAll('.settings-tab')].find((x) => rx.test(x.textContent));
      if (!t) return false;
      t.click();
      return true;
    }, tab);
    if (!opened) continue;
    await page.waitForTimeout(500);
    out.screens.push(await sweep(`settings:${tab}`, '.settings-shell'));
    await shot(`settings-${tab}`);
  }

  // 4. back to the world, then the laptop and every page it offers
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__fw.scene3d.walk.hooks?.openLaptop?.());
  await page.waitForTimeout(2500);
  // The laptop's real classes are `lt-*` (laptop.js). The earlier guess at
  // `.laptop-nav button` matched nothing, so the sweep silently covered the home
  // page only and reported it as "the laptop".
  const LT_ROOT = '.lt-shell, .lt-screen, .lt-content';
  out.screens.push(await sweep('laptop:Home', LT_ROOT));
  await shot('laptop-home');

  const navLabels = await page.evaluate(() => [...document.querySelectorAll('.lt-navbtn')]
    .map((n) => n.textContent.trim()).filter(Boolean));
  out.laptopPages = navLabels;
  for (const label of navLabels) {
    const spot = await page.evaluate((want) => {
      const b = [...document.querySelectorAll('.lt-navbtn')]
        .find((x) => x.textContent.trim() === want);
      if (!b) return null;
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, label);
    if (!spot) continue;
    // clicked where it really is on the projected glass, like laptop-tour does
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(600);
    out.screens.push(await sweep(`laptop:${label}`, LT_ROOT));

    // and every sub-tab this page offers, which is where the 24 pages live
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.lt-tab, .lt-subnav button')]
      .map((n) => n.textContent.trim()).filter(Boolean).slice(0, 8));
    for (const tab of tabs) {
      const at = await page.evaluate((want) => {
        const t = [...document.querySelectorAll('.lt-tab, .lt-subnav button')]
          .find((x) => x.textContent.trim() === want);
        if (!t) return null;
        const r = t.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, tab);
      if (!at) continue;
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(450);
      out.screens.push(await sweep(`laptop:${label}/${tab}`, LT_ROOT));
    }
  }
  await shot('laptop-last');

  // ---- VERDICT -------------------------------------------------------------
  const totalOverlaps = out.screens.reduce((a, s) => a + (s.overlapCount || 0), 0);
  const totalCramped = out.screens.reduce((a, s) => a + (s.crampedCount || 0), 0);
  const totalTruncated = out.screens.reduce((a, s) => a + (s.truncatedCount || 0), 0);
  out.verdict = {
    controlsValid: out.controls.plantedOverlapFound && out.controls.plantedEdgeFound
      && out.controls.plantedTruncationFound,
    plantedTruncationFound: out.controls.plantedTruncationFound,
    totalTruncated,
    plantedOverlapFound: out.controls.plantedOverlapFound,
    plantedEdgeFound: out.controls.plantedEdgeFound,
    screensSwept: out.screens.length,
    totalOverlaps,
    totalCramped,
    worst: out.screens
      .filter((s) => (s.overlapCount || 0) + (s.crampedCount || 0) > 0)
      .map((s) => `${s.screen}: ${s.overlapCount} overlaps, ${s.crampedCount} cramped`),
  };
  fs.writeFileSync(path.join(OUT, 'g2.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('G2 verdict', JSON.stringify(out.verdict));
  for (const s of out.screens) {
    if (!s.overlapCount && !s.crampedCount && !s.truncatedCount) continue;
    console.log(`G2 ${s.screen}: overlaps=${s.overlapCount} cramped=${s.crampedCount}`);
    for (const o of (s.overlaps || []).slice(0, 4)) {
      console.log(`   OVERLAP "${o.a}" x "${o.b}" ${o.overlapW}x${o.overlapH}px at ${o.at}`);
    }
    for (const c of (s.cramped || []).slice(0, 4)) {
      console.log(`   CRAMPED "${c.text}" ${c.side} gap ${c.gap}px in .${c.host}`);
    }
    for (const t2 of (s.truncated || []).slice(0, 4)) {
      console.log(`   CUT OFF "${t2.text}" ${t2.why} ${t2.shownPx}px shown of ${t2.neededPx}px`);
    }
  }
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
