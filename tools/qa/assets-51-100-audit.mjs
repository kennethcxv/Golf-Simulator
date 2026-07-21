// Phase-1 manifest and structural audit generator for authoritative Assets 51-100.
//
// Run from the repository root:
//   node tools/qa/assets-51-100-audit.mjs
//
// Reusable assets discovered in the repository are inputs only. This generator
// deliberately keeps planned production files and final acceptance separate.

import {
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  ASSETS,
  FIRST_PERSON_REFERENCES,
  SHEETS,
} from './assets-51-100-spec.mjs';
import {
  auditGlbFile,
  dimensionsText,
  mdCell,
  round,
} from './glb-structure-audit.mjs';

const ROOT = process.cwd();
const OUTPUT_DIRECTORY = path.join(ROOT, 'qa', 'assets_51_100_master');
const GENERATOR_PATH = 'tools/qa/assets-51-100-audit.mjs';
const HAS_PLANNED_PRODUCTION_ARTIFACT = ASSETS.some((asset) => (
  Object.values(asset.plannedPaths).some((repoPath) => existsSync(path.resolve(ROOT, repoPath)))
));
const AUDIT_STAGE = HAS_PLANNED_PRODUCTION_ARTIFACT
  ? 'PRODUCTION_IN_PROGRESS'
  : 'PHASE_1_DISCOVERY';
const NON_FINAL_STATUS = `${AUDIT_STAGE}_NON_FINAL`;
const FINAL_STATUS = 'NOT_ACCEPTED';

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

function repoExists(repoPath) {
  return !!repoPath && existsSync(path.resolve(ROOT, repoPath));
}

function pathRecord(kind, repoPath, provenance) {
  const exists = repoExists(repoPath);
  return {
    kind,
    path: repoPath || null,
    provenance,
    exists,
    fileSizeBytes: exists && statSync(path.resolve(ROOT, repoPath)).isFile()
      ? statSync(path.resolve(ROOT, repoPath)).size
      : null,
  };
}

function currentCandidateArtifacts(spec) {
  return Object.entries(spec.currentCandidates)
    .flatMap(([kind, paths]) => paths.map((repoPath) => pathRecord(kind, repoPath, 'current-reuse-candidate')));
}

function plannedArtifacts(spec) {
  return Object.entries(spec.plannedPaths)
    .map(([kind, repoPath]) => pathRecord(kind, repoPath, 'planned-production'));
}

function withAuditPolicy(spec, result, provenance, representation, role) {
  const budget = representation === 'first-person' && spec.firstPersonBudget
    ? spec.firstPersonBudget
    : spec;
  const budgetViolations = [...(result.budgetViolations || [])];
  if (result.exists && Number.isFinite(budget.maxFileBytes)
    && result.fileSizeBytes > budget.maxFileBytes) {
    budgetViolations.push({
      metric: 'fileSizeBytes',
      actual: result.fileSizeBytes,
      budget: budget.maxFileBytes,
    });
  }

  const flags = [...(result.flags || [])];
  if (budgetViolations.length && !flags.includes('BUDGET_VIOLATION')) {
    flags.push('BUDGET_VIOLATION');
  }
  if (provenance === 'current-reuse-candidate') flags.push('REUSE_CANDIDATE_NOT_FINAL');
  if (provenance === 'planned-production' && !result.exists) {
    flags.push(representation === 'first-person'
      ? 'MISSING_PLANNED_FIRST_PERSON_GLB'
      : 'MISSING_PLANNED_PRODUCTION_GLB');
  }

  const normalizedFlags = [...new Set(flags)].sort();
  return {
    representation,
    role,
    provenance,
    ...result,
    budgetViolations,
    flags: normalizedFlags,
    structurallyAccepted: result.exists
      && !result.error
      && normalizedFlags.length === 0,
    finalProductionAccepted: false,
  };
}

