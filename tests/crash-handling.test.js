// F3 — the crash log and the fault guard, tested where they can be tested from
// Node. The parts that need a window (the panel, the window.onerror hook) are
// proved in the shipping shell by tools/qa/electron-crash-handling.js; these
// tests cover the parts a unit test can genuinely hold: that writing a log never
// throws, that it rotates, and that a fault storm is rate-limited.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { reportFault, resetFaultGuardForTests, faultCounts } from '../src/core/faultGuard.js';

const require = createRequire(import.meta.url);
const { createCrashReporter, CRASH_LOG_MAX_BYTES } = require('../src/electron/crashReport.cjs');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fw-crash-'));

test('a recorded fault lands in the log with its origin and stack', () => {
  const dir = tempDir();
  const reporter = createCrashReporter({ dir, appVersion: '9.9.9', now: () => new Date(0) });
  const result = reporter.record('main:uncaughtException', new Error('boom'));
  assert.equal(result.wrote, true);
  const text = fs.readFileSync(reporter.logPath, 'utf8');
  assert.ok(text.includes('main:uncaughtException'), 'origin is recorded');
  assert.ok(text.includes('boom'), 'message is recorded');
  assert.ok(text.includes('9.9.9'), 'the build that produced it is recorded');
});

test('recording never throws, whatever it is handed', () => {
  const dir = tempDir();
  const reporter = createCrashReporter({ dir });
  const circular = {};
  circular.self = circular;
  // A crash handler that crashes turns a recoverable fault into a silent exit.
  for (const value of [null, undefined, 'a string', 42, circular, new Error('x')]) {
    assert.doesNotThrow(() => reporter.record('test', value, { circular }));
  }
});

test('an unwritable directory degrades to wrote:false instead of throwing', () => {
  // A path whose PARENT is a file cannot be created; this is the real-world
  // shape of a userData directory that has been replaced or locked.
  const dir = tempDir();
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'not a directory');
  const reporter = createCrashReporter({ dir: path.join(blocker, 'logs') });
  const result = reporter.record('test', new Error('nope'));
  assert.equal(result.wrote, false);
});

test('the log rotates rather than growing without bound', () => {
  const dir = tempDir();
  const reporter = createCrashReporter({ dir });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(reporter.logPath, 'x'.repeat(CRASH_LOG_MAX_BYTES + 10));
  reporter.record('test', new Error('after rotation'));
  assert.ok(fs.existsSync(reporter.previousPath), 'the oversized log became the previous log');
  assert.ok(fs.statSync(reporter.logPath).size < CRASH_LOG_MAX_BYTES,
    'the live log restarted small');
});

test('the tail returns the end of the log, which is what a report should carry', () => {
  const dir = tempDir();
  const reporter = createCrashReporter({ dir });
  reporter.record('first', new Error('EARLY_MARKER'));
  reporter.record('second', new Error('LATE_MARKER'));
  const tail = reporter.tail(2048);
  assert.ok(tail.includes('LATE_MARKER'));
});

test('the same fault twenty times is reported a bounded number of times', () => {
  resetFaultGuardForTests();
  const sent = [];
  const native = { reportError: (payload) => sent.push(payload) };
  let clock = 0;
  for (let i = 0; i < 20; i += 1) {
    reportFault('frame', new Error('SAME'), {}, { native, now: () => (clock += 1) });
  }
  assert.ok(sent.length <= 3, `a per-frame throw sent ${sent.length} reports`);
  // ...and a DIFFERENT fault still gets through, which is the thing a global
  // rate limit would break.
  reportFault('frame', new Error('DIFFERENT'), {}, { native, now: () => (clock += 1) });
  assert.ok(sent.some((p) => p.message.includes('DIFFERENT')), 'a new fault is not suppressed');
  assert.ok(faultCounts().some((entry) => entry.count === 20));
});

test('a bridge that throws does not take the fault handler with it', () => {
  resetFaultGuardForTests();
  const native = { reportError: () => { throw new Error('ipc gone'); } };
  assert.doesNotThrow(() => reportFault('frame', new Error('X'), {}, { native, now: () => 1 }));
});
