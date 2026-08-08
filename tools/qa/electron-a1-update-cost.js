// A1 — HOW MUCH OF THE INDOOR SPIKE IS walk.update AND clubhouse.update?
//
// ~15 of invariant 1's 23 indoor points are unattributed and sit outside
// `renderer.render()`. `walk.update` and `clubhouse.update` are own function
// properties on objects a driver can hold, so they patch the same way
// `renderer.render` did.
//
// THE TRAP THIS DRIVER IS BUILT AROUND. The frame loop lives inside
// courseScene's closure and may call the INTERNAL function rather than the
// exposed property — in which case patching the property intercepts nothing and
// the driver reports 0.00 ms, which reads exactly like "these are not the cause".
// That is a false negative dressed as a finding, and this session has already
// logged several of its relatives.
//
// So every patch counts its own invocations, and the verdict leads with
// `intercepted`. **A zero time with a zero call count is not evidence about the
// game; it is evidence about the patch**, and the driver says which.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a1-update-cost.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a1-update-cost');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(6000);

  out.teleport = await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw?.scene3d?.clubhouse?.();
    const st = fw?.scene3d?.walk?.state;
    if (!ch || !st) return { ok: false };
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const book = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - book.x, z: ip.z - book.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = book.x + (to.x / len) * 3.0;
    st.z = book.z + (to.z / len) * 3.0;
    st.pitch = -0.2;
    return { ok: true, inside: !!ch.isInside(st.x, st.z, 0.35) };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));
  await page.waitForTimeout(3500);

  out.patched = await page.evaluate(() => {
    const s3 = window.__fw?.scene3d;
    const ch = s3?.clubhouse?.();
    window.__a1u = {
      walkMs: 0, walkCalls: 0, chMs: 0, chCalls: 0, renderMs: 0, renderCalls: 0,
    };
    const wrap = (obj, key, msKey, callKey) => {
      if (!obj || typeof obj[key] !== 'function') return `no ${key}`;
      const orig = obj[key].bind(obj);
      obj[key] = function timed(...args) {
        const t0 = performance.now();
        const r = orig(...args);
        window.__a1u[msKey] += performance.now() - t0;
        window.__a1u[callKey] += 1;
        return r;
      };
      return 'ok';
    };
    return {
      walk: wrap(s3?.walk, 'update', 'walkMs', 'walkCalls'),
      clubhouse: wrap(ch, 'update', 'chMs', 'chCalls'),
      render: wrap(s3?.renderer, 'render', 'renderMs', 'renderCalls'),
    };
  }).catch((e) => ({ threw: String(e && e.message) }));

  const rows = await page.evaluate(() => new Promise((resolve) => {
    const a = window.__a1u;
    const acc = [];
    let prev = performance.now();
    let p = { walkMs: a.walkMs, chMs: a.chMs, renderMs: a.renderMs, walkCalls: a.walkCalls, chCalls: a.chCalls };
    const t0 = prev;
    const tick = () => {
      const now = performance.now();
      acc.push({
        dt: +(now - prev).toFixed(2),
        walk: +(a.walkMs - p.walkMs).toFixed(2),
        ch: +(a.chMs - p.chMs).toFixed(2),
        render: +(a.renderMs - p.renderMs).toFixed(2),
        walkCalls: a.walkCalls - p.walkCalls,
        chCalls: a.chCalls - p.chCalls,
      });
      prev = now;
      p = { walkMs: a.walkMs, chMs: a.chMs, renderMs: a.renderMs, walkCalls: a.walkCalls, chCalls: a.chCalls };
      if (now - t0 < 11000) requestAnimationFrame(tick);
      else resolve(acc);
    };
    requestAnimationFrame(tick);
  }));

  const body = rows.slice(1);
  const spike = body.filter((r) => r.dt > 16.7);
  const calm = body.filter((r) => r.dt <= 16.7);
  const med = (xs) => {
    if (!xs.length) return null;
    const v = xs.slice().sort((a, b) => a - b);
    return +v[Math.floor(v.length / 2)].toFixed(2);
  };
  const gap = (k) => {
    const s = med(spike.map((r) => r[k]));
    const c = med(calm.map((r) => r[k]));
    return s == null || c == null ? null : +(s - c).toFixed(2);
  };

  const totalWalkCalls = body.reduce((a, r) => a + r.walkCalls, 0);
  const totalChCalls = body.reduce((a, r) => a + r.chCalls, 0);
  out.verdict = {
    inside: out.teleport?.inside ?? null,
    patchResult: out.patched,
    // LEADS WITH THIS. A zero time with zero calls is a fact about the patch.
    interceptedWalk: totalWalkCalls > 0,
    interceptedClubhouse: totalChCalls > 0,
    walkCallsTotal: totalWalkCalls,
    clubhouseCallsTotal: totalChCalls,
    frames: body.length,
    spikePct: +((spike.length / body.length) * 100).toFixed(1),
    dtGapMs: gap('dt'),
    walkGapMs: gap('walk'),
    clubhouseGapMs: gap('ch'),
    renderGapMs: gap('render'),
    accountedPct: gap('dt')
      ? +((((gap('walk') || 0) + (gap('ch') || 0) + (gap('render') || 0)) / gap('dt')) * 100).toFixed(1)
      : null,
  };
  out.medians = {
    spike: { dt: med(spike.map((r) => r.dt)), walk: med(spike.map((r) => r.walk)), ch: med(spike.map((r) => r.ch)), render: med(spike.map((r) => r.render)) },
    calm: { dt: med(calm.map((r) => r.dt)), walk: med(calm.map((r) => r.walk)), ch: med(calm.map((r) => r.ch)), render: med(calm.map((r) => r.render)) },
  };
  fs.writeFileSync(path.join(OUT, 'a1-update-cost.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('A1-UPDATE', JSON.stringify(out.verdict));
  console.log('  medians ', JSON.stringify(out.medians));
  return out;
}
