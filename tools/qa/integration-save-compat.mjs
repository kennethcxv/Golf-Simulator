import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const output = path.resolve(root, process.env.QA_SAVE_REPORT
  || 'qa/integration-seven/save-compatibility-matrix.json');

function parseSource(value) {
  const [label, head, ...rootParts] = value.split('|');
  const sourceRoot = rootParts.join('|');
  if (!label || !head || !sourceRoot) {
    throw new Error(`Invalid --source value: ${value}. Expected label|head|worktree.`);
  }
  return { label, head, root: path.resolve(sourceRoot) };
}

const sources = process.argv
  .filter((value) => value.startsWith('--source='))
  .map((value) => parseSource(value.slice('--source='.length)));
if (!sources.length) throw new Error('Pass at least one --source=label|head|worktree argument.');

function git(sourceRoot, ...args) {
  return execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8' }).trim();
}

async function sourceModules(source, index) {
  const query = `?save-source=${encodeURIComponent(source.label)}-${index}`;
  const state = await import(pathToFileURL(path.join(source.root, 'src/sim/state.js')).href + query);
  const empire = await import(pathToFileURL(path.join(source.root, 'src/sim/empire.js')).href + query);
  return { state, empire };
}

const integratedState = await import(pathToFileURL(path.join(root, 'src/sim/state.js')).href);
const integratedEmpire = await import(pathToFileURL(path.join(root, 'src/sim/empire.js')).href);

function summary(empire) {
  const state = integratedEmpire.activeState(empire);
  const lifecycle = state?.shop?.inventoryLifecycle;
  const lots = lifecycle?.lots || lifecycle?.units || [];
  const customers = state?.shop?.customerSimulation || {};
  const maintenance = state?.courseMaintenance;
  return {
    empireVersion: empire.version,
    cash: empire.cash,
    holdingIds: empire.holdings.map((holding) => holding.property.id),
    stateVersion: state?.version,
    stateCash: state?.cash,
    placementIds: Object.keys(state?.shop?.layout?.objects || {}).sort(),
    inventorySchema: lifecycle?.schemaVersion ?? lifecycle?.version ?? null,
    inventoryLotIds: Array.isArray(lots) ? lots.map((lot) => lot.id || lot.uid).filter(Boolean).sort() : [],
    boxIds: (state?.shop?.deliveries?.boxes || []).map((box) => box.id).sort(),
    activeCustomerIds: (customers.active || []).map((customer) => customer.id).sort(),
    scheduledCustomerIds: (customers.scheduled || []).map((customer) => customer.id).sort(),
    reservationIds: (state?.reservations?.booked || []).map((reservation) => reservation.id).sort(),
    financeEntryIds: (state?.reservations?.financeEntries || []).map((entry) => entry.id).sort(),
    ledgerEntryIds: (state?.ledger?.entries || []).map((entry) => entry.id).sort(),
    maintenanceHero: maintenance?.heroHoleId ?? null,
    maintenanceSurfaceHash: maintenance?.surfaceHash ?? null,
    reputationVersion: state?.reputation?.version ?? null,
    businessVersion: state?.business?.version ?? null,
    tutorialStep: state?.tutorial?.step ?? null,
  };
}

