import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  REGISTER_GTAO_VISUAL_AB_SCHEMA_VERSION,
  REGISTER_GTAO_VISUAL_AB_VIEW_KEYS,
  validateRegisterGtaoVisualAbResult,
} from '../tools/qa/checkout-register-gtao-visual-ab.mjs';

const MODULE_URL = new URL('../tools/qa/checkout-register-gtao-visual-ab.mjs', import.meta.url);
const RUNNER_URL = new URL('../tools/qa/checkout-register-gtao-visual-ab.js', import.meta.url);
const LEGACY_MODULE_URL = new URL('../tools/qa/checkout-card-gtao-visual-ab.mjs', import.meta.url);
const LEGACY_RUNNER_URL = new URL('../tools/qa/checkout-card-gtao-visual-ab.js', import.meta.url);
const source = fs.readFileSync(MODULE_URL, 'utf8');
const runnerSource = fs.readFileSync(RUNNER_URL, 'utf8');
const legacyModuleSource = fs.readFileSync(LEGACY_MODULE_URL, 'utf8');
const legacyRunnerSource = fs.readFileSync(LEGACY_RUNNER_URL, 'utf8');

function validResult() {
  const workspaces = {
    activeMonitor: 'monitor',
    scanner: 'scan',
    cardReady: 'card',
  };
  return {
    schemaVersion: REGISTER_GTAO_VISUAL_AB_SCHEMA_VERSION,
    protocol: {
      normalControls: true,
      captureSequence: 'off/on/off',
      freezeScope: 'clubhouse.update only while each comparison is captured',
    },
    views: Object.fromEntries(REGISTER_GTAO_VISUAL_AB_VIEW_KEYS.map((key) => [key, {
      workspace: workspaces[key],
      originalEnabled: false,
      restoredEnabled: false,
      cameraDrift: 0,
      gtaoSequence: [
        { name: 'off-before', enabled: false },
        { name: 'on', enabled: true },
        { name: 'off-after', enabled: false },
      ],
      files: {
        gtaoOffControl: `${key}-off-control.png`,
        gtaoOn: `${key}-on.png`,
        gtaoOff: `${key}-off.png`,
        amplifiedDiff: `${key}-diff.png`,
      },
      metrics: {
        gtaoOnVsOffBefore: { wholeFrame: {} },
        gtaoOnVsOffAfter: { wholeFrame: {} },
        offControlMotion: { wholeFrame: {} },
      },
    }])),
    lifecycle: {
      firstCycle: {
        priorEnabled: true,
        restoredEnabled: true,
        activeTransitions: [
          { checkpoint: 'monitor', active: true, workspace: 'monitor', gtaoEnabled: false },
          { checkpoint: 'scan', active: true, workspace: 'scan', gtaoEnabled: false },
          { checkpoint: 'card', active: true, workspace: 'card', gtaoEnabled: false },
          { checkpoint: 'card-to-monitor', active: true, workspace: 'monitor', gtaoEnabled: false },
        ],
        leave: { active: false, gtaoEnabled: true },
      },
      secondCycle: {
        priorEnabled: false,
        enteredEnabled: false,
        restoredEnabled: false,
        entry: { active: true, gtaoEnabled: false },
        leave: { active: false, gtaoEnabled: false },
      },
    },
    diagnostics: {
      errors: [],
      pageErrors: [],
      nonBenignRequestFailures: [],
    },
  };
}

test('register-scoped GTAO runner keeps the runner-compatible function shape', () => {
  const run = Function(`"use strict"; return (${runnerSource});`)();
  assert.equal(typeof run, 'function');
  assert.match(runnerSource, /checkout-register-gtao-visual-ab\.mjs/);
  assert.match(runnerSource, /runCheckoutRegisterGtaoVisualAb/);
  assert.deepEqual(REGISTER_GTAO_VISUAL_AB_VIEW_KEYS, ['activeMonitor', 'scanner', 'cardReady']);
});

