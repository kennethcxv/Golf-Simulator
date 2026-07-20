import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'qa', 'integration-seven');
const base = 'main';
const originalMain = '0c5137e5f0efac9627ce2309b9e66936f1eeb769';

const branchNotes = [
  {
    branch: 'overnight/furniture-customization',
    scope: 'Unified floor, wall, counter, and shelf placement; move/store/sell; collision and persistence.',
    saveSchemaChanges: ['src/sim/layout.js — canonical persisted transforms, storage/sale state, and legacy layout normalization'],
    sharedSystemChanges: ['src/main.js', 'src/render3d/clubhouse.js', 'src/render3d/clubhouse/buildMode.js', 'src/styles.css'],
    potentialOverlap: ['inventory physical objects', 'customer navigation', 'UX input ownership', 'shared clubhouse rendering'],
    risk: 'high',
    claimedCompletionState: 'Branch report/evidence claims production acceptance.',
    actualCompletionEvidence: 'Fresh 26/26 normal-control placement route, save/reload, customer navigation, laptop access, 534/534 tests, syntax and hardware performance passed. Retail card evidence did not perform the required physical swipe.',
  },
  {
    branch: 'overnight/inventory-delivery-loop',
    scope: 'Conserved ordered/in-transit/boxed/reserve/shelf/customer-held/sold/disposed inventory lifecycle and physical receiving workspace.',
    saveSchemaChanges: ['src/sim/state.js', 'src/sim/inventoryLifecycle.js', 'src/sim/deliveries.js — stable shipment/box IDs and staged quantity normalization'],
    sharedSystemChanges: ['src/main.js', 'src/sim/checkout.js', 'src/sim/shop.js', 'src/ui/laptop.js', 'src/render3d/clubhouse.js'],
    potentialOverlap: ['placement primitives', 'customer reservations', 'economy order ledger', 'checkout exact-once sale completion'],
    risk: 'high',
    claimedCompletionState: 'Branch acceptance evidence claims complete conserved delivery loop.',
    actualCompletionEvidence: 'Fresh normal-control delivery/unbox/carry/stock/recycle route and save/reload passed; 1,000-unit reconciliation and 533/533 tests passed. Reorder browser assertion was stale because it compared total cash against concurrent clock expenses; ledger/order debit itself was exact.',
  },
  {
    branch: 'overnight/customer-simulation',
    scope: 'Persistent physical customer lifecycle, arrivals, browsing, reservations, queueing, checkout, lounge use, recovery, and satisfaction.',
    saveSchemaChanges: ['src/sim/customerSimulation.js', 'src/sim/state.js', 'src/sim/reservations.js — persisted lifecycle with safe checkout/queue recovery'],
    sharedSystemChanges: ['src/sim/reservations.js', 'src/sim/reviews.js', 'src/sim/state.js', 'src/render3d/clubhouse.js'],
    potentialOverlap: ['inventory reservation ownership', 'golf reservation events', 'economy reputation outputs', 'course scene resource accounting'],
    risk: 'high',
    claimedCompletionState: 'Branch final report claims production acceptance.',
    actualCompletionEvidence: 'Fresh lifecycle, abandonment/restock, reservation timing, save-during-scan and repeated reload passed; 534/534 tests passed. Branch diff has one trailing-whitespace defect, and its forced-software-renderer performance evidence is not usable for acceptance.',
  },
  {
    branch: 'overnight/course-maintenance',
    scope: 'Hero-hole turf state, inspection, mowing, irrigation, fertilization, repairs, bunker raking, treatment, scoring, tools, and visuals.',
    saveSchemaChanges: ['src/sim/courseMaintenance.js', 'src/sim/state.js — normalized turf grid, masks, work order, disease, and maintenance score'],
    sharedSystemChanges: ['src/main.js', 'src/render3d/courseScene.js', 'src/styles.css', 'ASSET_SOURCES.md'],
    potentialOverlap: ['course render lifecycle', 'UX tool/input ownership', 'economy condition/valuation', 'shared asset provenance'],
    risk: 'high',
    claimedCompletionState: 'Branch release QA claims route and performance acceptance.',
    actualCompletionEvidence: 'Fresh no-video route passed all 12 assertions and real save/reload; hardware performance and 60 mount cycles passed; 527/527 tests passed. Checked-in QA had a brittle fixed wait/personal Playwright path, video capture was unstable, and one floating dark rectangle is visible near a treatment route.',
  },
  {
    branch: 'overnight/golf-operations',
    scope: 'Deterministic tee sheet, reservations, arrivals, check-in, walk-ins, no-shows/cancellations, payment context, course-access and booking ledger events.',
    saveSchemaChanges: ['src/sim/reservations.js', 'src/sim/state.js', 'src/sim/economy.js — stable booking IDs, lifecycle states, payment and exact-once event markers'],
    sharedSystemChanges: ['src/main.js', 'src/ui/laptop.js', 'src/render3d/clubhouse.js', 'src/render3d/clubhouse/registerMode.js', 'src/styles.css'],
    potentialOverlap: ['customer physical lifecycle', 'economy ledger', 'UX focus/pause lifecycle', 'front-desk/retail checkout input'],
    risk: 'high',
    claimedCompletionState: 'Branch documentation claims accepted golf operations day and laptop workflows.',
    actualCompletionEvidence: 'Fresh full operating day passed with prepaid/card/cash, walk-in, exact stable transactions, 538/538 tests, no errors and stable hardware runtime. Full laptop rerun timed out under forced software rendering; receipt contrast is weak and front-desk normal exit left the controller unfocused.',
  },
  {
    branch: 'overnight/economy-progression',
    scope: 'Exact-once ledger, summaries, pricing, reputation, upgrades, condition, explainable valuation, guarded sale flow, and anti-exploit invariants.',
    saveSchemaChanges: ['src/sim/business.js', 'src/sim/state.js', 'src/sim/propertyProgression.js', 'src/sim/reputation.js — normalized ledger/event IDs, summaries, upgrades, appraisal and sale recovery state'],
    sharedSystemChanges: ['src/sim/economy.js', 'src/sim/checkout.js', 'src/sim/reservations.js', 'src/sim/shop.js', 'src/ui/laptop.js', 'src/ui/ui.js'],
    potentialOverlap: ['inventory purchase/sale events', 'golf booking payments', 'customer satisfaction/reputation', 'course/property condition', 'UX notification/UI framework'],
    risk: 'high',
    claimedCompletionState: 'Branch acceptance evidence claims coherent progression and guarded sale flow.',
    actualCompletionEvidence: 'Fresh poor/average/skilled simulations, exact ledger evidence, 17-page browser tour, explicit sale confirmation/recovery, 535/535 tests and 120 FPS hardware sample passed with no console/page errors.',
  },
  {
    branch: 'overnight/player-experience-polish',
    scope: 'Main/pause menus, contextual HUD/prompts, tutorials, notifications, settings/accessibility, tool wheel, audio and lifecycle-safe transitions.',
    saveSchemaChanges: ['src/core/storage.js', 'src/core/preferences.js', 'src/sim/tutorial.js — version-aware slot metadata, preference persistence and tutorial reset/version state'],
    sharedSystemChanges: ['src/main.js', 'src/styles.css', 'src/ui/laptop.js', 'src/ui/ui.js', 'src/render3d/courseScene.js', 'src/render3d/clubhouse/buildMode.js'],
    potentialOverlap: ['all input modes', 'notifications from every system', 'save/load presentation', 'audio/renderer teardown', 'economy laptop pages'],
    risk: 'high',
    claimedCompletionState: 'Branch acceptance evidence claims production UX gates.',
    actualCompletionEvidence: 'Fresh 15-screen normal and accessibility routes, 100 pause/resume and 100 mode transitions, save failure/version recovery, audio lifecycle, 520/520 tests and hardware performance passed. One persistent contextual notification remains by design after cleanup; checked-in prose claiming zero is stale.',
  },
];

