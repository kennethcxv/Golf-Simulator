async (page) => {
  const base = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const out = process.env.QA_OUTPUT_DIR || 'qa/steam-release-polish/baseline/menu';
  const findings = [];

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(base);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.screenshot({ path: `${out}/01-main-menu.png` });
  const menu = await page.evaluate(() => ({
    title: document.querySelector('.menu-screen h1')?.textContent?.trim() || '',
    tagline: document.querySelector('.tagline')?.textContent?.trim() || '',
    footnote: document.querySelector('.footnote')?.textContent?.trim() || '',
    buttons: [...document.querySelectorAll('.menu-buttons button')].map((button) => ({
      text: button.textContent.trim(),
      disabled: button.disabled,
    })),
  }));
  if (/working build|placeholder art/i.test(menu.footnote)) {
    findings.push({ severity: 'Blocker', issue: 'The public main menu explicitly calls the game a working build with placeholder art.' });
  }

  await page.getByText('New Empire — Relaxed', { exact: true }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/02-new-game-route.png` });
  const newGame = await page.evaluate(() => ({
    screen: window.__fw?.screen || null,
    visibleHeading: [...document.querySelectorAll('h1,h2,h3')]
      .find((node) => getComputedStyle(node).display !== 'none')?.textContent?.trim() || null,
  }));

  return { menu, newGame, findings };
}
