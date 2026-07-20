import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8464/';
const stamp = process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-');
const root = path.resolve(process.cwd(), 'qa', 'customer-simulation', 'checkout', stamp);
await mkdir(root, { recursive: true });

const original = await readFile(path.resolve('tools', 'qa', 'register-sale.js'), 'utf8');
const modes = (process.env.CHECKOUT_MODES || 'card,cash')
  .split(',')
  .map((mode) => mode.trim())
  .filter(Boolean);
const reports = [];
const priorEnvironment = {
  mode: process.env.REGISTER_QA_MODE,
  output: process.env.REGISTER_QA_OUTPUT,
  baseUrl: process.env.QA_BASE_URL,
};

for (const mode of modes) {
  // A recorded Three.js run owns a substantial WebGL context. Give each payment
  // path a fresh browser process so closing card capture cannot tear down the cash
  // page while it is booting (a Chromium/SwiftShader failure, not a game result).
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
  });
  const out = path.join(root, mode);
  const videoDir = path.join(out, 'video');
  await mkdir(videoDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1600, height: 900 } },
  });
  const page = await context.newPage();
  const video = page.video();
  const runnerErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') runnerErrors.push(message.text());
  });
  page.on('pageerror', (error) => runnerErrors.push(`PAGEERROR: ${error.message}`));

  process.env.REGISTER_QA_MODE = mode;
  process.env.REGISTER_QA_OUTPUT = out;
  process.env.QA_BASE_URL = url;

  // This evaluates a trusted, versioned local QA function. Keeping the established
  // physical checkout driver intact prevents this integration gate from drifting
  // away from the register's existing scan/payment/receipt/bagging acceptance path.
  const runSale = eval(original); // eslint-disable-line no-eval
  let result;
  const failures = [];
  try {
    result = await runSale(page);
    const final = result.log.find((entry) => entry.step === '20. final');
    if (!result.ok) failures.push('the register acceptance result was not reconciled');
    if (result.mode !== mode) failures.push(`requested ${mode}, but the harness ran ${result.mode}`);
    if (result.errorCount) failures.push(`${result.errorCount} console/page errors`);
    if (!final || final.saleHeld !== 0) failures.push('the sale\'s held stock was not fully consumed');
    if (result.inventoryAudit?.held !== 0) failures.push('unrelated customer-held stock remained after the sale');
    if (!final || final.units < 2) failures.push('both physical items were not banked');
    if (!final || final.revenue <= 0) failures.push('sale revenue was not banked');
  } catch (error) {
    const diagnostic = await page.evaluate(() => {
      const app = window.__fw;
      const tx = app?.scene3d?.clubhouse?.()?.register?.getTx?.();
      return {
        tx: tx ? {
          stage: tx.stage,
          method: tx.method,
          tendered: tx.tendered,
          tenderedTotal: tx.tenderedTotal,
          deposited: tx.deposited,
          drawerOpen: tx.drawerOpen,
          hand: tx.hand,
          items: tx.items,
        } : null,
        money: app ? {
          revenue: app.state.shop.salesLive?.revenue || 0,
          units: app.state.shop.salesLive?.units || 0,
          held: app.state.shop.held?.length || 0,
        } : null,
      };
    }).catch(() => ({ tx: null, money: null }));
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    failures.push(error instanceof Error ? error.message : String(error));
    result = {
      mode,
      log: [],
      errors: runnerErrors.slice(0, 10),
      errorCount: runnerErrors.length,
      diagnostic,
    };
  }

  await page.close().catch(() => {});
  const videoPath = video ? await video.path() : null;
  await context.close();
  await browser.close();
  reports.push({ ...result, videoPath, failures });
}

for (const [key, value] of Object.entries({
  REGISTER_QA_MODE: priorEnvironment.mode,
  REGISTER_QA_OUTPUT: priorEnvironment.output,
  QA_BASE_URL: priorEnvironment.baseUrl,
})) {
  if (value == null) delete process.env[key];
  else process.env[key] = value;
}

const report = {
  stamp,
  url,
  protocol: 'existing tools/qa/register-sale.js through normal mouse/keyboard controls',
  reports,
  passed: reports.every((entry) => entry.failures.length === 0),
};
await writeFile(path.join(root, 'checkout.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
