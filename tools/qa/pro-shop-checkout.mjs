import { chromium } from 'playwright-core';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PORT = Number(process.argv.find((arg) => arg.startsWith('--port='))?.slice(7) || 8457);
const PASS = process.argv.find((arg) => arg.startsWith('--pass='))?.slice(7) || 'checkout-final';
const SCENARIO = process.argv.find((arg) => arg.startsWith('--scenario='))?.slice(11) || 'all';
const OUT = path.join(ROOT, 'qa', 'pro-shop-overhaul', PASS);
const BASE_URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function callbackFrom(file) {
  const source = await readFile(path.join(ROOT, 'tools', 'qa', file), 'utf8');
  const moduleSource = `export default ${source}`;
  return (await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)).default;
}

const sale = await callbackFrom('register-sale.js');
const recover = await callbackFrom('register-recover.js');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
});

async function run(name, callback, mode = null) {
  const scenarioOut = path.join(OUT, name);
  const videoOut = path.join(scenarioOut, 'video');
  await mkdir(videoOut, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoOut, size: { width: 1600, height: 900 } },
  });
  const page = await context.newPage();
  globalThis.__QA_REGISTER_MODE = mode;
  globalThis.__QA_REGISTER_OUT = scenarioOut.replaceAll('\\', '/');
  globalThis.__QA_BASE_URL = BASE_URL;
  let result;
  let thrown = null;
  try {
    result = await callback(page);
  } catch (error) {
    thrown = { message: error.message, stack: error.stack };
    await page.screenshot({ path: path.join(scenarioOut, 'failure.png') }).catch(() => {});
    thrown.diagnostic = await page.evaluate(() => {
      const register = window.__fw?.scene3d?.clubhouse?.()?.register;
      const tx = register?.getTx?.();
      return {
        tx: tx ? {
          stage: tx.stage,
          method: tx.method,
          deposited: tx.deposited,
          drawerOpen: tx.drawerOpen,
          tenderedTotal: tx.tenderedTotal,
          changeDue: tx.changeDue,
          hand: tx.hand,
          receiptPrinted: tx.receiptPrinted,
        } : null,
        palm: window.__qa?.find?.('palm') || null,
      };
    }).catch(() => null);
  }
  const video = page.video();
  await context.close();
  if (video) {
    const raw = await video.path();
    await rename(raw, path.join(videoOut, `${name}.webm`));
  }
  const report = { name, mode, result, thrown };
  await writeFile(path.join(scenarioOut, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const selected = SCENARIO === 'all' ? ['card', 'cash', 'save-reload'] : [SCENARIO];
const known = new Set(['card', 'cash', 'save-reload']);
if (selected.some((name) => !known.has(name))) throw new Error(`Unknown scenario: ${SCENARIO}`);
const reports = [];
if (selected.includes('card')) reports.push(await run('card', sale, 'card'));
if (selected.includes('cash')) reports.push(await run('cash', sale, 'cash'));
if (selected.includes('save-reload')) reports.push(await run('save-reload', recover));
await browser.close();

const byName = Object.fromEntries(reports.map((report) => [report.name, report]));

function finalMoney(report) {
  const final = report.result?.log?.find((row) => row.step === '20. final');
  return final || null;
}

const cardFinal = finalMoney(byName.card || {});
const cashFinal = finalMoney(byName.cash || {});
const reloadRows = byName['save-reload']?.result?.log || [];
const reloadChecks = reloadRows.find((row) => row.step === '5. RELOADED')?.checks || {};
const recovered = Object.values(reloadChecks).every((value) => String(value).startsWith('OK'));
const unlocked = reloadRows.find((row) => row.step === '6. and the player is not stranded')?.check || '';

const acceptance = {
  card: {
    skipped: !byName.card,
    passed: !!byName.card && !byName.card.thrown && byName.card.result?.errorCount === 0
      && cardFinal?.units === 2 && cardFinal?.saleHeld === 0 && cardFinal?.revenue > 0
      && cardFinal?.transactionActive === false && cardFinal?.customerPresent === false,
    final: cardFinal,
  },
  cash: {
    skipped: !byName.cash,
    passed: !!byName.cash && !byName.cash.thrown && byName.cash.result?.errorCount === 0
      && cashFinal?.units === 2 && cashFinal?.saleHeld === 0 && cashFinal?.revenue > 0
      && cashFinal?.transactionActive === false && cashFinal?.customerPresent === false,
    final: cashFinal,
  },
  saveReload: {
    skipped: !byName['save-reload'],
    passed: !!byName['save-reload'] && !byName['save-reload'].thrown && byName['save-reload'].result?.errorCount === 0
      && recovered && String(unlocked).startsWith('OK'),
    checks: reloadChecks,
    registerRecovery: unlocked,
  },
};
const summary = {
  pass: PASS,
  scenario: SCENARIO,
  timestamp: new Date().toISOString(),
  baseUrl: BASE_URL,
  browser: await chromium.launch ? 'Google Chrome via Playwright' : 'unknown',
  viewport: { width: 1600, height: 900 },
  normalUiBoot: true,
  videosRecorded: true,
  acceptance,
  reports,
};
await writeFile(path.join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ acceptance, errors: reports.map((r) => r.thrown) }, null, 2));
if (selected.some((name) => {
  const key = name === 'save-reload' ? 'saveReload' : name;
  return !acceptance[key].passed;
})) process.exitCode = 1;
