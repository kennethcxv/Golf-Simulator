import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestJsonPath = path.join(repoRoot, 'qa/assets_01_50_master/asset_manifest.json');
const manifestMarkdownPath = path.join(repoRoot, 'qa/assets_01_50_master/asset_manifest.md');
const iterationResultPath = 'qa/assets_01_50_master/after/sheet03/iteration-8/sheet03-assets-acceptance-result-iteration-8.json';
const cleanReimportJsonPath = 'qa/assets_01_50_master/after/sheet03/clean-reimport-v3/sheet03-product-clean-reimport-v3.json';
const cleanReimportMarkdownPath = 'qa/assets_01_50_master/after/sheet03/clean-reimport-v3/sheet03-product-clean-reimport-v3.md';

const readJson = (relativeOrAbsolutePath) => JSON.parse(fs.readFileSync(path.resolve(repoRoot, relativeOrAbsolutePath), 'utf8'));
const toRepoPath = (filePath) => path.relative(repoRoot, path.resolve(filePath)).replaceAll('\\', '/');
const assertEvidenceExists = (relativePath) => assert.ok(
  fs.existsSync(path.resolve(repoRoot, relativePath)),
  `Missing acceptance evidence: ${relativePath}`,
);

const manifest = readJson(manifestJsonPath);
const iteration8 = readJson(iterationResultPath);
const cleanReimportV3 = readJson(cleanReimportJsonPath);

assert.equal(manifest.authoritativeAssetCount, 50);
assert.equal(manifest.assets.length, 50);
assert.deepEqual(manifest.assets.map(({ assetNumber }) => assetNumber), Array.from({ length: 50 }, (_, index) => index + 1));
assert.equal(iteration8.ok, true);
assert.equal(iteration8.iteration, 'iteration-8');
assert.deepEqual(iteration8.assets.map(({ asset }) => asset), Array.from({ length: 10 }, (_, index) => index + 21));
assert.deepEqual(iteration8.diagnostics.consoleErrors, []);
assert.deepEqual(iteration8.diagnostics.pageErrors, []);
assert.deepEqual(iteration8.diagnostics.nonAbortedFailedRequests, []);
assert.deepEqual(iteration8.diagnostics.badResponses, []);
assert.equal(cleanReimportV3.ok, true);
assert.equal(cleanReimportV3.summary.assetCount, 5);
assert.equal(cleanReimportV3.summary.passedAssets, 5);
assert.equal(cleanReimportV3.summary.failedAssets, 0);
assert.equal(cleanReimportV3.summary.passedChecks, 35);
assert.equal(cleanReimportV3.summary.totalChecks, 35);
assert.equal(cleanReimportV3.summary.failedChecks, 0);

for (const state of ['empty', 'partial', 'full']) {
  assert.deepEqual(iteration8.cameras[state].map(({ asset }) => asset), Array.from({ length: 10 }, (_, index) => index + 21));
}

const { empty, full, delta, budget, baselineComparison } = iteration8.performance;
assert.ok(delta.averageFpsRatio >= budget.averageFpsRatio);
assert.ok(delta.onePercentLowRatio >= budget.onePercentLowRatio);
assert.ok(full.onePercentLowFps >= budget.minimumOnePercentLowFps);
assert.ok(delta.drawCalls <= budget.addedDrawCalls);
assert.ok(delta.renderedTriangles <= budget.addedRenderedTriangles);
assert.ok(delta.materialCount <= budget.addedSceneMaterials);
assert.ok(delta.texturesInMemory <= budget.addedTexturesInMemory);
assert.ok(delta.textureMemoryBytes <= budget.addedTextureMemoryBytes);
assert.ok(delta.eventListeners <= budget.addedEventListeners);
assert.ok(delta.uiUpdatesPerSecond <= budget.addedUiUpdatesPerSecond);
assert.ok(baselineComparison.averageFpsRatio >= budget.baselineAverageFpsRatio);
assert.ok(baselineComparison.onePercentLowRatio >= budget.baselineOnePercentLowRatio);
assert.ok(baselineComparison.drawCallsRatio <= budget.baselineDrawCallsRatio);
assert.ok(baselineComparison.renderedTrianglesRatio <= budget.baselineRenderedTrianglesRatio);
assert.ok(baselineComparison.sceneTrianglesRatio <= budget.baselineSceneTrianglesRatio);
assert.ok(baselineComparison.materialCountRatio <= budget.baselineMaterialsRatio);
assert.ok(baselineComparison.geometriesInMemoryRatio <= budget.baselineGeometriesRatio);
assert.ok(baselineComparison.texturesInMemoryRatio <= budget.baselineTexturesRatio);

