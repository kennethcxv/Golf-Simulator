// C (Goal 23) — THE CSP IS PINNED, BECAUSE I JUST WIDENED IT.
//
// Nothing in this repository guarded the Content-Security-Policy. It was
// widened tonight to add 'wasm-unsafe-eval' so recast-navigation's WASM can
// compile, and a security directive that can be widened again by anybody
// without a test noticing is exactly the kind of drift the golden gate turned
// out to be suffering from in a different form.
//
// So the policy is asserted directive by directive. Adding a source now means
// changing this file, which means someone reads the reason.
//
// WHY 'wasm-unsafe-eval' IS ACCEPTABLE HERE AND 'unsafe-eval' IS NOT:
//
//   * 'wasm-unsafe-eval' permits WebAssembly compilation ONLY. It does not
//     permit eval() of strings, new Function(), or setTimeout("...").
//     'unsafe-eval' permits all of those and was DECLINED for KTX2.
//   * The page loads over file:// with default-src 'self' and no remote script
//     source, under contextIsolation with nodeIntegration off and sandbox on.
//     There is no path by which attacker-controlled bytes reach the compiler.
//   * The alternative is shipping hand-rolled navigation for a fifth time.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const match = /<meta http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]+)"/.exec(html);

const directives = () => {
  assert.ok(match, 'index.html must carry a Content-Security-Policy meta tag');
  const out = new Map();
  for (const part of match[1].split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    out.set(tokens[0], tokens.slice(1));
  }
  return out;
};

test('the policy exists and names every directive it should', () => {
  const d = directives();
  for (const name of ['default-src', 'connect-src', 'img-src', 'style-src', 'script-src', 'worker-src']) {
    assert.ok(d.has(name), `${name} must be declared rather than inherited`);
  }
  assert.deepEqual(d.get('default-src'), ["'self'"], 'the default stays self');
});

test('script-src permits WASM COMPILATION and nothing more', () => {
  const src = directives().get('script-src');
  assert.ok(src.includes("'self'"), 'own scripts');
  assert.ok(src.includes("'wasm-unsafe-eval'"),
    'WebAssembly compilation, for recast-navigation (see the header of this file)');
  // THE LINE THAT MATTERS. 'unsafe-eval' is a superset that also enables
  // eval() and new Function(); it was declined for KTX2 and stays declined.
  assert.ok(!src.includes("'unsafe-eval'"),
    "'unsafe-eval' permits eval() of strings and must never be added");
  assert.ok(!src.includes("'unsafe-inline'"),
    "'unsafe-inline' in script-src would defeat the hash below it");
  assert.ok(src.some((s) => s.startsWith("'sha256-")),
    'the one inline script is admitted by hash, not by blanket permission');
  // no remote origins
  for (const source of src) {
    assert.ok(!/^https?:/.test(source), `script-src must not name a remote origin (${source})`);
  }
});

test('no directive quietly admits a remote origin', () => {
  for (const [name, sources] of directives()) {
    for (const source of sources) {
      assert.ok(!/^https?:\/\//.test(source),
        `${name} names ${source}; this game loads from file:// and should reach nothing`);
    }
  }
});

test('style-src still carries its inline exception, and script-src does not', () => {
  // Recorded rather than fixed: the stylesheet uses inline style attributes.
  // The point of the test is that the two are not confused for each other.
  const d = directives();
  assert.ok(d.get('style-src').includes("'unsafe-inline'"));
  assert.ok(!d.get('script-src').includes("'unsafe-inline'"));
});
