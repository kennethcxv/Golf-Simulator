// Run one of the repository's Playwright QA function files INSIDE ELECTRON.
//
// Why this exists (2026-08-04): every driver in tools/qa/ has been executed
// against `npm run serve` in headless Chrome. The shipping product is Electron.
// Three defects have now shipped with a green Chrome driver and no effect in the
// real build, so "verified" has to mean "seen in Electron" from here on.
//
// Usage:
//   node tools/qa/run-electron.cjs tools/qa/first-run-legibility.js
//   node tools/qa/run-electron.cjs tools/qa/foo.js --clubhouse=pine-hills-v2
//
// A function file written for run-playwright.cjs runs here unmodified. The two
// browser-only calls are shimmed:
//   * page.goto(...)            — Electron has already loaded file://index.html.
//                                 Becomes a no-op (page.reload() still works).
//   * page.setViewportSize(...) — not implemented on an Electron page. Resizes
//                                 the real BrowserWindow instead, so screenshots
//                                 keep a deterministic size.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const EXECUTABLE = path.join(
  ROOT, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
);

function loadPlaywright() {
  try { return require('playwright'); } catch (_) { /* fall through */ }
  throw new Error('Playwright is unavailable. npm install playwright.');
}

function electronArgs() {
  const passthrough = process.argv.slice(3).filter((a) => a.startsWith('--'));
  const fromEnv = process.env.QA_CLUBHOUSE ? [`--clubhouse=${process.env.QA_CLUBHOUSE}`] : [];
  const merged = [...passthrough, ...fromEnv];
  const seen = new Set();
  const unique = merged.filter((a) => {
    const key = a.split('=')[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return ['.', ...unique];
}

// A Proxy rather than mutating the Page: Playwright's Page methods are on the
// prototype and several are non-writable.
function shimPage(window, app) {
  return new Proxy(window, {
    get(target, prop, receiver) {
      if (prop === 'goto') {
        return async () => null;
      }
      if (prop === 'setViewportSize') {
        return async (size) => {
          if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return;
          await app.evaluate(async ({ BrowserWindow }, wanted) => {
            const win = BrowserWindow.getAllWindows()[0];
            if (!win) return;
            win.setResizable(true);
            win.setContentSize(Math.round(wanted.width), Math.round(wanted.height));
          }, size);
          await target.waitForTimeout(220);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function main() {
  const rel = process.argv[2];
  if (!rel) throw new Error('Pass a QA function file, for example tools/qa/electron-first-run.js.');
  const file = path.resolve(rel);
  const qaRoot = path.resolve('tools/qa') + path.sep;
  if (!file.startsWith(qaRoot)) throw new Error('QA script must be inside tools/qa/.');

  const source = fs.readFileSync(file, 'utf8');
  const run = Function(`"use strict"; return (${source});`)();
  if (typeof run !== 'function') throw new Error(`${rel} did not evaluate to a function.`);

  const { _electron: electron } = loadPlaywright();
  const args = electronArgs();
  const diagnostics = [];
  // VIDEO_DIR=qa/foo records the whole run to a .webm, the way run-playwright
  // does. Some acceptances are about motion — "does the pan read as broken" is
  // not a question a still can answer — and until now the Electron runner could
  // only produce stills.
  const videoDir = process.env.VIDEO_DIR ? path.resolve(process.env.VIDEO_DIR) : null;
  if (videoDir) fs.mkdirSync(videoDir, { recursive: true });
  const app = await electron.launch({
    executablePath: EXECUTABLE,
    args,
    cwd: ROOT,
    timeout: 120_000,
    env: { ...process.env, FW_QA: '1' },
    ...(videoDir ? { recordVideo: { dir: videoDir } } : {}),
  });
  app.process()?.stderr?.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) diagnostics.push(`stderr: ${text}`);
  });

  const window = await app.firstWindow({ timeout: 120_000 });
  window.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.push(`console:${message.type()}: ${message.text()}`);
    }
  });
  window.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
  await window.waitForLoadState('domcontentloaded');

  const page = shimPage(window, app);
  try {
    const result = await run(page);
    const json = `${JSON.stringify({ electronArgs: args, result }, null, 2)}\n`;
    process.stdout.write(json);
    if (process.env.QA_RESULT_PATH) {
      const out = path.resolve(process.env.QA_RESULT_PATH);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, json);
    }
    if (diagnostics.length) process.stderr.write(`${diagnostics.slice(0, 40).join('\n')}\n`);
    if (result && typeof result === 'object' && result.ok === false) {
      throw new Error(`${rel} returned ok:false`);
    }
  } catch (error) {
    const failureDir = path.resolve('qa/electron/diagnostics');
    fs.mkdirSync(failureDir, { recursive: true });
    await window.screenshot({ path: path.join(failureDir, 'runner-failure.png') }).catch(() => {});
    if (diagnostics.length) process.stderr.write(`${diagnostics.slice(0, 40).join('\n')}\n`);
    throw error;
  } finally {
    await app.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
