// The shared menu boot for QA function-files (2026-07-31).
//
// History: dozens of harnesses booted with
//   await page.getByText('Continue', { exact: true }).click();
// which presumed a saved profile. run-playwright.cjs launches an EPHEMERAL
// context, so on every clean run "Continue" does not exist and those drivers
// hung on the load veil (or fell through a .catch and hung on their first
// in-game wait instead). The checkout round-5/7 drivers fixed it locally;
// this module is that fix shared.
//
// Function-files import this with:
//   await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`)).clickThroughMenu(page);
//
// Semantics: resume the save when one exists (the old drivers' intent),
// otherwise start a fresh Relaxed game. Only the MENU is handled here — each
// driver keeps its own post-boot waits, so no timing behaviour changes.

// PLAN_16 R-A — OWNER-RESOLUTION ACCEPTANCE.
//
// Verified during the Phase 2 review: every driver inherits main.cjs's
// 1600x940 DIP window while the owner plays this machine's 4K display, so
// every screenshot, legibility verdict and perf acceptance in six rounds was
// judged at ~62% of the owner's linear resolution with nobody saying so.
//
// This sizes the REAL BrowserWindow to the primary display's full bounds
// (borderless-style maximised bounds, native DIP size; the shipped DPR cap
// stays in force because the acceptance environment reproduces the shipped
// pipeline at the owner's window — it does not invent a new one) and returns
// the caption every acceptance artifact must carry. Falls back verbosely: a
// driver that cannot size the window must SAY so in its output rather than
// silently grading small frames.
//
// Usage, after boot:
//   const cap = await ownerResolution(page, electronApp);
//   out.windowCaption = cap.caption;   // e.g. "2560x1392 DIP @2.0 scale (4K)"
export async function ownerResolution(page, electronApp) {
  // run-electron.cjs's page shim exposes the Electron app as page.electronApp.
  const app = electronApp || page?.electronApp || null;
  try {
    const info = await (app
      ? app.evaluate(({ screen, BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const display = screen.getDisplayMatching(win.getBounds());
        win.setBounds(display.bounds);
        const content = win.getContentBounds();
        return {
          dipW: content.width,
          dipH: content.height,
          scale: display.scaleFactor,
          physW: Math.round(display.bounds.width * display.scaleFactor),
          physH: Math.round(display.bounds.height * display.scaleFactor),
        };
      })
      : Promise.reject(new Error('no electronApp handle')));
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    return {
      ok: true,
      ...info,
      dpr,
      caption: `${info.dipW}x${info.dipH} DIP @${info.scale} scale `
        + `(display ${info.physW}x${info.physH} physical, dpr ${dpr})`,
    };
  } catch (error) {
    return {
      ok: false,
      caption: `OWNER-RES UNAVAILABLE (${String(error?.message || error)}) — `
        + 'frames are harness-sized, NOT acceptance grade',
    };
  }
}

/**
 * @param mode 'relaxed' | 'realistic'
 *
 * THE MODE WAS HARD-CODED (Goal 21). Every driver in this repository has only
 * ever booted RELAXED, because this helper clicked that card and no caller
 * could say otherwise. Realistic — tighter margins, full maintenance pressure,
 * manual cash handling — has never been exercised by any check, and the
 * stranger who could not find the current task was playing it. Two populations,
 * at the harness level, for the whole life of the harness.
 */
export async function clickThroughMenu(page, {
  forceNew = false,
  pinSeed = null,
  mode = 'relaxed',
  onPrimaryControlRequest = null,
} = {}) {
  // "Continue" renders on every menu — DISABLED on a clean profile. Resume
  // only when it is actually clickable; otherwise start fresh.
  //
  // VERIFY2_L: the exact-match regex could never see an ENABLED Continue —
  // the live button carries label+detail spans, so its flattened textContent
  // is never the bare word. Match containment on the button, click the node
  // directly.
  //
  // GOLDEN PIN (Goal 19): every harness boot lands here with Continue
  // disabled, clicks New Game, and rolls a FRESH RANDOM SEED — measured
  // 2026-08-11: two boots, seeds 97236116 vs 2066143097, interior world-Y
  // -2.23 vs -0.67. The golden suite was comparing screenshots of different
  // worlds, which is the entire "boot-varying world-Y" degradation.
  // `pinSeed` stubs Math.random for exactly the New Game click (main.js
  // draws the seed as (Math.random()*2^31)|0 inside the click handler, which
  // runs synchronously) and restores it immediately after — the world is
  // then identical every run while runtime randomness stays live. `forceNew`
  // keeps an instrument honest even on a profile that could resume: a
  // resumed save is an ARBITRARY world, not the canonical one.
  const canResume = forceNew ? false : await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => /\bContinue\b/.test(candidate.textContent || ''));
    if (!button || button.disabled) return false;
    button.dataset.qaResume = 'true';
    return true;
  }).catch(() => false);
  if (canResume) {
    if (onPrimaryControlRequest) await onPrimaryControlRequest('Continue');
    await page.click('button[data-qa-resume="true"]');
    return 'continue';
  }
  if (pinSeed != null) {
    await page.evaluate((s) => {
      const original = Math.random;
      window.__qaRestoreRandom = () => { Math.random = original; delete window.__qaRestoreRandom; };
      Math.random = () => s;
    }, pinSeed);
  }
  // The menu renders its buttons disabled until the boot manifest is ready;
  // drivers that navigated and clicked immediately used to race it.
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => /new game/i.test(candidate.textContent || ''));
    return !!button && !button.disabled;
  }, null, { timeout: 90000 });
  if (onPrimaryControlRequest) await onPrimaryControlRequest('New Game');
  await page.getByRole('button', { name: /New game/i }).click();
  const modeLabel = /^realistic$/i.test(String(mode)) ? 'Realistic' : 'Relaxed';
  await page.locator('.difficulty-card').filter({ hasText: modeLabel }).click();
  const confirm = page.getByRole('button', { name: /^(Start|Confirm|Yes)/i }).first();
  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();
  // pinSeed note: the menu invokes onNewGame in an ASYNC continuation (a
  // 150 ms post-click restore measured seed 1035912314 — NOT the pinned
  // draw), so the stub must stay installed until the game is actually
  // running. The CALLER restores after its walk-active wait:
  //   await page.evaluate(() => window.__qaRestoreRandom?.());
  return 'new-game';
}

