// READ YOUR OWN SAVE'S CHECKOUT HEALTH.
//
//   npm run save:check              -- every save file this machine has
//   npm run save:check -- autosave  -- just one, by name
//
// The owner asked how to read his save's latch state himself. He should not have
// to take my word for any of this, and I should not have to be running to answer
// "is my save wedged".
//
// WHERE SAVES ACTUALLY LIVE. Not localStorage -- that cost me a probe lie. The
// Electron build routes src/core/storage.js through window.fairwayNative, and
// main.cjs writes files under app.getPath('userData'):
//
//   Windows  %APPDATA%\GOLF EMPIRE\saves
//   macOS    ~/Library/Application Support/GOLF EMPIRE/saves
//   Linux    ~/.config/GOLF EMPIRE/saves
//
// Two columns matter and they are different questions:
//   ON DISK    what the file carries -- a latch here was saved by a past session
//   AFTER LOAD what the game derives when it opens the file -- a latch here is
//              being SET AT BOOT, and clearing it will not survive a restart
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deserializeEmpireWithReport, activeState } from '../src/sim/empire.js';
import { deserializeWithReport } from '../src/sim/state.js';
import { checkoutWalIsQuarantined, pendingCheckoutCount } from '../src/sim/checkoutSettlement.js';

function saveDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'GOLF EMPIRE', 'saves');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'GOLF EMPIRE', 'saves');
  }
  return path.join(os.homedir(), '.config', 'GOLF EMPIRE', 'saves');
}

const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'))[0] || null;
// --dir exists so this tool can be pointed at a KNOWN-LATCHED save and shown to
// report SET. "No save has an active latch" from an instrument that has never
// once printed SET is not a reading, it is an untested code path.
const dirArg = process.argv.slice(2).find((a) => a.startsWith('--dir='));
const dir = dirArg ? dirArg.slice('--dir='.length) : saveDir();
if (!fs.existsSync(dir)) {
  console.log(`No save directory at ${dir}`);
  process.exit(0);
}

const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.json') && !f.includes('-meta') && !f.endsWith('.bak'))
  .filter((f) => !filter || f.includes(filter));

console.log(`Save directory: ${dir}\n`);
let anyWedged = false;

for (const file of files) {
  const full = path.join(dir, file);
  const stat = fs.statSync(full);
  const text = fs.readFileSync(full, 'utf8');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    console.log(`${file}  UNREADABLE: ${e.message}\n`);
    continue;
  }

  const isEmpire = raw?.empireVersion != null || Array.isArray(raw?.holdings);
  const shopOnDisk = isEmpire ? raw?.holdings?.[0]?.state?.shop : raw?.shop;
  const diskLatch = shopOnDisk?.pendingCheckoutsQuarantine;

  let state = null;
  let repairs = [];
  try {
    if (isEmpire) {
      const { empire, report } = deserializeEmpireWithReport(JSON.parse(text));
      state = activeState(empire);
      repairs = report?.repairs || [];
    } else {
      const loaded = deserializeWithReport(text);
      state = loaded.state;
      repairs = loaded.report?.repairs || [];
    }
  } catch (e) {
    console.log(`${file}  FAILED TO LOAD: ${e.message}\n`);
    continue;
  }

  const bootLatched = checkoutWalIsQuarantined(state);
  const diskLatched = diskLatch?.active === true;
  if (bootLatched) anyWedged = true;

  const checkoutRepairs = repairs.filter(({ path: p }) => /checkout/i.test(String(p)));

  console.log(`${file}   (saved ${stat.mtime.toISOString().replace('T', ' ').slice(0, 16)})`);
  console.log(`  latch ON DISK      ${diskLatch ? `${diskLatched ? 'SET' : 'released'} — ${diskLatch.reason ?? 'no reason recorded'}` : 'absent'}`);
  console.log(`  latch AFTER LOAD   ${bootLatched ? `SET — ${state.shop.pendingCheckoutsQuarantine?.reason ?? 'unknown'}` : 'clear'}`);
  console.log(`  till would refuse  ${pendingCheckoutCount(state) > 0 ? 'YES — a sale will fail to bank' : 'no'}`);
  if (!diskLatched && bootLatched) {
    console.log('  >> SET AT BOOT, not carried in the file. Clearing it in game will');
    console.log('     not survive a restart: the loader re-derives it every time.');
  }
  for (const { path: p, message } of checkoutRepairs) console.log(`  repair             ${p}: ${message}`);
  console.log('');
}

if (!files.length) console.log('(no save files matched)');
else if (!anyWedged) console.log('No save on this machine has an active checkout latch.');
