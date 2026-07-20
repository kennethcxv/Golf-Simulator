async (page) => {
  // Boot diagnostics: what state does the game reach, and what does the console say?
  const errs = [];
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + (e.stack || e.message).slice(0, 500)));
  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(3000);
  const menuState = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 12);
    return {
      hasFw: !!window.__fw,
      screen: window.__fw ? window.__fw.screen : null,
      buttons,
    };
  });
  // fresh profile: New Empire → the marketplace opens → buy the cheapest course
  await page.getByText('New Empire — Relaxed', { exact: true }).click({ timeout: 5000 })
    .catch((e) => logs.push('New Empire click failed: ' + String(e && e.message).slice(0, 200)));
  await page.waitForTimeout(2500);
  const market = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => t).slice(0, 24),
    marketNodes: document.querySelectorAll('.market, .market-card, .modal, .mkt').length,
  }));
  logs.push(JSON.stringify(market));
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => ({
    screen: window.__fw ? window.__fw.screen : null,
    hasScene: !!(window.__fw && window.__fw.scene3d),
    hasClubhouse: !!(window.__fw && window.__fw.scene3d && window.__fw.scene3d.clubhouse && window.__fw.scene3d.clubhouse()),
    veil: (() => { const v = document.querySelector('.load-veil'); return v ? getComputedStyle(v).display + '/' + getComputedStyle(v).opacity : 'none'; })(),
  }));
  return { menuState, after, logs, errs: errs.slice(0, 10) };
}