const overlapKinds = {
  'ASSET_SOURCES.md': ['Compatible additive change'],
  'src/main.js': ['Shared API conflict', 'State ownership conflict', 'Input conflict', 'Save-schema conflict'],
  'src/render3d/clubhouse.js': ['Shared API conflict', 'State ownership conflict', 'Performance conflict'],
  'src/render3d/clubhouse/buildMode.js': ['Input conflict', 'UI conflict'],
  'src/render3d/clubhouse/registerMode.js': ['Shared API conflict', 'State ownership conflict', 'Input conflict'],
  'src/render3d/courseScene.js': ['Shared API conflict', 'Performance conflict', 'Audio conflict'],
  'src/sim/checkout.js': ['State ownership conflict', 'Shared API conflict', 'Save-schema conflict'],
  'src/sim/economy.js': ['State ownership conflict', 'Shared API conflict', 'Save-schema conflict'],
  'src/sim/reservations.js': ['State ownership conflict', 'Shared API conflict', 'Save-schema conflict'],
  'src/sim/reviews.js': ['State ownership conflict', 'Shared API conflict'],
  'src/sim/shop.js': ['State ownership conflict', 'Shared API conflict', 'Save-schema conflict'],
  'src/sim/state.js': ['Save-schema conflict', 'State ownership conflict'],
  'src/styles.css': ['UI conflict'],
  'src/ui/laptop.js': ['UI conflict', 'Shared API conflict', 'Performance conflict'],
  'src/ui/marketplacePanel.js': ['UI conflict', 'Shared API conflict'],
  'src/ui/ui.js': ['UI conflict', 'Shared API conflict'],
  'tools/qa/register-sale.js': ['Test conflict'],
};

