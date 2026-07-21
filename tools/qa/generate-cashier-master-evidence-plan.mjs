import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CAPTURE_REQUIREMENTS,
  validateCashierMasterEvidencePlan,
} from './assemble-cashier-master-evidence.mjs';
import {
  CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION,
  CASHIER_REPOSITORY_ROOT,
  cashierProductionFileManifest,
  captureCashierBuildSnapshot,
} from './cashier-build-snapshot.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const PERFORMANCE_PASS_GATES = Object.freeze([
  'authoritativeMasterPass',
  'authoritativeProductionBuildUnchanged',
  'currentProductionBuildMatches',
  'overlayProductionBuildUnchanged',
]);
const LIFECYCLE_PASS_GATES = Object.freeze([
  'lifecyclePass',
  'everyLifecycleGatePassed',
  'everyCardinalityPassed',
  'diagnosticsClean',
  'captureOverlayPass',
  'artifactsValid',
  'productionBuildUnchanged',
  'currentProductionBuildMatches',
  'everyReferencedFileHashed',
]);

export const FINAL_RESULT_INPUTS = Object.freeze({
  card1600: Object.freeze({ cli: 'card-1600', defaults: ['latest-result.json'], kind: 'acceptance', mode: 'card', viewport: '1600x900' }),
  cash1600: Object.freeze({ cli: 'cash-1600', defaults: ['latest-result.json'], kind: 'acceptance', mode: 'cash', viewport: '1600x900' }),
  recovery: Object.freeze({ cli: 'recovery', defaults: ['latest-result.json'], kind: 'recovery', viewport: '1600x900' }),
  queue: Object.freeze({ cli: 'queue', defaults: ['latest-result.json'], kind: 'queue', viewport: '1600x900' }),
  card1280: Object.freeze({ cli: 'card-1280', defaults: ['latest-result.json'], kind: 'acceptance', mode: 'card', viewport: '1280x720' }),
  cash1280: Object.freeze({ cli: 'cash-1280', defaults: ['latest-result.json'], kind: 'acceptance', mode: 'cash', viewport: '1280x720' }),
  card1920: Object.freeze({ cli: 'card-1920', defaults: ['latest-result.json'], kind: 'acceptance', mode: 'card', viewport: '1920x1080' }),
  cash1920: Object.freeze({ cli: 'cash-1920', defaults: ['latest-result.json'], kind: 'acceptance', mode: 'cash', viewport: '1920x1080' }),
  performance38: Object.freeze({ cli: 'performance-38', defaults: ['38-performance-overlay-provenance.json', 'performance-overlay-provenance.json'], kind: 'performance', viewport: '1600x900' }),
  lifecycle39: Object.freeze({ cli: 'lifecycle-39', defaults: ['capture-39-provenance.json'], kind: 'lifecycle', viewport: '1600x900' }),
  saveReload: Object.freeze({ cli: 'save-reload', defaults: ['latest-result.json'], kind: 'save-reload', viewport: '1600x900' }),
});

const basename = (value) => Object.freeze({ kind: 'basename', value });
const suffix = (value) => Object.freeze({ kind: 'suffix', value });
const jsonPath = (value) => Object.freeze({ kind: 'json-path', value });

