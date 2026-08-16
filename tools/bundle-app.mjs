// GOAL 28 PHASE 1 — BUNDLE THE APP MODULE GRAPH.
//
// The renderer parsed a ~290-module / 8.2 MB unbundled ESM graph from disk on
// every boot — ~2 s of renderer-start -> menu-interactive on BOTH tiers, the
// attribution said, and degradation-independent. This collapses the graph to
// one tracked file, the same pattern as the vendored three build: generated
// artifact, committed, drift-gated by --check in the regression gate.
//
//   node tools/bundle-app.mjs            build vendor/app/main.bundle.js
//   node tools/bundle-app.mjs --check    rebuild to temp, byte-compare, exit 1 on drift
//
// Externals: `three` and `three/addons/*` stay bare — index.html's import map
// owns them (CLAUDE.md rule). Debug modules and recast load dynamically via
// document.baseURI URLs, so they resolve from the page root in both worlds.
// Sourcemap rides beside the bundle for stack traces.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'vendor', 'app', 'main.bundle.js');
const CHECK = process.argv.includes('--check');

async function bundleTo(outfile) {
  const result = await build({
    entryPoints: [path.join(ROOT, 'src', 'main.js')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'esnext',
    external: ['three', 'three/addons/*'],
    sourcemap: 'linked',
    logLevel: 'silent',
    metafile: true,
    // no minify: the bundle stays diffable and stack traces stay readable;
    // the win here is request count, not bytes
    minify: false,
  });
  return result.metafile;
}

if (!CHECK) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const meta = await bundleTo(OUT);
  const inputs = Object.keys(meta.inputs).length;
  const bytes = fs.statSync(OUT).size;
  console.log(`bundled ${inputs} modules -> ${path.relative(ROOT, OUT)} (${(bytes / 1048576).toFixed(2)} MB)`);
} else {
  const tmpDir = fs.mkdtempSync(path.join(ROOT, 'vendor', 'app', 'check-'));
  const tmp = path.join(tmpDir, 'main.bundle.js');
  try {
    await bundleTo(tmp);
    const fresh = fs.readFileSync(tmp);
    const committed = fs.existsSync(OUT) ? fs.readFileSync(OUT) : Buffer.alloc(0);
    if (!fresh.equals(committed)) {
      console.error('app bundle DRIFTED: src/ changed without rebuilding vendor/app/main.bundle.js — run node tools/bundle-app.mjs');
      process.exit(1);
    }
    console.log('app bundle up to date');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
