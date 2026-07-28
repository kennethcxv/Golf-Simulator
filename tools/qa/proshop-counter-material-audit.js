// What is the reception counter run actually made of?
//
// ART_BIBLE §7.4.1's [V] gate assumes the counter is medium walnut and asks whether a
// calibrated worktable reads as the same production. That assumption has never been
// checked against the running game, and the whole gate depends on it: if the counter is
// a different colour, or carries no texture at all, then "they look like two different
// games" is a statement about the counter rather than about calibration.
//
// Reports, for every material on asset_061 and its neighbours: the shipped base colour
// as sRGB hex, which map slots are populated, and each map's dimensions. Colour is read
// from `material.color`, which three.js has already converted to linear from the glTF
// baseColorFactor, so it is converted back here through the same EOTF the palette module
// uses rather than by eye.
async (page) => {
  const baseUrl = process.env.QA_BASE_URL || 'http://localhost:8457/';
  const SEED = Number(process.env.SPIKE_SEED || 20260727);

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(async (seed) => {
    localStorage.clear();
    const E = await import('/src/sim/empire.js');
    const empire = E.newStarterEmpire('relaxed', seed);
    localStorage.setItem('golfempire:autosave', JSON.stringify(E.empireSnapshot(empire)));
  }, SEED);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || v.style.display === 'none' || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 120000 });
  await page.waitForTimeout(5000);

  return page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const ch = s3.clubhouse();
    const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];

    const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * (c ** (1 / 2.4)) - 0.055);
    const hex = (col) => '#' + ['r', 'g', 'b']
      .map((k) => Math.round(Math.min(1, Math.max(0, toSrgb(col[k]))) * 255).toString(16).padStart(2, '0'))
      .join('').toUpperCase();

    // §8 medium walnut, the value the gate assumes both surfaces carry.
    const TARGET = '#6B4A2F';
    const targetRgb = [0x6B, 0x4A, 0x2F];
    const gapTo = (h) => {
      const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      return +Math.hypot(...v.map((x, i) => x - targetRgb[i])).toFixed(1);
    };

    const collect = (pattern, label) => {
      let root = null;
      ch.interior.traverse((n) => { if (!root && pattern.test(n.name || '')) root = n; });
      if (!root) return { label, found: false };
      const seen = new Set();
      const materials = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          if (!m || seen.has(m.uuid)) return;
          seen.add(m.uuid);
          const maps = {};
          SLOTS.forEach((slot) => {
            const t = m[slot];
            if (t && t.image) maps[slot] = `${t.image.width}x${t.image.height}`;
          });
          const h = m.color ? hex(m.color) : null;
          const textured = Object.keys(maps).length > 0;
          materials.push({
            name: m.name || '(unnamed)',
            // For an UNTEXTURED material this is the shipped colour. For a textured one it
            // is only the baseColorFactor: the shipped albedo is factor x texture, so this
            // number is not comparable to a palette value. Reported either way, but the gap
            // below is suppressed rather than left to mislead.
            baseColorHex: h,
            baseColorIs: textured ? 'factor only — shipped albedo is factor x texture' : 'shipped colour',
            gapToMediumWalnut: h && !textured ? gapTo(h) : null,
            roughness: m.roughness != null ? +m.roughness.toFixed(2) : null,
            metalness: m.metalness != null ? +m.metalness.toFixed(2) : null,
            maps,
            textured,
          });
        });
      });
      return {
        label,
        found: true,
        node: root.name,
        materialCount: materials.length,
        texturedCount: materials.filter((m) => m.textured).length,
        materials: materials.sort((a, b) => a.name.localeCompare(b.name)),
      };
    };

    const subjects = [
      collect(/^AssetRuntime_61_front_desk_counter_shell/, 'reception counter run (asset_061)'),
      collect(/^AssetRuntime_62_back_counter_storage_cabinets/, 'back counter (asset_062)'),
      collect(/^AssetRuntime_65_stockroom_worktable/, 'stockroom worktable (asset_065)'),
    ];

    return {
      ok: subjects.every((s) => s.found),
      paletteTarget: { name: 'medium walnut (ART_BIBLE §8)', hex: TARGET },
      subjects,
      // The headline: the gate compares a textured surface against one that may not be.
      summary: subjects.map((s) => (s.found
        ? `${s.label}: ${s.texturedCount}/${s.materialCount} materials textured`
        : `${s.label}: NOT FOUND`)),
    };
  });
}
