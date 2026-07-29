async (page) => {
  // WALK INPUT PARITY — movement keys through the REAL key-event path, both
  // clubhouse variants (greybox-walk item 2's regression instrument).
  //
  //   node tools/qa/run-playwright.cjs tools/qa/walk-input-parity.js
  //
  // Each of W/A/S/D is synthesized as a genuine keydown/keyup pair and the walk
  // position delta measured, from the door clearway (open floor in both rooms).
  // Catches: a dead binding, an intercepted key, a latched key cancelling its
  // opposite, and variant-conditional input divergence.
  //
  // WHAT THIS DOES NOT PROVE (2026-07-28, the hard way). "Synthesized" is a
  // CDP-dispatched event: no OS keyboard, no layout mapping, no shell
  // accelerator, and no competing listener racing it. This file was green 8/8
  // on D while D did not strafe under a real hand. So a pass here means "the
  // binding and the movement basis are intact", NOT "the key works when the
  // player presses it". The real-hand path is instrumented separately by
  // ?keydebug=1 (src/debug/keyCapture.js) with tools/qa/key-capture-control.js
  // as its synthetic baseline. Do not cite this file as evidence that an input
  // works in play until that gap is closed and this note is rewritten.
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const repo = path.resolve(process.env.QA_REPO_ROOT || process.cwd());
  const outDir = path.resolve(process.env.GREYBOX_DATA_OUT
    || path.join(repo, 'Designs', 'ProShop', 'Greybox', 'data'));
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.GREYBOX_SEED || 20260727);
  // Open floor differs per room: v1's checkout island owns the mid-floor. The
  // v2 stand moved (0.5, 0.5) → (0.5, 1.7) on 2026-07-28: the resize re-seated
  // the feature table at (0.55, −0.55), 0.40 yd north of the original stand,
  // and the northward sweep read as a dead W key — a stale-stand red, the
  // exact drift class HARNESS_TRUST.md exists to catch, in this file's own
  // fixture. The new spot clears ≥0.9 yd of body travel on all four sweeps
  // against every current v2 rect (feature north, desk south, member east,
  // essentials west).
  const STANDS = {
    'pine-hills': { x: -0.8, z: 3.6 },
    'pine-hills-v2': { x: 0.5, z: 1.7 },
  };

  const sweep = async (STAND) => {
    const rows = [];
    for (const key of ['w', 'a', 's', 'd']) {
      const before = await page.evaluate((stand) => {
        const app = window.__fw;
        const o = app.scene3d.clubhouse().interior.position;
        const w = app.scene3d.walk.state;
        w.x = stand.x + o.x;
        w.z = stand.z + o.z;
        w.yaw = 0;
        w.pitch = 0;
        return { x: w.x, z: w.z };
      }, STAND);
      await page.waitForTimeout(120);
      await page.keyboard.down(key);
      await page.waitForTimeout(600);
      await page.keyboard.up(key);
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => {
        const w = window.__fw.scene3d.walk.state;
        return { x: w.x, z: w.z };
      });
      rows.push({ key, dx: +(after.x - before.x).toFixed(3), dz: +(after.z - before.z).toFixed(3) });
    }
    return rows;
  };

  const boot = async (variant) => {
    const query = variant === 'pine-hills-v2' ? '?clubhouse=pine-hills-v2' : '';
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`${baseUrl}${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.evaluate(async (seed) => {
      localStorage.clear();
      const E = await import('/src/sim/empire.js');
      const empire = E.newStarterEmpire('relaxed', seed);
      localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
    }, SEED);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /^Continue/ }).first().click();
    await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 120000 });
    await page.waitForTimeout(2500);
    await page.mouse.click(800, 450);
    await page.waitForTimeout(300);
  };

  // At yaw 0 the walk basis maps W to -z, S to +z, A to -x, D to +x.
  const expected = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] };
  const out = { stands: STANDS, variants: {}, verdicts: [] };
  for (const variant of ['pine-hills', 'pine-hills-v2']) {
    await boot(variant);
    const rows = await sweep(STANDS[variant]);
    out.variants[variant] = rows;
    for (const row of rows) {
      const [ex, ez] = expected[row.key];
      const moved = Math.hypot(row.dx, row.dz);
      const alongExpected = row.dx * ex + row.dz * ez;
      out.verdicts.push({
        variant,
        key: row.key,
        moved: +moved.toFixed(3),
        ok: moved > 0.25 && alongExpected > 0.8 * moved,
      });
    }
  }
  out.ok = out.verdicts.every((v) => v.ok);
  fs.writeFileSync(path.join(outDir, 'walk-input-parity.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