function auditPath(spec, {
  glbPath,
  sourcePath,
  provenance,
  representation = 'world',
  role,
}) {
  const budget = representation === 'first-person' && spec.firstPersonBudget
    ? spec.firstPersonBudget
    : spec;
  const result = auditGlbFile({
    root: ROOT,
    glbPath,
    sourcePath,
    intendedDimensions: spec.intendedDimensions,
    collisionExpected: spec.collisionExpected,
    requiredSockets: spec.requiredSockets,
    requiredAnimations: spec.requiredAnimations,
    budgets: {
      triangleBudget: budget.triangleBudget,
      meshBudget: budget.meshBudget,
      materialBudget: budget.materialBudget,
      textureBudget: budget.textureBudget,
      // The reusable GLB auditor accepts a scalar ceiling. The spec stores the
      // permitted width and height, so the larger limit is the scalar ceiling.
      maxTextureSize: Math.max(...budget.maxTextureSize),
    },
  });
  return withAuditPolicy(spec, result, provenance, representation, role);
}

function uniqueGlbCandidates(spec) {
  const entries = [
    ...spec.currentCandidates.canonicalGlb.map((glbPath) => ({ role: 'candidate-canonical-glb', glbPath })),
    ...spec.currentCandidates.runtimeGlb.map((glbPath) => ({ role: 'candidate-runtime-glb', glbPath })),
    ...spec.currentCandidates.rawInputs
      .filter((repoPath) => /\.glb$/iu.test(repoPath))
      .map((glbPath) => ({ role: 'candidate-raw-input-glb', glbPath })),
  ];
  const seen = new Set();
  return entries.filter(({ role, glbPath }) => {
    const key = `${role}\0${glbPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function auditAsset(spec) {
  const selectedSource = spec.source;
  const selectedCanonicalProvenance = spec.pathStatus.canonicalGlb === 'current-candidate'
    ? 'current-reuse-candidate'
    : 'planned-production';
  const selectedRuntimeProvenance = spec.pathStatus.runtimeGlb === 'current-candidate'
    ? 'current-reuse-candidate'
    : 'planned-production';

  const selectedCanonicalAudit = auditPath(spec, {
    glbPath: spec.canonicalGlb,
    sourcePath: selectedSource,
    provenance: selectedCanonicalProvenance,
    role: 'selected-canonical-glb',
  });
  const selectedRuntimeAudit = auditPath(spec, {
    glbPath: spec.runtimeGlb,
    sourcePath: selectedSource,
    provenance: selectedRuntimeProvenance,
    role: 'selected-runtime-glb',
  });
  const plannedCanonicalAudit = auditPath(spec, {
    glbPath: spec.plannedPaths.canonicalGlb,
    sourcePath: spec.plannedPaths.source,
    provenance: 'planned-production',
    role: 'planned-canonical-glb',
  });
  const plannedRuntimeAudit = auditPath(spec, {
    glbPath: spec.plannedPaths.runtimeGlb,
    sourcePath: spec.plannedPaths.source,
    provenance: 'planned-production',
    role: 'planned-runtime-glb',
  });

  const candidateGlbAudits = uniqueGlbCandidates(spec).map(({ role, glbPath }) => auditPath(spec, {
    glbPath,
    sourcePath: spec.currentCandidates.source[0] || spec.plannedPaths.source,
    provenance: 'current-reuse-candidate',
    role,
  }));

  let firstPerson = null;
  if (spec.representations.includes('first-person')) {
    firstPerson = {
      plannedSource: pathRecord(
        'firstPersonSource',
        spec.plannedPaths.firstPersonSource,
        'planned-production',
      ),
      plannedCanonicalAudit: auditPath(spec, {
        glbPath: spec.plannedPaths.firstPersonCanonicalGlb,
        sourcePath: spec.plannedPaths.firstPersonSource,
        provenance: 'planned-production',
        representation: 'first-person',
        role: 'planned-first-person-canonical-glb',
      }),
      plannedRuntimeAudit: auditPath(spec, {
        glbPath: spec.plannedPaths.firstPersonRuntimeGlb,
        sourcePath: spec.plannedPaths.firstPersonSource,
        provenance: 'planned-production',
        representation: 'first-person',
        role: 'planned-first-person-runtime-glb',
      }),
    };
  }

  const candidates = currentCandidateArtifacts(spec);
  const planned = plannedArtifacts(spec);
  const missingCandidateArtifacts = candidates.filter((artifact) => !artifact.exists);
  const missingPlannedArtifacts = planned.filter((artifact) => !artifact.exists);
  const plannedWorldStructurallyAccepted = repoExists(spec.plannedPaths.source)
    && repoExists(spec.plannedPaths.runtimeIntegrationFile)
    && plannedCanonicalAudit.structurallyAccepted
    && plannedRuntimeAudit.structurallyAccepted;
  const plannedFirstPersonStructurallyAccepted = !firstPerson
    || (firstPerson.plannedSource.exists
      && firstPerson.plannedCanonicalAudit.structurallyAccepted
      && firstPerson.plannedRuntimeAudit.structurallyAccepted);
  const structurallyAccepted = plannedWorldStructurallyAccepted
    && plannedFirstPersonStructurallyAccepted;

  return {
    assetNumber: spec.assetNumber,
    referenceSheet: spec.referenceSheet,
    referenceName: spec.referenceName,
    currentCandidateArtifacts: candidates,
    missingCandidateArtifacts,
    plannedProductionArtifacts: planned,
    missingPlannedProductionArtifacts: missingPlannedArtifacts,
    selectedCanonicalAudit,
    selectedRuntimeAudit,
    candidateGlbAudits,
    plannedCanonicalAudit,
    plannedRuntimeAudit,
    optionalFirstPersonPlannedAudit: firstPerson,
    selectedCandidateStructurallyAccepted: selectedRuntimeProvenance === 'current-reuse-candidate'
      && selectedRuntimeAudit.exists
      && !selectedRuntimeAudit.error
      && selectedRuntimeAudit.flags
        .filter((flag) => flag !== 'REUSE_CANDIDATE_NOT_FINAL').length === 0,
    plannedWorldStructurallyAccepted,
    plannedFirstPersonStructurallyAccepted,
    structurallyAccepted,
    finalProductionAccepted: false,
    status: NON_FINAL_STATUS,
    finalStatus: FINAL_STATUS,
  };
}

const auditRecords = ASSETS.map(auditAsset);

if (auditRecords.length !== 50
  || auditRecords.some((record, index) => record.assetNumber !== index + 51)) {
  throw new Error('Audit generation requires exactly 50 ordered records for Assets 51-100.');
}

function selectedPathRecord(spec, kind, repoPath, pathStatus) {
  return pathRecord(
    kind,
    repoPath,
    pathStatus === 'current-candidate' ? 'current-reuse-candidate' : 'planned-production',
  );
}

function describeTechnicalQuality(auditRecord) {
  const audit = auditRecord.selectedRuntimeAudit;
  if (!audit.exists) return 'No selected runtime GLB exists; production is missing.';
  if (audit.error) return `Selected runtime GLB is unreadable: ${audit.error}`;
  const meaningfulFlags = audit.flags.filter((flag) => flag !== 'REUSE_CANDIDATE_NOT_FINAL');
  return meaningfulFlags.length
    ? `Reuse candidate requires structural work: ${meaningfulFlags.join(', ')}.`
    : 'Reuse candidate parsed without automated structural blockers; reference, gameplay, and final production acceptance remain pending.';
}

function describeRequiredWork(spec, auditRecord) {
  const missingKinds = [...new Set(auditRecord.missingPlannedProductionArtifacts.map((item) => item.kind))];
  const firstPerson = spec.representations.includes('first-person')
    ? ' Build and validate the separate first-person source, canonical GLB, and runtime GLB.'
    : '';
  return `${spec.requiredWork} Missing planned artifact kinds: ${missingKinds.join(', ') || 'none'}.${firstPerson}`;
}

const manifestAssets = ASSETS.map((spec, index) => {
  const auditRecord = auditRecords[index];
  const selectedAudit = auditRecord.selectedRuntimeAudit.exists
    ? auditRecord.selectedRuntimeAudit
    : auditRecord.selectedCanonicalAudit;
  const selectedRuntimeFiles = spec.runtimeIntegrationFiles.map((repoPath) => pathRecord(
    'runtimeIntegrationFile',
    repoPath,
    spec.pathStatus.runtimeIntegrationFiles === 'current-candidate'
      ? 'current-reuse-candidate'
      : 'planned-production',
  ));

  return {
    assetNumber: spec.assetNumber,
    sheet: spec.referenceSheet,
    referenceSheet: spec.referenceSheet,
    referenceImagePath: spec.referenceImagePath,
    supplementalReferenceImagePaths: [...spec.supplementalReferenceImagePaths],
    referenceName: spec.referenceName,
    referenceAssetName: spec.referenceName,
    intendedUse: spec.intendedGameplayPurpose,
    intendedGameplayPurpose: spec.intendedGameplayPurpose,
    category: spec.category,
    fixtureOrPlacementLocation: spec.fixtureOrPlacementLocation,
    representations: [...spec.representations],

    existingCandidatePaths: spec.currentCandidates,
    currentCandidateNotes: spec.currentCandidateNotes,
    selectedBlenderSource: selectedPathRecord(spec, 'source', spec.source, spec.pathStatus.source),
    selectedCanonicalGlb: selectedPathRecord(
      spec,
      'canonicalGlb',
      spec.canonicalGlb,
      spec.pathStatus.canonicalGlb,
    ),
    selectedRuntimeGlb: selectedPathRecord(
      spec,
      'runtimeGlb',
      spec.runtimeGlb,
      spec.pathStatus.runtimeGlb,
    ),
    selectedRuntimeIntegrationFiles: selectedRuntimeFiles,
    selectedPathStatus: spec.pathStatus,
    currentBlenderSourcePath: spec.source,
    currentCanonicalGlbPath: spec.canonicalGlb,
    currentRuntimeGlbPath: spec.runtimeGlb,
    runtimeLoaderOrIntegrationFiles: [...spec.runtimeIntegrationFiles],
    plannedProductionPaths: spec.plannedPaths,
    plannedProductionPathStates: auditRecord.plannedProductionArtifacts,
    plannedBlenderSourcePath: spec.plannedPaths.source,
    plannedCanonicalGlbPath: spec.plannedPaths.canonicalGlb,
    plannedRuntimeGlbPath: spec.plannedPaths.runtimeGlb,
    plannedRuntimeIntegrationFile: spec.plannedPaths.runtimeIntegrationFile,

    currentDimensions: selectedAudit.bounds?.dimensions || null,
    targetDimensions: spec.intendedDimensions,
    dimensionUnit: spec.dimensionUnit,
    currentTriangleCount: selectedAudit.triangleCount ?? null,
    currentVertexCount: selectedAudit.vertexCount ?? null,
    currentMeshCount: selectedAudit.meshCount ?? null,
    currentMaterialCount: selectedAudit.materialCount ?? null,
    currentTextureCount: selectedAudit.textureCount ?? null,
    currentTextureDimensions: selectedAudit.textureDimensions || [],
    currentFileSizeBytes: selectedAudit.fileSizeBytes ?? null,
    budgets: {
      triangleBudget: spec.triangleBudget,
      meshBudget: spec.meshBudget,
      materialBudget: spec.materialBudget,
      textureBudget: spec.textureBudget,
      maxTextureSize: spec.maxTextureSize,
      maxFileBytes: spec.maxFileBytes,
    },
    firstPersonBudget: spec.firstPersonBudget,

    collisionExpected: spec.collisionExpected,
    collisionRequirements: spec.collisionRequirements,
    currentCollisionNodes: selectedAudit.collisionNodes || [],
    interactionType: spec.interactionType,
    animationRequirements: spec.animationRequirements,
    requiredAnimations: [...spec.requiredAnimations],
    currentAnimations: selectedAudit.animationNames || [],
    missingRequiredAnimations: selectedAudit.missingRequiredAnimations || [...spec.requiredAnimations],
    requiredSockets: [...spec.requiredSockets],
    currentSockets: selectedAudit.socketNodes || [],
    placementSockets: selectedAudit.socketNodes || [],
    missingRequiredSockets: selectedAudit.missingRequiredSockets || [...spec.requiredSockets],

    currentVisualQuality: auditRecord.currentCandidateArtifacts.some((artifact) => (
      ['source', 'canonicalGlb', 'runtimeGlb', 'rawInputs'].includes(artifact.kind)
      && artifact.exists
    ))
      ? 'UNVERIFIED_REUSE_CANDIDATE_INPUT'
      : 'MISSING_AUTHORED_PRODUCTION_ASSET',
    currentQuality: spec.currentQuality,
    currentTechnicalQuality: describeTechnicalQuality(auditRecord),
    currentIntegrationStatus: selectedRuntimeFiles.some((entry) => entry.exists)
      ? 'A current runtime integration candidate exists; planned per-asset integration remains missing.'
      : 'Planned per-asset runtime integration is missing.',
    requiredWork: describeRequiredWork(spec, auditRecord),
    finalQuality: 'NOT_EVALUATED_NO_PRODUCTION_ACCEPTANCE_EVIDENCE',
    productionStatus: NON_FINAL_STATUS,
    finalStatus: FINAL_STATUS,
    structurallyAccepted: auditRecord.structurallyAccepted,
    finalProductionAccepted: false,
    auditFlags: selectedAudit.flags,
  };
});

const candidateArtifactReferences = auditRecords.flatMap((record) => record.currentCandidateArtifacts);
const uniqueCandidateArtifacts = [...new Map(
  candidateArtifactReferences.map((artifact) => [`${artifact.kind}\0${artifact.path}`, artifact]),
).values()];
const plannedProductionArtifacts = auditRecords.flatMap((record) => record.plannedProductionArtifacts);
const plannedModelArtifacts = plannedProductionArtifacts.filter((artifact) => (
  artifact.kind !== 'runtimeIntegrationFile'
));
const plannedGlbArtifacts = plannedProductionArtifacts.filter((artifact) => /Glb$/u.test(artifact.kind));
const assetsWithExistingModelCandidates = auditRecords.filter((record) => (
  record.currentCandidateArtifacts.some((artifact) => (
    ['source', 'canonicalGlb', 'runtimeGlb', 'rawInputs'].includes(artifact.kind) && artifact.exists
  ))
));
const selectedExistingRuntimeGlbs = auditRecords.filter((record) => (
  record.selectedRuntimeAudit.provenance === 'current-reuse-candidate'
  && record.selectedRuntimeAudit.exists
));

const generatedAt = new Date().toISOString();
const summary = {
  authoritativeAssetCount: 50,
  existingCandidateCount: assetsWithExistingModelCandidates.length,
  existingCandidateCountUnit: 'asset records with at least one existing reusable model/source input',
  existingCandidateArtifactReferenceCount: candidateArtifactReferences.filter((artifact) => artifact.exists).length,
  uniqueExistingCandidateArtifactCount: uniqueCandidateArtifacts.filter((artifact) => artifact.exists).length,
  selectedExistingRuntimeGlbCount: selectedExistingRuntimeGlbs.length,
  plannedProductionArtifactCount: plannedProductionArtifacts.length,
  plannedProductionArtifactCountIncludes: 'source, canonical GLB, runtime GLB, runtime integration, and optional first-person paths',
  plannedModelArtifactCount: plannedModelArtifacts.length,
  plannedGlbArtifactCount: plannedGlbArtifacts.length,
  plannedProductionArtifactsPresentCount: plannedProductionArtifacts.filter((artifact) => artifact.exists).length,
  plannedProductionCompleteAssetCount: auditRecords.filter((record) => (
    record.missingPlannedProductionArtifacts.length === 0
  )).length,
  selectedCandidateStructurallyAcceptedCount: auditRecords.filter((record) => (
    record.selectedCandidateStructurallyAccepted
  )).length,
  structurallyAcceptedCount: auditRecords.filter((record) => record.structurallyAccepted).length,
  structurallyAcceptedCountUnit: 'assets whose complete planned world and required first-person production artifacts pass structural audit',
  finalProductionAcceptedCount: 0,
};

const metadata = {
  schemaVersion: 1,
  generatedAt,
  generator: GENERATOR_PATH,
  nodeVersion: process.version,
  phase: AUDIT_STAGE,
  status: NON_FINAL_STATUS,
  final: false,
  repositoryRoot: '.',
  assetRange: [51, 100],
  referenceSheets: Object.entries(SHEETS).map(([sheet, file]) => ({
    sheet: Number(sheet),
    file,
  })),
  firstPersonReferences: [...FIRST_PERSON_REFERENCES],
  auditPolicy: {
    reusableCandidatesAreFinal: false,
    plannedProductionArtifactsRequired: true,
    firstPersonArtifactsRequiredForRepresentations: true,
    finalAcceptanceRequiresGameplayVisualSavePerformanceEvidence: true,
  },
};

const manifest = {
  ...metadata,
  documentType: 'ASSET_MANIFEST',
  summary,
  assets: manifestAssets,
};

const finalAudit = {
  ...metadata,
  documentType: 'STRUCTURAL_ASSET_AUDIT',
  auditStage: AUDIT_STAGE,
  summary,
  missingCurrentCandidateArtifacts: auditRecords.flatMap((record) => (
    record.missingCandidateArtifacts.map((artifact) => ({
      assetNumber: record.assetNumber,
      ...artifact,
    }))
  )),
  missingPlannedProductionArtifacts: auditRecords.flatMap((record) => (
    record.missingPlannedProductionArtifacts.map((artifact) => ({
      assetNumber: record.assetNumber,
      ...artifact,
    }))
  )),
  records: auditRecords,
};

function markdownCode(repoPath) {
  return repoPath ? `\`${mdCell(repoPath)}\`` : 'none';
}

function numberOrDash(value) {
  return value == null ? '-' : String(value);
}

const manifestLines = [
  '# Assets 51-100 master manifest',
  '',
  `Generated: ${generatedAt}`,
  '',
  `Status: **${NON_FINAL_STATUS}**. Reuse candidates are production inputs only; no asset is finally accepted.`,
  '',
  '## Production counts',
  '',
  '| Measure | Count | Meaning |',
  '|---|---:|---|',
  `| Existing candidate assets | ${summary.existingCandidateCount} | ${mdCell(summary.existingCandidateCountUnit)} |`,
  `| Selected existing runtime GLBs | ${summary.selectedExistingRuntimeGlbCount} | Reuse candidates selected by the Phase-1 spec |`,
  `| Planned production artifacts | ${summary.plannedProductionArtifactCount} | ${mdCell(summary.plannedProductionArtifactCountIncludes)} |`,
  `| Planned artifacts present | ${summary.plannedProductionArtifactsPresentCount} | Discovery baseline was zero; current disk census |`,
  `| Structurally accepted planned assets | ${summary.structurallyAcceptedCount} | Complete planned world plus required first-person artifacts |`,
  `| Finally production accepted | ${summary.finalProductionAcceptedCount} | Requires later gameplay, visual, save/load, and performance evidence |`,
  '',
  '## Ordered primary assets',
  '',
  '| # | Sheet | Reference asset | Selected source | Selected runtime GLB | Planned source | Planned runtime GLB | Current dimensions (m) | Target dimensions (m) | Tris | Meshes | Mats / textures | File bytes | Collision | Interaction / animations / sockets | Current quality | Required work | Final quality / status |',
  '|---:|---:|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---|---|---|---|',
  ...manifestAssets.map((asset) => `| ${asset.assetNumber} | ${asset.referenceSheet} | ${mdCell(asset.referenceAssetName)} | ${markdownCode(asset.selectedBlenderSource.path)} (${asset.selectedBlenderSource.provenance}) | ${markdownCode(asset.selectedRuntimeGlb.path)} (${asset.selectedRuntimeGlb.provenance}) | ${markdownCode(asset.plannedProductionPaths.source)} | ${markdownCode(asset.plannedProductionPaths.runtimeGlb)} | ${mdCell(dimensionsText(asset.currentDimensions))} | ${mdCell(dimensionsText(asset.targetDimensions))} | ${numberOrDash(asset.currentTriangleCount)} | ${numberOrDash(asset.currentMeshCount)} | ${numberOrDash(asset.currentMaterialCount)} / ${numberOrDash(asset.currentTextureCount)} | ${numberOrDash(asset.currentFileSizeBytes)} | ${mdCell(`${asset.collisionRequirements} Current nodes: ${asset.currentCollisionNodes.length}.`)} | ${mdCell(`${asset.interactionType} ${asset.animationRequirements} Required sockets: ${asset.requiredSockets.join(', ')}.`)} | ${mdCell(`${asset.currentVisualQuality}; ${asset.currentTechnicalQuality}`)} | ${mdCell(asset.requiredWork)} | ${asset.finalQuality} / ${asset.finalStatus} |`),
  '',
  'The JSON manifest carries exact texture dimensions, all selected/planned paths, budgets, collision nodes, animation clips, socket gaps, and per-path existence states.',
];

const auditLines = [
  '# Assets 51-100 automated GLB audit',
  '',
  `Generated: ${generatedAt}`,
  '',
  `Status: **${NON_FINAL_STATUS}**. Structural acceptance: ${summary.structurallyAcceptedCount}/50. Final production acceptance: **0/50**.`,
  '',
  '## Audit coverage',
  '',
  'Every selected canonical/runtime GLB, every declared reusable GLB candidate, every planned canonical/runtime GLB, and every optional first-person planned canonical/runtime GLB is represented in the JSON audit. Checks include file/header integrity, bounds/origin, node names, duplicates, hidden nodes, root transforms, far meshes, LOD, collision, sockets, animations, skins, skeletons, morphs, missing textures, transparency, double-sided materials, and category budgets.',
  '',
  '| # | Asset | Selected runtime GLB | Exists | KiB | Nodes | Meshes | Verts | Tris | Mats | Tex | Texture sizes | Anim | Skin / morph | Bounds (m) | Origin offset | Collision | Sockets missing | Animations missing | Transparent / double-sided | LOD | Flags | Planned runtime | FP planned | Structural | Final |',
  '|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---|---:|---:|---|---|---:|---:|---|---|---|---|---|',
  ...auditRecords.map((record) => {
    const audit = record.selectedRuntimeAudit;
    const textureSizes = (audit.textureDimensions || [])
      .map((texture) => `${texture.width ?? '?'}x${texture.height ?? '?'}`)
      .join(', ') || '-';
    const fp = record.optionalFirstPersonPlannedAudit
      ? `${record.optionalFirstPersonPlannedAudit.plannedRuntimeAudit.path}: ${record.optionalFirstPersonPlannedAudit.plannedRuntimeAudit.exists ? 'present' : 'missing'}`
      : 'not required';
    return `| ${record.assetNumber} | ${mdCell(record.referenceName)} | ${markdownCode(audit.path)} | ${audit.exists ? 'yes' : 'no'} | ${numberOrDash(audit.fileSizeKiB)} | ${numberOrDash(audit.nodeCount)} | ${numberOrDash(audit.meshCount)} | ${numberOrDash(audit.vertexCount)} | ${numberOrDash(audit.triangleCount)} | ${numberOrDash(audit.materialCount)} | ${numberOrDash(audit.textureCount)} | ${mdCell(textureSizes)} | ${numberOrDash(audit.animationCount)} | ${numberOrDash(audit.skinCount)} / ${numberOrDash(audit.morphTargetCount)} | ${mdCell(dimensionsText(audit.bounds?.dimensions))} | ${numberOrDash(round(audit.bounds?.centreOffset))} | ${(audit.collisionNodes || []).length} | ${mdCell((audit.missingRequiredSockets || []).join(', ') || 'none')} | ${mdCell((audit.missingRequiredAnimations || []).join(', ') || 'none')} | ${numberOrDash(audit.transparentMaterialCount)} / ${numberOrDash(audit.doubleSidedMaterialCount)} | ${(audit.lodNodes || []).length} | ${mdCell((audit.flags || []).join(', ') || 'none')} | ${record.plannedRuntimeAudit.exists ? 'present' : 'missing'} | ${mdCell(fp)} | ${record.structurallyAccepted ? 'accepted' : 'not accepted'} | ${FINAL_STATUS} |`;
  }),
  '',
  '## Missing-artifact truth',
  '',
  `- Missing declared current-candidate path references: ${finalAudit.missingCurrentCandidateArtifacts.length}.`,
  `- Missing planned production paths: ${finalAudit.missingPlannedProductionArtifacts.length}/${summary.plannedProductionArtifactCount}.`,
  `- Planned production assets structurally accepted: ${summary.structurallyAcceptedCount}/50.`,
  `- Final production assets accepted: ${summary.finalProductionAcceptedCount}/50.`,
];

writeFileSync(
  path.join(OUTPUT_DIRECTORY, 'asset_manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
writeFileSync(
  path.join(OUTPUT_DIRECTORY, 'asset_manifest.md'),
  `${manifestLines.join('\n')}\n`,
);
writeFileSync(
  path.join(OUTPUT_DIRECTORY, 'final_asset_audit.json'),
  `${JSON.stringify(finalAudit, null, 2)}\n`,
);
writeFileSync(
  path.join(OUTPUT_DIRECTORY, 'final_asset_audit.md'),
  `${auditLines.join('\n')}\n`,
);

console.log(JSON.stringify({
  ok: true,
  final: false,
  status: NON_FINAL_STATUS,
  outputDirectory: 'qa/assets_51_100_master',
  orderedAssetRecords: auditRecords.length,
  ...summary,
}, null, 2));
