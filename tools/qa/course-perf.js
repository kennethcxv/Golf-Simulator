// Course performance probe — real headed GPU, isolated context.
//   HEADED=1 node tools/qa/run-playwright.cjs tools/qa/course-perf.js
//
// Boots a fresh Realistic empire, buys the first property, opens the editor,
// then samples frame time in: editor overview (static), editor orbiting,
// and ground-level playtest. Reports avg ms/frame, ~fps, draw calls, tris.
async (page) => {
  const out = {};
  page.on('pageerror', (e) => { (out.errors = out.errors || []).push(String(e.message)); });

  await page.goto('http://localhost:8457/');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1500);

  await page.getByText('New Empire — Realistic', { exact: false }).click();
  await page.waitForTimeout(2500);
  await page.getByText('Buy', { exact: true }).first().click();
  await page.waitForFunction(() => window.__fw && window.__fw.state && window.__fw.state.course && window.__fw.state.course.vec, null, { timeout: 90000 });
  await page.waitForFunction(() => { const v = document.querySelector('.load-veil'); return !v || getComputedStyle(v).opacity === '0'; }, null, { timeout: 90000 });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    window.__fw.state.weather.locked = true;
    window.__fw.state.weather.today = { tempHiF: 74, tempLoF: 55, rainIn: 0, humidity: 0.4, windMph: 6 };
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true }));
  });
  await page.waitForTimeout(3000);

  const sample = async (label, ms, spin) => {
    const r = await page.evaluate(({ ms, spin }) => new Promise((res) => {
      const s = window.__fw.scene3d;
      const info = s.renderer.info;
      const deltas = [];
      let last = performance.now();
      const t0 = last;
      const tick = (t) => {
        deltas.push(t - last);
        last = t;
        if (spin && s.rig) s.rig.orbit(0.008, 0);
        if (t - t0 < ms) requestAnimationFrame(tick);
        else {
          deltas.sort((a, b) => a - b);
          const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
          const p99 = deltas[Math.floor(deltas.length * 0.99)];
          res({ frames: deltas.length, avg, p99, calls: info.render.calls, tris: info.render.triangles });
        }
      };
      requestAnimationFrame(tick);
    }), { ms, spin });
    out[label] = {
      fps: +(1000 / r.avg).toFixed(1), avgMs: +r.avg.toFixed(2), p99Ms: +r.p99.toFixed(2),
      drawCalls: r.calls, triangles: r.tris,
    };
  };

  await page.evaluate(() => window.__fw.scene3d.frameHole(window.__fw.state, 0));
  await page.waitForTimeout(1000);
  await sample('editorOverviewStatic', 2500, false);
  await sample('editorOrbiting', 3000, true);

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Playtest'));
    if (b) b.click();
  });
  await page.waitForTimeout(3000);
  await sample('playtestGround', 3000, false);

  console.log('COURSE_PERF ' + JSON.stringify(out));
  return out;
}