const sharedPerformanceFinding = [
  `Iteration-8 full stock measured ${full.averageFps.toFixed(2)} FPS average, ${full.onePercentLowFps.toFixed(2)} FPS 1% low, and ${full.worstFrameMs.toFixed(1)} ms worst frame.`,
  `Against matched empty stock, average FPS retained ${(delta.averageFpsRatio * 100).toFixed(2)}% and 1% low retained ${(delta.onePercentLowRatio * 100).toFixed(2)}%, with +${delta.drawCalls} draws, +${delta.visibleSceneTriangles.toLocaleString('en-US')} visible scene triangles, +${delta.materialCount} materials, +${delta.texturesInMemory} renderer texture, +${(delta.textureMemoryBytes / 1_000_000).toFixed(2)} MB decoded texture estimate, ${delta.eventListeners} listener, and ${delta.uiUpdatesPerSecond} UI updates/s.`,
  'All Sheet-3 acceptance and project-baseline performance gates passed.',
].join(' ');

const accepted = {
  21: {
    initialClassification: 'C',
    initialClassificationRationale: 'The fixture shell was usable, but the initial player-camera state was visibly blocky, underfilled, and limited to an incomplete six-arm apparel presentation; substantial runtime stock presentation work was required.',
    visual: 'Iteration-8 player-camera evidence shows eight authored hanging polos plus four folded polos, with distinct restrained colorways, readable garment construction, believable proportions, and no visible clipping in empty, partial, or full states.',
    technical: 'The fixture retained a flag-free structural audit. The authored hanging-polo companion product independently passed Blender 5.1.2 factory-startup reimport, applied-transform, bounds, hierarchy, collision/detail, and artifact-integrity checks in clean-reimport-v3.',
    integration: 'Normal E interaction restocked the apparel display through empty, partial, and full states. A pending held apparel unit was saved through the pause UI, restored, and returned exactly once after load.',
    reimport: 'Directly covers the checkout_product_hanging_polo companion used by this display; fixture-specific structural evidence remains the manifest audit plus iteration-8 runtime acceptance.',
    additional: [
      'qa/assets_01_50_master/after/sheet03/iteration-8/iteration-8-36-pending-held-unit-saved-through-pause-ui.png',
      'qa/assets_01_50_master/after/sheet03/iteration-8/iteration-8-37-loaded-pending-held-unit-returned-exactly-once.png',
    ],
  },
  22: {
    initialClassification: 'C',
    initialClassificationRationale: 'The authored wall shell existed, but the initial stock read as sparse shelf-rested caps with only a partial twelve-unit presentation rather than the intended full pegged hat wall.',
    visual: 'Iteration-8 shows sixteen authored caps facing the player in four clean rows, with a coherent golf-shop palette, readable brims and crowns, stable spacing, and no overlaps across stock states.',
    technical: 'The fixture retained a flag-free structural audit. The authored cap companion independently passed all clean-reimport-v3 factory-import, transform, hierarchy, collision/detail, bounds, and integrity checks.',
    integration: 'Normal E restocking reached the documented full state. Build-mode pickup, carry, rotation, and set-down moved the fixture without floating stock or collider residue.',
    reimport: 'Directly covers checkout_product_cap used on the hat wall; fixture-specific structural evidence remains the manifest audit plus iteration-8 runtime and build-mode acceptance.',
    additional: [
      'qa/assets_01_50_master/after/sheet03/iteration-8/iteration-8-31-build-mode-hatstand-before-pick.png',
      'qa/assets_01_50_master/after/sheet03/iteration-8/iteration-8-32-build-mode-hatstand-carried-no-floating-stock-or-collider.png',
      'qa/assets_01_50_master/after/sheet03/iteration-8/iteration-8-33-build-mode-hatstand-moved-rotated-set-down.png',
    ],
  },
  23: {
    initialClassification: 'C',
    initialClassificationRationale: 'The fixture shell and sockets existed, but the initial presentation was sparse and the umbrella silhouette was visibly primitive; product variety and authored visual polish needed a substantial pass.',
    visual: 'Iteration-8 shows full accessory runs with readable packages, gloves, socks, towels, and a coherent authored umbrella fan, arranged without visible overlap in empty, partial, and full player-camera captures.',
    technical: 'The accessory-slatwall fixture retained a flag-free structural audit with its authored collision proxy and sockets; iteration-8 completed runtime state and diagnostic validation without console, page, request, or response errors.',
    integration: 'Both accessory fixture runs accepted normal E restocking across the documented empty, partial, and full states and remained stable during the full transaction/recovery route.',
    reimport: 'Clean-reimport-v3 is supporting companion-product evidence only; it does not claim to factory-import the accessory-slatwall fixture. Fixture-specific proof is the flag-free structural audit and iteration-8 runtime acceptance.',
    additional: [],
  },
  24: {
    initialClassification: 'C',
    initialClassificationRationale: 'The rack was structurally usable, but initial stock was underfilled and dark shafts and heads lacked player-camera legibility; rack population and presentation required substantial revision.',
    visual: 'Iteration-8 shows fully populated driver and iron racks with readable heads and shafts, consistent restrained three-step lean, believable spacing, and no visible clipping through all stock states.',
    technical: 'The club-rack fixture retained a flag-free structural audit with authored collision and eighteen sockets; finite stock transforms and the shared shaft material contract are covered by the Sheet-3 contract suite and iteration-8 runtime diagnostics.',
    integration: 'Both driver and iron fixture IDs reached empty, partial, and full states through normal E restocking and remained stable through the acceptance transaction and recovery route.',
    reimport: 'Clean-reimport-v3 is supporting companion-product evidence only and does not claim to factory-import the club-rack fixture; fixture proof comes from structural contracts and iteration-8 runtime acceptance.',
    additional: [],
  },
  25: {
    initialClassification: 'C',
    initialClassificationRationale: 'The rack shell existed, but the initial sparse six-position presentation did not meet the intended dense putter display and the stock lacked sufficient head/shaft readability.',
    visual: 'Iteration-8 shows twenty individually slotted putters with bright readable shafts and distinct heads, consistent lean, even spacing, and no visible clipping in the full player-camera state.',
    technical: 'The putter-rack fixture retained a flag-free structural audit with authored collision and sockets; finite stock transforms and shared material reuse are covered by the Sheet-3 contract suite and clean iteration-8 diagnostics.',
    integration: 'Normal E restocking advanced the putter rack through empty, partial, and full states and kept the populated rack stable during the acceptance transaction and recovery route.',
    reimport: 'Clean-reimport-v3 is supporting companion-product evidence only and does not claim to factory-import the putter-rack fixture; fixture proof comes from structural contracts and iteration-8 runtime acceptance.',
    additional: [],
  },
  26: {
    initialClassification: 'C',
    initialClassificationRationale: 'The platform fixture was usable, but initial bag stock read as crude cylindrical bins with shafts and did not meet the reference-quality silhouette or merchandising bar.',
    visual: 'Iteration-8 shows five authored golf bags with pockets, labels, distinct colorways, and controlled three-club fans across the full platform, with believable silhouettes and no visible intersections.',
    technical: 'The fixture retained a flag-free structural audit. The authored stand-bag companion independently passed all clean-reimport-v3 factory-import, transform, hierarchy, collision/detail, bounds, and integrity checks.',
    integration: 'Normal E restocking advanced the bag display through empty, partial, and full states, with the fully populated platform stable during the acceptance transaction and recovery route.',
    reimport: 'Directly covers checkout_product_stand_bag used by this display; fixture-specific structural evidence remains the manifest audit plus iteration-8 runtime acceptance.',
    additional: [],
  },
  27: {
    initialClassification: 'C',
    initialClassificationRationale: 'The wall shell existed, but initial shoes read as indistinct white blobs and boxed stock lacked a polished retail presentation; substantial product and runtime presentation work was needed.',
    visual: 'Iteration-8 shows six authored shoe pairs plus six boxed retail units across two modules, with readable footwear construction, clean spacing, coordinated colorways, and no visible clipping.',
    technical: 'The fixture retained a flag-free structural audit. The authored shoe-pair companion independently passed all clean-reimport-v3 factory-import, transform, hierarchy, collision/detail, bounds, and integrity checks.',
    integration: 'Normal E restocking reached full state. Build-mode pickup, carry, rotation, and set-down left no floating stock or collider, and an organic shopper retargeted to the moved shoe wall.',
    reimport: 'Directly covers checkout_product_shoe_pair used by this display; fixture-specific structural evidence remains the manifest audit plus iteration-8 runtime and build-mode acceptance.',
    additional: [
      'qa/assets_01_50_master/after/sheet03/iteration-8/iteration-8-31-build-mode-shoerack-before-pick.png',
      'qa/assets_01_50_master/after/sheet03/iteration-8/iteration-8-32-build-mode-shoerack-carried-no-floating-stock-or-collider.png',
      'qa/assets_01_50_master/after/sheet03/iteration-8/iteration-8-33-build-mode-shoerack-moved-rotated-set-down.png',
      'qa/assets_01_50_master/after/sheet03/iteration-8/iteration-8-34-organic-shopper-retargeted-to-moved-shoe-wall.png',
    ],
  },
  28: {
    initialClassification: 'B',
    initialClassificationRationale: 'The ball shelf and carton presentation were already structurally sound and recognizable; acceptance required targeted stock-density, label/material, runtime-state, and performance polish rather than a substantial rebuild.',
    visual: 'Iteration-8 shows forty-five aligned golf-ball cartons in three distinct branded color lanes, with shared carton proportions, readable labels, stable shelf contact, and no visible clipping.',
    technical: 'The ball shelf retained a flag-free structural audit with authored collision and fifteen sockets; the Sheet-3 contract suite confirms a shared carton body/label construction without a six-material-per-box array, and iteration-8 diagnostics are clean.',
    integration: 'Normal E restocking advanced the ball wall through documented empty, partial, and full states, and the full forty-five-carton layout remained stable during transaction and recovery coverage.',
    reimport: 'Clean-reimport-v3 is supporting companion-product evidence only and does not claim to factory-import the ball shelf or cartons; fixture/product proof comes from structural contracts and iteration-8 runtime acceptance.',
    additional: [],
  },
  29: {
    initialClassification: 'B',
    initialClassificationRationale: 'The shelf and snack presentation were already recognizable and close to target; acceptance needed targeted product-variety, drink integration, spacing, state, and performance polish.',
    visual: 'Iteration-8 shows ten snack pouches and fourteen bottles in stable, readable shelf rows, with coordinated product colors, clear category separation, and no visible overlaps.',
    technical: 'The snack shelf retained a flag-free structural audit with authored collision and twenty-eight sockets; iteration-8 exercised full stock with clean console/page/network diagnostics and no runtime mutation churn.',
    integration: 'Normal E restocking advanced the snack and drink shelf through documented empty, partial, and full states and kept the full layout stable during transaction and recovery coverage.',
    reimport: 'Clean-reimport-v3 is supporting companion-product evidence only and does not claim to factory-import the snack shelf or its stock; fixture/product proof comes from structural audit and iteration-8 runtime acceptance.',
    additional: [],
  },
  30: {
    initialClassification: 'C',
    initialClassificationRationale: 'The fixture shell existed, but the initial stock read as anonymous dark boxes instead of legible rangefinders; the product geometry, lens presentation, and shelf composition required substantial revision.',
    visual: 'Iteration-8 shows six authored rangefinders on two shelves with lenses facing the player, readable body/lens separation, stable placement, coherent color treatment, and no visible clipping.',
    technical: 'The fixture retained a flag-free structural audit. The authored rangefinder companion independently passed all clean-reimport-v3 factory-import, transform, hierarchy, collision/detail, bounds, and integrity checks.',
    integration: 'Normal E restocking advanced the rangefinder display through empty, partial, and full states, with all six products stable through the acceptance transaction and recovery route.',
    reimport: 'Directly covers checkout_product_rangefinder used by this display; fixture-specific structural evidence remains the manifest audit plus iteration-8 runtime acceptance.',
    additional: [],
  },
};