async function verifySource(source, index) {
  const actualHead = git(source.root, 'rev-parse', 'HEAD');
  assert.equal(actualHead, source.head, `${source.label} worktree head moved`);
  assert.equal(git(source.root, 'status', '--porcelain=v1'), '', `${source.label} worktree is not clean`);

  const modules = await sourceModules(source, index);
  const sourceEmpire = modules.empire.newEmpire('relaxed', 20260719 + index);
  const target = sourceEmpire.market.find((property) => property.id === 'willow-creek')
    || sourceEmpire.market[0];
  const purchase = modules.empire.buyProperty(sourceEmpire, target.id);
  assert.equal(purchase.ok, true, `${source.label} could not create a representative owned club`);
  const sourceRaw = JSON.parse(modules.empire.serializeEmpire(sourceEmpire));
  const sourceStateVersion = sourceRaw.holdings[0]?.state?.version ?? null;
  sourceRaw.futureIntegrationProbe = { source: source.label, revision: 23 };
  sourceRaw.holdings[0].futureHoldingProbe = { preserve: true };
  sourceRaw.holdings[0].state.futureStateProbe = { preserve: ['unknown', index] };

  const first = integratedEmpire.deserializeEmpire(sourceRaw);
  const firstJson = JSON.parse(integratedEmpire.serializeEmpire(first));
  const second = integratedEmpire.deserializeEmpire(firstJson);
  const secondJson = JSON.parse(integratedEmpire.serializeEmpire(second));

  assert.equal(firstJson.empireVersion, integratedEmpire.EMPIRE_VERSION);
  assert.equal(firstJson.holdings[0].state.version, integratedState.SAVE_VERSION);
  assert.deepEqual(firstJson.futureIntegrationProbe, sourceRaw.futureIntegrationProbe);
  assert.deepEqual(firstJson.holdings[0].futureHoldingProbe, sourceRaw.holdings[0].futureHoldingProbe);
  assert.deepEqual(firstJson.holdings[0].state.futureStateProbe, sourceRaw.holdings[0].state.futureStateProbe);
  assert.deepEqual(secondJson.futureIntegrationProbe, sourceRaw.futureIntegrationProbe);
  assert.deepEqual(secondJson.holdings[0].futureHoldingProbe, sourceRaw.holdings[0].futureHoldingProbe);
  assert.deepEqual(secondJson.holdings[0].state.futureStateProbe, sourceRaw.holdings[0].state.futureStateProbe);
  assert.deepEqual(summary(second), summary(first), `${source.label} duplicated or dropped canonical identities on reload`);
  assert.equal(integratedEmpire.activeState(first).cash, purchase.state.cash);
  assert.ok(integratedEmpire.activeState(first).shop?.layout, 'placement state is present');
  assert.ok(integratedEmpire.activeState(first).shop?.inventoryLifecycle, 'inventory lifecycle is present');
  assert.ok(integratedEmpire.activeState(first).shop?.customerSimulation, 'customer lifecycle is present');
  assert.ok(integratedEmpire.activeState(first).reservations, 'golf operations are present');
  assert.ok(integratedEmpire.activeState(first).courseMaintenance, 'course maintenance is present');
  assert.ok(integratedEmpire.activeState(first).ledger, 'canonical ledger is present');
  assert.ok(integratedEmpire.activeState(first).business, 'business progression is present');
  assert.ok(integratedEmpire.activeState(first).reputation, 'reputation is present');
  assert.ok(integratedEmpire.activeState(first).tutorial, 'tutorial state is present');

  return {
    label: source.label,
    head: source.head,
    sourceStateVersion,
    integratedStateVersion: firstJson.holdings[0].state.version,
    integratedEmpireVersion: firstJson.empireVersion,
    sourceBytes: Buffer.byteLength(JSON.stringify(sourceRaw)),
    integratedBytes: Buffer.byteLength(JSON.stringify(firstJson)),
    repeatedReloadStable: true,
    unknownRootHoldingAndStateDataPreserved: true,
    canonicalDomainsPresent: true,
    summary: summary(first),
    passed: true,
  };
}

const results = [];
for (let index = 0; index < sources.length; index += 1) {
  try {
    results.push(await verifySource(sources[index], index));
  } catch (error) {
    results.push({
      label: sources[index].label,
      head: sources[index].head,
      passed: false,
      error: error.stack || error.message,
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  integratedHead: git(root, 'rev-parse', 'HEAD'),
  integratedStateVersion: integratedState.SAVE_VERSION,
  integratedEmpireVersion: integratedEmpire.EMPIRE_VERSION,
  sourceCount: sources.length,
  sources: results,
  passed: results.every((result) => result.passed),
  notes: [
    'Each payload was serialized by the exact committed source worktree named in the row.',
    'The integrated loader then performed two full empire save/load cycles.',
    'Opaque future fields were injected at empire, holding, and state scope and had to survive both cycles.',
    'The report intentionally omits machine-specific worktree paths.',
  ],
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
