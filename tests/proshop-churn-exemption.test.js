// The customer-day gate waives block episodes attributable to an open, named
// defect. That waiver is only honest while the defect is actually open — an
// exemption that outlives its cause is how a gate quietly stops gating.
//
// So this test pins the two documents to each other. DEFECTS.md is the status
// authority; tools/qa/proshop-greybox-customer-day.js is the waiver list. If
// the defect is marked FIXED while the waiver is still there, the suite goes
// red, and the fix commit is forced to delete the waiver in the same change.
// It fails the other way too: a waiver for a defect that was never filed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const defectsPath = join(repo, 'Designs', 'ProShop', 'DEFECTS.md');
const harnessPath = join(repo, 'tools', 'qa', 'proshop-greybox-customer-day.js');
const defects = readFileSync(defectsPath, 'utf8');
const harness = readFileSync(harnessPath, 'utf8');

// Read the ids the harness actually waives out of its DEFECT_EXEMPTIONS block,
// not out of the whole file — an id in a comment is documentation, not a waiver.
function waivedIds(source) {
  const start = source.indexOf('const DEFECT_EXEMPTIONS');
  assert.notEqual(start, -1, 'the harness must declare DEFECT_EXEMPTIONS');
  const end = source.indexOf('const EXEMPT_IDS', start);
  assert.ok(end > start, 'DEFECT_EXEMPTIONS must be followed by EXEMPT_IDS');
  return [...source.slice(start, end).matchAll(/id:\s*'([A-Z]+-[A-Z]+-\d+)'/g)].map((m) => m[1]);
}

// A defect's status line is the first "**Status:**" under its heading.
function statusOf(source, id) {
  const heading = source.indexOf(`## ${id}`);
  if (heading === -1) return null;
  const next = source.indexOf('\n## ', heading + 1);
  const section = source.slice(heading, next === -1 ? source.length : next);
  const match = section.match(/\*\*Status:\*\*\s*([A-Z]+)/);
  return match ? match[1] : null;
}

test('every waived defect id is filed in DEFECTS.md', () => {
  for (const id of waivedIds(harness)) {
    assert.notEqual(
      statusOf(defects, id),
      null,
      `${id} is waived by the customer-day gate but has no entry in DEFECTS.md. `
      + 'A waiver with no filed defect is an unexplained exemption.',
    );
  }
});

test('a waived defect is still OPEN — the exemption expires when it is fixed', () => {
  for (const id of waivedIds(harness)) {
    assert.equal(
      statusOf(defects, id),
      'OPEN',
      `${id} is no longer OPEN in DEFECTS.md, but the customer-day gate still waives `
      + 'episodes attributed to it. Delete the DEFECT_EXEMPTIONS entry in the same commit '
      + 'that closes the defect — the episodes it was covering must now face the 20s cap '
      + 'and the recovery floor.',
    );
  }
});

test('NAV-WAIT-001 is filed, and the churn gate records why it is waived', () => {
  // The ruling that produced this waiver: the browse-stand stack is a missing
  // feature, not a threshold problem. Both halves must survive in the record —
  // the defect entry AND the unchanged thresholds it is an exception to.
  assert.equal(statusOf(defects, 'NAV-WAIT-001'), 'OPEN');
  assert.match(defects, /NAV-WAIT-001 — NPCs have nowhere to wait for an occupied browse stand/);
  assert.ok(
    waivedIds(harness).includes('NAV-WAIT-001'),
    'the gate must carry the waiver while the defect is open, or the ruled exemption is lost',
  );
  // The thresholds themselves were explicitly NOT relaxed by the ruling.
  assert.match(harness, /const BLOCK_CAP_WALL_S = 20;/);
  assert.match(harness, /const RECOVERY_FLOOR = 0\.75;/);
});

test('attribution stays narrow — a waived episode must be a stand wait, not any block', () => {
  // If these conditions ever loosen into "anything near a fixture", the waiver
  // becomes the class-wide exemption the ruling rejected. Pin the shape.
  assert.match(harness, /const STAND_OCCUPIED_YD = 0\.45;/);
  assert.match(harness, /const STAND_APPROACH_YD = 2\.60;/);
  assert.match(harness, /const STAND_OCCUPANCY_MIN = 0\.90;/);
  const attribute = harness.slice(harness.indexOf('const attribute ='), harness.indexOf('const closeEpisode ='));
  assert.match(attribute, /epi\.fixtureId/, 'attribution must require a target stand');
  assert.match(attribute, /standOccupancyMin/, 'attribution must require the stand to be held');
  assert.match(attribute, /standApproachYd/, 'attribution must require the stall to be in the approach');
});

test('the gate judges unattributed episodes and reports the waived ones', () => {
  // A waiver that is not printed is a blind spot. The report must carry the
  // count, the per-defect breakdown, and the exemption list itself.
  assert.match(harness, /const judged = episodes\.filter\(\(e\) => !e\.defect\);/);
  assert.match(harness, /waivedByDefect/);
  assert.match(harness, /exemptions: cfg\.defectExemptions/);
  // The floor's denominator must be the judged set, not every episode —
  // otherwise waived episodes still drag the recovery rate down.
  assert.match(harness, /judged\.length >= cfg\.floorMinEpisodes && recoveryRate < cfg\.recoveryFloor/);
});
