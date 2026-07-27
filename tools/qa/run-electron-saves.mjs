// Own the complete Electron persistence QA lifecycle so the desktop process is
// always stopped, including when the attached assertions fail.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const port = process.argv[2] || '19337';
const outputDir = path.resolve(process.argv[3] || 'qa/electron-release');
const userDataDir = path.join(outputDir, 'user-data');
const screenshotPath = path.join(outputDir, 'screenshot.png');
const electronPath = path.resolve('node_modules/electron/dist/electron.exe');

fs.mkdirSync(userDataDir, { recursive: true });

const electron = spawn(electronPath, [
  '.',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
], {
  cwd: process.cwd(),
  stdio: 'ignore',
  windowsHide: true,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForEndpoint() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (electron.exitCode != null) {
      throw new Error(`Electron exited before CDP became ready (${electron.exitCode})`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch (_) { /* Electron is still starting. */ }
    await sleep(250);
  }
  throw new Error(`Electron CDP endpoint did not become ready on ${port}`);
}

function runAssertions() {
  const child = spawn(process.execPath, [
    'tools/qa-electron-saves.mjs',
    port,
    userDataDir,
    screenshotPath,
  ], {
    cwd: process.cwd(),
    stdio: 'inherit',
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Electron assertions exited with ${code ?? signal}`));
    });
  });
}

try {
  await waitForEndpoint();
  await runAssertions();
} finally {
  if (electron.exitCode == null) {
    electron.kill();
    await Promise.race([
      new Promise((resolve) => electron.once('exit', resolve)),
      sleep(3_000),
    ]);
  }
}
