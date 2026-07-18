import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  ASSETS,
  CATEGORY_BUDGETS,
  FIRST_PERSON_BUDGET,
  FIRST_PERSON_REFERENCES,
  SHEETS,
} from '../tools/qa/assets-51-100-spec.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const diskPath = (repoPath) => path.join(ROOT, ...repoPath.split('/'));
const exists = (repoPath) => existsSync(diskPath(repoPath));

const EXPECTED_NAMES = [
  'FINISHED CLUBHOUSE EXTERIOR',
  'DILAPIDATED CLUBHOUSE EXTERIOR',
  'MAIN ENTRANCE DOUBLE-DOOR ASSEMBLY',
  'EXTERIOR PORCH AND STEPS',
  'CLUBHOUSE WINDOWS SET',
  'INTERIOR WALL-PANEL KIT',
  'INTERIOR TRIM AND BASEBOARD KIT',
  'CEILING AND BEAM KIT',
  'RENOVATED FLOORING SET',
  'DAMAGED FLOORING SET',
  'FRONT DESK COUNTER SHELL',
  'BACK-COUNTER STORAGE CABINETS',
  'PRO-SHOP FITTING ROOM ASSEMBLY',
  'STOCKROOM SHELVING SYSTEM',
  'STOCKROOM WORKTABLE',
  'OFFICE / LAPTOP DESK',
  'CLUBHOUSE LOUNGE SOFA',
  'LOUNGE ARMCHAIR',
  'LOUNGE COFFEE TABLE',
  'TROPHY & DISPLAY CABINET',
  'VACUUM CLEANER',
  'MOP',
  'MOP BUCKET AND WRINGER',
  'BROOM',
  'DUSTPAN',
  'CLEANING SPRAY BOTTLE',
  'CLEANING CLOTH & SPONGE SET',
  'PRESSURE WASHER',
  'PRESSURE WASHER HOSE & WAND',
  'TRASH BAG',
  'OFFICE CHAIR',
  'FILING CABINET',
  'DESK LAMP',
  'PRINTER',
  'TELEPHONE',
  'CORKBOARD / NOTICEBOARD',
  'WALL CLOCK',
  'KEY RACK',
  'RESERVATION CLIPBOARD',
  'SCORECARD HOLDER',
  'FIRE EXTINGUISHER',
  'FIRST-AID KIT CABINET',
  'SECURITY CAMERA',
  'EXIT SIGN',
  'EMERGENCY LIGHT',
  'BULLETIN BOARD',
  'KEY CABINET',
  'HAND SANITIZER STATION',
  'UMBRELLA STAND',
  'FLOOR MAT / WELCOME MAT',
];

test('Assets 51-100 contain exactly 50 ordered primary records with the sheet names', () => {
  assert.equal(ASSETS.length, 50);
  assert.deepEqual(ASSETS.map((asset) => asset.assetNumber),
    Array.from({ length: 50 }, (_, index) => index + 51));
  assert.deepEqual(ASSETS.map((asset) => asset.referenceName), EXPECTED_NAMES);
  assert.equal(new Set(ASSETS.map((asset) => asset.assetNumber)).size, 50);
  assert.equal(new Set(ASSETS.map((asset) => asset.stem)).size, 50);
});

test('Sheets 6-10 and first-person references resolve to the supplied files', () => {
  assert.deepEqual(Object.keys(SHEETS).map(Number), [6, 7, 8, 9, 10]);
  for (const [sheet, referencePath] of Object.entries(SHEETS)) {
    assert.ok(exists(referencePath), `Sheet ${sheet} reference is missing: ${referencePath}`);
  }
  assert.equal(FIRST_PERSON_REFERENCES.length, 2);
  for (const referencePath of FIRST_PERSON_REFERENCES) {
    assert.ok(exists(referencePath), `first-person reference is missing: ${referencePath}`);
  }

  for (const asset of ASSETS) {
    assert.equal(asset.referenceSheet, Math.ceil(asset.assetNumber / 10));
    assert.equal(asset.referenceImagePath, SHEETS[asset.referenceSheet]);
    assert.ok(exists(asset.referenceImagePath), `Asset ${asset.assetNumber} reference is missing`);
    if (asset.referenceSheet === 8) {
      assert.deepEqual(asset.supplementalReferenceImagePaths, FIRST_PERSON_REFERENCES,
        `Asset ${asset.assetNumber} must carry both first-person references`);
    } else {
      assert.deepEqual(asset.supplementalReferenceImagePaths, []);
    }
  }
});

