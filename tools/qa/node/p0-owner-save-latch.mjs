// P0 (Goal 25 round 2) — DOES THE REPAIR RE-LATCH ON EVERY LOAD?
//
// The owner's question, exactly: "If my save has malformed pendingCheckouts,
// clearing the latch once does nothing -- next load sets it again. Check whether
// the latch is set once or every boot."
//
// This reads HIS ACTUAL SAVE FILES from %APPDATA%/GOLF EMPIRE/saves and runs
// them through the shipped loader. Read-only: nothing here writes to that
// directory, and the parsed JSON is cloned before any load touches it.
//
// This is the measurement I have owed him since probe-lie #17. Every previous
// attempt read localStorage inside a fresh Electron QA profile -- the runner
// boots --user-data-dir=<temp>/<scope>-<rand>, so an empty result meant "I
// cannot see his save", not "his save is clean". Electron does not use
// localStorage for saves at all: src/core/storage.js routes through
// window.fairwayNative, and main.cjs writes files under app.getPath('userData').
//
// Three things get reported per file, and the third is the whole item:
//   ON DISK    what the file itself carries (is the latch saved?)
//   AFTER LOAD what the shipped loader produces from it (is it set at boot?)
//   RE-LATCH   release it, save, load again -- does it come back?
import fs from 'node:fs';
import path from 'node:path';
import { deserializeEmpireWithReport, serializeEmpire, activeState } from '../../../src/sim/empire.js';
import {
  checkoutWalIsQuarantined, releaseCheckoutWalQuarantine,
} from '../../../src/sim/checkoutSettlement.js';

const SAVE_DIR = path.join(process.env.APPDATA || '', 'GOLF EMPIRE', 'saves');

function latchOf(state) {
  const q = state?.shop?.pendingCheckoutsQuarantine;
  if (!q) return null;
  return {
    active: q.active === true,
    reason: q.reason ?? null,
    releasedBy: q.releasedBy ?? null,
    evidence: q.evidence ? Object.keys(q.evidence) : null,
  };
}

function checkoutRepairs(report) {
  return (report?.repairs || [])
    .filter(({ path: p }) => typeof p === 'string' && /checkout/i.test(p))
    .map(({ path: p, message }) => `${p}: ${message}`);
}

const results = [];
for (const file of fs.readdirSync(SAVE_DIR)) {
  if (!file.endsWith('.json') || file.includes('-meta') || file.endsWith('.bak')) continue;
  const text = fs.readFileSync(path.join(SAVE_DIR, file), 'utf8');
  let raw;
  try { raw = JSON.parse(text); } catch (e) { results.push({ file, unparseable: String(e.message) }); continue; }

  const shopOnDisk = raw?.holdings?.[0]?.state?.shop ?? raw?.shop ?? null;
  const onDisk = {
    latch: shopOnDisk?.pendingCheckoutsQuarantine
      ? { active: shopOnDisk.pendingCheckoutsQuarantine.active === true,
        reason: shopOnDisk.pendingCheckoutsQuarantine.reason ?? null }
      : '(field absent)',
    pendingCheckouts: shopOnDisk && Object.hasOwn(shopOnDisk, 'pendingCheckouts')
      ? JSON.stringify(shopOnDisk.pendingCheckouts).slice(0, 80) : '(field absent)',
    hasReceipts: shopOnDisk ? Object.hasOwn(shopOnDisk, 'checkoutSettlementReceipts') : null,
    hasReceiptKeys: shopOnDisk ? Object.hasOwn(shopOnDisk, 'checkoutSettlementReceiptKeys') : null,
    hasProjectionIds: shopOnDisk ? Object.hasOwn(shopOnDisk, 'checkoutProjectionIds') : null,
  };

  // ---- BOOT 1: exactly what the game does when he presses Continue ---------
  let loaded;
  let report;
  try {
    ({ empire: loaded, report } = deserializeEmpireWithReport(JSON.parse(text)));
  } catch (e) {
    results.push({ file, onDisk, loadThrew: String(e.message) });
    continue;
  }
  const state1 = activeState(loaded);
  const boot1 = { latch: latchOf(state1), quarantined: checkoutWalIsQuarantined(state1),
    repairs: checkoutRepairs(report) };

  // ---- THE RE-LATCH TEST ---------------------------------------------------
  // Only meaningful if boot 1 latched. Use the manager's key, save the way the
  // game saves, and boot the result. If the latch is back, the key is useless
  // and the repair path is the bug.
  let relatch = '(not applicable — boot 1 was clean)';
  if (boot1.quarantined) {
    const release = releaseCheckoutWalQuarantine(state1, { acknowledgedBy: 'p0-probe' });
    const clearedInMemory = !checkoutWalIsQuarantined(state1);
    const saved = serializeEmpire(loaded);
    const { empire: reloaded } = deserializeEmpireWithReport(JSON.parse(saved));
    const state2 = activeState(reloaded);
    relatch = {
      releaseSaid: release,
      clearedInMemory,
      savedWithLatch: JSON.parse(saved)?.holdings?.[0]?.state?.shop
        ?.pendingCheckoutsQuarantine?.active === true,
      afterReload: latchOf(state2),
      RE_LATCHED: checkoutWalIsQuarantined(state2),
    };
  }

  results.push({ file, onDisk, boot1, relatch });
}

console.log(JSON.stringify({ saveDir: SAVE_DIR, results }, null, 2));
