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
const { execFileSync } = require('child_process');
const {
  acquirePlaywrightRunLock,
  releasePlaywrightRunLock,
} = require('./playwright-run-lock.cjs');

const QA_BASE_URL = process.env.QA_BASE_URL || 'http://localhost:8457/';

function npmCacheRoot() {
  if (process.env.npm_config_cache) return process.env.npm_config_cache;
  try {
    return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['config', 'get', 'cache'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return null;
  }
}

function cachedPlaywrightCandidates() {
  const cache = npmCacheRoot();
  const npxRoot = cache && path.join(cache, '_npx');
  if (!npxRoot || !fs.existsSync(npxRoot)) return [];
  return fs.readdirSync(npxRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(npxRoot, entry.name, 'node_modules', 'playwright'))
    .filter((candidate) => fs.existsSync(candidate));
}

function loadPlaywright() {
  const candidates = [...new Set([
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    ...cachedPlaywrightCandidates(),
  ].filter(Boolean))];
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) { /* try the next local install */ }
  }
  throw new Error(
    'Playwright is unavailable. Install it locally or set PLAYWRIGHT_MODULE to its module directory.',
  );
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
      const requestedPropertyId = String(process.env.QA_BOOTSTRAP_PROPERTY_ID || 'willow-creek');
      const operationalShop = process.env.QA_BOOTSTRAP_OPERATIONAL_SHOP === '1';
      await page.evaluate(async ({ propertyId, operationalShop: makeOperational }) => {
        const E = await import('/src/sim/empire.js');
        const empire = E.newEmpire('relaxed', 424242);
        empire.cash = 10_000_000;
        let target = empire.market.find((listing) => listing.id === propertyId) || empire.market[0];
        if (!E.propertyAccess(empire, target).unlocked) {
          const starter = empire.market.find((listing) => E.propertyAccess(empire, listing).unlocked);
          if (!starter) throw new Error(`QA bootstrap could not unlock ${target.id}.`);
          const starterPurchase = E.buyProperty(empire, starter.id);
          if (!starterPurchase.ok) throw new Error(`QA starter-property bootstrap failed: ${starterPurchase.reason}`);
          target = empire.market.find((listing) => listing.id === propertyId) || target;
        }
        const bought = E.buyProperty(empire, target.id);
        if (!bought.ok) throw new Error(`QA property bootstrap failed: ${bought.reason}`);
        const switched = E.switchProperty(empire, bought.property.id);
        if (!switched.ok) throw new Error(`QA property activation failed: ${switched.reason}`);
        bought.state.tutorial.complete = true;
        bought.state.tutorial.hidden = true;
        if (makeOperational) {
          // Campaign properties deliberately start closed and stripped for the
          // restoration arc. Register QA needs the equally real post-install
          // state before the scene mounts, so activate only the facilities the
          // physical checkout route owns and restore their authored fixtures.
          const C = await import('/src/sim/campaign.js');
          const L = await import('/src/sim/layout.js');
          const facilities = C.ensureCampaignFacilities(bought.state);
          facilities.displayShelves = true;
          facilities.frontCounter = true;
          facilities.registerHardware = true;
          for (const id of ['shelf_balls', 'shelf_acc', 'shelf_small', 'backcounter']) {
            L.restoreFixture(bought.state, id);
          }
          if (bought.state.campaign) {
            bought.state.campaign.businessOpen = true;
            bought.state.campaign.openedAt = bought.state.clock.minutes;
          }
        }
        localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
      }, { propertyId: requestedPropertyId, operationalShop });
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
