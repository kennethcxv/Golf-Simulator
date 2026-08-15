// P0 (Goal 25 round 3) — RUN HIS OWN RESERVATIONS THROUGH THE CHECK-IN.
//
// Guessing at reservation shapes did not reproduce it (see
// p0-reservation-target-repro.mjs: eight plausible variations, none failed).
// That is the same dead end as guessing which of the 277 messages he saw.
//
// So: stop guessing and use his data. This loads his real save through the
// shipped loader and attempts a check-in against every open reservation in it,
// reporting the clause number for any that refuse. Read-only -- the save is
// parsed from disk, and each attempt runs on its own freshly-loaded copy so one
// arm cannot contaminate the next.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deserializeEmpireWithReport, activeState } from '../../../src/sim/empire.js';
import { createReservationCheckInTx, finalizeReservationCheckIn } from '../../../src/sim/reservationCheckIn.js';
import {
  acceptCash, depositTendered, enterCardDigit, insertCard, makeChange, openDrawer,
  presentCard, requestPayment, runCard, submitCardAmount, totalOf,
} from '../../../src/sim/register.js';

function saveDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'GOLF EMPIRE', 'saves');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'GOLF EMPIRE', 'saves');
  }
  return path.join(os.homedir(), '.config', 'GOLF EMPIRE', 'saves');
}

const dir = saveDir();
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.includes('-meta') && !f.endsWith('.bak'))
  : [];

function payCard(tx) {
  requestPayment(tx);
  presentCard(tx);
  insertCard(tx);
  for (const digit of String(Math.round(totalOf(tx) * 100))) enterCardDigit(tx, Number(digit));
  submitCardAmount(tx);
  return runCard(tx).result === 'approved';
}

function payCash(state, tx) {
  requestPayment(tx);
  const due = Math.ceil(totalOf(tx) / 20) * 20 || 20;
  tx.tendered = makeChange(due);
  acceptCash(tx);
  openDrawer(tx);
  depositTendered(tx, state.shop.drawer);
  return true;
}

for (const file of files) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  let base;
  try { base = JSON.parse(text); } catch { continue; }
  let probe;
  try { probe = activeState(deserializeEmpireWithReport(JSON.parse(text)).empire); } catch (e) {
    console.log(`${file}: load failed ${e.message}`);
    continue;
  }
  // reservations.booked is the array; my first pass guessed .list/.bookings and
  // reported "0 reservations" about a save that has them.
  const raw = probe.reservations?.booked;
  const list = Array.isArray(raw) ? raw : Object.values(raw || {});
  const open = (Array.isArray(list) ? list : []).filter((r) => r && r.status === 'booked');
  console.log(`\n=== ${file}: ${Array.isArray(list) ? list.length : 0} reservations, ${open.length} open/booked`);
  if (!Array.isArray(list) || !list.length) continue;
  const byStatus = {};
  for (const r of list) byStatus[r?.status ?? 'undefined'] = (byStatus[r?.status ?? 'undefined'] || 0) + 1;
  console.log('   statuses:', JSON.stringify(byStatus));

  for (const target of open.slice(0, 12)) {
    // fresh copy per attempt
    const state = activeState(deserializeEmpireWithReport(JSON.parse(text)).empire);
    for (const method of ['card', 'cash']) {
      const made = createReservationCheckInTx(state, target.id, { method, rng: () => 0.9 });
      if (!made.ok) { console.log(`   ${target.id} [${method}] ticket refused: ${made.reason || made.diagnostic}`); continue; }
      const { tx } = made;
      const paid = method === 'card' ? payCard(tx) : payCash(state, tx);
      if (!paid) { console.log(`   ${target.id} [${method}] payment not approved`); continue; }
      let result;
      let threw = null;
      try { result = finalizeReservationCheckIn(state, tx); } catch (e) { threw = String(e?.message || e); }
      const mark = result?.ok ? 'OK  ' : 'FAIL';
      console.log(`   ${mark} ${target.id} [${method}] ${threw ? `THREW ${threw}` : (result?.diagnostic || result?.reason || '')}`);
      if (result?.ok) break; // one successful method is enough for this reservation
    }
  }
}
if (!files.length) console.log(`no saves at ${dir}`);
