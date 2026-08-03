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

test('NAV-WAIT-001 is fixed, and its waiver went with it', () => {
  // The other half of the pairing. While the defect was open this test asserted
  // the waiver was PRESENT; now that it is fixed the same test asserts the
  // waiver is GONE, so neither state can drift silently.
  //
  // The ruling that produced the waiver: the browse-stand stack is a missing
  // feature, not a threshold problem. It was closed by building the feature —
  // an occupancy claim and spaced hold points — and measured on the instrument
  // it was filed against: 95 episodes to 0 (neglected), 82 to 1 (restored),
  // with the survivor judged rather than waived.
  assert.equal(statusOf(defects, 'NAV-WAIT-001'), 'FIXED');
  assert.ok(
    !waivedIds(harness).includes('NAV-WAIT-001'),
    'the defect is fixed, so the gate must no longer waive episodes attributed to it — '
    + 'those episodes now face the 20s cap and the recovery floor like every other block',
  );
  // The thresholds were never relaxed to accommodate the defect, and must not
  // be relaxed now that it is gone either.
  assert.match(harness, /const BLOCK_CAP_WALL_S = 20;/);
  assert.match(harness, /const RECOVERY_FLOOR = 0\.75;/);
});

test('nothing is exempt from the churn gate any more', () => {
  // The list is empty and should stay that way. This is not a style rule: an
  // exemption is the one thing that can make a green gate meaningless, so
  // re-adding one should be a deliberate act that turns this test red and
  // forces a filed defect alongside it.
  assert.deepEqual(
    waivedIds(harness), [],
    'a new exemption was added to the churn gate. That is allowed, but it is a debt: '
    + 'file the defect in DEFECTS.md, keep attribution narrow, and update this test '
    + 'so the waiver cannot outlive its cause.',
  );
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
