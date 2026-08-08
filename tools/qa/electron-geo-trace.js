// WHERE ARE THE 54 GEOMETRIES BUILT? A STACK, NOT A READ.
//
// Section A established, with a scene-wide control, that the first tool equip
// CREATES 54 geometries (scene total 2730 -> 2784, so they are built and not
// re-parented), carried by 54 meshes with 9 new materials, which compile 9
// ordinary MeshStandardMaterial programs on first draw and cost 333-7855 ms.
//
// FOUR code readings failed to find the construction site: `buildArm` runs at
// boot, `rebuildArmGeometries` makes two cylinders from a feel setter,
// `setActive` only flips visibility and layers, and `fpHands.setTool` sets
// fields. The scene count says a constructor exists anyway.
//
// So stop reading and take a stack. `THREE` is not exposed on `window`, but
// every geometry's prototype is reachable from any mesh already in the scene,
// and every geometry calls `setAttribute` while it is being built. Patching
// that one method captures the call site of anything constructed while the
// trace flag is on.
//
// WRITTEN AS A FILE ON PURPOSE. The previous attempt built this same patch as a
// JS string inside a `node -e` string inside a bash command; the escaping
// mangled it into a SyntaxError and left the walk driver unparseable. That was
// the third escaping failure of the session and the rule it earned is: never
// author code through nested shell strings.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-geo-trace.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/geo-trace');
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

  // Arm the trace. Patch once, keep it off until the equip window opens.
  out.armed = await page.evaluate(() => {
    const s3 = window.__fw && window.__fw.scene3d;
    let proto = null;
    if (s3 && s3.scene) {
      s3.scene.traverse((o) => { if (!proto && o.geometry) proto = Object.getPrototypeOf(o.geometry); });
    }
    if (!proto) return 'no geometry found to reach the prototype';
    if (proto.__fwGeoPatched) return 'already patched';
    proto.__fwGeoPatched = true;
    window.__geoOn = false;
    window.__geoStacks = [];
    const original = proto.setAttribute;
    proto.setAttribute = function patched(name, value) {
      if (window.__geoOn && window.__geoStacks.length < 500) {
        const stack = String(new Error().stack || '');
        window.__geoStacks.push(stack.split('\n').slice(2, 7).join(' <- '));
      }
      return original.call(this, name, value);
    };
    return 'patched';
  }).catch((e) => `threw: ${String(e && e.message)}`);

  const geoCount = () => page.evaluate(() => {
    const s3 = window.__fw && window.__fw.scene3d;
    const seen = new Set();
    if (s3 && s3.scene) s3.scene.traverse((o) => { if (o.geometry) seen.add(o.geometry.uuid); });
    return seen.size;
  }).catch(() => null);

  // WHY COULD THIS DRIVER NOT EQUIP WHILE THE FULL WALK COULD?
  //
  // `walkActive()` (main.js:186) requires THREE things — `app.view === 'course'`,
  // `app.courseMode === 'walk'`, and `walk.isActive()` — and this driver awaited
  // only the third. If either of the others has not settled, the tool-belt key
  // is dispatched into a mode that ignores it.
  //
  // Sampled before the click and again after, so a difference between the two
  // shows which condition is late rather than merely which is false.
  const gate = () => page.evaluate(() => {
    const fw = window.__fw;
    return {
      view: fw?.view ?? null,
      courseMode: fw?.courseMode ?? null,
      walkActive: !!fw?.scene3d?.walk?.isActive?.(),
      ledgerOpen: !!fw?.ledgerOpen,
    };
  }).catch(() => null);
  out.gateAtBoot = await gate();

  await page.mouse.click(700, 500);
  await page.waitForTimeout(400);
  out.gateAfterClick = await gate();
  const keys = await page.evaluate(() => window.__fw.preferences?.values?.controls?.bindings || {});

  out.geoBefore = await geoCount();
  await page.evaluate(() => { window.__geoOn = true; });

  // BISECT STEP 1: a second pointer click before the equip.
  //
  // The walk driver clicks twice — once at the start and again after the ledger
  // releases pointer lock — and it equips reliably. This driver clicked once and
  // does not. Every state condition has been eliminated (`app.view`,
  // `app.courseMode`, `walk.isActive()`, `ledgerOpen` all correct at boot), so
  // the difference is in the sequence, and this is its cheapest element.
  await page.mouse.click(700, 500);
  await page.waitForTimeout(300);
  // BISECT STEP 2: actually walk first. The walk driver holds 'w' for seconds
  // before it equips; a second click alone changed nothing.
  await page.keyboard.down('w');
  await page.waitForTimeout(2600);
  await page.keyboard.up('w');
  await page.waitForTimeout(600);
  out.gateBeforeEquip = await gate();

  // Equip through the real wheel: hold the belt, press the tool's LETTER, release.
  await page.keyboard.down(keys.toolBelt || 'f');
  await page.waitForTimeout(450);
  // THE ONE LINE NEVER CHECKED HERE: is the wheel actually populated?
  //
  // The walk driver reads `.tool-wheel` between the keydown and the press and
  // only presses `if (at >= 0)`. This driver pressed unconditionally. If the
  // wheel is empty here, every refuted hypothesis in this sub-thread — cart,
  // mode, ledger, second click, walking first — was explaining a symptom whose
  // cause is simply that there was nothing to select from.
  out.wheelItems = await page.evaluate(() => {
    const el = document.querySelector('.tool-wheel');
    if (!el) return { present: false, items: [] };
    return {
      present: true,
      open: !!(el.className || '').match(/open|is-open|visible/i),
      className: String(el.className || '').slice(0, 60),
      items: [...el.querySelectorAll('.tool-wheel-item')]
        .map((b) => b.querySelector('.tool-wheel-label')?.textContent || ''),
    };
  }).catch((e) => ({ threw: String(e && e.message) }));

  await page.keyboard.press('b');
  await page.waitForTimeout(250);
  await page.keyboard.up(keys.toolBelt || 'f');
  await page.waitForTimeout(1800);

  await page.evaluate(() => { window.__geoOn = false; });
  out.geoAfter = await geoCount();
  out.equipped = await page.evaluate(() => window.__fw?.scene3d?.walk?.getTool?.() ?? 'none').catch(() => null);

  out.sites = await page.evaluate(() => {
    const tally = {};
    for (const s of (window.__geoStacks || [])) tally[s] = (tally[s] || 0) + 1;
    return Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }).catch(() => null);

  out.verdict = {
    armed: out.armed,
    equipped: out.equipped,
    geometriesCreated: (out.geoAfter ?? 0) - (out.geoBefore ?? 0),
    distinctSites: out.sites ? out.sites.length : 0,
  };
  fs.writeFileSync(path.join(OUT, 'geo-trace.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('GEO-TRACE', JSON.stringify(out.verdict));
  for (const [site, n] of (out.sites || [])) console.log(`  x${n}  ${site.slice(0, 220)}`);
  return out;
}
