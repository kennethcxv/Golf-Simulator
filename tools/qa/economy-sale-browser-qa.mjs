import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(root, process.argv.find((arg) => arg.startsWith('--out='))?.slice(6) || 'qa/economy-progression/sale-browser');
const baseUrl = process.argv.find((arg) => arg.startsWith('--url='))?.slice(6) || 'http://127.0.0.1:8461/';

function findPlaywright() {
  const candidates = ['playwright'];
  const cacheRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx') : null;
  if (cacheRoot && fs.existsSync(cacheRoot)) {
    candidates.push(...fs.readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(cacheRoot, entry.name, 'node_modules', 'playwright'))
      .filter((candidate) => fs.existsSync(path.join(candidate, 'package.json'))));
  }
  for (const candidate of candidates) {
    try { return { api: require(candidate), modulePath: candidate }; } catch { /* continue */ }
  }
  throw new Error('Playwright is unavailable.');
}

fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'video'), { recursive: true });
const { api: playwright, modulePath } = findPlaywright();
const browser = await playwright.chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
  recordVideo: { dir: path.join(outDir, 'video'), size: { width: 1600, height: 900 } },
});
const page = await context.newPage();
page.setDefaultTimeout(120_000);
const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') consoleMessages.push({ type: message.type(), text: message.text() });
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), reason: request.failure()?.errorText || 'unknown' }));

async function clickText(text, selector = 'button') {
  const control = page.locator(selector).filter({ hasText: text }).first();
  await control.click({ timeout: 120_000 });
  await page.waitForTimeout(350);
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.locator('.menu-screen .menu-action').filter({ hasText: /^New game/ }).click();
await page.getByRole('dialog', { name: 'New game' }).waitFor();
await page.locator('.difficulty-card').filter({ hasText: /^Relaxed/ }).click();
await page.getByRole('button', { name: /^Buy$/i }).first().click();
await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60000 });
await page.waitForFunction(() => {
  const veil = document.querySelector('.load-veil');
  return !veil || getComputedStyle(veil).opacity === '0';
}, null, { timeout: 60000 });
await page.waitForTimeout(2500);

// Fixture only the prerequisite world state. Every property metric still reads
// the same grime masks, clutter flags, wash cells, turf arrays, equipment, and
// policies that normal play changes; all decision assertions use visible UI controls.
const fixture = await page.evaluate(async () => {
  const app = window.__fw;
  const sim = await import('/src/sim/empire.js');
  const conditionSim = await import('/src/sim/propertyCondition.js');
  const progressionSim = await import('/src/sim/propertyProgression.js');
  for (let day = 0; day < 4; day += 1) sim.empireUpdate(app.empire, 1440);
  const state = app.state;
  state.shop.reno.grime.fill(0);
  state.shop.reno.windows.fill(0);
  for (const item of state.shop.reno.clutter) item.cleared = true;
  const exterior = state.shop.reno.exterior;
  exterior.weeds.fill(0);
  exterior.gutter = 0;
  exterior.cobwebs = 0;
  exterior.light = 0;
  exterior.siding.fill(0);
  for (const surface of Object.values(state.shop.reno.wash || {})) surface.grime.fill(0);
  for (const item of state.props.litter) item.cleared = true;
  state.props.teeSignFixed = true;
  state.tractor.repaired = true;
  state.turf.health.fill(78);
  state.turf.moisture.fill(55);
  state.turf.nutrients.fill(60);
  state.turf.wear.fill(3);
  state.turf.disSev.fill(0);
  state.turf.disType.fill(0);
  for (const policy of Object.values(state.maintenance.policies)) policy.irrigation = 'standard';
  const clubhouse = app.scene3d.clubhouse();
  const origin = clubhouse.interior.position;
  const walk = app.scene3d.walk.state;
  walk.x = 8.45 + origin.x;
  walk.z = 4.5 + origin.z;
  walk.yaw = -Math.PI / 2;
  walk.pitch = -0.05;
  return {
    condition: conditionSim.propertyConditionBreakdown(state).overall,
    readiness: progressionSim.propertyReadiness(state, app.empire),
    cash: app.empire.cash,
    holdings: app.empire.holdings.length,
  };
});
if (!fixture.readiness.saleEligible) throw new Error(`Sale fixture is not eligible: ${JSON.stringify(fixture.readiness)}`);

