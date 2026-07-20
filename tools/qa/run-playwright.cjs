// Run one repository Playwright QA callback in an isolated browser context.
//
// Usage:
//   node tools/qa/run-playwright.cjs tools/qa/register-boot.js
//   node tools/qa/run-playwright.cjs tools/qa/register-sale.js --bootstrap
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  acquirePlaywrightRunLock,
  releasePlaywrightRunLock,
} = require('./playwright-run-lock.cjs');

const QA_BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';

async function startLocalServer() {
  if (process.env.QA_START_SERVER !== '1') return null;
  const url = new URL(QA_BASE_URL);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const serverRoot = path.resolve(process.env.QA_SERVER_ROOT || '.');
  const child = spawn(process.execPath, ['tools/serve.cjs'], {
    cwd: serverRoot,
    env: { ...process.env, PORT: port },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`QA server exited with ${child.exitCode}: ${stderr.trim()}`);
    }
    try {
      const response = await fetch(QA_BASE_URL);
      const servedRoot = response.headers.get('x-golf-root');
      if (response.ok && servedRoot && decodeURIComponent(servedRoot) === serverRoot) return child;
    } catch (_) { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`QA server did not become ready at ${QA_BASE_URL}. ${stderr.trim()}`);
}

async function stopLocalServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

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
  if (!rel) throw new Error('Pass a QA callback, for example tools/qa/register-boot.js.');
  const file = path.resolve(rel);
  const qaRoot = path.resolve('tools/qa') + path.sep;
  if (!file.startsWith(qaRoot)) throw new Error('QA script must be inside tools/qa/.');

  const source = fs.readFileSync(file, 'utf8');
  const run = Function(`"use strict"; return (${source});`)();
  if (typeof run !== 'function') throw new Error(`${rel} did not evaluate to a function.`);
  if (process.env.QA_OUTPUT_DIR) fs.mkdirSync(path.resolve(process.env.QA_OUTPUT_DIR), { recursive: true });
  if (process.env.VIDEO_DIR) fs.mkdirSync(path.resolve(process.env.VIDEO_DIR), { recursive: true });

  const { chromium } = loadPlaywright();
  const viewport = {
    width: Number(process.env.QA_VIEWPORT_WIDTH || 1600),
    height: Number(process.env.QA_VIEWPORT_HEIGHT || 900),
  };
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.env.HEADED !== '1',
  });
  const contextOptions = {
    viewport,
    deviceScaleFactor: 1,
    acceptDownloads: true,
  };
  if (process.env.VIDEO_DIR) {
    contextOptions.recordVideo = {
      dir: path.resolve(process.env.VIDEO_DIR),
      size: viewport,
    };
  }
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const diagnostics = [];
  let recordDiagnostics = false;
  page.on('console', (message) => {
    if (recordDiagnostics && (message.type() === 'error' || message.type() === 'warning')) {
      diagnostics.push(`console:${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    if (recordDiagnostics) diagnostics.push(`pageerror: ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText || 'unknown';
    // Chromium reports loader cancellation as ERR_ABORTED when Continue replaces
    // the menu scene. A missing/broken response is ERR_FAILED (or an HTTP status)
    // and remains evidence; a canceled request never reached a failure response.
    if (recordDiagnostics && reason !== 'net::ERR_ABORTED') {
      diagnostics.push(`requestfailed: ${request.url()} (${reason})`);
    }
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
      // The callback navigates to the real test page. Leave the bootstrap page
      // while diagnostics are muted so its in-flight decorative GLBs do not turn
      // a deliberate navigation into gameplay request failures.
      await page.goto('about:blank');
    }
    recordDiagnostics = true;
    const result = await run(page);
    const output = result && typeof result === 'object'
      ? { ...result, runnerDiagnostics: diagnostics }
      : { result, runnerDiagnostics: diagnostics };
    const resultJson = `${JSON.stringify(output, null, 2)}\n`;
    if (process.env.QA_QUIET !== '1') process.stdout.write(resultJson);
    if (process.env.QA_RESULT_PATH) {
      const resultPath = path.resolve(process.env.QA_RESULT_PATH);
      fs.mkdirSync(path.dirname(resultPath), { recursive: true });
      fs.writeFileSync(resultPath, resultJson);
    }
    if (output && typeof output === 'object' && output.ok === false) {
      const detail = output.blocker?.message ? `: ${output.blocker.message}` : '';
      throw new Error(`${rel} returned ok:false${detail}`);
    }
    if (diagnostics.length && process.env.QA_QUIET !== '1') {
      process.stderr.write(`${diagnostics.join('\n')}\n`);
    }
  } catch (error) {
    const failureDir = path.resolve(
      process.env.QA_FAILURE_DIR || 'qa/steam-release-polish/diagnostics',
    );
    fs.mkdirSync(failureDir, { recursive: true });
    await page.screenshot({ path: path.join(failureDir, 'runner-failure.png') }).catch(() => {});
    if (diagnostics.length) process.stderr.write(`${diagnostics.join('\n')}\n`);
    throw error;
  } finally {
    await context.close();
    await browser.close();
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
  let server = null;
  try {
    server = await startLocalServer();
    await runUnlocked();
  } finally {
    await stopLocalServer(server);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    release();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