const preservedRecords = new Map(
  manifest.assets
    .filter(({ assetNumber }) => assetNumber < 21 || assetNumber > 30)
    .map((record) => [record.assetNumber, JSON.stringify(record)]),
);

const cameraEvidence = (state, assetNumber) => {
  const capture = iteration8.cameras[state].find(({ asset }) => asset === assetNumber);
  assert.ok(capture, `Missing ${state} camera capture for asset ${assetNumber}`);
  return toRepoPath(capture.file);
};

for (const record of manifest.assets.filter(({ assetNumber }) => assetNumber >= 21 && assetNumber <= 30)) {
  const findings = accepted[record.assetNumber];
  assert.ok(findings, `Missing acceptance mapping for asset ${record.assetNumber}`);

  const evidence = {
    iteration8Result: iterationResultPath,
    iteration8EmptyPlayerCamera: cameraEvidence('empty', record.assetNumber),
    iteration8PartialPlayerCamera: cameraEvidence('partial', record.assetNumber),
    iteration8FullPlayerCamera: cameraEvidence('full', record.assetNumber),
    iteration8Additional: findings.additional,
    cleanReimportV3Json: cleanReimportJsonPath,
    cleanReimportV3Markdown: cleanReimportMarkdownPath,
    cleanReimportV3Relevance: findings.reimport,
  };

  for (const evidencePath of [
    evidence.iteration8Result,
    evidence.iteration8EmptyPlayerCamera,
    evidence.iteration8PartialPlayerCamera,
    evidence.iteration8FullPlayerCamera,
    ...evidence.iteration8Additional,
    evidence.cleanReimportV3Json,
    evidence.cleanReimportV3Markdown,
  ]) assertEvidenceExists(evidencePath);

  record.currentVisualQuality = findings.visual;
  record.currentTechnicalQuality = findings.technical;
  record.currentIntegrationStatus = findings.integration;
  record.currentPerformanceRisk = sharedPerformanceFinding;
  record.missingSupportingParts = [];
  record.requiredAction = 'None.';
  record.initialClassification = findings.initialClassification;
  record.finalStatus = 'ACCEPTED_PRODUCTION_READY';
  record.auditFlags = [];
  record.initialClassificationRationale = findings.initialClassificationRationale;
  record.acceptanceEvidence = evidence;
}

