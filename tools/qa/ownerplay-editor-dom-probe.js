// EDITOR DEAD-INPUT DOM PROBE — what invisible thing eats the clicks.
//   node tools/qa/run-electron.cjs tools/qa/ownerplay-editor-dom-probe.js --clubhouse=pine-hills-v2
async (page) => {
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  await page.mouse.click(vp.w / 2, vp.h / 2);
  await page.waitForTimeout(400);
  await page.keyboard.press('j');
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const stack = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      .slice(0, 8)
      .map((e) => {
        const cs = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return {
          tag: `${e.tagName}.${String(e.className).slice(0, 40)}`,
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          z: cs.zIndex,
          pe: cs.pointerEvents,
          op: cs.opacity,
          vis: cs.visibility,
          bg: cs.backgroundColor,
        };
      });
    const veils = [...document.querySelectorAll('.ced-modal-veil')].map((v) => ({
      children: v.children.length,
      html: v.innerHTML.slice(0, 200),
      opacity: getComputedStyle(v).opacity,
      display: getComputedStyle(v).display,
    }));
    const minis = [...document.querySelectorAll('.ced-mini')].map((c) => {
      const r = c.getBoundingClientRect();
      return {
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        parentChain: (() => { let s = ''; let n = c; for (let i = 0; i < 4 && n; i += 1, n = n.parentElement) s += `${n.tagName}.${String(n.className).slice(0, 30)}/`; return s; })(),
      };
    });
    return { stack, veils, minis };
  });
  console.log(JSON.stringify(out, null, 1));
  return out;
}
