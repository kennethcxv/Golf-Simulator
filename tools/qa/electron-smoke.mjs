import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const OUT = path.resolve(process.env.QA_ELECTRON_OUT || path.join(ROOT, 'qa', 'integration', 'electron-smoke'));
const executablePath = path.join(
  ROOT,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
);

await fs.mkdir(OUT, { recursive: true });

const diagnostics = {
  executablePath: path.relative(ROOT, executablePath).replaceAll('\\', '/'),
  consoleErrors: [],
  pageErrors: [],
  processErrors: [],
  result: null,
};

let app = null;
try {
  app = await electron.launch({
    executablePath,
    args: ['.'],
    cwd: ROOT,
    timeout: 60_000,
  });

  const child = app.process();
  child?.stderr?.on('data', (chunk) => {
    const message = chunk.toString().trim();
    if (message) diagnostics.processErrors.push(message);
  });

  const window = await app.firstWindow({ timeout: 60_000 });
  window.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  window.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack || error.message));

  await window.waitForLoadState('domcontentloaded');
  await window.waitForFunction(() => window.__fw?.screen === 'menu', null, { timeout: 60_000 });
  const result = await window.evaluate(async () => {
    const display = await window.fairwayNative?.displayInfo?.();
    return {
      title: document.title,
      urlProtocol: location.protocol,
      readyState: document.readyState,
      menuVisible: !!document.querySelector('.menu-screen'),
      appScreen: window.__fw?.screen || null,
      nativeBridge: {
        present: !!window.fairwayNative,
        save: typeof window.fairwayNative?.save,
        load: typeof window.fairwayNative?.load,
        loadRecord: typeof window.fairwayNative?.loadRecord,
        displayInfo: typeof window.fairwayNative?.displayInfo,
      },
      security: {
        nodeRequireExposed: typeof window.require !== 'undefined',
        nodeProcessExposed: typeof window.process !== 'undefined',
      },
      display,
    };
  });
  diagnostics.result = result;
  await window.screenshot({ path: path.join(OUT, 'electron-main-menu.png'), animations: 'disabled' });

  const bridgeFunctions = Object.values(result.nativeBridge).filter((value) => value !== true);
  const pass = result.title === 'GOLF EMPIRE'
    && result.urlProtocol === 'file:'
    && result.readyState === 'complete'
    && result.menuVisible
    && result.appScreen === 'menu'
    && result.nativeBridge.present
    && bridgeFunctions.every((value) => value === 'function')
    && result.security.nodeRequireExposed === false
    && result.security.nodeProcessExposed === false
    && Number.isFinite(result.display?.width)
    && Number.isFinite(result.display?.height)
    && diagnostics.consoleErrors.length === 0
    && diagnostics.pageErrors.length === 0;

  const report = { pass, ...diagnostics };
  await fs.writeFile(path.join(OUT, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!pass) process.exitCode = 1;
} catch (error) {
  diagnostics.processErrors.push(error.stack || error.message);
  const report = { pass: false, ...diagnostics };
  await fs.writeFile(path.join(OUT, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
}
