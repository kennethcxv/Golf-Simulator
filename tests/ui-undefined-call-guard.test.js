// Guards against calling a helper that was never written.
//
// The course editor's Tee / Green / Bunker / Water tools each called a `zr(...)`
// dirty-rect helper that existed in no module. Because the call sat on the tool's
// SUCCESS branch, the edit mutated the course and charged the player, then the
// ReferenceError aborted the refresh — so the tool looked like a dead button.
//
// Every editor test in the suite passed through it, because they assert against
// file TEXT (`sourceBetween`) and never execute a pointer handler. No amount of
// that style of test can catch an undefined callee.
//
// This is deliberately a conservative scope check, not a parser: a called bare
// identifier must be declared SOMEWHERE in its own module, imported, or be a
// known runtime global. It cannot detect shadowing or block-scope misuse, and it
// is not trying to. It detects "this function does not exist", which is the
// defect class that actually shipped.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = [
  'src/ui/courseEditor.js',
  'src/ui/courseCameraState.js',
  'src/sim/courseEditor.js',
  'src/sim/courseCamera.js',
  'src/sim/courseEditorObjectPlacement.js',
  'src/sim/coursePathCoordinates.js',
  'src/sim/courseLandscape.js',
  'src/render3d/floraLod.js',
  'src/render3d/courseEditorPreviewGeometry.js',
  'src/render3d/courseBridgeGeometry.js',
  'src/render3d/courseWaterReflectionGuard.js',
];

// Control-flow and operator keywords that are followed by `(` but are not calls.
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
  'new', 'do', 'else', 'delete', 'void', 'await', 'yield', 'throw', 'in',
  'of', 'instanceof', 'case', 'with', 'super', 'import', 'export', 'const',
  'let', 'var', 'class', 'extends', 'try', 'finally', 'break', 'continue',
  'async',
]);

const RUNTIME_GLOBALS = new Set([
  ...Object.getOwnPropertyNames(globalThis),
  // Browser globals this codebase legitimately uses; Node cannot enumerate them.
  'window', 'document', 'navigator', 'location', 'history', 'localStorage',
  'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'alert',
  'confirm', 'prompt', 'getComputedStyle', 'matchMedia', 'Image', 'Audio',
  'Event', 'CustomEvent', 'PointerEvent', 'MouseEvent', 'KeyboardEvent',
  'WheelEvent', 'ResizeObserver', 'MutationObserver', 'IntersectionObserver',
  'DOMParser', 'XMLHttpRequest', 'Worker', 'Blob', 'FileReader', 'Path2D',
  'HTMLElement', 'HTMLCanvasElement', 'CanvasRenderingContext2D', 'devicePixelRatio',
]);

// Strip comments and string/template literals so their contents never look like code.
function stripNonCode(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = null; // 'line' | 'block' | '"' | "'" | '`' | 'regex'
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === null) {
      if (c === '/' && d === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { mode = 'block'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { mode = c; i += 1; out += ' '; continue; }
      out += c; i += 1; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = null; out += '\n'; } i += 1; continue; }
    if (mode === 'block') {
      if (c === '*' && d === '/') { mode = null; i += 2; out += ' '; continue; }
      if (c === '\n') out += '\n';
      i += 1; continue;
    }
    // inside a string/template
    if (c === '\\') { i += 2; continue; }
    if (c === mode) { mode = null; out += ' '; i += 1; continue; }
    if (c === '\n') out += '\n';
    i += 1;
  }
  return out;
}

// Index of the `)` matching the `(` at openIdx, or -1. Comments and strings are
// already gone, so a plain depth count is sound here.
function matchParen(code, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Every identifier that is bound anywhere in the module: declarations, function
// and catch params, destructuring targets, import bindings, labels, class names.
function declaredNames(code) {
  const names = new Set();
  const add = (s) => { if (s) names.add(s); };

  for (const m of code.matchAll(/\b(?:function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  // import { a, b as c } from '...'  /  import d from '...'  /  import * as ns
  for (const m of code.matchAll(/\bimport\s+([^;]+?)\s+from\b/g)) {
    for (const part of m[1].split(/[,{}]/)) {
      const t = part.trim().replace(/^\*\s*as\s+/, '');
      const asName = t.split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(asName)) add(asName);
    }
  }
  // Parameter lists only — NOT every parenthesised group. Collecting identifiers
  // from any `(...)` would sweep in the callee names sitting in argument lists
  // (`refreshGround(..., zr(...))` would "declare" zr) and the check could never
  // fail. So resolve each paren to its true match, then keep only the ones in a
  // binding position: `function f(...)`, `catch (...)`, `(...) =>`, `method(...) {`.
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '(') continue;
    const close = matchParen(code, i);
    if (close < 0) continue;
    const before = code.slice(0, i).replace(/\s+$/, '');
    const after = code.slice(close + 1).replace(/^\s+/, '');
    const isFn = /\bfunction(\s*\*)?(\s+[A-Za-z_$][\w$]*)?$/.test(before);
    const isCatch = /\bcatch$/.test(before);
    const isArrow = after.startsWith('=>');
    const owner = before.match(/([A-Za-z_$][\w$]*)$/);
    const isMethod = Boolean(owner) && !KEYWORDS.has(owner[1]) && after.startsWith('{');
    if (!isFn && !isCatch && !isArrow && !isMethod) continue;
    // Names followed by `(` inside a default value are callees, not bindings.
    const params = code.slice(i + 1, close);
    for (const id of params.matchAll(/([A-Za-z_$][\w$]*)/g)) {
      const rest = params.slice(id.index + id[1].length).replace(/^\s+/, '');
      if (!rest.startsWith('(')) add(id[1]);
    }
  }
  for (const m of code.matchAll(/\{([^{}]*)\}/g)) {
    for (const id of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*[,:}=]/g)) add(id[1]);
  }
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(?:function|\()/g)) add(m[1]);
  return names;
}

// Bare `name(` calls — not `.name(`, not `?.name(`, not a keyword.
function calledNames(code) {
  const calls = new Map(); // name -> first line number
  const lines = code.split('\n');
  for (let ln = 0; ln < lines.length; ln++) {
    for (const m of lines[ln].matchAll(/(^|[^.\w$?])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[2];
      if (KEYWORDS.has(name)) continue;
      if (!calls.has(name)) calls.set(name, ln + 1);
    }
  }
  return calls;
}

for (const file of FILES) {
  test(`${file} calls no helper that was never defined`, () => {
    const code = stripNonCode(readFileSync(file, 'utf8'));
    const declared = declaredNames(code);
    const missing = [];
    for (const [name, line] of calledNames(code)) {
      if (declared.has(name) || RUNTIME_GLOBALS.has(name)) continue;
      missing.push(`${file}:${line} calls ${name}() - not declared, imported, or a runtime global`);
    }
    assert.deepEqual(missing, [], `undefined callee(s):\n  ${missing.join('\n  ')}`);
  });
}
