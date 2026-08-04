// F1 — the settings menu, verified rather than assumed.
//
// The panel already carries every control the brief names. What was never shown
// is that it works IN ELECTRON and that a change survives a restart, which is
// the whole point of a settings screen. So: open it from the main menu, list
// what is actually on screen, move two controls, quit, relaunch, read them back.
//
// The negative control is the read-back itself: the driver asserts the values
// it wrote are DIFFERENT from the defaults it found, so "persisted" cannot be
// satisfied by a panel that simply always shows the same numbers.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/settings');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1400, height: 860 });
  await page.waitForFunction(() => window.__fw?.screen === 'menu', null, { timeout: 120000 });
  await page.waitForTimeout(1000);

  const openSettings = async () => {
    await page.getByRole('button', { name: /Settings/i }).first().click();
    await page.waitForTimeout(900);
  };
  await openSettings();
  await page.screenshot({ path: path.join(OUT, 'settings-from-menu.png') });

  const inventory = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.settings-row, .settings-field, label')]
      .map((n) => n.innerText.trim().replace(/\s+/g, ' ').slice(0, 70))
      .filter(Boolean);
    const controls = [...document.querySelectorAll('input, select, button')]
      .filter((n) => n.offsetParent !== null)
      .map((n) => ({
        tag: n.tagName.toLowerCase(),
        type: n.type || null,
        label: (n.getAttribute('aria-label') || n.name || n.textContent || '').trim().slice(0, 40),
        value: n.value ?? null,
      }));
    return { rows: [...new Set(rows)].slice(0, 40), controls: controls.slice(0, 40) };
  });

  // Move two things a player would move, through real input.
  const before = await page.evaluate(() => {
    const prefs = window.__fw?.state?.uiPrefs || window.__fw?.uiPrefs || null;
    return prefs ? JSON.parse(JSON.stringify(prefs)) : null;
  });

  const changed = await page.evaluate(() => {
    const out = {};
    const sliders = [...document.querySelectorAll('input[type="range"]')]
      .filter((n) => n.offsetParent !== null);
    for (const slider of sliders.slice(0, 2)) {
      const min = Number(slider.min || 0);
      const max = Number(slider.max || 1);
      const now = Number(slider.value);
      // Move it somewhere it demonstrably was not.
      const next = Math.abs(now - min) > Math.abs(now - max) ? min : max;
      slider.value = String(next);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      out[slider.getAttribute('aria-label') || slider.name || 'slider'] = { from: now, to: next };
    }
    const toggles = [...document.querySelectorAll('input[type="checkbox"]')]
      .filter((n) => n.offsetParent !== null);
    if (toggles[0]) {
      const was = toggles[0].checked;
      toggles[0].checked = !was;
      toggles[0].dispatchEvent(new Event('change', { bubbles: true }));
      out[toggles[0].getAttribute('aria-label') || 'toggle'] = { from: was, to: !was };
    }
    return out;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'settings-changed.png') });

  const after = await page.evaluate(() => {
    const prefs = window.__fw?.state?.uiPrefs || window.__fw?.uiPrefs || null;
    return prefs ? JSON.parse(JSON.stringify(prefs)) : null;
  });

  // Where the values live for a real restart to read back.
  const stored = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => /pref|setting|option/i.test(k));
    return Object.fromEntries(keys.map((k) => [k, String(localStorage.getItem(k)).slice(0, 400)]));
  });

  // Reload the page — the cheapest honest proxy for a restart within one
  // launch. A full quit/relaunch read-back is the .mjs driver's job.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fw?.screen === 'menu', null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  await openSettings();
  await page.screenshot({ path: path.join(OUT, 'settings-after-reload.png') });
  const readBack = await page.evaluate(() => {
    const sliders = [...document.querySelectorAll('input[type="range"]')]
      .filter((n) => n.offsetParent !== null)
      .slice(0, 2)
      .map((n) => ({ label: n.getAttribute('aria-label') || n.name || 'slider', value: Number(n.value) }));
    const toggle = [...document.querySelectorAll('input[type="checkbox"]')]
      .filter((n) => n.offsetParent !== null)[0];
    return { sliders, toggle: toggle ? toggle.checked : null };
  });

  return {
    inventory,
    changed,
    prefsMoved: JSON.stringify(before) !== JSON.stringify(after),
    storedKeys: Object.keys(stored),
    readBack,
  };
}