// GOAL 17 — THE TOOL-IS-ACTUALLY-LIVE GATE.
//
// Three separate findings in one session were artefacts of measuring a tool
// that was not switched on, and each one looked completely convincing:
//
//   * the mop's strand divergence, measured across a "stroke" on a mop that
//     was DRY and refusing to run - the banner saying so was in the corner of
//     the evidence screenshot
//   * the fix for that, which set the charge on the object `cleaningStatus()`
//     returns - a fresh copy every call - and reported success
//   * a "dead zone in the hand anchor", which was four sweep steps taken
//     before the rig had started (seatError exactly 0, headAboveFloor null)
//
// One shape, three times: the driver assumed the tool was working because it
// had asked for it. This is the assertion those three needed. It does not
// prepare anything by itself - preparation is the driver's business - it just
// refuses to let a run continue on a tool that is not live, and hands back the
// evidence so the driver can print it.
//
//   const live = await toolIsLive(page, 'mop');
//   if (!live.ok) { console.log('ABORT', JSON.stringify(live)); return { live }; }
export async function toolIsLive(page, tool, { timeoutMs = 20000 } = {}) {
  const rigReady = await page.waitForFunction((id) => {
    const w = window.__fw?.scene3d?.walk;
    if (w?.getTool?.() !== id) return false;
    const d = w.toolRigDiagnostics?.(id);
    // headAboveFloor is null until the rig has actually solved a pose, which
    // is the difference between "equipped" and "running".
    return !!(d && d.headAboveFloor != null);
  }, tool, { timeout: timeoutMs }).then(() => true).catch(() => false);

  const detail = await page.evaluate((id) => {
    const app = window.__fw;
    const w = app?.scene3d?.walk;
    const d = w?.toolRigDiagnostics?.(id) ?? null;
    // The consumable gates, read through the SAME accessor the game reads, not
    // from a store the driver happens to know about.
    const status = app?.scene3d?.clubhouse?.()?.cleaningStatus?.() ?? null;
    const gates = {};
    if (id === 'mop') {
      gates.mopCharge = status?.mop?.charge ?? null;
      gates.mopWet = status?.mop?.wet ?? null;
      // A dry mop REFUSES to work and says so on screen. Measuring a stroke
      // with this false is measuring nothing.
      gates.blocked = !(status?.mop?.charge > 0);
    }
    if (id === 'trashbag') gates.blocked = !!status?.bag?.tied;
    if (id === 'dustpan') gates.blocked = !!status?.pan?.full;
    return {
      held: w?.getTool?.() ?? null,
      headAboveFloor: d?.headAboveFloor ?? null,
      seatError: d?.seatError ?? null,
      geomSource: d?.geomSource ?? null,
      gates,
    };
  }, tool);

  return {
    ok: rigReady && detail.held === tool && detail.gates.blocked !== true,
    rigReady,
    ...detail,
  };
}

// --- IS THIS ELEMENT ACTUALLY ON SCREEN? ------------------------------------
//
// `getComputedStyle(el).opacity` is the value set ON THAT ELEMENT. A child of an
// `opacity: 0` parent reports 1 and passes a naive check while being completely
// invisible.
//
// That is not hypothetical. The G2 screen sweep used the naive check and
// reported a HUD overlap between a key chip inside a transparent prompt and the
// lock hint - two elements that are never drawn in the same state at all. It was
// the only instrument fault of that session which INVENTED a defect rather than
// hiding one, and inventing is worse: false comfort wastes a check, a false
// defect wastes a day.
//
// Naive `.opacity` is still CORRECT for a top-level element with no transparent
// ancestor - the load veil, for instance - which is why most drivers using it
// are fine. Use this whenever the subject is a CHILD of anything.
//
// Returns the source of a page-side function, so a driver can inject it into
// page.evaluate where getComputedStyle actually lives.
export const EFFECTIVE_OPACITY_SRC = `(el) => {
  let o = 1;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.visibility === 'hidden' || s.display === 'none') return 0;
    o *= Number(s.opacity);
    if (o < 0.05) return 0;
  }
  return o;
}`;

/**
 * True when the element is drawn: it has a box, and nothing in its ancestor
 * chain has faded, hidden or collapsed it.
 * Usage: await page.evaluate(isDrawnSrc(), selector)
 */
export const isDrawnSrc = () => `(sel) => {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 3 || r.height < 3) return false;
  return (${EFFECTIVE_OPACITY_SRC})(el) >= 0.05;
}`;
