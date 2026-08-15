// F3 — WHERE A CRASH GOES.
//
// Until this file the answer was "nowhere": no uncaughtException handler, no
// render-process-gone handler, no log on disk. A renderer that died took the
// window with it and left a player with a blank screen and no way to say what
// happened. A save from ten minutes ago is not much comfort if you cannot tell
// anyone why you lost it.
//
// Three rules this module holds to:
//   1. Writing the log must never itself throw. A crash handler that crashes
//      turns a recoverable fault into a silent exit.
//   2. The log is APPENDED to a rotating file, so the report a player sends
//      contains the run before the one that died — the interesting one is
//      usually not the last.
//   3. Nothing here decides policy. It records and returns the path; the caller
//      decides whether to offer a restart.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX_BYTES = 512 * 1024; // one rotation, so a crash loop cannot fill a disk

function safe(fn, fallback = null) {
  try { return fn(); } catch { return fallback; }
}

function describe(error) {
  if (error == null) return 'unknown';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  return safe(() => JSON.stringify(error), String(error)) || String(error);
}

function createCrashReporter({ dir, appVersion = null, now = () => new Date() }) {
  const logDir = dir;
  const logPath = path.join(logDir, 'crash.log');
  const previousPath = path.join(logDir, 'crash.previous.log');
  let sessionHeaderWritten = false;

  const ensureDir = () => safe(() => fs.mkdirSync(logDir, { recursive: true }));

  const rotateIfLarge = () => safe(() => {
    if (!fs.existsSync(logPath)) return;
    if (fs.statSync(logPath).size < MAX_BYTES) return;
    safe(() => fs.rmSync(previousPath, { force: true }));
    fs.renameSync(logPath, previousPath);
  });

  const append = (text) => safe(() => {
    ensureDir();
    rotateIfLarge();
    fs.appendFileSync(logPath, text, 'utf8');
    return true;
  }, false);

  const sessionHeader = () => {
    if (sessionHeaderWritten) return '';
    sessionHeaderWritten = true;
    return [
      '',
      '='.repeat(72),
      `session ${safe(() => now().toISOString(), 'unknown time')}`,
      `app ${appVersion || 'unknown'} · electron ${process.versions.electron || 'n/a'}`
        + ` · node ${process.versions.node} · ${os.platform()} ${os.release()}`,
      '='.repeat(72),
      '',
    ].join('\n');
  };

  return {
    logPath,
    previousPath,
    /**
     * Record one fault. `origin` says which process and which hook caught it,
     * `detail` is whatever extra the hook knows (exit code, reason, url).
     */
    record(origin, error, detail = null) {
      const stamp = safe(() => now().toISOString(), 'unknown time');
      const lines = [
        sessionHeader(),
        `[${stamp}] ${origin}`,
        describe(error).split('\n').map((line) => `    ${line}`).join('\n'),
      ];
      if (detail && Object.keys(detail).length) {
        lines.push(`    detail ${safe(() => JSON.stringify(detail), '(unserialisable)')}`);
      }
      lines.push('');
      const wrote = append(`${lines.join('\n')}\n`);
      return { wrote, logPath, origin, when: stamp };
    },
    /** The tail a support request should carry, newest last. */
    tail(bytes = 8192) {
      return safe(() => {
        if (!fs.existsSync(logPath)) return '';
        const size = fs.statSync(logPath).size;
        const start = Math.max(0, size - bytes);
        const fd = fs.openSync(logPath, 'r');
        try {
          const buffer = Buffer.alloc(size - start);
          fs.readSync(fd, buffer, 0, buffer.length, start);
          return buffer.toString('utf8');
        } finally {
          fs.closeSync(fd);
        }
      }, '');
    },
  };
}

module.exports = { createCrashReporter, describeCrash: describe, CRASH_LOG_MAX_BYTES: MAX_BYTES };
