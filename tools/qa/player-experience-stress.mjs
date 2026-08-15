import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const URL = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8463/';
const OUT = path.join(ROOT, 'qa', 'player-experience-polish', 'stress');
await fs.mkdir(OUT, { recursive: true });

const result = {
  url: URL,
  viewport: { width: 1440, height: 900 },
  firstTime: {},
  settings: {},
  tutorials: {},
  saves: {},
  pauseModes: {},
  stress: {},
  audio: {},
  returning: {},
  screenshots: [],
};
const consoleMessages = [];
const pageErrors = [];
const requestFailures = [];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--force-color-profile=srgb', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const context = await browser.newContext({
  viewport: result.viewport,
  deviceScaleFactor: 1,
  locale: 'en-US',
  colorScheme: 'dark',
});
await context.addInitScript(() => {
  try {
    if (localStorage.getItem('golfempire:qa-context-ready') !== '1') {
      localStorage.clear();
      localStorage.setItem('golfempire:qa-context-ready', '1');
    }
  } catch { /* opaque about:blank pages do not expose storage */ }
  let seed = 0x6d2b79f5;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const stats = { adds: 0, removes: 0, byType: {} };
  EventTarget.prototype.addEventListener = function patchedAdd(type, listener, options) {
    if (this === window || this === document) {
      stats.adds += 1;
      stats.byType[type] = (stats.byType[type] || 0) + 1;
    }
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function patchedRemove(type, listener, options) {
    if (this === window || this === document) stats.removes += 1;
    return remove.call(this, type, listener, options);
  };
  window.__qaGlobalListeners = stats;
});

const page = await context.newPage();
page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text().slice(0, 1200) }));
page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
page.on('requestfailed', (request) => requestFailures.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' }));

async function shot(name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  result.screenshots.push(path.relative(ROOT, file).replaceAll('\\', '/'));
}

async function waitForWorld() {
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(700);
}

async function openPause() {
  await page.keyboard.press('p');
  await page.locator('.pause-veil-ui').waitFor({ state: 'visible', timeout: 5_000 });
}

async function closePause() {
  await page.keyboard.press('p');
  await page.locator('.pause-veil-ui').waitFor({ state: 'detached', timeout: 5_000 });
}

async function pauseProbe(label) {
  const before = await page.evaluate(() => ({
    mode: document.body.dataset.uiMode,
    speed: window.__fw.speedIdx,
    audio: window.__fw.audio.debugStats(),
  }));
  await openPause();
  const during = await page.evaluate(() => ({
    mode: document.body.dataset.uiMode,
    speed: window.__fw.speedIdx,
    audio: window.__fw.audio.debugStats(),
    focusInside: !!document.activeElement?.closest('.pause-veil-ui'),
  }));
  await closePause();
  const after = await page.evaluate(() => ({
    mode: document.body.dataset.uiMode,
    speed: window.__fw.speedIdx,
    audio: window.__fw.audio.debugStats(),
  }));
  result.pauseModes[label] = { before, during, after };
}

async function setRange(name, value) {
  await page.getByRole('slider', { name }).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('.menu-screen').waitFor({ state: 'visible' });
  result.firstTime = await page.evaluate(() => ({
    continueDisabled: document.querySelector('.menu-action-primary')?.disabled ?? null,
    saveStatus: document.querySelector('.menu-save-state')?.dataset.state || null,
  }));

  // Exercise real settings controls before the first game and verify their shared store.
  await page.locator('.menu-action').filter({ hasText: /^Settings/ }).click();
  await page.getByRole('tab', { name: 'Camera' }).click();
  await setRange('Mouse sensitivity', 1.35);
  await page.locator('.setting-row').filter({ hasText: /^Invert vertical look/ }).getByRole('button').click();
  await setRange('Field of view', 74);
  await page.locator('.setting-row').filter({ hasText: /^Camera movement/ }).getByRole('button').click();
  await page.getByRole('tab', { name: 'Audio' }).click();
  await setRange('Master volume', 0.6);
  const mute = page.locator('.setting-row').filter({ hasText: /^Mute all audio/ }).getByRole('button');
  await mute.click();
  await mute.click();
  await page.getByRole('tab', { name: 'Display' }).click();
  await setRange('Interface scale', 1.1);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  result.settings.beforeGame = await page.evaluate(() => window.__fw.preferences.values);

  await page.locator('.menu-action').filter({ hasText: /^New game/ }).click();
  await page.locator('.difficulty-card').filter({ hasText: /^Relaxed/ }).click();
  await page.locator('.market-listing').first().waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  await waitForWorld();
  await page.evaluate(() => {
    window.__fw.speedIdx = 0;
    const c = window.__fw.state.clock;
    c.minutes = Math.floor(c.minutes / 1440) * 1440 + 14 * 60;
  });
  result.settings.inGame = await page.evaluate(() => window.__fw.preferences.values);
  result.stress.listenersBefore = await page.evaluate(() => ({ ...window.__qaGlobalListeners }));

  // Tutorial disable/reset through the in-game settings surface.
  result.tutorials.initial = await page.evaluate(() => ({ ...window.__fw.state.tutorial }));
  await openPause();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Accessibility' }).click();
  await page.getByRole('button', { name: 'Disable guidance', exact: true }).click();
  await closePause();
  result.tutorials.disabled = await page.evaluate(() => ({
    state: { ...window.__fw.state.tutorial },
    cardVisible: getComputedStyle(document.querySelector('.objectives-card')).display !== 'none',
  }));
  await openPause();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Accessibility' }).click();
  await page.getByRole('button', { name: 'Reset tutorials', exact: true }).click();
  await closePause();
  result.tutorials.reset = await page.evaluate(() => ({
    state: { ...window.__fw.state.tutorial },
    cardVisible: getComputedStyle(document.querySelector('.objectives-card')).display !== 'none',
  }));

  // Save success, explicit write failure, corrupt/unsupported/recovered inspection.
  await openPause();
  await page.getByRole('button', { name: 'Save game', exact: true }).click();
  const slot1Save = page.locator('.slot-card').nth(0).getByRole('button', { name: 'Save here' });
  await slot1Save.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelectorAll('.slot-act')[0]?.disabled);
  await slot1Save.click();
  await page.waitForFunction(() => document.querySelector('.pause-status')?.textContent.includes('Saved to slot 1'));
  result.saves.success = await page.evaluate(() => ({
    slot: !!localStorage.getItem('golfempire:slot1'),
    metadata: !!localStorage.getItem('golfempire:slot1-meta'),
    status: document.querySelector('.pause-status')?.textContent,
  }));
  await page.evaluate(() => {
    window.__qaStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function failSlot2(key, value) {
      if (String(key).startsWith('golfempire:slot2')) throw new DOMException('QA write denied', 'QuotaExceededError');
      return window.__qaStorageSet.call(this, key, value);
    };
  });
  const slot2Save = page.locator('.slot-card').nth(1).getByRole('button', { name: 'Save here' });
  await slot2Save.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelectorAll('.slot-act')[1]?.disabled);
  await slot2Save.click();
  await page.waitForFunction(() => document.querySelector('.pause-status')?.textContent.includes('could not be saved'));
  result.saves.failure = await page.locator('.slot-card').nth(1).innerText();
  await shot('01-save-failure');
  await page.evaluate(() => {
    Storage.prototype.setItem = window.__qaStorageSet;
    delete window.__qaStorageSet;
    const slot1 = localStorage.getItem('golfempire:slot1');
    localStorage.setItem('golfempire:slot1.backup', slot1);
    localStorage.setItem('golfempire:slot1', '{ damaged latest copy');
    localStorage.setItem('golfempire:slot3', JSON.stringify({ empireVersion: 999 }));
    localStorage.removeItem('golfempire:slot3.backup');
  });
  await page.getByRole('button', { name: 'Load game', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.slot-card')].every((card) => card.getAttribute('aria-busy') === 'false'));
  result.saves.inspection = await page.locator('.slot-card').allInnerTexts();
  await shot('02-save-recovery-and-version-guard');
  await page.evaluate(() => {
    const backup = localStorage.getItem('golfempire:slot1.backup');
    localStorage.setItem('golfempire:slot1', backup);
  });
  await closePause();

  // Universal pause ownership across the real player modes.
  await page.evaluate(() => { window.__fw.speedIdx = 2; });
  await pauseProbe('walk');
  await page.evaluate(() => { window.__fw.speedIdx = 0; });

  await page.keyboard.down('f');
  await page.waitForTimeout(300);
  await page.keyboard.up('f');
  await page.locator('.tool-wheel').waitFor({ state: 'visible' });
  await openPause();
  result.pauseModes.toolWheel = await page.evaluate(() => ({
    pauseOpen: !!document.querySelector('.pause-veil-ui'),
    wheelDisplay: getComputedStyle(document.querySelector('.tool-wheel')).display,
    audio: window.__fw.audio.debugStats(),
  }));
  await closePause();

  await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    app.scene3d.walk.state.x = origin.x;
    app.scene3d.walk.state.z = origin.z;
  });
  await page.keyboard.press('b');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().build.isActive());
  await pauseProbe('placement');
  await page.keyboard.press('b');

  await page.evaluate(() => {
    const app = window.__fw;
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk;
    walk.state.x = 8.45 + origin.x;
    walk.state.z = 4.5 + origin.z;
    walk.state.yaw = -Math.PI / 2;
    walk.state.pitch = -0.05;
  });
  await page.waitForTimeout(350);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.laptopOpen === true);
  await pauseProbe('laptop');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.laptopOpen === false);

  await page.evaluate(() => {
    const app = window.__fw;
    const inv = app.state.shop.inventory.balls3;
    inv.shelf = Math.max(inv.shelf, 10);
    app.scene3d.clubhouse().rebuildStock();
    app.scene3d.clubhouse().sendToCounter(['balls3'], 'card');
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x + 2.80;
    walk.z = origin.z + 5.10;
    walk.yaw = 0;
    walk.pitch = -0.18;
  });
  await page.waitForFunction(() => !!window.__fw.scene3d.clubhouse().register.getTx(), null, { timeout: 15_000 });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive());
  await pauseProbe('register');
  // Register Escape is intentionally hierarchical: step back to the monitor,
  // clear any selected service context, then leave from the home workspace.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const active = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.isActive());
    if (!active) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => !window.__fw.scene3d.clubhouse().register.isActive());

  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__fw.courseMode === 'overview');
  await pauseProbe('overview');
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.courseMode === 'editor');
  await pauseProbe('course-editor');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__fw.courseMode === 'overview');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__fw.courseMode === 'walk');

  // One hundred full pause cycles and one hundred camera-mode transitions.
  await page.evaluate(() => { window.__fw.speedIdx = 2; });
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press('p');
    await page.waitForFunction(() => !!document.querySelector('.pause-veil-ui'));
    await page.keyboard.press('p');
    await page.waitForFunction(() => !document.querySelector('.pause-veil-ui'));
  }
  result.stress.pauseCycles = await page.evaluate(() => ({
    completed: 100,
    speed: window.__fw.speedIdx,
    pauseNodes: document.querySelectorAll('.pause-veil-ui').length,
    audio: window.__fw.audio.debugStats(),
  }));
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press('Tab');
    if (index % 10 === 9) await page.waitForTimeout(20);
  }
  result.stress.modeTransitions = await page.evaluate(() => ({
    completed: 100,
    courseMode: window.__fw.courseMode,
    presentationMode: document.body.dataset.uiMode,
    pauseNodes: document.querySelectorAll('.pause-veil-ui').length,
  }));

  // Notification burst: cap, priority queue, dedupe count, and cleanup.
  result.stress.notifications = await page.evaluate(async () => {
    const ui = await import(new URL('src/ui/ui.js', document.baseURI).href);
    for (let index = 0; index < 70; index += 1) ui.notify({ message: 'Repeated stock update', category: 'low-stock', duration: 250, dedupeKey: 'qa-repeat' });
    for (let index = 0; index < 30; index += 1) ui.notify({ message: `QA burst ${index}`, category: index % 7 === 0 ? 'invalid' : 'info', duration: 80, dedupeKey: `qa-${index}` });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const initial = {
      visible: document.querySelectorAll('.notification').length,
      repeatText: [...document.querySelectorAll('.notification')].map((node) => node.textContent).find((text) => text.includes('Repeated stock update')) || null,
    };
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const after = document.querySelectorAll('.notification').length;
    ui.clearNotifications();
    return { initial, after };
  });

  // Long held washer use, background lifecycle, and loop cleanup.
  await page.evaluate(() => {
    const app = window.__fw;
    app.preferences.set('accessibility.toolActivation', 'hold');
    const origin = app.scene3d.clubhouse().interior.position;
    const walk = app.scene3d.walk.state;
    walk.x = origin.x + 6.5;
    walk.z = origin.z + 15.5;
    walk.yaw = 0;
    walk.pitch = 0;
    document.activeElement?.blur();
  });
  await page.locator('canvas').click({ position: { x: 720, y: 450 } });
  await page.keyboard.down('f');
  await page.waitForTimeout(300);
  await page.keyboard.up('f');
  await page.locator('.tool-wheel').waitFor({ state: 'visible' });
  await page.locator('.tool-wheel-item').filter({ hasText: 'Rented washer' }).click();
  await page.waitForFunction(() => window.__fw.scene3d.walk.getTool() === 'washer');
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(2500);
  result.audio.held = await page.evaluate(() => window.__fw.audio.debugStats());

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(350);
  result.audio.background = await page.evaluate(() => window.__fw.audio.debugStats());
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(350);
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(200);
  result.audio.restored = await page.evaluate(() => window.__fw.audio.debugStats());

  // Returning player and preference persistence in a second real page.
  const returning = await context.newPage();
  await returning.goto(URL, { waitUntil: 'domcontentloaded' });
  await returning.locator('.menu-screen').waitFor({ state: 'visible' });
  await returning.waitForFunction(() => document.querySelector('.menu-action-primary')?.disabled === false);
  result.returning = await returning.evaluate(() => ({
    continueDisabled: document.querySelector('.menu-action-primary')?.disabled ?? null,
    continueText: document.querySelector('.menu-action-primary')?.textContent?.trim() || '',
    preferenceScale: window.__fw.preferences.values.display.uiScale,
    sensitivity: window.__fw.preferences.values.camera.sensitivity,
  }));
  await returning.screenshot({ path: path.join(OUT, '03-returning-player.png'), animations: 'disabled' });
  result.screenshots.push('qa/player-experience-polish/stress/03-returning-player.png');
  await returning.close();

  result.stress.listenersAfter = await page.evaluate(() => ({ ...window.__qaGlobalListeners }));
  result.stress.listenerBalanceDelta = (result.stress.listenersAfter.adds - result.stress.listenersAfter.removes)
    - (result.stress.listenersBefore.adds - result.stress.listenersBefore.removes);
  result.final = await page.evaluate(() => ({
    courseMode: window.__fw.courseMode,
    presentationMode: document.body.dataset.uiMode,
    pauseNodes: document.querySelectorAll('.pause-veil-ui').length,
    modalNodes: document.querySelectorAll('.modal-backdrop').length,
    notificationNodes: document.querySelectorAll('.notification').length,
    audio: window.__fw.audio.debugStats(),
    preferences: window.__fw.preferences.values,
  }));
} catch (error) {
  result.failed = true;
  result.error = error.stack || error.message;
  await shot('failure-state').catch(() => {});
} finally {
  result.consoleMessages = consoleMessages;
  result.pageErrors = pageErrors;
  result.requestFailures = requestFailures;
  result.unexpectedConsoleErrors = consoleMessages.filter((message) => message.type === 'error' && !message.text.includes('save slot2 failed'));
  await fs.writeFile(path.join(OUT, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify({
  failed: !!result.failed,
  error: result.error || null,
  unexpectedConsoleErrors: result.unexpectedConsoleErrors?.length || 0,
  pageErrors: pageErrors.length,
  final: result.final || null,
}, null, 2));
if (result.failed || result.unexpectedConsoleErrors?.length || pageErrors.length) process.exitCode = 1;