test('every record carries meter dimensions, category budgets, and interaction contracts', () => {
  const positiveBudgetFields = [
    'triangleBudget', 'meshBudget', 'materialBudget', 'textureBudget', 'maxFileBytes',
  ];

  for (const asset of ASSETS) {
    const label = `Asset ${asset.assetNumber}`;
    assert.equal(asset.dimensionUnit, 'm', `${label} dimension unit`);
    assert.ok(asset.intendedGameplayPurpose.length > 10, `${label} intended purpose`);
    assert.ok(asset.fixtureOrPlacementLocation.length > 5, `${label} placement`);
    assert.ok(asset.interactionType.length > 10, `${label} interaction`);
    assert.ok(asset.animationRequirements.length > 10, `${label} animation requirements`);
    assert.ok(asset.collisionRequirements.length > 10, `${label} collision requirements`);
    assert.equal(typeof asset.collisionExpected, 'boolean', `${label} collisionExpected`);

    const dimensions = Object.values(asset.intendedDimensions);
    assert.ok(dimensions.length >= 2, `${label} has at least two target dimensions`);
    assert.ok(dimensions.every((value) => Number.isFinite(value) && value > 0),
      `${label} target dimensions are positive meters`);

    const categoryBudget = CATEGORY_BUDGETS[asset.category];
    assert.ok(categoryBudget, `${label} uses a declared budget category`);
    for (const field of positiveBudgetFields) {
      assert.equal(asset[field], categoryBudget[field], `${label} ${field} matches category`);
      assert.ok(Number.isInteger(asset[field]) && asset[field] > 0, `${label} ${field} is positive`);
    }
    assert.deepEqual(asset.maxTextureSize, categoryBudget.maxTextureSize);
    assert.equal(asset.maxTextureSize.length, 2);
    assert.ok(asset.maxTextureSize.every((value) => Number.isInteger(value) && value >= 1024));

    assert.ok(Array.isArray(asset.requiredAnimations), `${label} requiredAnimations`);
    assert.equal(asset.animationExpected, asset.requiredAnimations.length > 0,
      `${label} animationExpected matches its required clips`);
    assert.ok(asset.requiredAnimations.every((name) => typeof name === 'string' && name.length > 2));
    assert.ok(Array.isArray(asset.requiredSockets) && asset.requiredSockets.length > 0,
      `${label} required sockets`);
    assert.equal(asset.socketExpected, true, `${label} expects authored sockets`);
    assert.equal(new Set(asset.requiredSockets).size, asset.requiredSockets.length,
      `${label} socket names are unique inside the asset`);
    assert.ok(asset.requiredSockets.every((name) => /^(PIVOT|SOCKET)_/u.test(name)),
      `${label} sockets use the authored naming convention`);
    assert.ok(Array.isArray(asset.representations) && asset.representations.includes('world'),
      `${label} has a world representation`);

    assert.equal(asset.currentQuality, 'unverified-candidate-or-missing');
    assert.equal(asset.productionStatus, 'phase-1-spec-only');
    assert.equal(asset.finalStatus, 'not-started');
    assert.ok(asset.currentCandidateNotes.length > 20, `${label} has an honest candidate note`);
    assert.ok(asset.requiredWork.includes(asset.referenceName), `${label} names its required work`);
  }
});

test('handheld Sheet-8 tools explicitly require separate first-person representations', () => {
  const firstPersonAssets = new Set([71, 72, 74, 75, 76, 77, 79, 80]);
  for (const asset of ASSETS.filter((item) => item.referenceSheet === 8)) {
    assert.equal(asset.representations.includes('first-person'), firstPersonAssets.has(asset.assetNumber),
      `Asset ${asset.assetNumber} first-person representation contract`);
    assert.equal(asset.firstPersonBudget, firstPersonAssets.has(asset.assetNumber) ? FIRST_PERSON_BUDGET : null,
      `Asset ${asset.assetNumber} first-person budget contract`);
  }
  assert.equal(FIRST_PERSON_BUDGET.triangleBudget, 18000);
  assert.equal(FIRST_PERSON_BUDGET.boneBudget, 32);
});

function assertUniqueUnlessShared(field) {
  const groups = new Map();
  for (const asset of ASSETS) {
    const value = asset.plannedPaths[field];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(asset);
  }
  for (const [value, records] of groups) {
    if (records.length === 1) continue;
    const numbers = records.map((asset) => asset.assetNumber).sort((a, b) => a - b);
    for (const asset of records) {
      assert.deepEqual(asset.sharedPlannedPaths[field],
        numbers.filter((number) => number !== asset.assetNumber),
        `${field} ${value} is shared without an explicit reciprocal contract`);
    }
  }
}

