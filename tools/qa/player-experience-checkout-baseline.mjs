import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const BASE_URL = process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8463/';
const EVIDENCE_LABEL = process.env.QA_EVIDENCE_LABEL || 'baseline';
const OUT = path.join(ROOT, 'qa', 'player-experience-polish', EVIDENCE_LABEL, 'checkout');
const LOGS = path.join(ROOT, 'qa', 'player-experience-polish', 'logs');
const SOURCE_PATH = path.join(ROOT, 'tools', 'qa', 'register-sale.js');

await Promise.all([
  fs.mkdir(path.join(OUT, 'cash'), { recursive: true }),
  fs.mkdir(path.join(OUT, 'card'), { recursive: true }),
  fs.mkdir(LOGS, { recursive: true }),
]);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--enable-precise-memory-info',
    '--force-color-profile=srgb',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
  locale: 'en-US',
  reducedMotion: 'no-preference',
});
await context.addInitScript(() => {
  let state = 0x5f3759df;
  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
});

const page = await context.newPage();
const harnessMessages = [];
page.on('console', (message) => harnessMessages.push({ type: message.type(), text: message.text().slice(0, 1000) }));
page.on('pageerror', (error) => harnessMessages.push({ type: 'pageerror', text: error.stack || error.message }));

async function waitForWorld() {
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 60_000 });
}

// Establish the save through the real menu and market. The downstream checkout
// script may then use Continue exactly as a returning player does.
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.locator('.menu-screen .menu-action').filter({ hasText: /^New game/ }).click();
await page.getByRole('dialog', { name: 'New game' }).waitFor();
await page.locator('.difficulty-card').filter({ hasText: /^Relaxed/ }).click();
await page.getByRole('heading', { name: 'Property market' }).waitFor();
await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
await waitForWorld();
await page.evaluate(() => window.__fw.autosave());

const source = await fs.readFile(SOURCE_PATH, 'utf8');
const results = {};
for (const mode of ['cash', 'card']) {
  const output = path.join(OUT, mode).replaceAll('\\', '/');
  const configured = source
    .replace("const MODE = 'cash';", `const MODE = '${mode}';`)
    .replace("const OUT = 'C:/Users/Kenneth/Documents/GitHub/Golf-Flipper/qa/register/' + MODE;", `const OUT = '${output}';`)
    .replaceAll("http://localhost:8457/", BASE_URL);
  const run = (0, eval)(configured);
  try {
    results[mode] = await run(page);
  } catch (error) {
    const diagnostic = await page.evaluate(() => {
      const app = window.__fw;
      const register = app?.scene3d?.clubhouse?.()?.register;
      const tx = register?.getTx?.();
      return {
        registerActive: register?.isActive?.() ?? null,
        transaction: tx ? {
          stage: tx.stage,
          method: tx.method,
          scanned: tx.items.filter((item) => item.scanned).length,
          bagged: tx.items.filter((item) => item.bagged).length,
          items: tx.items.length,
          tenderedTotal: tx.tenderedTotal,
          changeGiven: tx.changeGiven,
          changeDue: tx.changeDue,
          drawerOpen: tx.drawerOpen,
          receiptPrinted: !!tx.receiptPrinted,
          banked: !!tx.banked,
        } : null,
        visibleText: (document.querySelector('.reg-hint')?.textContent || '').trim().replace(/\s+/g, ' '),
      };
    }).catch(() => null);
    await page.screenshot({ path: path.join(OUT, mode, 'failure-state.png'), animations: 'disabled' });
    results[mode] = {
      failed: true,
      error: error.stack || error.message,
      errorCount: 1,
      diagnostic,
      log: [],
    };
  }
  await fs.writeFile(path.join(OUT, mode, 'result.json'), `${JSON.stringify(results[mode], null, 2)}\n`);
}

await fs.writeFile(path.join(LOGS, `${EVIDENCE_LABEL}-checkout-browser.json`), `${JSON.stringify(harnessMessages, null, 2)}\n`);
await fs.writeFile(path.join(OUT, 'summary.json'), `${JSON.stringify(results, null, 2)}\n`);
await browser.close();

const summary = Object.fromEntries(Object.entries(results).map(([mode, result]) => [mode, {
  failed: !!result.failed,
  errorCount: result.errorCount,
  final: result.log?.at(-1) || result.diagnostic,
  steps: result.log?.length || 0,
}]));
console.log(JSON.stringify(summary, null, 2));
