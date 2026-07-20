// Run one of the repository's Playwright QA function files in an isolated browser.
//
// Usage:
//   node tools/qa/run-playwright.cjs tools/qa/register-boot.js
//   node tools/qa/run-playwright.cjs tools/qa/register-boot.js --bootstrap
//
// The Playwright MCP profile can be occupied by another Codex session. This runner
// deliberately launches its own ephemeral context while keeping the same real mouse
// and keyboard input paths used by the MCP scripts.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  acquirePlaywrightRunLock,
  releasePlaywrightRunLock,
} = require('./playwright-run-lock.cjs');

const QA_BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';

function loadPlaywright() {
  const candidates = [
    'playwright',
    'C:/Users/Kenneth/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright',
    'C:/Users/Kenneth/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
  ];
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) { /* try the next local install */ }
  }
  throw new Error('Playwright is not available from the project or the known local npm cache.');
}

async function runUnlocked() {
  const rel = process.argv[2];
  if (!rel) throw new Error('Pass a QA function file, for example tools/qa/register-boot.js.');
  const file = path.resolve(rel);
  const qaRoot = path.resolve('tools/qa') + path.sep;
  if (!file.startsWith(qaRoot)) throw new Error('QA script must be inside tools/qa/.');

  const source = fs.readFileSync(file, 'utf8');
  const run = Function(`"use strict"; return (${source});`)();
  if (typeof run !== 'function') throw new Error(`${rel} did not evaluate to a function.`);

  const { chromium } = loadPlaywright();
  const contextOptions = {
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    // Acceptance media is emitted by the in-page MediaRecorder as a browser
    // download so Playwright can stream it to an exact caller-provided path.
    acceptDownloads: true,
  };
  if (process.env.VIDEO_DIR) {
    contextOptions.recordVideo = {
      dir: path.resolve(process.env.VIDEO_DIR),
      size: { width: 1600, height: 900 },
    };
  }
  const persistentProfile = String(process.env.QA_PERSISTENT_PROFILE || '').trim();
  let browser = null;
  let context = null;
  if (persistentProfile) {
    const profilePath = path.resolve(persistentProfile);
    fs.mkdirSync(profilePath, { recursive: true });
    context = await chromium.launchPersistentContext(profilePath, {
      channel: 'chrome',
      headless: process.env.HEADED !== '1',
      ...contextOptions,
    });
    browser = context.browser();
  } else {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: process.env.HEADED !== '1',
    });
    context = await browser.newContext(contextOptions);
  }
  const page = context.pages()[0] || await context.newPage();
  const diagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push(`console:${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    diagnostics.push(`requestfailed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`);
  });
  try {
    if (process.argv.includes('--bootstrap')) {
      await page.goto(QA_BASE_URL);
      await page.waitForFunction(() => document.readyState === 'complete');
      await page.evaluate(async () => {
        const E = await import('/src/sim/empire.js');
        const empire = E.newEmpire('relaxed', 424242);
        empire.cash = 10_000_000;
        const first = empire.market.find((listing) => listing.id === 'willow-creek') || empire.market[0];
        const bought = E.buyProperty(empire, first.id);
        if (!bought.ok) throw new Error(`QA property bootstrap failed: ${bought.reason}`);
        bought.state.tutorial.complete = true;
        bought.state.tutorial.hidden = true;
        localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
      });
    }
    const result = await run(page);
    const resultJson = `${JSON.stringify(result, null, 2)}\n`;
    process.stdout.write(resultJson);
    if (process.env.QA_RESULT_PATH) {
      const resultPath = path.resolve(process.env.QA_RESULT_PATH);
      fs.mkdirSync(path.dirname(resultPath), { recursive: true });
      fs.writeFileSync(resultPath, resultJson);
    }
    // Acceptance/recovery drivers persist a structured blocker and return it so the
    // failure state remains inspectable. Treat that result as a failed process too;
    // otherwise CI and manual PowerShell runs can look green while latest-result.json
    // explicitly says the player route failed.
    if (result && typeof result === 'object' && result.ok === false) {
      const detail = result.blocker?.message ? `: ${result.blocker.message}` : '';
      throw new Error(`${rel} returned ok:false${detail}`);
    }
    if (diagnostics.length) process.stderr.write(`${diagnostics.join('\n')}\n`);
  } catch (error) {
    const failureDir = path.resolve('qa/cash-register-production/diagnostics');
    fs.mkdirSync(failureDir, { recursive: true });
    await page.screenshot({ path: path.join(failureDir, 'runner-failure.png') }).catch(() => {});
    if (diagnostics.length) process.stderr.write(`${diagnostics.join('\n')}\n`);
    throw error;
  } finally {
    await context.close();
    // Closing a persistent context owns and closes its browser process. Keep the
    // explicit browser close for the default ephemeral-context path only.
    if (!persistentProfile) await browser.close();
  }
}

async function main() {
  const lock = await acquirePlaywrightRunLock({
    metadata: { qaScript: process.argv[2] || null },
  });
  const release = () => releasePlaywrightRunLock(lock);
  const onSignal = () => {
    release();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    await runUnlocked();
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    release();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
