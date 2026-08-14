// 9.2 (Goal 26) — DOES THE PROMPT NAME SOMETHING THE CROSSHAIR IS NOWHERE NEAR?
//
// "The prompt bar is sticky -- it names objects the crosshair is nowhere near.
// You have documented that walkStationPropInReach does this deliberately. I AM
// OVERRULING IT: THE CROSSHAIR DECIDES THE PROMPT. A station in reach may keep
// working for E without claiming the prompt."
//
// I hit this by accident staging another driver: standing INSIDE the clubhouse at
// the counter, the focus label read "Weeds - [E] pull them". That is the exact
// symptom, and it is what this reproduces on purpose.
//
// THE MEASUREMENT IS AN ANGLE, not a vibe. For whatever the prompt names, the
// bearing from the player to that prop is compared against where the player is
// actually looking. A prompt naming something more than ~50 degrees off the
// crosshair is naming something the player is not looking at.
//
// BOTH HALVES ARE CHECKED, because the owner asked for both: the prompt must stop
// naming unaimed stations, AND E must still work at a station in reach. A fix
// that satisfies only the first would break the counter.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-sticky-prompt.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/sticky-prompt');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], samples: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(5000);

  // Stand at each station in turn and sweep the view around a full circle. At
  // every heading, ask what the prompt names and how far off the crosshair that
  // thing actually is.
  out.sweep = await page.evaluate(async () => {
    const s3 = window.__fw.scene3d;
    const walk = s3.walk;
    const stations = walk.stations() || [];
    const rows = [];
    for (const st of stations) {
      // stand just inside the station's own radius
      walk.state.x = st.x + (st.r || 1) * 0.5;
      walk.state.z = st.z;
      walk.state.vx = 0; walk.state.vz = 0;
      walk.state.pitch = 0;
      for (let step = 0; step < 16; step += 1) {
        const yaw = (step / 16) * Math.PI * 2;
        walk.state.yaw = yaw;
        await new Promise((done) => setTimeout(done, 60));
        // THE ANGLE MUST BE TO THE THING THE PROMPT NAMES, not to the station the
        // player happens to be standing at. My first version measured the latter,
        // so a perfectly correct prompt about the laptop scored as a 180-degree
        // lie about the tee desk -- 34 of 47 samples "sticky" on a build where
        // nothing was wrong. focusInfo() reports the named prop's own position.
        const info = walk.focusInfo?.() ?? null;
        const label = info?.label ?? null;
        if (!info || info.x == null) {
          rows.push({
            station: `${st.x.toFixed(1)},${st.z.toFixed(1)}`,
            yawDeg: Math.round(yaw * (180 / Math.PI)),
            offAxisDeg: null,
            label: label ? String(label).slice(0, 44) : null,
            viaCrosshair: info?.viaCrosshair ?? null,
          });
          continue;
        }
        const dx = info.x - walk.state.x;
        const dz = info.z - walk.state.z;
        const dist = Math.hypot(dx, dz) || 1;
        const lookX = -Math.sin(yaw);
        const lookZ = -Math.cos(yaw);
        const dot = ((dx / dist) * lookX) + ((dz / dist) * lookZ);
        const offDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
        rows.push({
          station: `${st.x.toFixed(1)},${st.z.toFixed(1)}`,
          yawDeg: Math.round(yaw * (180 / Math.PI)),
          offAxisDeg: Math.round(offDeg),
          label: label ? String(label).slice(0, 44) : null,
          viaCrosshair: info.viaCrosshair,
        });
      }
    }
    return rows;
  });

  // A prompt is "sticky" when it names something while the player is looking well
  // away from it. 50 degrees is generous: the crosshair cone in this game is far
  // tighter, and a threshold that forgiving cannot produce a false positive.
  const labelled = out.sweep.filter((r) => r.label && Number.isFinite(r.offAxisDeg));
  const sticky = labelled.filter((r) => r.offAxisDeg > 50);
  out.verdict = {
    samples: out.sweep.length,
    labelledSamples: labelled.length,
    stickySamples: sticky.length,
    stickyRatio: labelled.length ? +(sticky.length / labelled.length).toFixed(3) : null,
    worst: sticky.slice().sort((a, b) => b.offAxisDeg - a.offAxisDeg)[0] || null,
    examples: sticky.slice(0, 6),
  };

  // ...AND E MUST STILL WORK AT A STATION IN REACH, which is the half a naive fix
  // breaks. Stand at a station, look 90 degrees away, and confirm the game still
  // reports a station in reach for the action path.
  out.reachStillWorks = await page.evaluate(async () => {
    const walk = window.__fw.scene3d.walk;
    const stations = walk.stations() || [];
    if (!stations.length) return null;
    const st = stations[0];
    walk.state.x = st.x + (st.r || 1) * 0.4;
    walk.state.z = st.z;
    walk.state.yaw = Math.PI / 2; // deliberately not at it
    await new Promise((done) => setTimeout(done, 200));
    return {
      stationInReach: !!walk.stationInReach?.(),
      promptLabel: walk.getFocusLabel?.() ?? null,
    };
  });
  console.log('STICKY-PROMPT', JSON.stringify(out.verdict, null, 2));
  console.log('REACH-STILL-WORKS', JSON.stringify(out.reachStillWorks));
  fs.writeFileSync(path.join(OUT, 'sticky-prompt.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
