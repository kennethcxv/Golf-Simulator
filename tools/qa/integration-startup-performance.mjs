import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import process from 'node:process';

const url = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8507/';
const label = process.env.QA_STARTUP_LABEL || 'integration';
const runCount = Math.max(1, Number(process.env.QA_STARTUP_RUNS || 3));

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--force-device-scale-factor=1'],
});
const runs = [];

try {
  for (let run = 1; run <= runCount; run += 1) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => failedRequests.push({
      url: request.url(),
      reason: request.failure()?.errorText || 'unknown',
    }));

    const started = performance.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const polishedNewGame = page.locator('.menu-screen .menu-action').filter({ hasText: /^New game/ });
    const menuControl = (await polishedNewGame.count())
      ? polishedNewGame
      : page.getByRole('button', { name: /New Empire.*Relaxed/ });
    await menuControl.waitFor({ state: 'visible', timeout: 60_000 });
    const menuReadyMs = performance.now() - started;

    if (await polishedNewGame.count()) {
      await polishedNewGame.click();
      await page.getByRole('dialog', { name: 'New game' }).waitFor();
      await page.locator('.difficulty-card').filter({ hasText: /^Relaxed/ }).click();
    } else {
      await menuControl.click();
    }
    await page.locator('.listing').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90_000 });
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
    }, null, { timeout: 90_000 });
    const playableMs = performance.now() - started;
    const navigation = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0];
      return entry ? {
        responseEndMs: entry.responseEnd,
        domContentLoadedMs: entry.domContentLoadedEventEnd,
        loadEventMs: entry.loadEventEnd,
      } : null;
    });
    runs.push({
      run,
      menuReadyMs,
      playableMs,
      navigation,
      consoleErrors,
      pageErrors,
      failedRequests,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const menuTimes = runs.map((run) => run.menuReadyMs);
const playableTimes = runs.map((run) => run.playableMs);
const report = {
  generatedAt: new Date().toISOString(),
  label,
  url,
  protocol: `${runCount} fresh, storage-isolated Chrome contexts; browser-process launch excluded`,
  summary: {
    menuReadyMeanMs: mean(menuTimes),
    menuReadyMedianMs: median(menuTimes),
    playableMeanMs: mean(playableTimes),
    playableMedianMs: median(playableTimes),
    consoleErrorCount: runs.reduce((sum, run) => sum + run.consoleErrors.length, 0),
    pageErrorCount: runs.reduce((sum, run) => sum + run.pageErrors.length, 0),
    failedRequestCount: runs.reduce((sum, run) => sum + run.failedRequests.length, 0),
  },
  runs,
};

console.log(JSON.stringify(report, null, 2));
if (report.summary.consoleErrorCount || report.summary.pageErrorCount) process.exitCode = 1;
