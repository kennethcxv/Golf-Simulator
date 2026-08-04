// D1 — THE SHARED ROOT CAUSE BEHIND TEN RED LAPTOP DRIVERS.
//
// Every one of them waited on `window.__fw.laptopOpen === true` and then went
// straight for the interface. That flag is set on the FIRST line of
// enterLaptop() (src/main.js), while the DOM it gates is opened 1350 ms later:
//
//   app.laptopOpen = true;                       // main.js — immediately
//   …
//   laptopTimers.push(setTimeout(() => {         // main.js — +1350 ms
//     if (ch.laptopScreen) ch.laptopScreen('live');
//     laptopUi.open(startPage);                  // ← root.style.display = ''
//   }, 1350));
//
// The flag means "the player has sat down and the lid is swinging". It does not
// mean the screen is on. So the drivers were reaching into a `.laptop-screen`
// that was still `display:none`, and Playwright reported exactly that —
// "locator resolved to <input class="lt-search" …> … element is not visible" —
// which HARNESS_DEBT §4 recorded as "`.lt-search` never visible" and read as
// selector drift. The selector was right; the wait was.
//
// This is also why laptop-bstand-verify was green throughout: it waits 1800 ms
// after the E press before it touches anything.

/**
 * Resolve when the laptop INTERFACE is actually on the glass and hittable.
 * @param {import('playwright').Page} page
 * @param {number} timeout
 */
export async function waitForLaptopScreen(page, timeout = 20000) {
  await page.waitForFunction(() => {
    const app = window.__fw;
    if (!app || app.laptopOpen !== true) return false;
    const screen = document.querySelector('.laptop-screen');
    if (!screen) return false;
    if (screen.style.display === 'none') return false;
    const box = screen.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  }, null, { timeout });
}

/**
 * Stand on the staff side of the LIVE laptop and face it.
 *
 * The stance is derived from `clubhouse.laptopRig()` rather than
 * FRONT_DESK.laptop. Measured 2026-08-04 the two agree exactly, so this is
 * insurance rather than a fix — but the datum drifting away from the rig is a
 * failure that presents as "the prompt never appeared", which is a long way
 * from its cause.
 */
export async function standAtLaptop(page, standoff = 0.85) {
  return page.evaluate((d) => {
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const rig = ch.laptopRig ? ch.laptopRig() : null;
    const node = rig && rig.object;
    if (!node) return { ok: false, reason: 'no laptop rig' };
    ch.interior.updateMatrixWorld(true);
    const m = node.matrixWorld.elements;
    const st = app.scene3d.walk.state;
    st.x = m[12];
    st.z = m[14] + d;
    st.yaw = 0;
    const horizontal = Math.max(0.001, d);
    st.pitch = Math.atan2(m[13] - app.scene3d.camera.position.y, horizontal);
    return { ok: true, world: { x: +m[12].toFixed(3), y: +m[13].toFixed(3), z: +m[14].toFixed(3) } };
  }, standoff);
}
