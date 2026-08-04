// F5 — "Play the first ten minutes as though you have never seen the game.
// Write down every moment where you would not know what to do next."
//
// This driver does not judge anything. It boots a genuinely clean profile and
// photographs the beats a first-time player passes through, in order, with the
// HUD left ON — so the list that follows is written from what is on the screen
// rather than from what the code says is there.
//
// Nothing here is an assertion. The deliverable is the list.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/first-run');
  fs.mkdirSync(OUT, { recursive: true });
  const shot = async (name) => page.screenshot({ path: path.join(OUT, name) });
  const notes = [];
  const note = (beat, detail) => notes.push({ beat, ...detail });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);

  // ---- beat 1: the very first screen ---------------------------------------
  await shot('01-title.png');
  note('title', await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => ({ text: b.textContent.trim().slice(0, 40), disabled: b.disabled }));
    return { buttons, bodyText: document.body.innerText.slice(0, 400) };
  }));

  await page.getByRole('button', { name: /New game/i }).click();
  await page.waitForTimeout(700);
  await shot('02-difficulty.png');
  note('difficulty', await page.evaluate(() => ({
    cards: [...document.querySelectorAll('.difficulty-card')].map((c) => c.textContent.trim().slice(0, 220)),
  })));

  await page.locator('.difficulty-card').filter({ hasText: 'Relaxed' }).click();
  const startBtn = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await startBtn.isVisible({ timeout: 1500 }).catch(() => false)) await startBtn.click();

  // ---- beat 2: the load, and how long a stranger stares at it ---------------
  const loadStart = Date.now();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 180000 });
  const toWalk = Date.now() - loadStart;
  await shot('03-first-frame.png');
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 180000 }).catch(() => {});
  const toPlayable = Date.now() - loadStart;
  await page.waitForTimeout(2500);
  await shot('04-spawn.png');
  note('load', { msToWalkActive: toWalk, msToVeilGone: toPlayable });

  // ---- beat 3: what the game is telling them, unprompted -------------------
  note('hud', await page.evaluate(() => {
    const visible = (el) => el && el.offsetParent !== null
      && getComputedStyle(el).visibility !== 'hidden';
    const grab = (sel) => [...document.querySelectorAll(sel)]
      .filter(visible).map((n) => n.innerText.trim().replace(/\s+/g, ' ').slice(0, 200));
    return {
      objectives: grab('.objectives-card, .objectives-panel, .objective'),
      toasts: grab('.notification, .notification-center, .toast'),
      walkOverlay: grab('.walk-overlay'),
      hud: grab('.hud, .hud-min'),
      prompt: window.__fw.scene3d.walk.getFocusLabel(),
    };
  }));

  // ---- beat 4: turn on the spot and list everything that offers itself -----
  const offers = [];
  for (let step = 0; step < 12; step += 1) {
    await page.evaluate((i) => {
      window.__fw.scene3d.walk.state.yaw = (i / 12) * Math.PI * 2;
      window.__fw.scene3d.walk.state.pitch = -0.05;
    }, step);
    await page.waitForTimeout(320);
    const label = await page.evaluate(() => window.__fw.scene3d.walk.getFocusLabel());
    if (label) offers.push({ yawStep: step, label });
  }
  note('offers-on-the-spot', { distinct: [...new Set(offers.map((o) => o.label))] });
  await shot('05-looking-around.png');

  // ---- beat 5: what the game considers the objective right now -------------
  note('campaign', await page.evaluate(() => {
    const app = window.__fw;
    const st = app.state;
    return {
      campaignEnabled: !!st.campaign?.enabled,
      businessOpen: !!st.campaign?.businessOpen,
      money: st.money ?? null,
      day: Math.floor(st.clock.minutes / 1440),
      clock: st.clock.minutes % 1440,
      shopSignOpen: !!st.shop?.signOpen,
      facilities: st.campaign?.facilities ? Object.keys(st.campaign.facilities)
        .filter((k) => st.campaign.facilities[k]) : null,
      objectives: app.campaignObjectives ? app.campaignObjectives() : null,
    };
  }));

  // ---- beat 6: the tools a stranger might reach for -------------------------
  note('belt', await page.evaluate(async () => {
    const { CLEANING_TOOLS } = await import(new URL('src/data/cleaningTools.js', document.baseURI).href);
    const app = window.__fw;
    const owned = [];
    for (const t of Object.values(CLEANING_TOOLS)) {
      app.scene3d.walk.setTool(t.id);
      owned.push({ id: t.id, took: app.scene3d.walk.getTool() === t.id, belt: !!t.belt });
    }
    app.scene3d.walk.setTool(null);
    return { tools: owned };
  }));

  fs.writeFileSync(path.join(OUT, 'first-run.json'), `${JSON.stringify({ notes }, null, 2)}\n`);
  return { notes };
}
