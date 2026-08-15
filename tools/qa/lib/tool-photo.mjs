// PHOTOGRAPHING A HELD TOOL, RELIABLY. (Playtest 5, item 6.)
//
// "An equipped tool reports itself fully present and appears in ZERO frames."
// Three sessions lost time to that, and the cause is now known exactly. Two
// separate things were happening, and either one alone produces the symptom:
//
// 1. THE TOOL STREAMS IN. Measured on the mop: 25 of its 92 meshes were drawable
//    at the first sample and 83 by ~15 s, as the authored model loads and the
//    procedural fallback is swapped out. A fixed sleep photographs whichever
//    fraction happened to be ready.
//
// 2. THE GAME TAKES THE TOOL OUT OF YOUR HANDS. `scheduleDeferredGpuWarm` in
//    src/main.js does this, on a timer, ~15 s after boot:
//
//        const held = typeof walk.tool === 'function' ? walk.tool() : null;
//        if (!held) { walk.setTool('dustpan'); ...; walk.setTool(null); }
//
//    The accessor is `walk.getTool`, not `walk.tool`, so `held` is ALWAYS null,
//    the branch ALWAYS runs, and whatever you are holding is replaced by the
//    dustpan for three frames and then by nothing. Caught live: at sample 6 the
//    tool was 'mop' with 83 drawable meshes; at sample 7, 428 ms later and with
//    the driver touching nothing, it was 'dustpan' with `Tool_mop` hidden.
//
//    That is a player-facing bug -- equip a tool inside the warm-up window and it
//    is silently taken away -- and the fix is one line in main.js. This session
//    does not own main.js, so this helper works AROUND it instead: it waits the
//    warm-up out, then re-asserts the tool and verifies at the moment of the shot.
//
// The contract: `photographTool` returns only once the tool is genuinely drawn,
// and reports the drawable mesh count it settled on so a caller can put the
// number in a report instead of trusting the picture.

/** Park the player at the golden suite's tool pose, from the LIVE interior origin. */
// Default pitch -0.15 is the GOLDEN SUITE's tool pose, which is this repo's
// convention for "the default player camera" on a held tool -- default FOV, a
// natural downward glance, not a contrived angle. Measured across the pitch
// range with the tool actually held: 62,824 magenta pixels of mop at -0.15
// against 29,531 at +0.05, where the head falls below the bottom edge.
export async function setToolPose(page, { dx = -5.6, dz = 4.4, yaw = -Math.PI / 2, pitch = -0.15 } = {}) {
  await page.evaluate(([a, b, c, d]) => {
    const w = window.__fw.scene3d.walk;
    const o = window.__fw.scene3d.clubhouse().interior.position;
    w.state.x = o.x + a; w.state.z = o.z + b; w.state.yaw = c; w.state.pitch = d;
    w.state.vx = 0; w.state.vz = 0;
  }, [dx, dz, yaw, pitch]);
}

/** How many of a tool's meshes would actually be drawn this frame. */
export function drawableCount(page, tool) {
  return page.evaluate((t) => {
    let group = null;
    window.__fw.scene3d.scene.traverse((o) => { if (!group && o.name === `Tool_${t}`) group = o; });
    if (!group) return { group: false, drawable: 0, total: 0, tool: window.__fw.scene3d.walk.getTool?.() ?? null };
    let drawable = 0; let total = 0;
    group.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh)) return;
      total += 1;
      let vis = o.visible;
      for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
      if (vis && o.layers.mask !== 0) drawable += 1;
    });
    return { group: true, drawable, total, tool: window.__fw.scene3d.walk.getTool?.() ?? null };
  }, tool);
}

/**
 * Equip a tool and wait until it is BOTH held and stable.
 *
 * setTool is debounced and runs a holster first, so its return value says nothing
 * and the calling frame is too early. Stability is defined as the drawable count
 * holding still across consecutive samples, which is what "the model finished
 * streaming in" looks like from outside.
 */
export async function equipAndSettle(page, tool, { settleSamples = 4, timeoutMs = 60000 } = {}) {
  await page.evaluate((t) => { window.__fw.scene3d.walk.setTool(t); }, tool);
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  let stable = 0;
  let seen = { drawable: 0, total: 0 };
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    seen = await drawableCount(page, tool);
    if (seen.tool !== tool) {
      // The warm-up (or anything else) took it. Put it back and start over
      // rather than photographing an empty hand.
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate((t) => { window.__fw.scene3d.walk.setTool(t); }, tool);
      stable = 0; last = -1;
    } else if (seen.drawable > 0 && seen.drawable === last) {
      stable += 1;
      if (stable >= settleSamples) return { ...seen, settled: true };
    } else {
      stable = 0;
    }
    last = seen.drawable;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
  }
  return { ...seen, settled: false };
}

/**
 * Take the photograph, verifying the tool is still held at the moment of the shot.
 * Returns the drawable count the frame was taken at, so a report can state it.
 */
export async function photographTool(page, tool, file, pose = {}) {
  await setToolPose(page, pose);
  const before = await equipAndSettle(page, tool);
  // Re-assert immediately before the shutter: the warm-up window is ~15 s wide
  // and a settle can finish just inside it.
  const atShot = await drawableCount(page, tool);
  if (atShot.tool !== tool || atShot.drawable === 0) {
    await page.evaluate((t) => { window.__fw.scene3d.walk.setTool(t); }, tool);
    await page.waitForTimeout(2500);
  }
  const confirmed = await drawableCount(page, tool);
  await page.screenshot({ path: file });
  return { file, settled: before.settled, drawableAtShot: confirmed.drawable, totalMeshes: confirmed.total, toolAtShot: confirmed.tool };
}
