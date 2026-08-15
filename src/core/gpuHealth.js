// GPU HEALTH — when acceleration dies, SAY SO.
//
// The owner played an entire session at "literally 3 fps" and reported it as
// lag. It was not lag: his log carried `GPU state invalid after
// WaitForGetOffsetInRange`, a GPU process loss, after which Chromium carries on
// under SwiftShader — software rendering, which on this scene is single-digit
// frame rates from the first frame. Nothing anywhere in the game noticed, so a
// driver-level failure spent a night masquerading as a performance regression
// and was hunted through the codebase.
//
// Every check the harness could take said healthy: his save at 63 fps, hardware
// ANGLE/D3D11 on the same machine, the same build. The one thing that could not
// be seen from outside was the state of HIS session's GPU process. So the game
// now watches the two observable forms of that failure:
//
//   * the context is LOST mid-session (webglcontextlost)
//   * the context comes up in SOFTWARE from the first frame
//
// and reports both through the fault log (so crash.log names it, the way it
// named the checkout refusal) and to the player (so "the game is broken" becomes
// "graphics acceleration failed, restart").

// Pure, so the strings that mean "software" are testable without a GL context.
// The known software renderer names Chromium can fall back to:
// SwiftShader (the standard fallback), plus llvmpipe/softpipe (Mesa) and the
// Microsoft Basic Render Driver (Windows' last resort).
export function isSoftwareRendererString(rendererString) {
  const value = String(rendererString || '');
  return /swiftshader|llvmpipe|softpipe|software\s*(rasterizer|renderer|adapter)|microsoft basic render/i
    .test(value);
}

export function readGpuInfo(gl) {
  if (!gl) return { renderer: null, software: false, contextLost: false };
  let renderer = null;
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = info
      ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
  } catch { /* a context that cannot answer is reported as unknown, not thrown */ }
  let contextLost = false;
  try { contextLost = gl.isContextLost(); } catch { /* same */ }
  return { renderer, software: isSoftwareRendererString(renderer), contextLost };
}

/**
 * Attach once per scene. `report(origin, message, extra)` feeds the fault log;
 * `notify(kind)` is the player-facing channel ('context-lost' | 'software') and
 * the caller owns the localized wording. Returns a dispose.
 */
export function watchGpuHealth({ canvas, gl, report, notify }) {
  const seen = { software: false, lost: false };
  const boot = readGpuInfo(gl);
  if (boot.software && !seen.software) {
    seen.software = true;
    report?.('gpu.software-rendering', `WebGL is software-rendered: ${boot.renderer}`, { renderer: boot.renderer });
    notify?.('software');
  }
  const onLost = (event) => {
    // preventDefault tells the browser a restore may be attempted; without it
    // some drivers never even try.
    try { event.preventDefault(); } catch { /* report regardless */ }
    if (!seen.lost) {
      seen.lost = true;
      report?.('gpu.context-lost', 'The WebGL context was lost mid-session.', { renderer: boot.renderer });
      notify?.('context-lost');
    }
  };
  const onRestored = () => {
    seen.lost = false;
    report?.('gpu.context-restored', 'The WebGL context was restored.', {});
  };
  canvas?.addEventListener?.('webglcontextlost', onLost, false);
  canvas?.addEventListener?.('webglcontextrestored', onRestored, false);
  return () => {
    canvas?.removeEventListener?.('webglcontextlost', onLost, false);
    canvas?.removeEventListener?.('webglcontextrestored', onRestored, false);
  };
}
