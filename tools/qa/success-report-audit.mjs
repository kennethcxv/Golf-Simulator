// BLOCKER 2 — "success reported, effect absent", treated as a class.
//
//   node tools/qa/success-report-audit.mjs
//
// The defect: an interaction tells the player it worked without ever asking
// whether it worked. The ceiling repair was one instance — restorationAction
// refused the write and the toast fired anyway.
//
// WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT.
//
// It enumerates every call site of every sim mutation that can REFUSE, and
// reports one mechanical fact per site: whether the result is captured at all.
// That much is reliable from a line of source. It does NOT try to decide
// whether the surrounding code then reports success honestly — two earlier
// revisions of this file did try, by walking brace depth to find the enclosing
// handler, and both were wrong in the same direction: the first found ONE
// report in 250 files, the second found five. Neither was a clean bill of
// health; both were an instrument with its eyes shut, which is the failure mode
// this project keeps paying for.
//
// So the classification is done by reading the sites this prints. There are
// enough of them to read (36 on 2026-07-29) and the enumeration is what makes
// that tractable. The standing gate against the pattern is a test —
// tests/success-reports-confirmed.test.js — which checks a narrow shape it can
// judge reliably: a refusable mutation called as a bare statement with a
// success report behind it.
//
// 2026-07-29 result: 36 player-facing call sites, 35 confirmed-then-reported,
// 1 optimistic
// (src/ui/laptop.js cancelling a tee time — result discarded, "spot is open
// again" printed regardless, while src/ui/frontDesk.js called the same function
// and checked it). Fixed, plus three null-tolerant guards of the form
// `res && res.ok === false ? warn : success`, which report SUCCESS for a null
// result — dead branches today, the same defect one step removed.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

const REFUSABLE = {
  repairs: ['restorationAction', 'setArchitectureComponent'],
  cleaning: ['clearClutter'],
  orders: ['submitPurchaseOrders', 'placeOrder', 'cancelOrder'],
  purchases: ['buyRentalSets', 'hireStaff', 'fireStaff', 'trainStaff'],
  upgrades: ['treatSection', 'aerateSection'],
  deliveries: ['cutTape', 'openFlap', 'takeFromBox', 'flattenBox', 'recycleBox', 'storeInBack'],
  pricing: ['setProductMarkup', 'setGreenFee', 'setMembershipDue', 'setRentalPrice'],
  bookings: ['bookSlot', 'cancelReservation', 'markReservationNoShow'],
};
const GROUP = new Map();
for (const [group, names] of Object.entries(REFUSABLE)) {
  for (const n of names) GROUP.set(n, group);
}

// Where a player-facing interaction lives. Sim-internal call sites are not
// reporting anything to anyone and would only pad the count.
const PLAYER_FACING = /^src\/(ui|render3d)\//;

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
}(path.join(ROOT, 'src')));

const sites = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (!PLAYER_FACING.test(rel)) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*|import\b)/.test(line)) continue;
    for (const [name, group] of GROUP) {
      if (!new RegExp(`(^|[^\\w.$])${name}\\s*\\(`).test(line)) continue;
      if (new RegExp(`function\\s+${name}\\b`).test(line)) continue;
      // Captured: assigned, tested, returned, or fed straight into a ternary.
      const captured = new RegExp(`[=(?:]\\s*(?:await\\s+)?${name}\\s*\\(`).test(line)
        || new RegExp(`\\breturn\\s+${name}\\s*\\(`).test(line)
        || /^\s*(const|let|var)\s/.test(line);
      sites.push({
        group,
        mutation: name,
        file: rel,
        line: i + 1,
        resultCaptured: captured,
        code: line.trim().slice(0, 120),
      });
    }
  }
}

const discarded = sites.filter((s) => !s.resultCaptured);
const out = {
  note: 'resultCaptured is mechanical. The confirmed/optimistic verdict is made by reading these sites; see the header.',
  totalSites: sites.length,
  resultCaptured: sites.length - discarded.length,
  resultDiscarded: discarded.length,
  byGroup: Object.fromEntries(Object.entries(REFUSABLE).map(([g]) => [
    g, sites.filter((s) => s.group === g).length,
  ])),
  discarded,
  sites,
};

const dest = path.join(ROOT, 'Designs', 'ProShop', 'Greybox', 'data', 'success-report-audit.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);

console.log(`player-facing call sites of refusable mutations: ${out.totalSites}`);
console.log(`  result captured:  ${out.resultCaptured}`);
console.log(`  result DISCARDED: ${out.resultDiscarded}`);
console.log('\nby group:');
for (const [g, n] of Object.entries(out.byGroup)) console.log(`  ${g.padEnd(12)} ${n}`);
if (discarded.length) {
  console.log('\nRESULT DISCARDED — each of these must be read:');
  for (const s of discarded) console.log(`  ${s.file}:${s.line}  [${s.mutation}]  ${s.code}`);
}
