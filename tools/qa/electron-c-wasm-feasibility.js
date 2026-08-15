// C (Goal 23) — CAN THIS BUILD RUN WEBASSEMBLY AT ALL?
//
// recast-navigation-js is the industry answer and the only one of the three
// candidates that can BAKE A NAVMESH FROM ARBITRARY GEOMETRY — which is what
// the brief asks for. yuka and three-pathfinding both consume a navmesh someone
// else authored. So the whole choice turns on one question, and it is a question
// about this repository rather than about the libraries.
//
// The shipped CSP is:
//   script-src 'self' 'sha256-...'
// with no 'wasm-unsafe-eval'. Under CSP, WebAssembly compilation is governed by
// script-src, and a policy without wasm-unsafe-eval (or unsafe-eval) refuses it.
//
// I am not going to assert that from the header text. This instantiates a real
// four-byte-header WebAssembly module inside the shipped page and reports what
// actually happens — a claim about a security policy is worth exactly as much as
// a claim about a rendering path, which is to say nothing until it is run.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-c-wasm-feasibility.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/c-wasm');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  await page.waitForFunction(() => !!document.querySelector('canvas'), null, { timeout: 120000 });
  await page.waitForTimeout(1500);

  out.result = await page.evaluate(async () => {
    const report = { csp: null, hasWebAssembly: typeof WebAssembly !== 'undefined' };
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    report.csp = meta ? meta.getAttribute('content') : null;

    // The smallest valid module: magic number + version, no sections.
    const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

    try {
      // eslint-disable-next-line no-new
      new WebAssembly.Module(bytes);
      report.syncCompile = 'allowed';
    } catch (e) { report.syncCompile = `refused: ${e.name}: ${e.message}`; }

    try {
      await WebAssembly.compile(bytes);
      report.asyncCompile = 'allowed';
    } catch (e) { report.asyncCompile = `refused: ${e.name}: ${e.message}`; }

    try {
      await WebAssembly.instantiate(bytes);
      report.instantiate = 'allowed';
    } catch (e) { report.instantiate = `refused: ${e.name}: ${e.message}`; }

    // Streaming from a blob: the path an emscripten build usually takes.
    try {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
      await WebAssembly.instantiateStreaming(fetch(url));
      URL.revokeObjectURL(url);
      report.instantiateStreaming = 'allowed';
    } catch (e) { report.instantiateStreaming = `refused: ${e.name}: ${e.message}`; }

    return report;
  });

  const r = out.result;
  out.verdict = {
    wasmUsable: r.instantiate === 'allowed' || r.instantiateStreaming === 'allowed',
    cspMentionsWasm: /wasm-unsafe-eval|unsafe-eval/.test(r.csp || ''),
    detail: {
      syncCompile: r.syncCompile,
      asyncCompile: r.asyncCompile,
      instantiate: r.instantiate,
      instantiateStreaming: r.instantiateStreaming,
    },
  };
  fs.writeFileSync(path.join(OUT, 'wasm-feasibility.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('C-WASM', JSON.stringify(out.verdict, null, 2));
  return out;
}
