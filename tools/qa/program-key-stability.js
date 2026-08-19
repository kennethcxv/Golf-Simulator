// DOES A STAMPED BOOT ASK FOR THE SAME PROGRAMS TWICE?
//
// prewarm-draw-anatomy proved the whole veil is program linking: draws with
// identical geometry cost 28 ms when they mint nothing and 7,337 ms when they
// mint 28 programs. On a STAMPED boot, 185 programs still link at full price.
//
// The driver keeps a disk cache of linked programs (gpu-program-cache-size-kb
// is set to 256 MB in main.cjs and the profile's GPUCache is only 7.9 MB, so
// nothing is being evicted). A cache that is present, unfull and still missing
// means the KEY is different each boot -- the second boot is asking for
// programs the first boot never compiled, because something in the shader
// source varies per session.
//
// So this dumps every program's identity and writes it to disk. Run it twice
// against the same profile and diff the two files. Identical files mean the
// keys are stable and the cache miss is elsewhere; differing files name the
// varying term outright.
//
// THE NEGATIVE CONTROL is built in: the file also records the same boot's keys
// captured TWICE within the single session. Those must be identical to each
// other, because nothing recompiled between them. If a within-boot capture
// differs from itself, the dump is nondeterministic and the cross-boot diff
// means nothing.
//
//   QA_ELECTRON_USER_DATA_DIR=<dir> QA_KEY_TAG=a node tools/qa/run-electron.cjs tools/qa/program-key-stability.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const boot = await import(`file:///${process.cwd().split(String.fromCharCode(92)).join('/')}/tools/qa/lib/qa-boot.mjs`);
  const stampedBefore = await page.evaluate(() => {
    try { return !!localStorage.getItem('golfEmpire.shaderCompileStamp.v2'); } catch { return null; }
  });
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => typeof window.__fwBoot?.veilLiftedMs === 'number', null, { timeout: 300000 });

  const grab = () => page.evaluate(() => {
    const r = window.__fw.scene3d.renderer;
    return (r.info.programs || []).map((p) => String(p.cacheKey || '')).sort();
  });
  const first = await grab();
  const second = await grab();
  const withinBoot = first.length === second.length && first.every((k, i) => k === second[i]);

  const TAG = (process.env.QA_KEY_TAG || 'a').replace(/[^a-z0-9-]+/gi, '_');
  fs.mkdirSync('qa/program-keys', { recursive: true });
  const file = `qa/program-keys/${TAG}.txt`;
  fs.writeFileSync(file, first.join('\n'));
  console.log(`boot ${stampedBefore ? 'WARM (stamped)' : 'COLD'}  programs ${first.length}  -> ${file}`);
  console.log(`CONTROL, same boot captured twice: ${withinBoot ? 'identical (dump is deterministic)' : 'DIFFERED — the dump is nondeterministic and any cross-boot diff is meaningless'}`);
  return { boot: stampedBefore ? 'WARM' : 'COLD', count: first.length, file, withinBootIdentical: withinBoot };
}
