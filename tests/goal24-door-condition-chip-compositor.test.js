import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mainSource = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const styleSource = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('door entry reveals a prepainted shop-condition chip without display churn', () => {
  const conditionBlock = mainSource.match(
    /\/\/ Inside the shop the condition chip[\s\S]*?\r?\n\s{2}}\r?\n}\r?\n\r?\n\/\/ one-shot/,
  )?.[0] || '';

  assert.ok(conditionBlock, 'condition-chip update block must remain discoverable');
  assert.match(conditionBlock, /const conditionScore = conditionVisible \? shopCondition\(app\.state\) : null/,
    'the full restoration scan must remain gated to visible in-shop walking');
  assert.match(conditionBlock,
    /const conditionText = conditionVisible[\s\S]*?shopConditionLabel\(app\.state, conditionScore\)[\s\S]*?: ovLast\.condText/);
  assert.match(conditionBlock, /classList\.toggle\('is-visible', conditionVisible\)/);
  assert.match(conditionBlock, /setAttribute\('aria-hidden', conditionVisible \? 'false' : 'true'\)/);
  assert.doesNotMatch(conditionBlock, /style\.display|textContent = condText/,
    'crossing the threshold must not trigger layout or first-paint text creation');

  const startGameBlock = mainSource.slice(
    mainSource.indexOf('function startGameNow('),
    mainSource.indexOf('app.scene3d = makeCourseScene('),
  );
  assert.match(startGameBlock,
    /app\.state = state;[\s\S]*?primeWalkConditionForState\(app\.state\);/,
    'the real state-derived label must be sized and painted behind the loading veil');
  assert.match(mainSource,
    /function primeWalkConditionForState\(state\)[\s\S]*?ovLast\.condText = conditionText;[\s\S]*?setPromptText\(walkCondition, conditionText\);/,
    'priming must update the cache so first entry cannot rebuild the label');

  const overlayBootBlock = mainSource.slice(
    mainSource.indexOf("walkPrompt = el('div', { class: 'shop-prompt'"),
    mainSource.indexOf('// BEHIND THE TILL'),
  );
  assert.ok(overlayBootBlock, 'the shipping walk overlay construction must remain discoverable');
  assert.match(overlayBootBlock,
    /walkCondition = el\('div', \{[\s\S]*?class: 'shop-cond', text: shopConditionLabel\(app\.state\), role: 'status',[\s\S]*?'aria-live': 'polite', 'aria-hidden': 'true'/,
    'the condition node must have paintable content before the first crossing');
  assert.match(overlayBootBlock, /walkCondition,\r?\n\s*walkLockHint,/,
    'that prepainted condition node must be the one appended to the shipping overlay');
  assert.doesNotMatch(overlayBootBlock, /class: 'shop-cond', text: '', style: 'display:none'/,
    'the appended overlay chip cannot defer its content and paint until entry');
});

test('shop-condition chip is an isolated opacity layer', () => {
  const rule = styleSource.match(/\.shop-cond\s*\{[\s\S]*?\r?\n}/)?.[0] || '';
  assert.ok(rule, 'shop-condition CSS rule must remain discoverable');
  assert.match(rule, /contain:\s*layout paint style/);
  assert.match(rule, /will-change:\s*opacity/);
  assert.match(rule, /opacity:\s*0\.004\b/,
    'a base above one 8-bit alpha step exercises the condition blend before entry');
  assert.doesNotMatch(rule, /opacity:\s*0\s*;/,
    'exact zero defers the first raster until the doorway reveal');
  assert.doesNotMatch(rule, /transition:[^;]*opacity/,
    'the first condition opacity animation compiles a full-screen Skia path at entry');
  const visibleRule = styleSource.match(/\.shop-cond\.is-visible\s*\{[\s\S]*?\r?\n}/)?.[0] || '';
  assert.match(visibleRule, /opacity:\s*0\.996\b/,
    'visible and prepainted states must share the translucent compositor path');
  assert.doesNotMatch(visibleRule, /opacity:\s*1\s*;/,
    'exact one lets Chromium defer an opaque-pipeline switch until first entry');
});

test('focus prompt keeps a painted compositing layer before pointer-lock reveal', () => {
  const rule = styleSource.match(/\.shop-prompt\s*\{[\s\S]*?\r?\n}/)?.[0] || '';
  assert.ok(rule, 'shop-prompt CSS rule must remain discoverable');
  assert.match(rule, /contain:\s*layout paint style/);
  assert.match(rule, /will-change:\s*opacity/);
  assert.match(rule, /opacity:\s*0\.004\b/,
    'a base above one 8-bit alpha step must exercise the prompt blend before focus reveal');
  assert.doesNotMatch(rule, /opacity:\s*0\s*;/,
    'exact zero lets Chromium defer the prompt compositor pipeline until player movement');
  assert.doesNotMatch(rule, /transition:[^;]*opacity/,
    'the first prompt opacity animation compiles a Skia shader on the cold approach');

  const overlayBootBlock = mainSource.slice(
    mainSource.indexOf("walkPrompt = el('div', { class: 'shop-prompt'"),
    mainSource.indexOf('// BEHIND THE TILL'),
  );
  assert.match(overlayBootBlock, /setPromptText\(walkPrompt, '\[E\] interact'\)/,
    'boot must build representative keycap and prompt content before gameplay');
  assert.match(overlayBootBlock, /walkOverlay = el\([\s\S]*?\r?\n\s*walkPrompt,/,
    'the prepainted prompt node must be the node appended to the shipping overlay');

  const promptUpdateBlock = mainSource.slice(
    mainSource.indexOf("const label = (placement?.hasCarriedBox()"),
    mainSource.indexOf("if (label?.includes('check in'))"),
  );
  assert.match(promptUpdateBlock, /const promptVisible = !!\(label && document\.pointerLockElement\)/);
  assert.match(promptUpdateBlock, /promptVisible \? '1' : '0\.004'/);
  assert.match(promptUpdateBlock,
    /setAttribute\('aria-hidden', promptVisible \? 'false' : 'true'\)/);
});
