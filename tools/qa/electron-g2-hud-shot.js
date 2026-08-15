// G2 — THE HUD PROMPT, SEEN AT THE DEFAULT CAMERA.
//
// The brief: "Visual items need a player-camera screenshot at the DEFAULT camera
// or they are UNCONFIRMED." Every visual item this session has been marked
// UNCONFIRMED for exactly that reason. This closes one of them.
//
// The fix: `.shop-prompt` sat at bottom:28px while `.shop-lockhint` occupies
// 18-51px, so the [E] key chip drew over the controls text - measured at 17x12px
// of overlap by the DOM sweep. The prompt moved to bottom:64px.
//
// A screenshot alone would not prove it: two boxes can look separated and still
// intersect by a pixel. So this does both - it MEASURES the gap in real layout
// and FILES THE FRAME the player would see, at the default camera, with nothing
// resized.
//
// NEGATIVE CONTROL: the prompt must actually be on screen. An empty prompt has
// no box, would report an enormous gap, and would photograph as a clean HUD
// while proving nothing at all.
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/g2-hud-shot');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.split('\\').join('/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(8000);

  // DEFAULT CAMERA: nothing resized, no viewport override, no FOV change.
  out.camera = await page.evaluate(() => ({
    css: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio,
    fov: window.__fw.scene3d.camera?.fov ?? null,
  }));

  // Look at something that produces a prompt, so the [E] chip is on screen.
  await page.evaluate(() => {
    const fw = window.__fw;
    const ch = fw.scene3d.clubhouse();
    const st = fw.scene3d.walk.state;
    let lp = ch.ledgerBook.position;
    if (typeof lp === 'function') lp = ch.ledgerBook.position();
    const ip = ch.interior.position;
    const b = { x: ip.x + lp.x, z: ip.z + lp.z };
    const to = { x: ip.x - b.x, z: ip.z - b.z };
    const len = Math.hypot(to.x, to.z) || 1;
    st.x = b.x + (to.x / len) * 1.3;
    st.z = b.z + (to.z / len) * 1.3;
    st.yaw = Math.atan2(-(b.x - st.x), -(b.z - st.z));
    st.pitch = -0.25;
  });
  // CAPTURE THE POINTER FIRST, LIKE A PLAYER.
  //
  // The first two runs measured the prompt at opacity 0 and I assumed I had the
  // wrong element. The candidate dump settled it: there is only ONE .shop-prompt,
  // it carries the right text, and it is transparent because THE POINTER WAS
  // NEVER LOCKED. The HUD hides itself when the player is not captured, which is
  // correct behaviour - the driver was the thing behaving unlike a player.
  await page.mouse.click(700, 500);
  await page.waitForTimeout(700);

  // WAIT FOR IT TO ACTUALLY BE ON SCREEN. The prompt fades in, so a measurement
  // taken too early reads a laid-out box at opacity 0 - present in the DOM,
  // invisible in the frame. The first run of this driver did exactly that and
  // its own control caught it: promptOnScreen false while the box had text and
  // a position. A screenshot filed at that moment would have shown no prompt at
  // all while the JSON claimed a clean 15px gap.
  await page.waitForFunction(() => {
    const el = document.querySelector('.shop-overlay .shop-prompt');
    if (!el) return false;
    const s = getComputedStyle(el);
    return Number(s.opacity) > 0.9 && (el.textContent || '').trim().length > 0;
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);

  // WHICH .shop-prompt IS DRAWN? There are two in the DOM - one standalone and
  // one inside the overlay - and the first run measured the wrong one. Report
  // every candidate so the answer is data rather than a guess.
  out.candidates = await page.evaluate(() => [...document.querySelectorAll('.shop-prompt')]
    .map((el, i) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return {
        i,
        inOverlay: !!el.closest('.shop-overlay'),
        opacity: st.opacity,
        display: st.display,
        bottom: Math.round(r.bottom),
        h: Math.round(r.height),
        text: (el.textContent || '').trim().slice(0, 40),
      };
    }));

  out.boxes = await page.evaluate(() => {
    // the DRAWN one: whichever candidate is actually opaque and has text
    const prompt = [...document.querySelectorAll('.shop-prompt')].find((el) => {
      const st = getComputedStyle(el);
      return Number(st.opacity) > 0.5 && st.display !== 'none'
        && (el.textContent || '').trim().length > 0;
    }) || document.querySelector('.shop-overlay .shop-prompt');
      const hint = [...document.querySelectorAll('.shop-lockhint')].find((el) => {
      const st = getComputedStyle(el);
      return Number(st.opacity) > 0.5 && st.display !== 'none';
    }) || document.querySelector('.shop-overlay .shop-lockhint');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        left: Math.round(r.left), right: Math.round(r.right),
        h: Math.round(r.height), w: Math.round(r.width),
        visible: s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05,
        text: (el.textContent || '').trim().slice(0, 60),
      };
    };
    return { prompt: box(prompt), hint: box(hint), viewportH: window.innerHeight };
  });

  await page.screenshot({ path: path.join(OUT, 'g2-hud-default-camera.png') });

  const p = out.boxes.prompt;
  const h = out.boxes.hint;
  // vertical gap between the prompt's bottom and the hint's top
  const gap = p && h ? h.top - p.bottom : null;
  out.verdict = {
    // the control: an empty prompt proves nothing
    promptOnScreen: !!(p && p.visible && p.h > 8 && p.text.length > 0),
    promptText: p?.text ?? null,
    hintOnScreen: !!(h && h.visible && h.h > 8),
    promptBottom: p?.bottom ?? null,
    hintTop: h?.top ?? null,
    verticalGapPx: gap,
    // the claim: they do not touch
    separated: gap != null && gap > 0,
    cameraUntouched: out.camera,
    shot: 'g2-hud-default-camera.png',
  };
  fs.writeFileSync(path.join(OUT, 'g2-hud.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('G2-HUD', JSON.stringify(out.verdict));
  if (out.errs.length) console.log('pageerrors', JSON.stringify(out.errs.slice(0, 3)));
  return out;
}
