// I (Goal 20) — PHOTOGRAPH THE LOADING SCREEN, WHICH IS THE ONE SCREEN EVERY
// DRIVER IN THIS REPOSITORY IS BUILT TO WAIT OUT.
//
// Every boot helper blocks until `.load-veil` reaches opacity 0, so the screen
// the player stares at for thirteen seconds is the single screen nobody has
// ever taken a picture of. This one clicks New Game and then shoots the veil
// repeatedly WHILE it is up, so the tips can be read and the backdrop judged.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-i-loading-screen.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/i-loading');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, 'menu.png') });

  // The player's own route in, through the shared boot helper — the mode cards
  // are not <button>s, which is why the first version of this driver clicked
  // New Game and then sat on the dialog watching for a veil that never came.
  //
  // DELIBERATELY NOT AWAITED. Every other driver in the repository awaits this
  // and then waits for the veil to reach opacity 0, which is exactly why the
  // loading screen has never been photographed. The shot loop below runs
  // alongside it.
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  const booting = boot.clickThroughMenu(page, { forceNew: true }).catch(() => {});

  // Shoot the veil while it is up. The tip rotates every 2.4 s, so shots at
  // 1.2 s intervals catch several different ones.
  const shots = [];
  const t0 = Date.now();
  for (let i = 0; i < 22; i += 1) {
    await page.waitForTimeout(900);
    const state = await page.evaluate(() => {
      const v = document.querySelector('.load-veil');
      if (!v) return null;
      const style = getComputedStyle(v);
      return {
        visible: style.display !== 'none' && style.opacity !== '0',
        opacity: style.opacity,
        club: v.querySelector('.load-veil-club')?.textContent || '',
        title: v.querySelector('.load-veil-title')?.textContent || '',
        step: v.querySelector('.load-veil-step')?.textContent || '',
        tip: v.querySelector('.load-veil-tip')?.textContent || '',
        fill: v.querySelector('.load-veil-fill')?.style.width || '',
        // E (Goal 21): what is PAINTED, not what exists. The check this
        // replaces counted DOM nodes under .load-veil-scene and called that a
        // backdrop -- the same error as X3, where every CSS property was
        // correct and the element was behind the canvas.
        plateImage: (() => {
          const p = v.querySelector(".load-veil-plate");
          if (!p) return null;
          const bg = getComputedStyle(p).backgroundImage || "";
          const m = bg.match(/([^/"\)]+.jpg)/);
          return m ? m[1] : null;
        })(),
        plateIsPainted: (() => {
          const p = v.querySelector(".load-veil-plate");
          if (!p) return false;
          const r = p.getBoundingClientRect();
          const top = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height * 0.22));
          return !!top && (top === p || v.contains(top));
        })(),
        place: v.querySelector(".load-veil-place")?.textContent || "",
        sceneNodes: v.querySelectorAll(".load-veil-plate, .load-veil-scrim").length,
      };
    });
    if (!state) continue; // the veil is created lazily on the first show()
    shots.push({ atMs: Date.now() - t0, ...state });
    await page.screenshot({ path: path.join(OUT, `veil-${String(i).padStart(2, '0')}.png`) });
    if (!state.visible) break;
  }

  await booting;
  const visible = shots.filter((s) => s.visible);
  const out = {
    veilSeconds: visible.length ? +(visible.at(-1).atMs / 1000).toFixed(1) : 0,
    frames: shots.length,
    club: visible[0]?.club || null,
    plate: visible[0]?.plateImage || null,
    place: visible[0]?.place || null,
    sceneNodes: visible[0]?.sceneNodes || 0,
    distinctTips: [...new Set(visible.map((s) => s.tip).filter(Boolean))],
    steps: [...new Set(visible.map((s) => s.step).filter(Boolean))],
    errs,
  };
  out.checks = {
    clubNamed: !!out.club,
    // three: the sun and two horizon bands. The clubhouse and flag were tried
    // and removed after the photograph showed the flagpole crossing the title.
    hasBackdrop: out.sceneNodes >= 2,
    plateIsARealImage: !!(visible[0] && visible[0].plateImage),
    plateIsActuallyPainted: !!(visible[0] && visible[0].plateIsPainted),
    placeIsNamed: !!(visible[0] && visible[0].place && visible[0].place.length > 4),
    tipsRotate: out.distinctTips.length >= 2,
    progressMoves: new Set(visible.map((s) => s.fill)).size >= 2,
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'loading.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
