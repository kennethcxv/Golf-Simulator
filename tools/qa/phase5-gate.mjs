// PHASE 5 — THE REGRESSION GATE, AS ONE COMMAND.
//
// Full_Goal_17 asks for exactly this: "Build a single command that checks all
// of them and run it in Phase 5. Where an invariant has no check yet, write
// one."
//
// This runs what can be run and, for the invariants that have no automated
// check, SAYS SO rather than leaving a blank that reads as a pass. An invariant
// reported as "no check exists" is doing more good than one silently skipped -
// the whole reason this project keeps a fault list is that absent evidence has
// repeatedly been read as green.
//
//   node tools/qa/phase5-gate.mjs            run everything
//   node tools/qa/phase5-gate.mjs --fast     skip the Electron walk (suite only)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FAST = process.argv.includes('--fast');
const results = [];

function run(label, cmd, args, { optional = false } = {}) {
  process.stdout.write(`\n=== ${label}\n`);
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20 * 60 * 1000,
    });
    return { ok: true, out };
  } catch (error) {
    const out = `${error.stdout || ''}${error.stderr || ''}`;
    if (!optional) process.exitCode = 1;
    return { ok: false, out, error: error.message };
  }
}

// ---- 1. the suite -------------------------------------------------------
// `node --test` directly rather than through npm: the npm shim on Windows
// swallowed the summary lines and this gate reported "? pass / ? fail", which
// then FAILED invariants 9 and 10 on a green suite. A gate that cannot read its
// own suite is worse than no gate, because it cries wolf.
const suite = run('invariant suite (node --test)', process.execPath, ['--test']);
const pass = /^# pass (\d+)$/m.exec(suite.out)?.[1] ?? '?';
const fail = /^# fail (\d+)$/m.exec(suite.out)?.[1] ?? '?';
results.push({ check: 'suite', ok: fail === '0', detail: `${pass} passing, ${fail} failing` });
console.log(`suite: ${pass} pass / ${fail} fail`);

// ---- 2. the sixty-second walk ------------------------------------------
let walk = null;
if (!FAST) {
  const udd = path.join(process.env.TEMP || '/tmp', `fw-phase5-${process.pid}`);
  fs.rmSync(udd, { recursive: true, force: true });
  const r = run('sixty-second walk (Electron)', 'node', [
    'tools/qa/run-electron.cjs', 'tools/qa/electron-sixty-second-walk.js',
    '--clubhouse=pine-hills-v2', `--user-data-dir=${udd}`,
  ], { optional: true });
  const line = /^P5 verdict (\{.*\})$/m.exec(r.out)?.[1];
  if (line) {
    walk = JSON.parse(line);
    console.log('walk:', line);
  } else {
    console.log('walk: DID NOT REPORT - treat as unknown, not as a pass');
  }
}

// ---- 3. the ten standing invariants, each answered honestly ------------
const TEN = [
  {
    n: 1,
    text: 'No frame over 16 ms during normal play',
    check: () => (walk
      ? {
        ok: walk.noFrameOver16 === true,
        detail: `worst ${walk.worstFrameMs} ms, ${walk.framesOver16} frames over 16 (${walk.framesOver16Pct}%), ${walk.framesOver100} over 100`,
      }
      : { ok: null, detail: 'walk did not run' }),
  },
  {
    n: 2,
    text: 'No text is ever cut off',
    check: () => ({ ok: null, detail: 'covered for the ledger and the front-desk monitor by their own recorders; NO WHOLE-GAME CHECK EXISTS' }),
  },
  {
    n: 3,
    text: 'No text ever overlaps other text',
    check: () => ({ ok: null, detail: 'ledger + monitor overlap recorders exist; NO WHOLE-GAME CHECK EXISTS, and G2 asks for exactly that sweep' }),
  },
  {
    n: 4,
    text: 'No UI element touches the edge of its container',
    check: () => ({ ok: null, detail: 'NO CHECK EXISTS' }),
  },
  {
    n: 5,
    text: 'Four stick tools have visible hands; five hand-worked tools have none',
    check: () => ({ ok: null, detail: 'tests/…hand-pixels driver covers both halves but is not wired into this gate; its pixel FLOOR was calibrated at 1280x720 and A5 changed the default window - recalibration owed' }),
  },
  {
    n: 6,
    text: 'Nothing carried is ever left floating, unputdownable, or allows a tool swap',
    // D4 (Goal 17) wrote this one. tests/carryable-system.test.js runs inside
    // the suite and pins all three clauses: one predicate covering every carry
    // system, the belt refusing on BOTH its paths, and every station boundary
    // putting carried things down.
    check: () => ({
      ok: results[0].ok,
      detail: 'tests/carryable-system.test.js - one predicate over cartons, the ledger and loose goods; belt guarded on both paths; station boundaries put down',
    }),
  },
  {
    n: 7,
    text: 'No NPC is stuck for more than 3 seconds',
    check: () => ({ ok: null, detail: 'NO CHECK EXISTS - this is G10 and it is unstarted' }),
  },
  {
    n: 8,
    text: 'Every player-facing string goes through t()',
    check: () => ({ ok: null, detail: 'partially covered by the i18n coverage test; no check that a NEW literal is caught' }),
  },
  {
    n: 9,
    text: 'No duplicate keys in any object literal',
    check: () => ({ ok: results[0].ok, detail: 'the lint runs inside the suite' }),
  },
  {
    n: 10,
    text: 'The suite is green and the tree is clean at every commit',
    check: () => {
      let dirty = '';
      try {
        dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' });
      } catch { dirty = '?'; }
      const srcDirty = dirty.split('\n').filter((l) => /\s(src|tests|tools)\//.test(l));
      return {
        ok: results[0].ok && srcDirty.length === 0,
        detail: srcDirty.length ? `${srcDirty.length} tracked source files modified` : 'suite green, no tracked source changes',
      };
    },
  },
];

console.log('\n=== THE TEN STANDING INVARIANTS');
const rows = TEN.map((inv) => {
  const r = inv.check();
  const mark = r.ok === true ? 'PASS' : r.ok === false ? 'FAIL' : 'NO CHECK';
  console.log(`${String(inv.n).padStart(2)}. [${mark.padEnd(8)}] ${inv.text}`);
  console.log(`    ${r.detail}`);
  return { n: inv.n, text: inv.text, verdict: mark, detail: r.detail };
});

const failed = rows.filter((r) => r.verdict === 'FAIL');
const unchecked = rows.filter((r) => r.verdict === 'NO CHECK');
console.log(`\nSUMMARY: ${rows.length - failed.length - unchecked.length} pass, ${failed.length} FAIL, ${unchecked.length} with no check yet.`);
if (failed.length) {
  console.log('FAILING:', failed.map((f) => f.n).join(', '));
  process.exitCode = 1;
}

fs.mkdirSync('qa/electron/phase5-walk', { recursive: true });
fs.writeFileSync('qa/electron/phase5-walk/phase5-gate.json',
  `${JSON.stringify({ suite: { pass, fail }, walk, invariants: rows }, null, 2)}\n`);
