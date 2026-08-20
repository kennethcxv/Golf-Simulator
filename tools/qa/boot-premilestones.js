// THE HALF OF THE BOOT THAT IS NOT PREWARM.
//
// On a quiet stamped boot the veil is ~9-11 s, of which prewarm is 5.2 s. The
// other ~3.9 s sits BEFORE prewarm starts and has never been broken down: it is
// whatever happens between the menu click and the scene handing prewarm a scene
// to warm. This polls for milestones from the moment the menu is clicked and
// records when each first becomes true, so that stretch stops being one number.
//
// THE CONTROL is the sum: the milestones must land inside the veil time this
// same run measures independently. A milestone recorded after the veil lifted
// would mean the poll is watching something else.
async (page) => {
  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  const t0 = Date.now();
  const seen = {};
  const mark = (k) => { if (seen[k] == null) seen[k] = Date.now() - t0; };
  let polling = true;
  const poll = (async () => {
    while (polling) {
      const s = await page.evaluate(() => {
        const fw = window.__fw;
        let clubhouse = false;
        try { clubhouse = !!fw?.scene3d?.clubhouse?.(); } catch { clubhouse = false; }
        return {
          fw: !!fw,
          scene3d: !!fw?.scene3d,
          renderer: !!fw?.scene3d?.renderer,
          clubhouse,
          bootLedger: !!window.__fwBoot,
          warmDraws: (window.__fwWarmDraws || []).length > 0,
          prewarming: !!fw?.prewarming,
          veilLifted: typeof window.__fwBoot?.veilLiftedMs === 'number',
        };
      }).catch(() => null);
      if (s) for (const k of Object.keys(s)) if (s[k]) mark(k);
      if (s && s.veilLifted) break;
      await new Promise((r) => setTimeout(r, 40));
    }
  })();
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => typeof window.__fwBoot?.veilLiftedMs === 'number', null, { timeout: 300000 });
  polling = false;
  await poll.catch(() => {});
  const veil = Date.now() - t0;
  const led = await page.evaluate(() => ({
    veilLiftedMs: window.__fwBoot?.veilLiftedMs ?? null,
    prewarmMs: (window.__fwBoot?.stages || []).find((s) => s.label === 'prewarm')?.ms ?? null,
  }));
  console.log(`veil (menu click -> ledger complete): ${veil} ms`);
  console.log(`  scene ledger says prewarm ${led.prewarmMs} ms, veilLifted at ${led.veilLiftedMs} ms from scene start`);
  console.log(`  so BEFORE the scene even starts its own clock: ${(veil - (led.veilLiftedMs || 0)).toFixed(0)} ms`);
  console.log('milestones, ms after the menu click:');
  for (const k of ['fw', 'scene3d', 'renderer', 'clubhouse', 'prewarming', 'warmDraws', 'bootLedger', 'veilLifted']) {
    console.log(`  ${String(seen[k] ?? 'never').padStart(7)}  ${k}`);
  }
  const control = Object.values(seen).every((v) => v <= veil + 500);
  console.log(`CONTROL, every milestone inside the veil: ${control ? 'ok' : 'FAILED — the poll is watching something else'}`);
  return { veil, seen, led, control };
}
