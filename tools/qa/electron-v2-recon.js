async (page) => {
  // VERIFIER 2 RECON — shape discovery only, no claims judged here.
  // Dumps: walk.stations(), ledgerBook.diagnostics(), state.clock, HUD chip
  // candidates, veil element candidates, walk.state shape + teleport check.
  const out = { ok: true, phase: 'boot', notes: [] };
  const ROOTP = process.cwd().replace(/\\/g, '/');
  const shots = `${ROOTP}/qa/electron/verify-v2`;
  try {
    const boot = await import(`file:///${ROOTP}/tools/qa/lib/qa-boot.mjs`);
    await page.bringToFront();
    const t0 = Date.now();
    out.menuPath = await boot.clickThroughMenu(page);
    // Veil watch: record any large fixed/absolute overlay classes during load.
    const veilWatch = page.evaluate(() => new Promise((resolve) => {
      const seen = new Map();
      const start = performance.now();
      const iv = setInterval(() => {
        try {
          const vw = innerWidth; const vh = innerHeight;
          [...document.querySelectorAll('body > *, body > * > *')].forEach((el) => {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || Number(cs.opacity) < 0.03) return;
            const r = el.getBoundingClientRect();
            if (r.width < vw * 0.8 || r.height < vh * 0.8) return;
            if (el.tagName === 'CANVAS') return;
            const key = `${el.tagName}|${String(el.className).slice(0, 60)}|${el.id}`;
            if (!seen.has(key)) seen.set(key, { first: Math.round(performance.now() - start) });
            seen.get(key).last = Math.round(performance.now() - start);
          });
        } catch (_) { /* keep polling */ }
        if (performance.now() - start > 18000) {
          clearInterval(iv);
          resolve([...seen.entries()].map(([k, v]) => ({ el: k, ...v })));
        }
      }, 150);
    }));
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive, null, { timeout: 120000 });
    out.bootMs = Date.now() - t0;
    const res = await boot.ownerResolution(page, page.electronApp);
    out.windowCaption = res.caption;
    out.veilCandidates = await veilWatch;
    await page.waitForTimeout(2500);

    out.phase = 'dump';
    out.dump = await page.evaluate(() => {
      const fw = window.__fw;
      const scene3d = fw?.scene3d;
      const walk = scene3d?.walk;
      const info = { errs: [] };
      const attempt = (label, fn) => {
        try { info[label] = fn(); } catch (e) { info.errs.push(`${label}: ${String((e && e.message) || e)}`); }
      };
      const keysOf = (o) => {
        const set = new Set(); let cur = o; let hops = 0;
        while (cur && cur !== Object.prototype && hops < 4) {
          Object.getOwnPropertyNames(cur).forEach((k) => set.add(k));
          cur = Object.getPrototypeOf(cur); hops += 1;
        }
        return [...set].filter((k) => k !== 'constructor').sort();
      };
      attempt('fwKeys', () => keysOf(fw));
      attempt('scene3dKeys', () => keysOf(scene3d));
      attempt('walkKeys', () => keysOf(walk));
      attempt('walkState', () => JSON.parse(JSON.stringify(walk.state)));
      attempt('stateKeys', () => keysOf(fw.state));
      attempt('clock', () => JSON.parse(JSON.stringify(fw.state.clock)));
      attempt('settingsKeys', () => keysOf(fw.state.settings || {}));
      attempt('bindings', () => JSON.parse(JSON.stringify(
        (fw.state.settings && fw.state.settings.bindings) || fw.state.bindings || null,
      )));
      attempt('stations', () => {
        const list = walk.stations();
        return (list || []).map((s) => {
          const row = {};
          Object.keys(s).forEach((k) => {
            const v = s[k];
            if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) row[k] = v;
            else if (typeof v === 'object' && Number.isFinite(v.x)) row[k] = { x: v.x, y: Number.isFinite(v.y) ? v.y : null, z: Number.isFinite(v.z) ? v.z : null };
            else row[k] = `[${typeof v}]`;
          });
          return row;
        });
      });
      attempt('clubhouseKeys', () => keysOf(scene3d.clubhouse()));
      attempt('interiorPos', () => {
        const p = scene3d.clubhouse().interior.position;
        return { x: p.x, y: p.y, z: p.z };
      });
      attempt('ledgerDiag', () => JSON.parse(JSON.stringify(scene3d.clubhouse().ledgerBook.diagnostics())));
      attempt('ledgerKeys', () => keysOf(scene3d.clubhouse().ledgerBook));
      attempt('eCounts', () => JSON.parse(JSON.stringify(window.__eCounts ?? null)));
      attempt('footstepsApi', () => JSON.parse(JSON.stringify(window.__fwFootsteps ?? null)));
      attempt('rendererInfo', () => {
        const r = scene3d.renderer || scene3d.gl || null;
        return r && r.info ? {
          triangles: r.info.render.triangles,
          calls: r.info.render.calls,
          programs: r.info.programs ? r.info.programs.length : null,
        } : `rendererKeys:${keysOf(scene3d).filter((k) => /render|gl/i.test(k)).join(',')}`;
      });
      attempt('hudButtons', () => [...document.querySelectorAll('button')]
        .filter((b) => b.offsetParent !== null)
        .slice(0, 60)
        .map((b) => {
          const r = b.getBoundingClientRect();
          return {
            cls: String(b.className).slice(0, 90),
            text: (b.textContent || '').trim().slice(0, 60),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          };
        }));
      attempt('chipCandidates', () => [...document.querySelectorAll('[class*="chip"],[class*="clock"],[class*="time"],[class*="speed"]')]
        .filter((el) => el.offsetParent !== null)
        .slice(0, 20)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName,
            cls: String(el.className).slice(0, 100),
            text: (el.textContent || '').trim().slice(0, 80),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          };
        }));
      return info;
    });

    out.phase = 'teleport';
    out.teleport = await page.evaluate(() => {
      const fw = window.__fw;
      const walk = fw.scene3d.walk;
      const st = walk.state;
      const pos = (st.position && Number.isFinite(st.position.x)) ? st.position : st;
      const before = { x: pos.x, z: pos.z, yaw: st.yaw, pitch: st.pitch };
      let stations = [];
      try { stations = walk.stations() || []; } catch (_) { /* none */ }
      const led = stations.find((s) => /ledger|read/i.test(JSON.stringify(
        Object.entries(s).filter(([, v]) => typeof v === 'string'),
      )));
      const ch = fw.scene3d.clubhouse();
      const ip = ch.interior.position;
      const fallback = { x: ip.x - 5.2, z: ip.z + 3.0 };
      const cand = led ? (led.stand || led.position || led.pos || led.point || null) : null;
      const target = cand && Number.isFinite(cand.x) ? { x: cand.x, z: cand.z } : fallback;
      pos.x = target.x; pos.z = target.z;
      st.yaw = 0.4;
      const ledOut = led ? JSON.parse(JSON.stringify(led, (k, v) => {
        if (v && typeof v === 'object' && Number.isFinite(v.x) && Number.isFinite(v.z)) {
          return { x: v.x, y: Number.isFinite(v.y) ? v.y : null, z: v.z };
        }
        if (typeof v === 'function') return '[fn]';
        return v;
      })) : null;
      return { before, target, usedFallback: !cand, ledStation: ledOut };
    });
    await page.waitForTimeout(900);
    out.afterTeleport = await page.evaluate(() => {
      const st = window.__fw.scene3d.walk.state;
      const pos = (st.position && Number.isFinite(st.position.x)) ? st.position : st;
      return { x: pos.x, y: pos.y ?? null, z: pos.z, yaw: st.yaw, pitch: st.pitch };
    });
    out.promptsVisible = await page.evaluate(() => [...document.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && /\[E\]|\bE\b.*read|ledger/i.test(el.textContent || '') && (el.textContent || '').length < 200)
      .slice(0, 8)
      .map((el) => ({ cls: String(el.className).slice(0, 60), text: (el.textContent || '').trim().slice(0, 140) })));
    await page.screenshot({ path: `${shots}/recon-01-teleport.png` });
    out.phase = 'done';
  } catch (error) {
    out.error = `${out.phase}: ${String((error && error.message) || error)}`;
    try { await page.screenshot({ path: `${shots}/recon-fail.png` }); } catch (_) { /* best effort */ }
  }
  return out;
}