test('planned source/export/runtime paths are unique and remain visibly missing in Phase 1', () => {
  for (const field of ['source', 'canonicalGlb', 'runtimeGlb', 'runtimeIntegrationFile']) {
    assertUniqueUnlessShared(field);
  }

  for (const asset of ASSETS) {
    const label = `Asset ${asset.assetNumber}`;
    const sheet = `sheet_${String(asset.referenceSheet).padStart(2, '0')}`;
    assert.match(asset.plannedPaths.source, /\.blend$/u, `${label} planned Blender source`);
    assert.match(asset.plannedPaths.canonicalGlb, /\.glb$/u, `${label} planned canonical GLB`);
    assert.match(asset.plannedPaths.runtimeGlb, /\.glb$/u, `${label} planned runtime GLB`);
    assert.match(asset.plannedPaths.runtimeIntegrationFile, /\.js$/u, `${label} planned runtime module`);
    assert.ok(asset.plannedPaths.source.startsWith(`asset_sources/blender/assets_51_100/${sheet}/`),
      `${label} source follows the canonical Sheet ${asset.referenceSheet} directory`);
    assert.ok(asset.plannedPaths.canonicalGlb.startsWith(`Assets/assets_51_100/glb/${sheet}/`),
      `${label} canonical GLB follows the canonical Sheet ${asset.referenceSheet} directory`);
    assert.ok(asset.plannedPaths.runtimeGlb.startsWith(`vendor/models/assets_51_100/${sheet}/`),
      `${label} runtime GLB follows the canonical Sheet ${asset.referenceSheet} directory`);
    const expectsFirstPerson = asset.representations.includes('first-person');
    for (const field of ['firstPersonSource', 'firstPersonCanonicalGlb', 'firstPersonRuntimeGlb']) {
      assert.equal(field in asset.plannedPaths, expectsFirstPerson,
        `${label} ${field} follows the first-person representation contract`);
    }
    if (expectsFirstPerson) {
      assert.match(asset.plannedPaths.firstPersonSource,
        /^asset_sources\/blender\/assets_51_100\/firstperson\/asset_\d{3}_.+_fp\.blend$/u);
      assert.match(asset.plannedPaths.firstPersonCanonicalGlb,
        /^Assets\/assets_51_100\/glb\/firstperson\/asset_\d{3}_.+_fp\.glb$/u);
      assert.match(asset.plannedPaths.firstPersonRuntimeGlb,
        /^vendor\/models\/assets_51_100\/firstperson\/asset_\d{3}_.+_fp\.glb$/u);
    }
    for (const [field, plannedPath] of Object.entries(asset.plannedPaths)) {
      assert.equal(exists(plannedPath), false,
        `${label} ${field} unexpectedly exists; update the Phase-1 status instead of calling it missing`);
    }
  }
});

test('selected paths distinguish existing candidates from planned missing paths', () => {
  const scalarKinds = ['source', 'canonicalGlb', 'runtimeGlb'];
  const candidateKinds = ['source', 'canonicalGlb', 'runtimeGlb', 'runtimeIntegrationFiles', 'rawInputs'];

  for (const asset of ASSETS) {
    const label = `Asset ${asset.assetNumber}`;
    for (const kind of candidateKinds) {
      assert.ok(Array.isArray(asset.currentCandidates[kind]), `${label} candidate ${kind} array`);
      for (const candidatePath of asset.currentCandidates[kind]) {
        assert.ok(exists(candidatePath), `${label} current ${kind} candidate is missing: ${candidatePath}`);
      }
    }

    for (const kind of scalarKinds) {
      const candidates = asset.currentCandidates[kind];
      if (candidates.length) {
        assert.equal(asset[kind], candidates[0], `${label} selects the first current ${kind} candidate`);
        assert.equal(asset.pathStatus[kind], 'current-candidate');
        assert.ok(exists(asset[kind]), `${label} selected ${kind} candidate exists`);
      } else {
        assert.equal(asset[kind], asset.plannedPaths[kind], `${label} selects planned ${kind}`);
        assert.equal(asset.pathStatus[kind], 'planned-missing');
        assert.equal(exists(asset[kind]), false, `${label} selected planned ${kind} stays missing`);
      }
    }

    const runtimeCandidates = asset.currentCandidates.runtimeIntegrationFiles;
    if (runtimeCandidates.length) {
      assert.deepEqual(asset.runtimeIntegrationFiles, runtimeCandidates,
        `${label} selects current runtime candidate files`);
      assert.equal(asset.pathStatus.runtimeIntegrationFiles, 'current-candidate');
      assert.ok(asset.runtimeIntegrationFiles.every(exists), `${label} runtime candidates exist`);
    } else {
      assert.deepEqual(asset.runtimeIntegrationFiles, [asset.plannedPaths.runtimeIntegrationFile],
        `${label} selects its planned runtime module`);
      assert.equal(asset.pathStatus.runtimeIntegrationFiles, 'planned-missing');
      assert.equal(exists(asset.runtimeIntegrationFiles[0]), false,
        `${label} planned runtime module stays missing`);
    }

    assert.ok(!Object.values(asset.pathStatus).includes('complete'),
      `${label} must not present a candidate or missing path as complete`);
  }
});
