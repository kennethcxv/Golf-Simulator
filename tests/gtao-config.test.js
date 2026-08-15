// GTAO configuration contract.
//
// Contact occlusion is the only thing darkening where indoor geometry meets the floor —
// RectAreaLights cannot cast shadows in three.js and interior meshes are kept out of the
// sun's shadow atlas — so its configuration is load-bearing for how grounded the room
// looks, and it is worth pinning.
//
// The bug this guards against: `gtao.radius = 0.7` reads like it works and does nothing.
// GTAOPass stores the radius in `gtaoMaterial.uniforms.radius` and never consults a bare
// `radius` property, so two call sites in main.js spent the feature's whole life setting
// a field nobody read. The configured value and the running value silently disagreed.
//
// The live-uniform assertion runs against the real GTAOPass class, so it fails if a
// three.js upgrade ever moves where the radius lives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readSrc = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('GTAO_CONFIG is the single source of truth for the pass setup', async () => {
  const { GTAO_CONFIG } = await import('../src/render3d/courseScene.js');
  assert.equal(typeof GTAO_CONFIG, 'object');
  assert.ok(Object.isFrozen(GTAO_CONFIG), 'GTAO_CONFIG must be frozen');

  // Radius stays tight on purpose. 2.4 was measured and read as blotchy staining rather
  // than contact (Designs/ProShop/Spike/LIGHTING_SPIKE.md addendum).
  assert.ok(
    GTAO_CONFIG.radius > 0 && GTAO_CONFIG.radius <= 1.8,
    `GTAO radius ${GTAO_CONFIG.radius} is outside the tight-contact range; raising it spreads occlusion instead of grounding objects`,
  );
  // Intensity is what buys grounding; sample count and resolution were
  // re-graded by measurement on 2026-08-10 (A3). At 4K physical the old
  // 24/16/full config cost 4.34 ms of an 8.17 ms GPU frame — over half the
  // frame — and the per-rung screenshot sweep (qa/electron/a3-gtao-sweep)
  // showed 12 samples / 8 pd / 0.75 scale keeps the box and counter contact
  // shadows at the ledger-desk pose. The floor below is pinned instead: AO
  // must not drop below the sweep's accepted rung, because BELOW it (half res
  // with the old denoise) is where contact darkening visibly died.
  assert.ok(GTAO_CONFIG.blendIntensity > 0.4, 'blendIntensity must exceed the old 0.4, which left contact effectively absent');
  assert.ok(GTAO_CONFIG.samples >= 12, 'sample count must stay at or above the accepted sweep rung (12)');
  assert.ok(GTAO_CONFIG.resolutionScale >= 0.75, 'AO resolution must stay at or above the accepted 0.75 rung - the cheaper half-res rung is where contact darkening was lost');
  assert.ok(GTAO_CONFIG.pd.samples >= 8, 'denoise samples must stay at or above the accepted sweep rung (8)');
});

test('the live gtaoMaterial uniform matches the configured radius', async () => {
  // Build the real pass with a stub renderer/scene/camera. No WebGL context is needed to
  // construct GTAOPass's materials, which is where the uniform actually lives.
  const { GTAOPass } = await import('../vendor/addons/postprocessing/GTAOPass.js');
  const { GTAO_CONFIG } = await import('../src/render3d/courseScene.js');
  const THREE = await import('../vendor/three.module.js');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(66, 16 / 9, 0.15, 6000);
  const pass = new GTAOPass(scene, camera, 2, 2);

  pass.blendIntensity = GTAO_CONFIG.blendIntensity;
  pass.updateGtaoMaterial({ radius: GTAO_CONFIG.radius, samples: GTAO_CONFIG.samples });

  const live = pass.gtaoMaterial?.uniforms?.radius?.value;
  assert.equal(
    live, GTAO_CONFIG.radius,
    'the running shader uniform must equal the configured radius - if this fails, the value is being set somewhere that GTAOPass does not read',
  );
  assert.equal(pass.blendIntensity, GTAO_CONFIG.blendIntensity);

  // The trap itself: assigning the bare property must NOT change what the shader uses.
  // If a future three.js adds a real setter this assertion flips, and the per-mode
  // assignment style becomes safe again — which is worth being told about.
  pass.radius = 99;
  assert.equal(
    pass.gtaoMaterial.uniforms.radius.value, GTAO_CONFIG.radius,
    'GTAOPass appears to have gained a real `radius` setter; revisit the per-mode radius decision in main.js',
  );
});

test('no source assigns a bare gtao.radius property', () => {
  // The inert pattern, in any of the shapes it appeared in.
  const files = ['src/main.js', 'src/render3d/courseScene.js'];
  for (const rel of files) {
    const src = readSrc(rel);
    const offenders = src
      .split('\n')
      .map((line, i) => [i + 1, line])
      // Comment lines are where this bug is *explained*, so they must not trip it.
      .filter(([, line]) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
        const code = line.split('//')[0];
        // Must match `gtao.radius =` however it is reached — the real bug was
        // `app.scene3d.post.gtao.radius = 0.7`, i.e. preceded by a dot, so the
        // preceding character cannot be excluded. \b handles that correctly.
        return /\bgtao\w*\s*\.\s*radius\s*=/i.test(code);
      });
    assert.deepEqual(
      offenders, [],
      `${rel} assigns gtao.radius directly, which GTAOPass never reads. Route it through updateGtaoMaterial({ radius }) instead.`,
    );
  }
});
