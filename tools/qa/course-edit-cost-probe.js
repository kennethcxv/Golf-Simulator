// Measure what a Course Editor stroke actually costs.
//
// The audit flagged rebuildTerrainHeights as a performance risk: one
// PlaneGeometry of 721x481 vertices rewritten, plus computeVertexNormals over
// ~691k triangles, after every stroke. Before changing any of that, measure it.
//
//   node tools/qa/run-playwright.cjs tools/qa/course-edit-cost-probe.js --bootstrap

async function courseEditCostProbe(page) {
  const outDir = process.env.OUT_DIR || 'qa/course_master_final/claude_completion/performance';

  await page.goto('http://localhost:8457/');
  await page.waitForFunction(() => document.readyState === 'complete');
  const cont = page.getByRole('button', { name: 'Continue', exact: true });
  await cont.waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((i) => i.textContent.trim() === 'Continue');
    return b && !b.disabled;
  });
  await cont.click();
  await page.waitForFunction(
    () => window.__fw?.state?.course?.vec && window.__fw?.scene3d && window.__fw?.editorUi?.(),
    null,
    { timeout: 90000 },
  );
  await page.waitForFunction(() => {
    const veil = document.querySelector('.load-veil');
    return !veil || getComputedStyle(veil).opacity === '0';
  }, null, { timeout: 90000 });
  await page.keyboard.press('j');
  await page.waitForFunction(() => window.__fw.editorUi().isActive(), null, { timeout: 60000 });
  await page.locator('.ced-root').waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);

  const measured = await page.evaluate(() => {
    const st = window.__fw.state;
    const sc = window.__fw.scene3d;

    function time(label, fn, runs = 5) {
      fn(); // warm
      const samples = [];
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        fn();
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      return {
        label,
        medianMs: +samples[Math.floor(samples.length / 2)].toFixed(2),
        minMs: +samples[0].toFixed(2),
        maxMs: +samples[samples.length - 1].toFixed(2),
      };
    }

    const results = [];
    // What a paint stroke asks for.
    results.push(time('refreshGround zones only', () => sc.refreshGround(st, {})));
    // What a terrain stroke asks for.
    results.push(time('refreshGround + relief resculpt', () => sc.refreshGround(st, { relief: true })));
    // What undo/redo of a feature now asks for.
    results.push(time('refreshGround full (water/objects/paths/holes/flow/relief)', () => sc.refreshGround(st, {
      water: true, objects: true, paths: true, holes: true, flow: true, relief: true,
    })));
    // A small dirty rect, to show what the zone path already saves.
    results.push(time('refreshGround small zoneRect', () => sc.refreshGround(st, {
      zoneRect: { x0: 40, y0: 30, x1: 48, y1: 38 },
    })));

    const geo = sc.terrainGeometry || null;
    return {
      results,
      terrain: geo ? {
        vertices: geo.attributes.position.count,
        triangles: geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3,
      } : 'terrainGeometry not exposed',
      renderer: {
        triangles: sc.renderer.info.render.triangles,
        drawCalls: sc.renderer.info.render.calls,
        geometries: sc.renderer.info.memory.geometries,
        textures: sc.renderer.info.memory.textures,
        programs: sc.renderer.info.programs.length,
      },
    };
  });

  await page.screenshot({ path: `${outDir}/edit_cost_probe.png` });

  return { ok: true, suite: 'course-edit-cost-probe', ...measured };
}
