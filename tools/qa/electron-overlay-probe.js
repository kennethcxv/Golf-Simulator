async (page) => {
  await page.waitForFunction(() => !!document.querySelector('.menu-screen button'), null, { timeout: 180000 });
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.menu-screen button')].find((n) => !n.disabled);
    const rect = b.getBoundingClientRect();
    const cx = Math.round(rect.x + rect.width / 2);
    const cy = Math.round(rect.y + rect.height / 2);
    const top = document.elementFromPoint(cx, cy);
    const chain = [];
    for (let n = top; n && chain.length < 6; n = n.parentElement) {
      chain.push(`${n.tagName}.${String(n.className||'').trim().replace(/\s+/g,'.').slice(0,40)}`);
    }
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      buttonRect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      centre: { cx, cy },
      topElement: top ? `${top.tagName}.${String(top.className||'').trim()}` : null,
      chain,
      isButtonInChain: chain.some((c) => c.startsWith('BUTTON')),
    };
  });
  console.log('OVERLAY', JSON.stringify(r, null, 2));
  return r;
}
