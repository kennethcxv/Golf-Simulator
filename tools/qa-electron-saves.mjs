// GOLF EMPIRE — Electron 43 native-runtime and persistence QA via CDP.
//
// Launch the app with an isolated QA profile, then attach this script:
//   electron . --remote-debugging-port=9226 --user-data-dir=<isolated-dir>
//   node tools/qa-electron-saves.mjs 9226 <isolated-dir> <screenshot.png>

// The route proves the sandboxed preload bridge, allowlisted/size-limited native
// persistence, on-disk files, reload/Continue, WebGL, pointer lock, navigation
// policy, and cleanup without reading or changing the player's real profile.
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.argv[2] || '9226';
const userDataDir = path.resolve(process.argv[3] || 'qa/electron-release/user-data');
const screenshotPath = path.resolve(process.argv[4] || 'qa/electron-release/after.png');
const saveDir = path.join(userDataDir, 'saves');

const targets = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
const target = targets.find((item) => item.type === 'page' && /^file:.*\/index\.html$/i.test(item.url));
if (!target) throw new Error(`GOLF EMPIRE page target not found on ${PORT}`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const errors = [];

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  } else if (message.method === 'Log.entryAdded') {
    const entry = message.params.entry;
    if (entry.level === 'error' || /Content Security Policy/i.test(entry.text)) {
      errors.push(`[log:${entry.level}] ${entry.text}`);
    }
  } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push('[console.error] ' + message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
  } else if (message.method === 'Runtime.exceptionThrown') {
    errors.push('[exception] ' + (message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text));
  }
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function evalJS(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error('page eval failed: ' + JSON.stringify(result.exceptionDetails).slice(0, 800));
  }
  return result.result.value;
}
async function waitFor(expression, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evalJS(`!!(${expression})`)) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

const result = {};
const check = (name, ok, detail = null) => {
  result[name] = { ok: !!ok, detail };
  if (!ok) process.exitCode = 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail == null ? '' : ` — ${detail}`}`);
};

const bridge = await evalJS(`({
  hasNative: !!window.fairwayNative,
  api: Object.keys(window.fairwayNative || {}).sort().join(','),
  menuVisible: !!document.querySelector('.menu-screen') && getComputedStyle(document.querySelector('.menu-screen')).display !== 'none',
  userAgent: navigator.userAgent,
  nodeLeaked: typeof process !== 'undefined' || typeof require !== 'undefined',
})`);
check('Electron 43 runtime', /Electron\/43\.1\.1/.test(bridge.userAgent), bridge.userAgent);
check('sandboxed preload bridge exposed', bridge.hasNative && bridge.api === 'del,list,load,save');
check('Node globals absent from renderer', !bridge.nodeLeaked);
check('menu visible at boot', bridge.menuVisible);

const roundTrip = await evalJS(`(async () => {
  const E = await import('./src/sim/empire.js');
  const S = await import('./src/core/storage.js');
  const empire = E.newEmpire('relaxed', 424242);
  empire.cash = 10000000;
  const first = empire.market.find((listing) => listing.id === 'willow-creek') || empire.market[0];
  const bought = E.buyProperty(empire, first.id);
  if (!bought.ok) throw new Error(bought.reason);
  bought.state.tutorial.complete = true;
  bought.state.tutorial.hidden = true;
  const snap = E.empireSnapshot(empire);
  const localBefore = localStorage.getItem('golfempire:slot1');
  await S.saveData('slot1', snap);
  await S.saveData('slot1-meta', { name: bought.state.name, savedAt: 1 });
  await S.saveData('autosave', snap);
  const back = await S.loadData('slot1');
  let invalidRejected = false;
  try { await window.fairwayNative.save('../outside', {}); } catch (_) { invalidRejected = true; }
  return {
    match: JSON.stringify(back) === JSON.stringify(snap),
    usedLocalStorage: localStorage.getItem('golfempire:slot1') !== localBefore,
    list: (await S.listData()).sort().join(','),
    invalidRejected,
  };
})()`);
check('native save/load round-trip byte-identical', roundTrip.match);
check('native path used instead of localStorage', !roundTrip.usedLocalStorage);
check('native list sees allowlisted files', roundTrip.list === 'autosave,slot1,slot1-meta', roundTrip.list);
check('invalid native save key rejected', roundTrip.invalidRejected);

const slotFile = path.join(saveDir, 'slot1.json');
check('slot1 exists in isolated userData', fs.existsSync(slotFile), slotFile);
check('native slot is valid JSON', !!JSON.parse(fs.readFileSync(slotFile, 'utf8')));

await send('Page.reload');
await waitFor(`[...document.querySelectorAll('button')].some((button) => button.textContent === 'Continue' && !button.disabled)`);
await evalJS(`[...document.querySelectorAll('button')].find((button) => button.textContent === 'Continue').click()`);
await waitFor(`window.__fw?.scene3d?.clubhouse?.()`);
await waitFor(`!document.querySelector('.load-veil') || getComputedStyle(document.querySelector('.load-veil')).opacity === '0'`);

const live = await evalJS(`({
  view: window.__fw.view,
  contextLost: window.__fw.scene3d.renderer.getContext().isContextLost(),
  nativeStillPresent: !!window.fairwayNative,
  opened: window.open('https://example.com/') !== null,
})`);
check('Continue restores the playable unified 3D scene', live.view === 'course', live.view);
check('WebGL context is healthy', !live.contextLost);
check('preload bridge survives reload', live.nativeStillPresent);
check('new windows are denied', !live.opened);

await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 800, y: 450, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 800, y: 450, button: 'left', clickCount: 1 });
await sleep(500);
const pointerLocked = await evalJS(`document.pointerLockElement === document.querySelector('#game')`);
check('first-person pointer lock works in Electron', pointerLocked);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });

fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
check('Electron gameplay screenshot captured', fs.statSync(screenshotPath).size > 100_000, screenshotPath);

const clean = await evalJS(`(async () => {
  const S = await import('./src/core/storage.js');
  for (const key of ['slot1', 'slot1-meta', 'autosave']) await S.deleteData(key);
  return { slot: await S.loadData('slot1'), remaining: (await S.listData()).join(',') };
})()`);
check('native delete round-trip', clean.slot === null && clean.remaining === '');
check('isolated QA save directory is empty', fs.readdirSync(saveDir).length === 0);
check('zero console errors or CSP violations', errors.length === 0, errors.join('\n'));

const output = { ok: !process.exitCode, port: PORT, userDataDir, screenshotPath, checks: result, errors };
const outputPath = path.join(path.dirname(screenshotPath), 'result.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(process.exitCode ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS');
ws.close();
process.exit(process.exitCode || 0);
