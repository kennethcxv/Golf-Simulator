import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const target = process.argv[2];
if (!target) throw new Error('Usage: node tools/qa/run-browser-function.mjs <async-page-function.js>');

const targetPath = path.resolve(process.cwd(), target);
const source = await fs.readFile(targetPath, 'utf8');
// These tiny checked-in wrappers intentionally evaluate to a function instead
// of exporting one. Resolve their relative dynamic imports before evaluation so
// the runner works on stock Node without the experimental VM-modules flag.
const resolvedSource = source.replace(
  /import\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g,
  (_match, _quote, specifier) => `import(${JSON.stringify(
    pathToFileURL(path.resolve(path.dirname(targetPath), specifier)).href,
  )})`,
);
const run = Function(`"use strict"; return (${resolvedSource}\n);`)();
if (typeof run !== 'function') throw new Error(`${target} did not evaluate to a function.`);

const videoDir = process.env.QA_VIDEO_DIR ? path.resolve(process.cwd(), process.env.QA_VIDEO_DIR) : null;
if (videoDir) await fs.mkdir(videoDir, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.QA_BROWSER_CHANNEL || 'chrome',
  headless: process.env.QA_HEADLESS !== '0',
  args: ['--enable-precise-memory-info', '--force-device-scale-factor=1'],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
  ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 1600, height: 900 } } } : {}),
});
const page = await context.newPage();
if (process.env.QA_BOOTSTRAP === '1') {
  const baseUrl = process.env.QA_BASE_URL || process.env.GOLF_FLIPPER_URL || 'http://127.0.0.1:8457/';
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const empireModule = await import('/src/sim/empire.js');
    const empire = empireModule.newEmpire('relaxed', seed);
    const willow = empire.market.find((property) => property.name === 'Willow Creek Municipal') || empire.market[0];
    const bought = empireModule.buyProperty(empire, willow.id);
    if (!bought.ok) throw new Error(bought.reason);
    localStorage.setItem('golfempire:autosave', JSON.stringify(empireModule.empireSnapshot(empire)));
  }, Number(process.env.QA_BOOTSTRAP_SEED || 20260719));
}
let result;
try {
  result = await run(page);
} finally {
  await context.close();
  await browser.close();
}

const resultPath = process.env.QA_RESULT_PATH ? path.resolve(process.cwd(), process.env.QA_RESULT_PATH) : null;
if (resultPath) {
  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
if (result?.ok === false) process.exitCode = 1;