test('each monitor, scanner, and card view uses an independent fixed-camera off/on/off capture', () => {
  assert.match(source, /activeMonitor:\s*await captureFixedView\(page, 'activeMonitor', 'scanning'\)/);
  assert.match(source, /views\.scanner = await captureFixedView\(page, 'scanner', 'scanning'\)/);
  assert.match(source, /views\.cardReady = await captureFixedView\(page, 'cardReady', 'card-ready'\)/);
  assert.match(source, /\{ name: 'off-before', enabled: false/);
  assert.match(source, /\{ name: 'on', enabled: true/);
  assert.match(source, /\{ name: 'off-after', enabled: false/);
  assert.match(source, /clubhouse\.update = function registerGtaoVisualFrozenUpdate\(\) \{\};/);
  assert.match(source, /if \(freeze\?\.update\) clubhouse\.update = freeze\.update/);
  assert.match(source, /normal game rAF and EffectComposer remain live/);
  assert.doesNotMatch(source, /requestAnimationFrame\s*=/);
  assert.doesNotMatch(source, /composer\.render\s*=/);
});

test('normal controls own entry, workspace advancement, cancellation, and both leaves', () => {
  assert.match(source, /await enterFrontDesk\(page\)/);
  assert.match(source, /await monitorClick\(page, 'start-scanning'\)/);
  assert.match(source, /await scanAll\(page\)/);
  assert.match(source, /page\.mouse\.click\(cancel\.x, cancel\.y\)/);
  assert.match(source, /page\.keyboard\.press\('Escape'\)/);
  assert.match(source, /before-second-entry-prior-false[^]*page\.keyboard\.press\('e'\)[^]*second-entry-preserves-prior-false/);
  assert.match(source, /workspace: 'monitor', stage: 'scanning', gtaoEnabled: false/);
  assert.match(source, /workspace: 'scan', stage: 'scanning', gtaoEnabled: false/);
  assert.match(source, /workspace: 'card', stage: 'card-ready', gtaoEnabled: false/);
  assert.doesNotMatch(source, /register\.enter\(/);
  assert.doesNotMatch(source, /register\.leave\(/);
  assert.doesNotMatch(source, /register\.setWorkspace\(/);
  assert.doesNotMatch(source, /getTx\(\)\.stage\s*=/);
});

test('schema requires active-workspace bypass and exact true then false restoration cycles', () => {
  const valid = validResult();
  assert.deepEqual(validateRegisterGtaoVisualAbResult(valid), { valid: true, issues: [] });

  valid.views.scanner.restoredEnabled = true;
  valid.lifecycle.firstCycle.activeTransitions[1].gtaoEnabled = true;
  valid.lifecycle.firstCycle.restoredEnabled = false;
  valid.lifecycle.secondCycle.restoredEnabled = true;
  valid.diagnostics.pageErrors.push('synthetic page failure');
  const invalid = validateRegisterGtaoVisualAbResult(valid);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some((issue) => issue.includes('views.scanner.restoredEnabled')));
  assert.ok(invalid.issues.some((issue) => issue.includes('scanner')));
  assert.ok(invalid.issues.some((issue) => issue.includes('prior true')));
  assert.ok(invalid.issues.some((issue) => issue.includes('prior false')));
  assert.ok(invalid.issues.some((issue) => issue.includes('diagnostics.pageErrors')));
});

test('legacy card-named launchers delegate to the register-scoped lifecycle harness', () => {
  const legacyRun = Function(`"use strict"; return (${legacyRunnerSource});`)();
  assert.equal(typeof legacyRun, 'function');
  assert.match(legacyModuleSource, /runCheckoutRegisterGtaoVisualAb as runCheckoutCardGtaoVisualAb/);
  assert.doesNotMatch(legacyModuleSource, /post\.gtao\.enabled\s*=/);
  assert.match(legacyRunnerSource, /runCheckoutCardGtaoVisualAb/);
});
