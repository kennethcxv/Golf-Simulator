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
// G2's DOM sweep writes its verdict to disk. Read it rather than re-running an
// Electron session inside the gate, but NEVER report a pass from a file alone:
// a stale artifact is the oldest way to claim a green that nobody measured, and
// a sweep whose planted controls failed is worth less than no sweep at all.
function g2Sweep() {
  const file = path.resolve('qa/electron/g2-screensweep/g2.json');
  if (!fs.existsSync(file)) {
    return { ok: null, detail: 'the G2 DOM sweep has never been run on this machine' };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ok: null, detail: 'the G2 sweep artifact is unreadable' };
  }
  const v = data.verdict || {};
  const ageH = (Date.now() - fs.statSync(file).mtimeMs) / 3600000;
  if (!v.controlsValid) {
    return {
      ok: false,
      detail: `the sweep ran but its PLANTED CONTROLS FAILED (overlap ${v.plantedOverlapFound}, `
        + `edge ${v.plantedEdgeFound}, truncation ${v.plantedTruncationFound}) - its zeros mean nothing`,
    };
  }
  return { data: v, ageH };
}

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
    check: () => {
      const sweep = g2Sweep();
      if (sweep.ok !== undefined && sweep.ok !== true) return sweep;
      const { data, ageH } = sweep;
      if (data.totalTruncated === undefined) {
        return { ok: null, detail: 'the sweep artifact predates the truncation pass - re-run it' };
      }
      const stale = ageH > 24;
      return {
        ok: stale ? null : data.totalTruncated === 0,
        detail: `${data.totalTruncated} strings clipped, ellipsised or squashed with no way to `
          + `scroll to them, across ${data.screensSwept} DOM screens, planted control found`
          + `${stale ? `; ARTIFACT IS ${ageH.toFixed(0)} h OLD - re-run the sweep` : ''}`
          + '; the canvas screens keep their own truncation ledgers (ledger, front desk)',
      };
    },
  },
  {
    n: 3,
    text: 'No text ever overlaps other text',
    check: () => {
      const sweep = g2Sweep();
      if (sweep.ok !== undefined && sweep.ok !== true) return sweep;
      const { data, ageH } = sweep;
      const stale = ageH > 24;
      return {
        ok: stale ? null : data.totalOverlaps === 0,
        detail: `${data.totalOverlaps} overlapping text pairs across ${data.screensSwept} DOM screens`
          + `, planted control found${stale ? `; ARTIFACT IS ${ageH.toFixed(0)} h OLD - re-run the sweep` : ''}`
          + '; the canvas screens keep their own recorders (ledger, front desk)',
      };
    },
  },
  {
    n: 4,
    text: 'No UI element touches the edge of its container',
    check: () => {
      const sweep = g2Sweep();
      if (sweep.ok !== undefined && sweep.ok !== true) return sweep;
      const { data, ageH } = sweep;
      const stale = ageH > 24;
      return {
        ok: stale ? null : data.totalCramped === 0,
        detail: `${data.totalCramped} elements within 8px of a non-scrolling container edge`
          + `, across ${data.screensSwept} screens, planted flush-edge control found`
          + `${stale ? `; ARTIFACT IS ${ageH.toFixed(0)} h OLD - re-run the sweep` : ''}`,
      };
    },
  },
  {
    n: 5,
    text: 'Four stick tools have visible hands; five hand-worked tools have none',
    check: () => {
      const file = path.resolve('qa/electron/hand-pixels-sweep/hand-pixels-sweep.json');
      if (!fs.existsSync(file)) {
        return { ok: null, detail: 'the hand-pixels sweep has never been run on this machine' };
      }
      let d;
      try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
        return { ok: null, detail: 'the hand-pixels artifact is unreadable' };
      }
      const r = d.sweep || d;
      const c = r.checks || {};
      // The differ-control is the one that makes both halves mean anything: a
      // bare tool reading zero proves nothing if EVERYTHING reads zero.
      if (c.controlHandedAndBareDiffer !== true) {
        return {
          ok: false,
          detail: 'the sweep ran but its handed/bare separation control FAILED - a bare tool '
            + 'reading zero proves nothing if everything reads zero, so both halves are void',
        };
      }
      const ageH = (Date.now() - fs.statSync(file).mtimeMs) / 3600000;
      const stale = ageH > 24;
      const handed = (r.handed || []).map((t) => `${t} ${r.workingMinByTool?.[t] ?? '?'}px`);
      const bare = (r.bare || []).map((t) => `${t} ${r.minByTool?.[t] ?? '?'}px`);
      return {
        ok: stale ? null : r.ok === true,
        detail: `stick tools keep their hands over the working range (<= ${r.workingMaxPitch} pitch): `
          + `${handed.join(', ')}; hand-worked tools draw none at ANY pitch: ${bare.join(', ')}`
          + `${stale ? `; ARTIFACT IS ${ageH.toFixed(0)} h OLD - re-run the sweep` : ''}`,
      };
    },
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
    // G10 (Goal 17) wrote this one. tests/nav-stuck-verdict.test.js pins the
    // contract: three seconds of no progress is stuck REGARDLESS of what
    // displacement thinks, it carries its own reason, and the boundary just
    // under three seconds is not stuck.
    check: () => ({
      ok: results[0].ok,
      detail: 'tests/nav-stuck-verdict.test.js - 3 s of no progress is stuck whatever displacement says, and enters the ladder at retarget rather than sidestep',
    }),
  },
  {
    n: 8,
    text: 'Every player-facing string goes through t()',
    check: () => {
      // The suite result is already in hand; this invariant is pinned by
      // tests/player-strings-ratchet.test.js, which fails when the count of
      // player-facing literals bypassing t() GROWS.
      const file = path.resolve('tests/player-strings-ratchet.test.js');
      if (!fs.existsSync(file)) {
        return { ok: null, detail: 'the ratchet test is missing' };
      }
      const baseline = /const BASELINE = (\d+)/.exec(fs.readFileSync(file, 'utf8'))?.[1];
      if (!baseline) return { ok: null, detail: 'the ratchet has no readable baseline' };
      return {
        ok: Number(fail) === 0,
        detail: `${baseline} raw strings at FOUR SINKS (toast/announce/setPrompt/setHint plus `
          + 'shop.log) are held under a ratchet - a new one there fails the suite. THAT IS THE '
          + 'WHOLE OF WHAT THIS CHECKS, and it is a small fraction of the surface: measured '
          + '2026-08-08, roughly 1,650 further player-facing literals live at prop labels, '
          + 'el({text}), ctx.fillText and refusal reasons, none of them scanned. This invariant '
          + 'reads PASS because its check is narrow, not because the game is translated. '
          + 'Widening the sink list is on NOT DONE and is the honest next step',
      };
    },
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
