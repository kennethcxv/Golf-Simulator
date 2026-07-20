import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const URL = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8463/';
const LOOP = process.env.QA_LOOP || 'iteration-1';
const ACCESSIBILITY_PROFILE = process.env.QA_ACCESSIBILITY === '1';
const RECORD_VIDEO = process.env.QA_VIDEO === '1';
const OUT = path.join(ROOT, 'qa', 'player-experience-polish', 'iterations', LOOP);
const [viewportWidth, viewportHeight] = (process.env.QA_VIEWPORT || '1440x900').split('x').map(Number);
const VIEWPORT = {
  width: Number.isFinite(viewportWidth) ? viewportWidth : 1440,
  height: Number.isFinite(viewportHeight) ? viewportHeight : 900,
};
const CAMERAS = {
  exterior: { at: [-1.5, 243.5], to: [-8.5, 231.0], pitch: 0.03 },
  entrance: { at: [-8.8, 233.2], to: [-9.2, 226.0], pitch: -0.05 },
  checkout: { at: [-7.5, 230.3], to: [-5.1, 232.5], pitch: -0.10 },
};

await fs.mkdir(OUT, { recursive: true });
const consoleMessages = [];
const pageErrors = [];
const requestFailures = [];
const result = {
  loop: LOOP,
  url: URL,
  viewport: VIEWPORT,
  controls: {},
  focus: {},
  captures: [],
  consoleErrors: 0,
  pageErrors: 0,
  requestFailures: 0,
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--force-color-profile=srgb', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  locale: 'en-US',
  colorScheme: 'dark',
  reducedMotion: 'no-preference',
  ...(RECORD_VIDEO ? { recordVideo: { dir: OUT, size: VIEWPORT } } : {}),
});
await context.addInitScript(() => {
  localStorage.clear();
  let state = 0x5f3759df;
  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
});
const page = await context.newPage();
const video = page.video();
page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text().slice(0, 1200) }));
page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
page.on('requestfailed', (request) => requestFailures.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' }));

async function shot(name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  result.captures.push(path.relative(ROOT, file).replaceAll('\\', '/'));
}

async function focusSequence(count) {
  const values = [];
  for (let index = 0; index < count; index++) {
    await page.keyboard.press('Tab');
    values.push(await page.evaluate(() => ({
      tag: document.activeElement?.tagName || null,
      text: (document.activeElement?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 90),
      className: typeof document.activeElement?.className === 'string' ? document.activeElement.className : '',
    })));
  }
  return values;
}

async function waitForWorld() {
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(1000);
}

async function setCamera(pose) {
  await page.evaluate(({ cameraPose }) => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.speedIdx = 0;
    const walk = app.scene3d.walk;
    walk.clearKeys();
    const state = walk.state;
    state.x = cameraPose.at[0];
    state.z = cameraPose.at[1];
    const dx = cameraPose.to[0] - cameraPose.at[0];
    const dz = cameraPose.to[1] - cameraPose.at[1];
    const length = Math.hypot(dx, dz) || 1;
    state.yaw = Math.atan2(-dx / length, -dz / length);
    state.pitch = cameraPose.pitch;
  }, { cameraPose: pose });
  await page.waitForTimeout(450);
}

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('.menu-screen').waitFor({ state: 'visible' });
  await shot('00-main-menu');
  result.focus.mainMenu = await focusSequence(8);

  await page.locator('.menu-screen .menu-action').filter({ hasText: /^Settings/ }).click();
  await page.getByRole('dialog', { name: 'Settings' }).waitFor();
  if (ACCESSIBILITY_PROFILE) {
    await page.getByRole('tab', { name: 'Accessibility', exact: true }).click();
    await page.locator('.setting-row').filter({ hasText: /^Reduced motion/ }).getByRole('button').click();
    await page.locator('.setting-row').filter({ hasText: /^High-contrast interface/ }).getByRole('button').click();
    await page.getByRole('combobox', { name: 'Sustained tool use' }).selectOption('toggle');
    await page.getByRole('tab', { name: 'Display', exact: true }).click();
    await page.getByRole('slider', { name: 'Interface scale' }).evaluate((input) => {
      input.value = '1.25';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.getByRole('tab', { name: 'Accessibility', exact: true }).click();
  }
  await shot('01-main-menu-settings');
  result.focus.menuSettings = await focusSequence(10);
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await page.locator('.menu-screen .menu-action').filter({ hasText: /^New game/ }).click();
  await page.getByRole('dialog', { name: 'New game' }).waitFor();
  await shot('02-new-game-dialog');
  await page.locator('.difficulty-card').filter({ hasText: /^Relaxed/ }).click();
  await page.locator('.listing').first().waitFor({ state: 'visible', timeout: 15_000 });
  await shot('03-property-market');
  result.focus.market = await focusSequence(12);
  if (VIEWPORT.height <= 700) {
    result.controls.marketKeyboardScroll = await page.locator('.market-dialog').evaluate((dialog) => ({
      scrollTop: dialog.scrollTop,
      scrollHeight: dialog.scrollHeight,
      clientHeight: dialog.clientHeight,
      activeText: document.activeElement?.textContent?.trim() || '',
    }));
    if (result.controls.marketKeyboardScroll.scrollHeight > result.controls.marketKeyboardScroll.clientHeight
      && result.controls.marketKeyboardScroll.scrollTop <= 0) {
      throw new Error('Compact property market did not scroll with keyboard focus');
    }
    await shot('03b-property-market-keyboard-scroll');
  }
  await page.getByRole('button', { name: 'Buy', exact: true }).first().click();

  await page.locator('.load-veil').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await shot('04-loading');
  await waitForWorld();

  await setCamera(CAMERAS.exterior);
  await shot('05-exterior-hud');
  await setCamera(CAMERAS.entrance);
  await shot('06-entrance-prompt');
  await setCamera(CAMERAS.checkout);
  await shot('07-checkout-environment');

  await page.keyboard.press('p');
  await page.locator('.pause-veil-ui').waitFor({ state: 'visible' });
  await shot('08-pause-overview');
  result.focus.pause = await focusSequence(12);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await shot('09-pause-settings');
  await page.getByRole('tab', { name: 'Accessibility', exact: true }).click();
  await shot('10-accessibility');
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await shot('11-controls');
  await page.keyboard.press('p');
  await page.locator('.pause-veil-ui').waitFor({ state: 'detached' });

  await page.keyboard.down('f');
  await page.waitForTimeout(320);
  await page.keyboard.up('f');
  await page.locator('.tool-wheel').waitFor({ state: 'visible' });
  await shot('12-tool-wheel');
  result.focus.toolWheel = await focusSequence(8);
  await page.evaluate(() => {
    window.__qaKeyTrace = [];
    window.addEventListener('keydown', (event) => window.__qaKeyTrace.push({
      key: event.key,
      target: event.target?.className || event.target?.tagName || '',
      defaultPrevented: event.defaultPrevented,
      mode: document.body.dataset.uiMode || '',
    }), true);
  });
  await page.keyboard.press('Escape');
  result.controls.afterWheelClose = await page.evaluate(() => ({
    wheelDisplay: getComputedStyle(document.querySelector('.tool-wheel')).display,
    mode: document.body.dataset.uiMode,
    courseMode: window.__fw.courseMode,
    active: document.activeElement?.className || document.activeElement?.tagName,
  }));

  // The integrated course-maintenance branch expands the outdoor belt to ten
  // tools. Capture that dense layout separately from the two-item indoor belt.
  await page.evaluate(() => {
    const walk = window.__fw.scene3d.walk.state;
    walk.x = -1.5;
    walk.z = 243.5;
    walk.yaw = 0;
    walk.pitch = 0;
  });
  await page.keyboard.down('f');
  await page.waitForTimeout(320);
  await page.keyboard.up('f');
  await page.locator('.tool-wheel').waitFor({ state: 'visible' });
  result.controls.outdoorToolWheel = await page.evaluate(() => ({
    count: document.querySelectorAll('.tool-wheel-item').length,
    labels: [...document.querySelectorAll('.tool-wheel-label')].map((node) => node.textContent),
  }));
  if (result.controls.outdoorToolWheel.count !== 10) throw new Error('Outdoor tool belt did not expose all ten canonical tools');
  await shot('12b-outdoor-tool-wheel');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Tab');
  await page.waitForTimeout(700);
  result.controls.afterOverviewKey = await page.evaluate(() => ({
    mode: document.body.dataset.uiMode,
    courseMode: window.__fw.courseMode,
    active: document.activeElement?.className || document.activeElement?.tagName,
    trace: window.__qaKeyTrace,
  }));
  if (result.controls.afterOverviewKey.courseMode !== 'overview') throw new Error('Tab did not enter course overview');
  await page.waitForTimeout(350);
  await shot('13-course-overview');
  await page.keyboard.press('p');
  await page.locator('.pause-veil-ui').waitFor({ state: 'visible' });
  await shot('14-pause-from-overview');
  await page.keyboard.press('p');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__fw.courseMode === 'walk');

  result.controls.presentationMode = await page.evaluate(() => document.body.dataset.uiMode);
  result.controls.audio = await page.evaluate(() => window.__fw.audio.debugStats());
  result.controls.preferences = await page.evaluate(() => window.__fw.preferences.values);
} catch (error) {
  result.failed = true;
  result.error = error.stack || error.message;
  await shot('failure-state').catch(() => {});
} finally {
  result.consoleErrors = consoleMessages.filter((message) => message.type === 'error').length;
  result.pageErrors = pageErrors.length;
  result.requestFailures = requestFailures.length;
  await context.close();
  if (video) {
    const videoPath = path.join(OUT, 'player-experience-acceptance.webm');
    await video.saveAs(videoPath);
    const generatedPath = await video.path();
    if (path.resolve(generatedPath) !== path.resolve(videoPath)) await fs.rm(generatedPath, { force: true });
    result.video = path.relative(ROOT, videoPath).replaceAll('\\', '/');
  }
  await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify({ ...result, consoleMessages, pageErrors, requestFailures }, null, 2));
  await browser.close();
}

console.log(JSON.stringify(result, null, 2));
if (result.failed || result.consoleErrors || result.pageErrors) process.exitCode = 1;
