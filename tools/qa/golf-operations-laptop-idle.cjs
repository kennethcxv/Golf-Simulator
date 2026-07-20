// Lightweight final audit for the projected laptop shell. It intentionally
// avoids screenshots/video so software-renderer pressure cannot distort the
// listener and mutation measurements.

const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const URL = process.env.QA_URL || 'http://127.0.0.1:8468/';
const OUT = path.resolve(process.env.QA_OUT || 'qa/golf-operations/laptop-idle-final');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const pageErrors = [];
  const consoleErrors = [];
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.addInitScript(() => {
    let active = 0;
    let registrations = 0;
    const registry = new WeakMap();
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const captureOf = (options) => typeof options === 'boolean' ? options : !!options?.capture;
    EventTarget.prototype.addEventListener = function patchedAdd(type, listener, options) {
      if (listener) {
        let types = registry.get(this);
        if (!types) { types = new Map(); registry.set(this, types); }
        let entries = types.get(type);
        if (!entries) { entries = []; types.set(type, entries); }
        const capture = captureOf(options);
        if (!entries.some((entry) => entry.listener === listener && entry.capture === capture)) {
          entries.push({ listener, capture });
          active++;
          registrations++;
        }
      }
      return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function patchedRemove(type, listener, options) {
      const entries = registry.get(this)?.get(type);
      const capture = captureOf(options);
      const index = entries?.findIndex((entry) => entry.listener === listener && entry.capture === capture) ?? -1;
      if (index >= 0) { entries.splice(index, 1); active--; }
      return originalRemove.call(this, type, listener, options);
    };
    window.__qaListeners = () => ({ active, registrations });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.locator('button').filter({ hasText: 'New Empire' }).first().click();
    await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 60000 });
    await page.evaluate(() => {
      const app = window.__fw;
      app.speedIdx = 0;
      const origin = app.scene3d.clubhouse().interior.position;
      const walk = app.scene3d.walk.state;
      walk.x = 8.45 + origin.x;
      walk.z = 4.5 + origin.z;
      walk.yaw = -Math.PI / 2;
      walk.pitch = -0.05;
    });
    await page.waitForFunction(() => /laptop/i.test(document.querySelector('.shop-prompt')?.textContent || ''),
      null, { timeout: 30000 });
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.lt-frame')?.getBoundingClientRect().width > 100,
      null, { timeout: 20000 });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      window.__qaLaptopMutations = 0;
      window.__qaLaptopObserver = new MutationObserver(() => { window.__qaLaptopMutations++; });
      window.__qaLaptopObserver.observe(document.querySelector('.laptop-screen'), {
        subtree: true, childList: true, characterData: true, attributes: true,
      });
    });
    const listenersBefore = await page.evaluate(() => window.__qaListeners());
    await page.waitForTimeout(5000);
    const result = await page.evaluate(() => {
      window.__qaLaptopObserver.disconnect();
      const days = [...window.__fw.state.reservations.generator.generatedDays];
      const bookings = window.__fw.state.reservations.booked;
      return {
        listenersAfter: window.__qaListeners(),
        laptopMutationCallbacks: window.__qaLaptopMutations,
        horizonDays: days,
        bookings: bookings.length,
        uniqueWithinEachDay: days.every((dayAbs) => {
          const names = bookings.filter((reservation) => reservation.dayAbs === dayAbs
            && reservation.status !== 'cancelled').flatMap((reservation) => reservation.customerNames);
          return new Set(names).size === names.length;
        }),
        laptopOpen: window.__fw.laptopOpen,
        laptopModeClass: document.body.classList.contains('laptop-mode'),
      };
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__fw.laptopOpen === false, null, { timeout: 10000 });
    result.normalEscape = await page.evaluate(() => ({
      laptopOpen: window.__fw.laptopOpen,
      laptopModeClass: document.body.classList.contains('laptop-mode'),
    }));
    result.listenersBefore = listenersBefore;
    result.activeListenerDelta = result.listenersAfter.active - listenersBefore.active;
    result.registrationDelta = result.listenersAfter.registrations - listenersBefore.registrations;
    result.pageErrors = pageErrors;
    result.consoleErrors = consoleErrors;
    result.commit = process.env.QA_COMMIT || 'working-tree';
    fs.writeFileSync(path.join(OUT, 'evidence.json'), `${JSON.stringify(result, null, 2)}\n`);
    if (result.activeListenerDelta !== 0 || result.registrationDelta !== 0 || result.laptopMutationCallbacks !== 0) {
      throw new Error(`Laptop idle instability: ${JSON.stringify(result)}`);
    }
    if (result.horizonDays.length !== 7 || !result.uniqueWithinEachDay) throw new Error('Production horizon failed.');
    if (!result.laptopOpen || !result.laptopModeClass
      || result.normalEscape.laptopOpen || result.normalEscape.laptopModeClass) throw new Error('Normal laptop mode transition failed.');
    if (pageErrors.length || consoleErrors.length) throw new Error(`Browser errors: ${[...pageErrors, ...consoleErrors].join(' | ')}`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
