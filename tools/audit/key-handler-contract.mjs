// H1's fault class, as a reusable checker: every bare identifier invoked inside
// a keydown handler must resolve to a module-scope definition or an import.
// Used by tests/main-key-handler-contract.test.js, and runnable directly:
//
//   node tools/audit/key-handler-contract.mjs <file.js>
//
// which is how the negative control is run against the pre-fix source.

export const GLOBALS = new Set([
  'requestAnimationFrame', 'cancelAnimationFrame',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'queueMicrotask', 'structuredClone', 'fetch', 'alert', 'confirm',
  'Number', 'String', 'Boolean', 'Array', 'Object', 'Math', 'JSON',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Promise', 'Set', 'Map',
  'Error', 'TypeError', 'RangeError', 'Date', 'Symbol', 'BigInt', 'RegExp',
]);

export const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'typeof', 'await',
  'function', 'delete', 'void', 'in', 'of', 'do', 'else', 'case', 'break',
  'continue', 'throw', 'try', 'finally', 'yield', 'super', 'this', 'import',
]);

export function definedNames(text) {
  const names = new Set();
  for (const m of text.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of text.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = (part.split(':').pop() || '').trim().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const name = (part.split(/\bas\b/).pop() || '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const m of text.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) names.add(m[1]);
  for (const m of text.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return names;
}

export function keydownHandlerBodies(text) {
  const bodies = [];
  for (const m of text.matchAll(/addEventListener\(\s*['"]keydown['"]/g)) {
    const start = text.indexOf('{', m.index);
    if (start < 0) continue;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) { bodies.push(text.slice(start, i + 1)); break; }
      }
    }
  }
  return bodies;
}

export function stripCommentsAndStrings(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

export function bareCalls(body) {
  const clean = stripCommentsAndStrings(body);
  const calls = new Set();
  for (const m of clean.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (KEYWORDS.has(name) || GLOBALS.has(name)) continue;
    calls.add(name);
  }
  return calls;
}

export function undefinedCallees(text) {
  const defined = definedNames(text);
  const bodies = keydownHandlerBodies(text);
  const missing = new Set();
  for (const body of bodies) {
    for (const name of bareCalls(body)) {
      if (!defined.has(name)) missing.add(name);
    }
  }
  return { missing: [...missing].sort(), handlerCount: bodies.length };
}

// CLI: node tools/audit/key-handler-contract.mjs <file.js>
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const { readFileSync } = await import('node:fs');
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node tools/audit/key-handler-contract.mjs <file.js>');
    process.exit(2);
  }
  const { missing, handlerCount } = undefinedCallees(readFileSync(target, 'utf8'));
  console.log(JSON.stringify({ target, handlerCount, missing }, null, 1));
  process.exit(missing.length ? 1 : 0);
}