function git(args, { trim = true } = {}) {
  const value = execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  return trim ? value.trim() : value;
}

function lines(value) {
  return value ? value.split(/\r?\n/).filter(Boolean) : [];
}

function worktreePathForBranch(branch) {
  const blocks = git(['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/);
  const expected = `branch refs/heads/${branch}`;
  for (const block of blocks) {
    const fields = lines(block);
    if (!fields.includes(expected)) continue;
    const worktree = fields.find((field) => field.startsWith('worktree '));
    return worktree ? worktree.slice('worktree '.length) : null;
  }
  return null;
}

function changeInventory(branch) {
  return lines(git(['diff', '--name-status', '-z', `${base}..${branch}`], { trim: false }).replace(/\0/g, '\n'));
}

function parseNameStatus(branch) {
  const tokens = git(['diff', '--name-status', '-z', `${base}..${branch}`], { trim: false }).split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (/^[RC]/.test(status)) {
      const from = tokens[index++];
      const file = tokens[index++];
      entries.push({ status, from, file });
    } else {
      entries.push({ status, file: tokens[index++] });
    }
  }
  return entries;
}

function numStats(branch) {
  let insertions = 0;
  let deletions = 0;
  let binaryCount = 0;
  for (const row of lines(git(['diff', '--numstat', `${base}..${branch}`]))) {
    const [added, removed] = row.split('\t');
    if (added === '-' || removed === '-') binaryCount += 1;
    else {
      insertions += Number(added);
      deletions += Number(removed);
    }
  }
  return { insertions, deletions, binaryCount };
}

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

const inventory = branchNotes.map((note) => {
  const head = git(['rev-parse', note.branch]);
  const forkPoint = git(['merge-base', base, note.branch]);
  const [behind, ahead] = git(['rev-list', '--left-right', '--count', `${base}...${note.branch}`]).split(/\s+/).map(Number);
  const changes = parseNameStatus(note.branch);
  const changedFiles = changes.map((entry) => entry.file);
  const addedFiles = changes.filter((entry) => entry.status.startsWith('A')).map((entry) => entry.file);
  const deletedFiles = changes.filter((entry) => entry.status.startsWith('D')).map((entry) => entry.file);
  const binaryAssets = changedFiles.filter((file) => /\.(?:blend|glb|gltf|png|jpe?g|webp|wav|mp3|ogg|webm|mp4|ttf|woff2?)$/i.test(file));
  const packageChanges = changedFiles.filter((file) => /(^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/i.test(file));
  const qaReports = changedFiles.filter((file) => /^qa\//.test(file) && /\.(?:md|json)$/i.test(file));
  const commits = lines(git(['log', '--reverse', '--format=%H%x09%cI%x09%s', `${forkPoint}..${note.branch}`])).map((row) => {
    const [commit, timestamp, ...subject] = row.split('\t');
    return { commit, timestamp, subject: subject.join('\t') };
  });
  return {
    ...note,
    head,
    forkPoint,
    aheadOfMain: ahead,
    behindMain: behind,
    commitCount: commits.length,
    latestCommitTimestamp: git(['show', '-s', '--format=%cI', head]),
    ...numStats(note.branch),
    changedFileCount: changedFiles.length,
    changedFiles,
    newFiles: addedFiles,
    deletedFiles,
    binaryAssets,
    packageChanges,
    qaReports,
    commits,
  };
});

const excluded = {
  branch: 'overnight/gameplay-progression',
  head: '3ddb082f90cdb78325e633ec722fd04a3bf98fdf',
  activeWorktree: worktreePathForBranch('overnight/gameplay-progression'),
  uncommittedState: { dirty: true, trackedPathCount: 3, untrackedPathCount: 1, contentsInspected: false },
  integrationStatus: 'Explicitly excluded; active worktree and branch were not entered, modified, merged, cherry-picked, reset, rebased, cleaned, or pruned.',
};

const inventoryDocument = {
  generatedAt: new Date().toISOString(),
  originalMain,
  auditedMainRef: git(['rev-parse', base]),
  remote: null,
  mainTracking: 'local-only',
  branches: inventory,
  excluded,
};

const touched = new Map();
for (const item of inventory) {
  for (const file of item.changedFiles) {
    if (!touched.has(file)) touched.set(file, []);
    touched.get(file).push(item.branch);
  }
}

const overlaps = [...touched.entries()]
  .filter(([, branches]) => branches.length > 1)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, branches]) => {
    const hashes = branches.map((branch) => sha(git(['diff', '--binary', `${base}..${branch}`, '--', file], { trim: false })));
    const identical = new Set(hashes).size === 1;
    return {
      file,
      branches,
      classification: identical ? ['Identical change'] : (overlapKinds[file] || [/^qa\//.test(file) ? 'Generated-artifact conflict' : /^tests\//.test(file) || /^tools\/qa\//.test(file) ? 'Test conflict' : 'Shared API conflict']),
      resolutionStatus: 'Pending integration review',
    };
  });

const overlapDocument = {
  generatedAt: new Date().toISOString(),
  base: git(['rev-parse', base]),
  branchCount: inventory.length,
  overlappingFileCount: overlaps.length,
  overlaps,
};

const md = [];
md.push('# Seven-branch inventory', '');
md.push(`Audited main: \`${inventoryDocument.auditedMainRef}\` (original main \`${originalMain}\`; local-only, no remote).`, '');
md.push('| Branch | Head | Fork | Ahead / behind | Commits | Files | + / - | Binary | Risk |', '|---|---|---|---:|---:|---:|---:|---:|---|');
for (const item of inventory) {
  md.push(`| \`${item.branch}\` | \`${item.head.slice(0, 12)}\` | \`${item.forkPoint.slice(0, 12)}\` | ${item.aheadOfMain} / ${item.behindMain} | ${item.commitCount} | ${item.changedFileCount} | +${item.insertions} / -${item.deletions} | ${item.binaryAssets.length} | ${item.risk} |`);
}
md.push('', 'The companion JSON contains every changed/new/deleted file, every binary asset, commit metadata, QA-report path, and package/save/shared-system classification.', '');
for (const item of inventory) {
  md.push(`## ${item.branch}`, '', `- Scope: ${item.scope}`, `- Latest commit: \`${item.head}\` at ${item.latestCommitTimestamp}`, `- New/deleted files: ${item.newFiles.length} / ${item.deletedFiles.length}`, `- Package or lockfile changes: ${item.packageChanges.length ? item.packageChanges.map((file) => `\`${file}\``).join(', ') : 'none'}`, `- Save-schema changes: ${item.saveSchemaChanges.join('; ')}`, `- Shared systems: ${item.sharedSystemChanges.map((file) => `\`${file}\``).join(', ')}`, `- Potential overlap: ${item.potentialOverlap.join(', ')}`, `- Claimed state: ${item.claimedCompletionState}`, `- Rerun evidence: ${item.actualCompletionEvidence}`, '');
}
md.push('## Explicitly excluded active branch', '', `- Branch: \`${excluded.branch}\``, `- Head: \`${excluded.head}\``, `- Active worktree: \`${excluded.activeWorktree}\``, `- Uncommitted state: dirty (${excluded.uncommittedState.trackedPathCount} tracked paths and ${excluded.uncommittedState.untrackedPathCount} untracked path); contents were not inspected.`, `- ${excluded.integrationStatus}`, '');

const overlapMd = [];
overlapMd.push('# Seven-branch overlap map', '', `Exactly ${overlaps.length} paths are changed by more than one completed branch. Classifications describe the architectural risk; no conflict is resolved with an unexamined whole-file “ours” or “theirs” choice.`, '', '| File | Branches | Classification |', '|---|---|---|');
for (const item of overlaps) overlapMd.push(`| \`${item.file}\` | ${item.branches.map((branch) => `\`${branch.replace('overnight/', '')}\``).join('<br>')} | ${item.classification.join('; ')} |`);
overlapMd.push('');

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'branch-inventory.json'), `${JSON.stringify(inventoryDocument, null, 2)}\n`);
writeFileSync(path.join(out, 'branch-inventory.md'), `${md.join('\n').trimEnd()}\n`);
writeFileSync(path.join(out, 'overlap-map.json'), `${JSON.stringify(overlapDocument, null, 2)}\n`);
writeFileSync(path.join(out, 'overlap-map.md'), `${overlapMd.join('\n').trimEnd()}\n`);

console.log(JSON.stringify({
  branches: inventory.map(({ branch, head, changedFileCount, insertions, deletions, binaryAssets, packageChanges }) => ({ branch, head, changedFileCount, insertions, deletions, binaryAssets: binaryAssets.length, packageChanges })),
  overlaps: overlaps.length,
  output: out,
}, null, 2));
