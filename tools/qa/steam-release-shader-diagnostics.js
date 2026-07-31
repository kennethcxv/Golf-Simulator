async (page) => {
  await page.addInitScript(() => {
    window.__shaderDiagnostics = [];
    const seen = new WeakSet();
    const instrument = (proto) => {
      if (!proto || proto.__golfShaderInstrumented) return;
      Object.defineProperty(proto, '__golfShaderInstrumented', { value: true });
      const getProgramInfoLog = proto.getProgramInfoLog;
      proto.getProgramInfoLog = function instrumentedProgramLog(program) {
        const log = getProgramInfoLog.call(this, program);
        if (log?.trim() && !seen.has(program)) {
          seen.add(program);
          const shaders = this.getAttachedShaders(program).map((shader) => ({
            type: this.getShaderParameter(shader, this.SHADER_TYPE) === this.VERTEX_SHADER
              ? 'vertex' : 'fragment',
            source: this.getShaderSource(shader) || '',
            log: this.getShaderInfoLog(shader) || '',
          }));
          window.__shaderDiagnostics.push({ kind: 'program', log, shaders });
        }
        return log;
      };
    };
    instrument(globalThis.WebGLRenderingContext?.prototype);
    instrument(globalThis.WebGL2RenderingContext?.prototype);
  });

  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/');
  await page.waitForTimeout(1200);
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d, null, { timeout: 40000 });
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || veil.style.display === 'none' || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 40000 });
  await page.waitForTimeout(2500);

  const diagnostics = await page.evaluate(() => window.__shaderDiagnostics.map((record) => ({
    kind: record.kind,
    log: record.log,
    shaders: record.shaders.map((shader) => {
      const lines = shader.source.split('\n');
      const shaderName = shader.source.match(/#define\s+SHADER_NAME\s+([^\s]+)/)?.[1] || null;
      const dynamicIndexLines = [];
      for (let i = 0; i < lines.length; i++) {
        if (/\[[^\]0-9][^\]]*\]/.test(lines[i])) {
          dynamicIndexLines.push(`${i + 1}: ${lines[i].trim()}`);
        }
      }
      return {
        type: shader.type,
        shaderName,
        log: shader.log,
        lineCount: lines.length,
        dynamicIndexLines: dynamicIndexLines.slice(0, 80),
      };
    }),
  })));
  return { ok: true, diagnostics };
}