// These selectors are the current driver-authored evidence contract. They do
// not guess among arbitrary PNGs. A missing selector is an unfinished evidence
// requirement and causes generation to fail.
export const FINAL_CAPTURE_SOURCES = Object.freeze([
  Object.freeze({ number: 1, source: 'card1600', selector: basename('01-customer-arrival.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 2, source: 'card1600', selector: basename('02-products-ready-at-counter.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 3, source: 'card1600', selector: basename('05-scanner-workspace.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 4, source: 'card1600', selector: basename('06-first-product-scanned.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 5, source: 'card1600', selector: basename('06b-mid-bagging.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 6, source: 'card1600', selector: basename('07-all-products-scanned.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 7, source: 'card1600', selector: basename('08-card-presented.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 8, source: 'card1600', selector: basename('10-card-entry-empty-cashier-pickup-hold.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 9, source: 'card1600', selector: basename('10-card-entry-empty-automatic-insert-motion.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 10, source: 'card1600', selector: basename('10-card-entry-empty.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 11, source: 'card1600', selector: basename('11b-replacement-card-entry-empty-automatic-insert-motion.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 12, source: 'card1600', selector: basename('11b-replacement-card-entry-empty-amount-entered.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 13, source: 'card1600', selector: basename('10b-card-processing-first-attempt.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 14, source: 'card1600', selector: basename('12-card-accepted.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 15, source: 'recovery', selector: suffix('-normal-card-decline-switch-choice.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 16, source: 'card1600', selector: basename('09b-card-cancelled-to-monitor.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 17, source: 'card1600', selector: basename('09a-escape-and-right-click-blocked.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 18, source: 'cash1600', selector: basename('08-cash-presented.png'), dimensions: [1600, 900] }),
  // #19 is the immediate normal-input result; #20 separately requires the
  // authored CashDrawer_Tray to be between 25% and 75% of its full travel.
  Object.freeze({ number: 19, source: 'cash1600', selector: basename('08a-cash-clicked.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 20, source: 'cash1600', selector: basename('08b-cash-clicked-drawer-opening.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 21, source: 'cash1600', selector: basename('09b-cash-drawer-open.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 22, source: 'cash1600', selector: basename('09c-bill-close-up.png') }),
  Object.freeze({ number: 23, source: 'cash1600', selector: basename('09d-coin-close-up.png') }),
  Object.freeze({ number: 24, source: 'cash1600', selector: basename('10b-change-under-by-one-cent.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 25, source: 'cash1600', selector: basename('11-exact-four-twenty-eight-selected.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 26, source: 'cash1600', selector: basename('10d-over-change-at-five-dollar-limit.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 27, source: 'card1600', selector: basename('12b-receipt-printing.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 28, source: 'card1600', selector: basename('13b-bag-handover.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 29, source: 'card1600', selector: basename('15-customer-leaving.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 30, source: 'queue', selector: basename('07b-register-reset-empty.png'), dimensions: [1600, 900], queueContract: 'reset' }),
  Object.freeze({ number: 31, source: 'queue', selector: basename('01-two-customer-queue-first-owner.png'), dimensions: [1600, 900], queueContract: 'two-customers' }),
  Object.freeze({ number: 32, source: 'card1280', selector: basename('10-card-entry-empty-amount-entered.png'), dimensions: [1280, 720] }),
  Object.freeze({ number: 33, source: 'card1600', selector: basename('11-replacement-card-presented.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 34, source: 'card1920', selector: basename('10-card-entry-empty-amount-entered.png'), dimensions: [1920, 1080] }),
  Object.freeze({ number: 35, source: 'cash1280', selector: basename('09b-cash-drawer-open.png'), dimensions: [1280, 720] }),
  Object.freeze({ number: 36, source: 'cash1600', selector: basename('10-received-cash-sorted.png'), dimensions: [1600, 900] }),
  Object.freeze({ number: 37, source: 'cash1920', selector: basename('09b-cash-drawer-open.png'), dimensions: [1920, 1080] }),
  Object.freeze({ number: 38, source: 'performance38', selector: jsonPath('output.path'), dimensions: [1600, 900] }),
  Object.freeze({ number: 39, source: 'lifecycle39', selector: jsonPath('artifacts.lifecycleMetrics.path'), dimensions: [1600, 900] }),
  Object.freeze({ number: 40, source: 'saveReload', selector: jsonPath('scenarios.completedCard.evidence.2'), dimensions: [1600, 900] }),
]);

export class FinalEvidencePlanError extends Error {
  constructor(message, errors) {
    super(message);
    this.name = 'FinalEvidencePlanError';
    this.errors = errors;
  }
}

function posixPath(value) {
  return String(value).replaceAll('\\', '/');
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function addError(errors, id, message, details = null) {
  errors.push({ id, message, ...(details ? { details } : {}) });
}

function getAtPath(value, dottedPath) {
  return String(dottedPath).split('.').reduce((current, key) => current?.[key], value);
}

function everyNamedGatePassed(gates, names) {
  return !!gates && typeof gates === 'object' && !Array.isArray(gates)
    && names.every((name) => gates[name] === true)
    && Object.values(gates).every((value) => value === true);
}

function normalizedHashMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([file, hash]) => [posixPath(file).replace(/^\.\//, ''), String(hash || '').toLowerCase()])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function viewportTag(result, kind) {
  if (kind === 'performance') return result?.overlayModel?.viewport || null;
  if (kind === 'lifecycle') return result?.protocol?.viewport || null;
  if (typeof result?.viewport === 'string') return result.viewport;
  const viewport = result?.viewport;
  return Number.isFinite(viewport?.width) && Number.isFinite(viewport?.height)
    ? `${viewport.width}x${viewport.height}` : null;
}

function resolveInputResult(workspaceRoot, input, definition, errors, role) {
  if (typeof input !== 'string' || !input.trim()) {
    addError(errors, `source.${role}.required`, `--${definition.cli} is required.`);
    return null;
  }
  const requested = path.resolve(workspaceRoot, input);
  if (!insideRoot(workspaceRoot, requested)) {
    addError(errors, `source.${role}.workspace`, `${role} must stay inside the workspace.`);
    return null;
  }
  if (!fs.existsSync(requested)) {
    addError(errors, `source.${role}.exists`, `${role} does not exist.`, { path: requested });
    return null;
  }
  if (!insideRoot(workspaceRoot, fs.realpathSync(requested))) {
    addError(errors, `source.${role}.realpath`, `${role} resolves outside the workspace.`);
    return null;
  }
  let resultPath = requested;
  if (fs.statSync(requested).isDirectory()) {
    const candidates = definition.defaults
      .map((name) => path.join(requested, name))
      .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());
    if (candidates.length !== 1) {
      addError(errors, `source.${role}.${candidates.length ? 'ambiguous' : 'resultMissing'}`,
        candidates.length
          ? `${role} directory contains multiple recognized results; pass the exact result path.`
          : `${role} directory does not contain ${definition.defaults.join(' or ')}.`,
        { path: requested, candidates });
      return null;
    }
    [resultPath] = candidates;
  }
  if (!fs.statSync(resultPath).isFile()) {
    addError(errors, `source.${role}.file`, `${role} result must be a regular file.`);
    return null;
  }
  if (!insideRoot(workspaceRoot, fs.realpathSync(resultPath))) {
    addError(errors, `source.${role}.realpath`, `${role} result resolves outside the workspace.`);
    return null;
  }
  let result;
  try {
    result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch (error) {
    addError(errors, `source.${role}.json`, `${role} result is not valid JSON: ${error.message}`);
    return null;
  }
  return { role, definition, resultPath, stat: fs.statSync(resultPath), result };
}

function validatePass(record, errors) {
  const { role, definition, result } = record;
  const fail = (message) => addError(errors, `source.${role}.pass`, message);
  if (result?.blocker || result?.provenanceBlockers?.length) {
    fail(`${role} contains a blocker or provenance blocker.`);
    return;
  }
  if (definition.kind === 'performance') {
    if (result?.overlayModel?.verdict !== 'PASS'
        || result.overlayModel.profile !== 'master'
        || !everyNamedGatePassed(result.gates, PERFORMANCE_PASS_GATES)) {
      fail('Capture #38 must be a master PASS with every provenance gate true.');
    }
  } else if (definition.kind === 'lifecycle') {
    if (result?.ok !== true || result?.verdict !== 'PASS' || result?.captureNumber !== 39
        || result?.protocol?.profile !== 'master'
        || !everyNamedGatePassed(result.gates, LIFECYCLE_PASS_GATES)) {
      fail('Capture #39 must be the master PASS sidecar with every provenance gate true.');
    }
  } else {
    if (result?.ok !== true || result?.gates?.productionBuildUnchanged !== true
        || result?.gates?.everyEvidencePngReferenced !== true) {
      fail(`${role} must be an explicit PASS with build and PNG provenance gates true.`);
    }
    if (definition.kind === 'acceptance' && result?.mode !== definition.mode) {
      fail(`${role} must be the ${definition.mode} acceptance result.`);
    }
    if (definition.kind === 'save-reload'
        && (result?.scenarios?.completedCard?.ok !== true
          || !Array.isArray(result.scenarios.completedCard.evidence)
          || result.scenarios.completedCard.evidence.length < 3)) {
      fail('Save/reload must include the completed-card banked and two-reload proof.');
    }
  }
  const actualViewport = viewportTag(result, definition.kind);
  if (actualViewport !== definition.viewport) {
    addError(errors, `source.${role}.viewport`,
      `${role} viewport must be ${definition.viewport}; got ${actualViewport || 'missing'}.`);
  }
}

function validateProductionEnvelope(record, current, expectedPaths, notBeforeMs, errors) {
  const { role, result, resultPath, stat } = record;
  const hashes = normalizedHashMap(result?.productionBuildHashes);
  const actualPaths = Object.keys(hashes);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    addError(errors, `source.${role}.productionMap`,
      `${role} does not contain the exact full cashier production hash map.`,
      { expectedCount: expectedPaths.length, actualCount: actualPaths.length });
  }
  for (const file of expectedPaths) {
    if (!SHA256_PATTERN.test(hashes[file] || '')
        || hashes[file] !== current.productionBuildHashes[file]) {
      addError(errors, `source.${role}.productionHash`,
        `${role} is stale or disagrees with current production at ${file}.`,
        { file, expected: current.productionBuildHashes[file], actual: hashes[file] || null });
      break;
    }
  }
  const snapshot = result?.productionBuildSnapshot;
  if (!snapshot || snapshot.schemaVersion !== CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION
      || snapshot.algorithm !== 'sha256' || snapshot.unchanged !== true
      || !Array.isArray(snapshot.changedFiles) || snapshot.changedFiles.length !== 0
      || snapshot.beforeAggregateHash !== current.aggregateHash
      || snapshot.afterAggregateHash !== current.aggregateHash
      || snapshot.beforeFileCount !== expectedPaths.length
      || snapshot.afterFileCount !== expectedPaths.length
      || (snapshot.currentAggregateHash != null
        && snapshot.currentAggregateHash !== current.aggregateHash)
      || (snapshot.currentFileCount != null
        && snapshot.currentFileCount !== expectedPaths.length)
      || (snapshot.currentUnchanged != null && snapshot.currentUnchanged !== true)
      || (snapshot.currentMatchesAuthoritative != null
        && snapshot.currentMatchesAuthoritative !== true)) {
    addError(errors, `source.${role}.productionSnapshot`,
      `${role} must contain one complete unchanged snapshot-v${CASHIER_BUILD_SNAPSHOT_SCHEMA_VERSION} envelope matching the current full map.`);
  }
  const timestampEntries = Object.entries(snapshot || {}).filter(([key]) => (
    /CapturedAt$|VerifiedAt$/.test(key)
  ));
  if (timestampEntries.length < 2) {
    addError(errors, `source.${role}.timestamps`, `${role} lacks before/after build timestamps.`);
  }
  for (const [field, value] of timestampEntries) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp < notBeforeMs) {
      addError(errors, `source.${role}.stale`,
        `${role}.${field} predates the explicit final-evidence cutoff.`, { value });
    }
  }
  if (stat.mtimeMs < notBeforeMs) {
    addError(errors, `source.${role}.staleFile`, `${role} result file predates the cutoff.`,
      { path: resultPath });
  }
  record.productionBuildHashes = hashes;
}

function collectStrings(value) {
  const output = [];
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === 'string') output.push(current);
    else if (Array.isArray(current)) pending.push(...current);
    else if (current && typeof current === 'object') pending.push(...Object.values(current));
  }
  return output;
}

function resolveReferencedFile(reference, resultPath, workspaceRoot) {
  if (typeof reference !== 'string' || !reference.toLowerCase().endsWith('.png')) return [];
  const candidates = path.isAbsolute(reference)
    ? [path.resolve(reference)]
    : [path.resolve(path.dirname(resultPath), reference), path.resolve(workspaceRoot, reference)];
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))].filter((candidate) => {
    if (!insideRoot(workspaceRoot, candidate) || !fs.existsSync(candidate)) return false;
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    try {
      return insideRoot(workspaceRoot, fs.realpathSync(candidate));
    } catch {
      return false;
    }
  });
}

function referencedPngs(record, workspaceRoot) {
  const files = collectStrings(record.result)
    .flatMap((value) => resolveReferencedFile(value, record.resultPath, workspaceRoot));
  return [...new Map(files.map((file) => [pathKey(file), file])).values()];
}

function selectEvidence(record, selector, workspaceRoot, errors, captureNumber) {
  const referenced = referencedPngs(record, workspaceRoot);
  let matches = [];
  if (selector.kind === 'json-path') {
    matches = resolveReferencedFile(
      getAtPath(record.result, selector.value), record.resultPath, workspaceRoot,
    );
  } else if (selector.kind === 'basename') {
    matches = referenced.filter((file) => path.basename(file) === selector.value);
  } else if (selector.kind === 'suffix') {
    matches = referenced.filter((file) => posixPath(file).endsWith(selector.value));
  }
  matches = [...new Map(matches.map((file) => [pathKey(file), file])).values()];
  if (matches.length !== 1) {
    addError(errors, `capture.${captureNumber}.evidence`,
      matches.length
        ? `Capture #${captureNumber} selector is ambiguous; the result must reference exactly one matching PNG.`
        : `Capture #${captureNumber} cannot be supplied by the current ${record.role} output name contract.`,
      { selector, matches });
    return null;
  }
  return matches[0];
}

function pngDimensions(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
      || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function validateQueueContract(record, file, contract, errors, captureNumber) {
  if (!contract) return;
  const checkpoint = (record.result?.checkpoints || []).find((entry) => (
    path.basename(entry?.screenshot || '') === path.basename(file)
  ));
  const state = checkpoint?.state;
  if (contract === 'reset') {
    if (!checkpoint || state?.active !== true || state?.workspace !== 'monitor'
        || state?.held !== 0 || state?.tx != null || state?.owner != null
        || !Array.isArray(state?.txHolders) || state.txHolders.length !== 0
        || !Array.isArray(state?.queue) || state.queue.length !== 0
        || state?.first != null || state?.second != null) {
      addError(errors, `capture.${captureNumber}.resetContract`,
        'Register reset must use the active empty-monitor checkpoint with no held stock, transaction, owner, queue, transaction holder, or seeded customer.');
    }
  } else if (contract === 'two-customers') {
    // This capture is deliberately taken before the cashier presses E. It proves
    // two customers are visibly queued while the first exclusively owns the
    // waiting transaction; active register mode begins in the following step.
    if (!checkpoint || state?.active !== false || state?.tx == null
        || state.tx.checkoutFlowState !== 'WaitingForCashier'
        || state?.queue?.length !== 2 || state?.owner?.role !== 'first'
        || state?.txHolders?.length !== 1 || state.txHolders[0]?.role !== 'first'
        || JSON.stringify(state?.queueRoles) !== JSON.stringify(['first', 'second'])) {
      addError(errors, `capture.${captureNumber}.queueContract`,
        'Multiple-customer queue must show two queued customers and one exclusive first owner before cashier entry.');
    }
  }
}

export function validateFinalCashierEvidenceInputs(inputs, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || CASHIER_REPOSITORY_ROOT);
  const errors = [];
  const notBeforeMs = Date.parse(options.notBefore);
  if (typeof options.notBefore !== 'string'
      || !ISO_TIMESTAMP_PATTERN.test(options.notBefore)
      || !Number.isFinite(notBeforeMs)) {
    addError(errors, 'freshness.notBefore', 'notBefore must be an explicit ISO timestamp.');
  }
  const productionFiles = options.productionFiles
    ? [...new Set(options.productionFiles.map(posixPath))].sort()
    : cashierProductionFileManifest({ repositoryRoot: workspaceRoot });
  const current = captureCashierBuildSnapshot({
    repositoryRoot: workspaceRoot,
    files: productionFiles,
  });
  // normalizedHashMap uses localeCompare so Windows paths with mixed-case asset
  // names have one deterministic order. Comparing against current.files' native
  // sort order rejected equal 489-entry maps even though every path/hash matched.
  const expectedPaths = Object.keys(normalizedHashMap(current.productionBuildHashes));
  const records = {};
  for (const [role, definition] of Object.entries(FINAL_RESULT_INPUTS)) {
    const record = resolveInputResult(workspaceRoot, inputs?.[role], definition, errors, role);
    if (!record) continue;
    records[role] = record;
    validatePass(record, errors);
    validateProductionEnvelope(record, current, expectedPaths, notBeforeMs, errors);
  }
  const duplicateResultPaths = Object.values(records).reduce((groups, record) => {
    const key = pathKey(record.resultPath);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record.role);
    return groups;
  }, new Map());
  for (const roles of duplicateResultPaths.values()) {
    if (roles.length > 1) addError(errors, 'sources.results.unique',
      'Every explicit source result must be a distinct file.', { roles });
  }

  const captures = [];
  for (const mapping of FINAL_CAPTURE_SOURCES) {
    const requirement = CAPTURE_REQUIREMENTS[mapping.number - 1];
    const record = records[mapping.source];
    if (!record) continue;
    const file = selectEvidence(record, mapping.selector, workspaceRoot, errors, mapping.number);
    if (!file) continue;
    const dimensions = pngDimensions(file);
    if (!dimensions) {
      addError(errors, `capture.${mapping.number}.png`,
        `Capture #${mapping.number} is not a readable PNG IHDR.`);
    } else if (mapping.dimensions
        && (dimensions.width !== mapping.dimensions[0]
          || dimensions.height !== mapping.dimensions[1])) {
      addError(errors, `capture.${mapping.number}.dimensions`,
        `Capture #${mapping.number} must be ${mapping.dimensions.join('x')}; got ${dimensions.width}x${dimensions.height}.`);
    }
    const stat = fs.statSync(file);
    if (Number.isFinite(notBeforeMs) && stat.mtimeMs < notBeforeMs) {
      addError(errors, `capture.${mapping.number}.stale`,
        `Capture #${mapping.number} predates the explicit final-evidence cutoff.`, { path: file });
    }
    if (stat.mtimeMs > record.stat.mtimeMs + 1000) {
      addError(errors, `capture.${mapping.number}.resultOrder`,
        `Capture #${mapping.number} is newer than its purported source result.`);
    }
    validateQueueContract(record, file, mapping.queueContract, errors, mapping.number);
    captures.push({
      number: requirement.number,
      name: requirement.name,
      source: posixPath(path.relative(workspaceRoot, file)),
      sourceResult: posixPath(path.relative(workspaceRoot, record.resultPath)),
      productionBuildHashesPath: 'productionBuildHashes',
      sourceRole: mapping.source,
      evidenceSelector: mapping.selector,
    });
  }
  const plan = {
    schemaVersion: 1,
    generatedBy: 'tools/qa/generate-cashier-master-evidence-plan.mjs',
    finalEvidenceNotBefore: Number.isFinite(notBeforeMs)
      ? new Date(notBeforeMs).toISOString() : String(options.notBefore || ''),
    requiredProductionBuildHashes: { ...current.productionBuildHashes },
    captures,
  };
  if (captures.length === CAPTURE_REQUIREMENTS.length && errors.length === 0) {
    const assemblerValidation = validateCashierMasterEvidencePlan(plan, { workspaceRoot });
    for (const error of assemblerValidation.errors) {
      addError(errors, `assembler.${error.id}`, error.message, error.details || null);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    plan,
    sourceResults: Object.fromEntries(Object.entries(records).map(([role, record]) => [
      role, posixPath(path.relative(workspaceRoot, record.resultPath)),
    ])),
    currentProductionBuildSnapshot: current,
  };
}

export function generateFinalCashierEvidencePlan(inputs, options = {}) {
  const validation = validateFinalCashierEvidenceInputs(inputs, options);
  if (!validation.ok) {
    throw new FinalEvidencePlanError(
      `Final exact-40 plan generation failed ${validation.errors.length} check(s).`,
      validation.errors,
    );
  }
  return validation.plan;
}

export function writeFinalCashierEvidencePlan(inputs, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || CASHIER_REPOSITORY_ROOT);
  if (!options.outputPath) throw new FinalEvidencePlanError('outputPath is required.', [{
    id: 'output.required', message: 'outputPath is required.',
  }]);
  const outputPath = path.resolve(workspaceRoot, options.outputPath);
  if (!insideRoot(workspaceRoot, outputPath)) throw new FinalEvidencePlanError(
    'Output must stay inside the workspace.', [{
      id: 'output.workspace', message: 'Output must stay inside the workspace.',
    }],
  );
  if (fs.existsSync(outputPath)) throw new FinalEvidencePlanError(
    `Refusing to overwrite existing plan: ${outputPath}`, [{
      id: 'output.exists', message: 'Choose a fresh explicit plan path.',
    }],
  );
  const plan = generateFinalCashierEvidencePlan(inputs, options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporary, outputPath);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw error;
  }
  return { outputPath, plan };
}

function parseCli(argv) {
  const values = {};
  const allowed = new Set([
    ...Object.values(FINAL_RESULT_INPUTS).map((definition) => definition.cli),
    'not-before',
    'output',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unknown argument: ${token}`);
    const key = token.slice(2);
    if (!allowed.has(key)) throw new Error(`Unknown argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a value.`);
    if (values[key] != null) throw new Error(`${token} was provided more than once.`);
    values[key] = value;
    index += 1;
  }
  const inputs = Object.fromEntries(Object.entries(FINAL_RESULT_INPUTS).map(([role, definition]) => (
    [role, values[definition.cli]]
  )));
  return { inputs, notBefore: values['not-before'], outputPath: values.output };
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  if (!cli.notBefore || !cli.outputPath) {
    throw new Error('Pass all explicit source roots/results plus --not-before ISO and --output plan.json.');
  }
  const written = writeFinalCashierEvidencePlan(cli.inputs, {
    notBefore: cli.notBefore,
    outputPath: cli.outputPath,
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    outputPath: written.outputPath,
    captures: written.plan.captures.length,
    productionFiles: Object.keys(written.plan.requiredProductionBuildHashes).length,
  }, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    if (error instanceof FinalEvidencePlanError) {
      process.stderr.write(`${JSON.stringify({ ok: false, errors: error.errors }, null, 2)}\n`);
    } else {
      process.stderr.write(`${error?.stack || error}\n`);
    }
    process.exitCode = 1;
  });
}
