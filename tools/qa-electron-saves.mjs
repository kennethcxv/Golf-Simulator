// FAIRWAY STATE — Electron native-save-bridge QA via CDP attach.
// Zero-dep (Node >= 22: built-in fetch + WebSocket). Drives the real app:
// new game -> native save round-trip -> on-disk file proof -> reload ->
// Continue -> office-menu slot save -> delete/cleanup (leaves no saves behind).
// Collects console errors and CSP violations for the whole run.
//
// Usage:
//   npx electron . --remote-debugging-port=9224     (or npm start -- --dev for 9223*)
//   node tools/qa-electron-saves.mjs [port]
// *npm eats "--dev" on some npm versions ("config dev" warning) — the explicit
//  Chromium switch is the reliable route; pass the port you chose as argv[2].
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = process.argv[2] || '9224';
// Electron derives userData from productName ("FAIRWAY STATE"), not package name.
const saveDir = path.join(os.homedir(), 'AppData', 'Roaming', 'FAIRWAY STATE', 'saves');

const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
const target = list.find((p) => p.type === 'page' && /Golf\/index\.html/.test(p.url));
if (!target) throw new Error(`FAIRWAY STATE page target not found on ${PORT}`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const errors = [];

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message));
    else p.resolve(m.result);
  } else if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    if (e.level === 'error' || /Content Security Policy/i.test(e.text)) {
      errors.push(`[log:${e.level}] ${e.text}`);
    }
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push('[console.error] ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    errors.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evalJS(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

const result = {};
const check = (name, ok) => {
  result[name] = ok;
  if (!ok) process.exitCode = 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};

// 1. bridge + menu
const bridge = await evalJS(`({
  hasNative: !!window.fairwayNative,
  api: Object.keys(window.fairwayNative || {}).sort().join(','),
  menuVisible: !!document.querySelector('.menu-screen') && document.querySelector('.menu-screen').style.display !== 'none',
})`);
check('preload bridge exposed (del,list,load,save)', bridge.hasNative && bridge.api === 'del,list,load,save');
check('menu visible at boot', bridge.menuVisible);

// 2. new game boots into the walkable shop (v5 home base)
await evalJS(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('New Club — Realistic')).click()`);
await sleep(3500);
const boot = await evalJS(`({ view: window.__fw.view, shopActive: !!window.__fw.shopScene })`);
check('new game boots into shop3d', boot.view === 'shop3d' && boot.shopActive);

// 3. native save round-trip via the app's own persistence facade
const rt = await evalJS(`(async () => {
  const { saveData, loadData } = await import('./src/core/storage.js');
  const { snapshot } = await import('./src/sim/state.js');
  const snap = snapshot(window.__fw.state);
  const localBefore = localStorage.getItem('fairwaystate:slot1');
  await saveData('slot1', snap);
  await saveData('autosave', snap);
  const back = await loadData('slot1');
  return {
    match: JSON.stringify(back) === JSON.stringify(snap),
    clockMinutes: snap.clock.minutes,
    usedLocalStorage: localStorage.getItem('fairwaystate:slot1') !== localBefore,
    list: (await window.fairwayNative.list()).sort().join(','),
  };
})()`);
check('save/load round-trip byte-identical', rt.match);
check('native path used (not localStorage)', !rt.usedLocalStorage);
check('native list() sees both keys', rt.list === 'autosave,slot1');

// 4. saves are REAL FILES in userData
const slotFile = path.join(saveDir, 'slot1.json');
const onDisk = fs.existsSync(slotFile) ? JSON.parse(fs.readFileSync(slotFile, 'utf8')) : null;
check('slot1.json exists on disk in userData', !!onDisk);
check('on-disk clock matches saved state', !!onDisk && onDisk.clock.minutes === rt.clockMinutes);

// 5. reload -> Continue restores from native autosave into the shop
await send('Page.reload', {});
await sleep(3500);
const cont = await evalJS(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Continue');
  return { found: !!b, disabled: b ? b.disabled : null };
})()`);
check('Continue enabled after reload', cont.found && cont.disabled === false);
await evalJS(`[...document.querySelectorAll('button')].find(x => x.textContent === 'Continue').click()`);
await sleep(3500);
const cboot = await evalJS(`({ view: window.__fw.view, shopActive: !!window.__fw.shopScene })`);
check('Continue boots into shop3d', cboot.view === 'shop3d' && cboot.shopActive);

// 6. office menu save (real UI path), then cleanup — leave no QA saves behind
await evalJS(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(400);
const office = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const primary = btns.find(b => /Back to the (shop|course)/.test(b.textContent));
  const save2 = btns.find(b => b.textContent === 'Save slot 2');
  if (save2) save2.click();
  return { primaryLabel: primary ? primary.textContent : null, clickedSave2: !!save2 };
})()`);
check('office menu opens in shop with context label', office.primaryLabel === 'Back to the shop');
await sleep(800);
check('office-menu Save slot 2 lands on disk', fs.existsSync(path.join(saveDir, 'slot2.json')));

const clean = await evalJS(`(async () => {
  const { deleteData, listData, loadData } = await import('./src/core/storage.js');
  await deleteData('slot1'); await deleteData('slot2'); await deleteData('autosave');
  return { loadsNull: (await loadData('slot1')) === null, remaining: (await listData()).join(',') };
})()`);
const diskAfter = fs.existsSync(saveDir) ? fs.readdirSync(saveDir) : [];
check('delete round-trip (load -> null, list empty)', clean.loadsNull && clean.remaining === '');
check('no QA save files left on disk', diskAfter.length === 0);

check('zero console errors / CSP violations', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));

console.log(process.exitCode ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS');
ws.close();
process.exit(process.exitCode || 0);
