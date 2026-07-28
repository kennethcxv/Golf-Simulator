// The QA-harness integrity sweep (HARNESS_TRUST.md rule 8, committed 2026-07-28).
//
// The maintenance-drift audit found 14 committed harnesses dead or false-red:
// one file that never parsed sat in the tree for weeks, nine referenced a
// BASE_URL global no committed runner defines, and five called a register API
// that no longer exists. Each class gets a permanent gate here so it cannot
// recur silently:
//
//   1. every tools/qa function-file constructs exactly the way
//      run-playwright.cjs does (and module-style files pass `node --check`),
//   2. every `register.<method>(` a harness calls exists in the live register
//      source,
//   3. any file using BASE_URL defines it (from QA_BASE_URL),
//   4. no live file loads from tools/qa/archive/.
//
// tools/qa/archive/ is excluded everywhere: retired harnesses are history, not
// evidence (see the archive README).

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const QA_ROOT = 'tools/qa';
const ARCHIVE_ROOT = path.join(QA_ROOT, 'archive');

const liveQaFiles = fs.readdirSync(QA_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name))
  .map((entry) => path.join(QA_ROOT, entry.name));
const read = (file) => fs.readFileSync(file, 'utf8');

// Mirrors run-playwright.cjs exactly: the runner wraps the file source in a
// strict-mode expression return. Parse failure here is parse failure there.
function constructAsFunctionFile(source) {
  return Function(`"use strict"; return (${source});`)();
}

function nodeCheck(file) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--check', file], { windowsHide: true },
      (error, _stdout, stderr) => resolve({ ok: !error, stderr: String(stderr || '') }));
  });
}

async function pooled(items, limit, worker) {
  const results = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const mine = index++;
      results[mine] = await worker(items[mine]);
    }
  }));
  return results;
}

test('every live QA file parses the way its runner will run it', async () => {
  const failures = [];
  const moduleFiles = [];
  for (const file of liveQaFiles) {
    if (/\.(mjs|cjs)$/.test(file)) {
      moduleFiles.push(file);
      continue;
    }
    const source = read(file);
    const isFunctionFile = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*async\s*\(/.test(source);
    try {
      const value = constructAsFunctionFile(source);
      if (isFunctionFile && typeof value !== 'function') {
        failures.push(`${file}: constructs but does not evaluate to a function (trailing tokens?)`);
      }
    } catch (error) {
      if (isFunctionFile) {
        failures.push(`${file}: ${error.message}`);
      } else {
        // A Node-utility .js (ESM imports) legitimately fails expression
        // construction; it must instead be a valid module.
        moduleFiles.push(file);
      }
    }
  }
  const checks = await pooled(moduleFiles, 8, async (file) => ({ file, ...(await nodeCheck(file)) }));
  for (const check of checks) {
    if (!check.ok) failures.push(`${check.file}: node --check failed\n${check.stderr.slice(0, 400)}`);
  }
  assert.deepEqual(failures, [], `parse-dead QA files:\n${failures.join('\n')}`);
});

test('every register API a harness calls exists in the live register source', () => {
  const liveSource = read('src/render3d/clubhouse/simplifiedRegisterMode.js')
    + read('src/render3d/clubhouse.js');
  const failures = [];
  const callPattern = /\bregister\??\.([A-Za-z_$][\w$]*)\s*\??\.?\s*\(/g;
  for (const file of liveQaFiles) {
    const source = read(file);
    const missing = new Set();
    for (const match of source.matchAll(callPattern)) {
      const name = match[1];
      if (!new RegExp(`\\b${name}\\s*[:,(=]`).test(liveSource)) missing.add(name);
    }
    if (missing.size) failures.push(`${file}: register.${[...missing].join(', register.')}`);
  }
  assert.deepEqual(failures, [],
    `harnesses call register APIs the live code does not export:\n${failures.join('\n')}`);
});

test('any QA file using BASE_URL defines it from QA_BASE_URL', () => {
  const failures = [];
  for (const file of liveQaFiles) {
    const source = read(file);
    if (!/\bBASE_URL\b/.test(source)) continue;
    const defines = /(?:const|let|var)\s+BASE_URL\s*=/.test(source)
      || /DEFAULT_BASE_URL/.test(source);
    if (!defines) failures.push(file);
  }
  assert.deepEqual(failures, [],
    `files reference BASE_URL without defining it:\n${failures.join('\n')}`);
});

test('no live file loads from tools/qa/archive', () => {
  const archived = fs.existsSync(ARCHIVE_ROOT)
    ? fs.readdirSync(ARCHIVE_ROOT).filter((name) => /\.(js|mjs|cjs)$/.test(name))
    : [];
  const loadWord = /import|require|readFile|fetch|callbackFrom/;
  const failures = [];
  for (const file of liveQaFiles) {
    for (const line of read(file).split('\n')) {
      if (!loadWord.test(line)) continue;
      for (const name of archived) {
        if (line.includes(name)) failures.push(`${file} loads archived ${name}`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});
