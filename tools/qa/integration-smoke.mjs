import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const url = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8457/';
const screenshot = process.env.QA_SCREENSHOT ? path.resolve(process.env.QA_SCREENSHOT) : null;

function loadPlaywright() {
  const candidates = ['playwright'];
  if (process.env.PLAYWRIGHT_MODULE) candidates.unshift(process.env.PLAYWRIGHT_MODULE);
  const cacheRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx') : null;
  if (cacheRoot && fs.existsSync(cacheRoot)) {
    candidates.push(...fs.readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(cacheRoot, entry.name, 'node_modules', 'playwright'))
      .filter((candidate) => fs.existsSync(path.join(candidate, 'package.json'))));
  }
  for (const candidate of candidates) {
    try { return require(candidate); } catch { /* Try the next portable candidate. */ }
  }
  throw new Error('Playwright is unavailable. Set PLAYWRIGHT_MODULE to an installed module path.');
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => localStorage.clear());
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const requestFailures = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
page.on('requestfailed', (request) => requestFailures.push({
  url: request.url(),
  error: request.failure()?.errorText || 'unknown',
}));

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('button', { name: /New Empire.*Relaxed/i }).click();
  await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90_000 });
  await page.waitForTimeout(750);
  if (screenshot) {
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, animations: 'disabled' });
  }
  const state = await page.evaluate(() => ({
    mode: window.__fw?.courseMode,
    hasClubhouse: !!window.__fw?.scene3d?.clubhouse?.(),
    layoutObjects: Object.keys(window.__fw?.state?.shop?.layout?.objects || {}).length,
    inventoryLifecycleVersion: window.__fw?.state?.shop?.inventoryLifecycle?.schemaVersion ?? null,
    boxes: window.__fw?.state?.shop?.deliveries?.boxes?.length ?? null,
  }));
  const blockingFailures = requestFailures.filter((failure) => !/ERR_ABORTED/.test(failure.error));
  const result = {
    ok: state.hasClubhouse && consoleErrors.length === 0 && pageErrors.length === 0 && blockingFailures.length === 0,
    url,
    state,
    consoleErrors,
    pageErrors,
    requestFailures,
    blockingFailures,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await browser.close();
}