manifest.stage = 'SHEET03_AUDITED_ACCEPTED_OTHERS_UNCHANGED';
manifest.generatedAt = iteration8.capturedAt;

for (const record of manifest.assets.filter(({ assetNumber }) => assetNumber < 21 || assetNumber > 30)) {
  assert.equal(JSON.stringify(record), preservedRecords.get(record.assetNumber), `Unexpected mutation outside Sheet 3: asset ${record.assetNumber}`);
}

const mdEscape = (value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const code = (value) => `\`${String(value).replaceAll('`', '\\`')}\``;
const dimensions = ({ currentDimensions }) => Object.entries(currentDimensions ?? {}).map(([axis, value]) => `${axis}=${value}`).join(', ');
const sockets = (record) => `${record.collisionType}; ${(record.placementSockets ?? []).length} sockets`;

function renderMarkdown() {
  const lines = [
    '# Assets 01-50 master manifest',
    '',
    `Generated: ${manifest.generatedAt}`,
    '',
    'Stage: **Sheet 3 audited and accepted; Sheets 1, 2, 4, and 5 unchanged**. Assets 21–30 completed iteration-8 player-camera, normal-control integration, recovery, diagnostic, and performance acceptance. Assets 1–20 and 31–50 retain their pre-existing baseline-discovery records and are not represented as audited or accepted here.',
    '',
    '## Authoritative reference sheets',
    '',
    '| Sheet | Exact path |',
    '|---:|---|',
    ...manifest.referenceSheets.map(({ sheet, path: referencePath }) => `| ${sheet} | ${code(referencePath)} |`),
    '',
    '## Blocking contract gaps found during discovery',
    '',
    ...manifest.knownContractGaps.map((gap) => `- ${gap}`),
    '',
    `Baseline: ${code(manifest.baselineEvidence)}`,
    '',
    '## Sheet 3 acceptance evidence',
    '',
    `- Iteration-8 result: ${code(iterationResultPath)} (${iteration8.ok ? 'PASS' : 'FAIL'}; captured ${iteration8.capturedAt}).`,
    `- Clean reimport v3: ${code(cleanReimportJsonPath)} and ${code(cleanReimportMarkdownPath)} (5/5 companion products and 35/35 checks passed).`,
    `- Diagnostics: 0 console errors, 0 page errors, 0 non-aborted failed requests, and 0 bad responses.`,
    `- Performance: ${sharedPerformanceFinding}`,
    '',
    '## Primary assets',
    '',
    '| # | Sheet | Reference asset | Source | Runtime GLB | Current dimensions (m) | Tris | Verts | Meshes | Mats / tex | Collision / sockets | Technical finding | Initial | Required action | Final |',
    '|---:|---:|---|---|---|---|---:|---:|---:|---:|---|---|---|---|---|',
    ...manifest.assets.map((record) => [
      `| ${record.assetNumber}`,
      record.referenceSheet,
      mdEscape(record.referenceAssetName),
      code(record.currentBlenderSourcePath),
      code(record.currentRuntimeGlbPath),
      mdEscape(dimensions(record)),
      record.currentTriangleCount,
      record.currentVertexCount,
      record.currentMeshCount,
      `${record.currentMaterialCount} / ${record.currentTextureCount}`,
      mdEscape(sockets(record)),
      mdEscape(record.currentTechnicalQuality),
      mdEscape(record.initialClassification),
      mdEscape(record.requiredAction),
      `${mdEscape(record.finalStatus)} |`,
    ].join(' | ')),
    '',
    '## Sheet 3 accepted production records',
    '',
  ];

  for (const record of manifest.assets.filter(recordInSheet3)) {
    const evidence = record.acceptanceEvidence;
    lines.push(
      `### ${record.assetNumber}. ${record.referenceAssetName}`,
      '',
      `- Initial classification: **${record.initialClassification}** — ${record.initialClassificationRationale}`,
      `- Final status: **${record.finalStatus}**`,
      `- Visual finding: ${record.currentVisualQuality}`,
      `- Technical finding: ${record.currentTechnicalQuality}`,
      `- Integration finding: ${record.currentIntegrationStatus}`,
      `- Performance finding: ${record.currentPerformanceRisk}`,
      `- Missing supporting parts: **none**`,
      `- Remaining required action: **none**`,
      `- Iteration-8 result: ${code(evidence.iteration8Result)}`,
      `- Empty player camera: ${code(evidence.iteration8EmptyPlayerCamera)}`,
      `- Partial player camera: ${code(evidence.iteration8PartialPlayerCamera)}`,
      `- Full player camera: ${code(evidence.iteration8FullPlayerCamera)}`,
      ...evidence.iteration8Additional.map((evidencePath) => `- Additional iteration-8 evidence: ${code(evidencePath)}`),
      `- Clean reimport v3 JSON: ${code(evidence.cleanReimportV3Json)}`,
      `- Clean reimport v3 report: ${code(evidence.cleanReimportV3Markdown)}`,
      `- Clean reimport relevance: ${evidence.cleanReimportV3Relevance}`,
      '',
    );
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function recordInSheet3(record) {
  return record.assetNumber >= 21 && record.assetNumber <= 30;
}

fs.writeFileSync(manifestJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(manifestMarkdownPath, renderMarkdown());

console.log(`Accepted Sheet 3 assets 21-30 in ${path.relative(repoRoot, manifestJsonPath)} and regenerated matching Markdown.`);
