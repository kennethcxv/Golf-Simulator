// ADVERSARIAL VERIFIER 1 (throwaway) — E2 footsteps on real input.
// Reads the PRODUCT's own window.__fwFootsteps log (main.js writes it on every
// footstep hook fire). Legs: outdoors 4 s, indoors 2.5 s, wall-push 2 s into
// the till counter (must add ZERO cues). Surface truth per cue re-derived from
// clubhouse().groundYAt at the logged coordinates. Teleports/yaw sets are
// declared staging; the walking itself is a real held W.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/verify-v1');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  out.menu = await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(2200);
  out.ownerRes = (await boot.ownerResolution(page)).caption;
  await page.bringToFront().catch(() => {});
  const cbox = await (await page.$('canvas')).boundingBox();
  const cx = Math.round(cbox.x + cbox.width / 2);
  const cy = Math.round(cbox.y + cbox.height / 2);

  out.spawn = await page.evaluate(() => {
    const w = window.__fw.scene3d.walk.state;
    return { x: +w.x.toFixed(2), z: +w.z.toFixed(2), yaw: +w.yaw.toFixed(3) };
  });
  out.audioReady = await page.evaluate(() => window.__fw.audio?.ready ?? 'not-exposed');
  out.strideRate = await page.evaluate(async () => {
    try {
      const loco = await import(new URL('src/data/locomotion.js', document.baseURI).href);
      return loco.STRIDE_RATE_RAD_S || null;
    } catch { return null; }
  });

  const footLeg = async (name, telePort, yaw, holdMs, shot) => {
    await page.evaluate(([tp, y]) => {
      const w = window.__fw.scene3d.walk.state;
      w.cameraBob = true;
      w.reducedMotion = false;
      if (tp) { w.x = tp.x; w.z = tp.z; }
      if (y != null) w.yaw = y;
      w.pitch = -0.05;
      window.__fwFootsteps = [];
      window.__legStart = { x: w.x, z: w.z, t: performance.now() };
    }, [telePort, yaw]);
    await page.waitForTimeout(350);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(280);
    await page.keyboard.down('w');
    await page.waitForTimeout(holdMs);
    await page.keyboard.up('w');
    await page.waitForTimeout(320);
    const read = await page.evaluate(() => {
      const s3 = window.__fw.scene3d;
      const w = s3.walk.state;
      const cues = (window.__fwFootsteps || []).slice();
      const ch = s3.clubhouse?.();
      const slabAt = ch && ch.groundYAt ? (x, z) => ch.groundYAt(x, z) : null;
      let agree = 0; let known = 0;
      const rows = cues.map((c) => {
        let truth = null;
        if (slabAt && c.x != null) {
          known += 1;
          const slab = slabAt(c.x, c.z);
          truth = (slab !== null && slab !== undefined) ? 'boards' : 'turf';
          if (truth === c.surface) agree += 1;
        }
        return { at: Math.round(c.at), surface: c.surface, truth, x: c.x, z: c.z };
      });
      return {
        cues: cues.length,
        rows,
        surfaces: [...new Set(cues.map((c) => c.surface))],
        zoneAgree: agree,
        zoneKnown: known,
        movedYd: +Math.hypot(w.x - window.__legStart.x, w.z - window.__legStart.z).toFixed(2),
        heldMsWall: Math.round(performance.now() - window.__legStart.t),
      };
    });
    // after stopping, cues must stop too
    await page.waitForTimeout(1100);
    read.cuesAfterStopWait = await page.evaluate(() => (window.__fwFootsteps || []).length);
    if (shot) await page.screenshot({ path: path.join(OUT, shot) });
    return { leg: name, ...read };
  };

  // outdoors: from spawn, walking away from the clubhouse
  out.turf = await footLeg('outdoors-4s', { x: out.spawn.x, z: out.spawn.z }, out.spawn.yaw + Math.PI, 4000, 'steps-outdoors.png');

  // indoors: the shop floor stand point
  const interior = await page.evaluate(() => {
    const o = window.__fw.scene3d.clubhouse().interior.position;
    return { x: o.x - 5.2, z: o.z + 3.0 };
  });
  out.boards = await footLeg('indoors-2.5s', interior, 0.4, 2500, 'steps-indoors.png');

  // wall push: find the till among stations by its prompt, stand 0.95 yd off,
  // push INTO the counter for 2 s — zero cues allowed
  const stations = await page.evaluate(() => window.__fw.scene3d.walk.stations());
  out.stations = stations;
  let till = null;
  for (const st of stations) {
    await page.evaluate(([s]) => {
      const w = window.__fw.scene3d.walk.state;
      w.x = s.x; w.z = s.z + 1.2;
      w.yaw = Math.atan2(-(s.x - w.x), -(s.z - w.z));
      w.pitch = -0.1;
    }, [st]);
    await page.waitForTimeout(450);
    const prompt = await page.evaluate(() => document.querySelector('.shop-prompt')?.textContent || '');
    if (/desk|register|till|serve|check|arrival/i.test(prompt) && !/ledger/i.test(prompt)) { till = { ...st, prompt: prompt.slice(0, 60) }; break; }
  }
  out.till = till;
  if (till) {
    const stand = { x: till.x, z: till.z + 0.95 };
    const yawAt = Math.atan2(-(till.x - stand.x), -(till.z - stand.z));
    out.wall = await footLeg('wall-push-2s', stand, yawAt, 2000, 'steps-wallpush.png');
  } else {
    out.wall = { missing: 'no till found by prompt' };
  }

  fs.writeFileSync(path.join(OUT, 'steps.json'), `${JSON.stringify(out, null, 2)}\n`);
  return {
    done: true,
    turf: { cues: out.turf.cues, surfaces: out.turf.surfaces, agree: `${out.turf.zoneAgree}/${out.turf.zoneKnown}`, movedYd: out.turf.movedYd },
    boards: { cues: out.boards.cues, surfaces: out.boards.surfaces, agree: `${out.boards.zoneAgree}/${out.boards.zoneKnown}`, movedYd: out.boards.movedYd },
    wall: out.wall.missing ? out.wall : { cues: out.wall.cues, movedYd: out.wall.movedYd },
    errs: out.errs.slice(0, 5),
  };
}