await page.waitForTimeout(1200);
await page.keyboard.press('e');
await page.waitForFunction(() => window.__fw?.laptopOpen === true, null, { timeout: 10000 });
await page.waitForSelector('.lt-frame', { timeout: 20000 });
await page.waitForTimeout(1800);
await clickText('Property', '.lt-navbtn');
await page.screenshot({ path: path.join(outDir, 'screenshots', '01-property-ready.png') });

await clickText('Request appraisal');
await page.waitForFunction(() => document.body.textContent.includes('Current sale offer'));
const firstOffer = await page.evaluate(() => {
  const appraisal = window.__fw.empire.progression.appraisals.at(-1);
  return { ...appraisal, valuation: undefined };
});
await page.screenshot({ path: path.join(outDir, 'screenshots', '02-current-offer.png') });

await clickText('Keep operating');
const afterKeep = await page.evaluate(() => ({
  holdings: window.__fw.empire.holdings.length,
  cash: window.__fw.empire.cash,
  latestStatus: window.__fw.empire.progression.appraisals.at(-1).status,
}));
await page.screenshot({ path: path.join(outDir, 'screenshots', '03-keep-operating.png') });

await clickText('Request appraisal');
await clickText('Accept offer');
const beforeConfirmation = await page.evaluate(() => ({
  holdings: window.__fw.empire.holdings.length,
  cash: window.__fw.empire.cash,
  confirmationVisible: !!document.querySelector('.lt-confirm'),
}));
await page.screenshot({ path: path.join(outDir, 'screenshots', '04-explicit-confirmation.png') });

await clickText('Confirm permanent sale');
await page.waitForFunction(() => window.__fw?.empire?.holdings?.length === 0, null, { timeout: 15000 });
await page.waitForTimeout(700);
const afterSale = await page.evaluate(() => ({
  holdings: window.__fw.empire.holdings.length,
  cash: window.__fw.empire.cash,
  completedSales: window.__fw.empire.progression.completedSales,
  backupCount: window.__fw.empire.progression.saleBackups.length,
  unlockedTierIds: window.__fw.empire.progression.unlockedTierIds,
  marketVisible: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Buy' && button.getBoundingClientRect().width > 0),
}));
await page.screenshot({ path: path.join(outDir, 'screenshots', '05-sold-next-market.png') });

const video = page.video();
await context.close();
let videoPath = null;
if (video) {
  const raw = await video.path();
  const target = path.join(outDir, 'video', 'sale-flow-normal-controls.webm');
  if (path.resolve(raw) !== path.resolve(target)) {
    if (fs.existsSync(target)) fs.rmSync(target);
    fs.renameSync(raw, target);
  }
  videoPath = path.relative(root, target).replaceAll('\\', '/');
}
await browser.close();

const report = {
  createdAt: new Date().toISOString(), baseUrl, browserModule: modulePath,
  normalControls: ['New game dialog', 'Relaxed difficulty card', 'Buy button', 'E interaction', 'projected Property navigation', 'Request appraisal', 'Keep operating', 'Accept offer', 'Confirm permanent sale'],
  fixture, firstOffer, afterKeep, beforeConfirmation, afterSale,
  payoutDelta: Math.round((afterSale.cash - beforeConfirmation.cash) * 100) / 100,
  checks: {
    keepPreservesProperty: afterKeep.holdings === fixture.holdings && afterKeep.cash === fixture.cash && afterKeep.latestStatus === 'kept',
    acceptAloneDoesNotSell: beforeConfirmation.holdings === fixture.holdings && beforeConfirmation.confirmationVisible,
    explicitConfirmationSells: afterSale.holdings === 0 && afterSale.completedSales.length === 1,
    payoutMatchesDisplayedNet: afterSale.completedSales[0]?.netProceeds
      === Math.round((afterSale.cash - beforeConfirmation.cash) * 100) / 100,
    recoveryBackupWritten: afterSale.backupCount === 1,
    nextMarketShown: afterSale.marketVisible,
  },
  consoleMessages, pageErrors, failedRequests, video: videoPath,
};
fs.writeFileSync(path.join(outDir, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`);
if (!Object.values(report.checks).every(Boolean)) throw new Error(`Sale-flow assertion failed: ${JSON.stringify(report.checks)}`);
console.log(JSON.stringify({ outDir, checks: report.checks, consoleErrors: consoleMessages.filter((message) => message.type === 'error').length, pageErrors: pageErrors.length, failedRequests: failedRequests.length, video: videoPath }, null, 2));
