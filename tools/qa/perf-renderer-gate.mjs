// The shared renderer gate (HARNESS_TRUST.md rule 5, 2026-07-28).
//
// Headless runs through run-playwright.cjs get no GPU flags, so WebGL is
// SwiftShader — a CPU rasterizer. Absolute frame numbers from it are not
// evidence about the live game, and until this gate existed nothing failed on
// that: perf harnesses recorded the renderer string and every consumer had to
// remember to read it. Now a performance harness calls gateRenderer(page) once
// after boot:
//
//   - real GPU        → returns { gpu, software: false }, run proceeds
//   - software GPU    → THROWS unless the run is declared software-relative
//                       (pass { allowSoftware: true } — the harness pins its
//                       own swiftshader flags and claims relative numbers
//                       only) or the operator overrode with
//                       PERF_ALLOW_SOFTWARE=1 (the result then carries
//                       software: true and must be labelled).
//
// Function-files import this with:
//   const { gateRenderer } = await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/perf-renderer-gate.mjs`);

const SOFTWARE_PATTERN = /swiftshader|llvmpipe|software|basic render/i;
const UNAVAILABLE_PATTERN = /^(?:no-context|masked|unknown|unavailable)?$/i;

export async function readGpuString(page) {
  return page.evaluate(() => {
    const gl = window.__fw?.scene3d?.renderer?.getContext?.();
    if (!gl) return 'no-context';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'masked';
  });
}

export async function gateRenderer(page, {
  allowSoftware = false,
  electronGpuFeatureStatus = null,
  requireElectronStatus = false,
} = {}) {
  const gpu = await readGpuString(page);
  const software = SOFTWARE_PATTERN.test(gpu);
  const unavailable = UNAVAILABLE_PATTERN.test(String(gpu || '').trim());
  if (unavailable) {
    throw new Error(
      `performance run refused: hardware renderer identity is unavailable (${gpu || 'empty'}). `
      + 'Absolute frame numbers require a real, positively identified WebGL renderer.',
    );
  }
  if (software && !allowSoftware && process.env.PERF_ALLOW_SOFTWARE !== '1') {
    throw new Error(
      `performance run refused: renderer is software (${gpu}). `
      + 'Absolute frame numbers from a CPU rasterizer are not live evidence. '
      + 'Run HEADED=1 on real hardware, or declare the harness software-relative, '
      + 'or override with PERF_ALLOW_SOFTWARE=1 and label the result.',
    );
  }
  const featureStatus = electronGpuFeatureStatus && typeof electronGpuFeatureStatus === 'object'
    ? JSON.parse(JSON.stringify(electronGpuFeatureStatus)) : null;
  if (requireElectronStatus && !featureStatus) {
    throw new Error(
      'performance run refused: Electron GPU feature status is unavailable; '
      + 'WebGL identity alone cannot prove the compositor path.',
    );
  }
  const requiredFeatures = ['gpu_compositing', 'webgl'];
  const nonHardwareFeatures = featureStatus ? requiredFeatures.filter((key) => (
    featureStatus[key] !== 'enabled'
  )) : [];
  if (nonHardwareFeatures.length > 0) {
    throw new Error(
      `performance run refused: Electron GPU features are not hardware-enabled: ${nonHardwareFeatures
        .map((key) => `${key}=${featureStatus[key] ?? 'missing'}`).join(', ')}.`,
    );
  }
  return {
    gpu,
    software,
    positivelyIdentified: true,
    electronGpuFeatureStatus: featureStatus,
    electronHardwareFeaturesProven: featureStatus ? nonHardwareFeatures.length === 0 : null,
  };
}
