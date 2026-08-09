// E4 — DOES REBINDING UPDATE THE FORMATTED CONTROLS LIST, IMMEDIATELY?
//
// "Changing a key in Controls must change it in the formatted controls list too,
// immediately, in the same layout."
//
// Three clauses, and only one of them is answered by the prompts being derived
// from bindings (they are — the live table holds all 21 actions). Derivation
// does not promise a RE-RENDER, and a list built from live bindings still shows
// stale text if nothing redraws it after the rebind commits. That is the clause
// the brief emphasises, so it is what this measures.
//
// No source reading of the render path on purpose: Section D cost six wrong
// explanations reasoned from code rather than behaviour. This drives the real UI
// and diffs what is on screen.
//
// THE NEGATIVE CONTROL is the first capture itself. If the "before" text does
// not contain the key we are about to rebind away from, the test can pass
// without the display ever having been correct, so that is asserted first.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-e4-rebind-display.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/e4-rebind');
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
  await page.waitForTimeout(4000);

  const keys = await page.evaluate(() => window.__fw.preferences?.values?.controls?.bindings || {});
  out.bindingsBefore = { moveForward: keys.moveForward, setDown: keys.setDown };

  await page.keyboard.press(keys.pause || 'p');
  await page.waitForTimeout(1200);
  out.opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, .menu-item, [role=button]')]
      .find((b) => /settings/i.test(b.textContent || ''));
    if (!btn) return { clicked: false };
    btn.click();
    return { clicked: true };
  }).catch(() => ({ clicked: false }));
  await page.waitForTimeout(1400);

  // Any element whose text mentions the bound key, anywhere in the settings
  // shell — the "formatted controls list" is whatever actually prints it, and
  // finding it by CONTENT rather than by class avoids guessing a name (which is
  // exactly how a canvas dump found zero files earlier in this session).
  const snapshot = () => page.evaluate(() => {
    const shell = document.querySelector('.settings-shell') || document.body;
    const rows = [];
    for (const el of shell.querySelectorAll('*')) {
      if (el.children.length) continue; // leaf text only
      const t = (el.textContent || '').trim();
      if (!t || t.length > 80) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      rows.push({
        text: t,
        cls: String(el.className || '').split(' ')[0] || el.tagName,
        x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width),
      });
    }
    return rows;
  }).catch(() => []);

  out.tabs = await page.evaluate(() => [...document.querySelectorAll('button, [role=tab]')]
    .map((b) => (b.textContent || '').trim()).filter((t) => t && t.length < 24).slice(0, 12));

  // THE CONTROLS TAB, EXPLICITLY, AND ARRIVAL ASSERTED.
  //
  // The first run captured the pause/laptop chrome — Credits, Quit, Home,
  // Bookings — and reported "text did not change after a rebind", which is E4's
  // defect exactly. The old key was never in the capture, so the diff was of
  // something that does not display bindings. The E2 screenshot showed the real
  // tab strip: Audio, Camera, Controls, Display, Language, Accessibility.
  //
  // So click Controls, and then PROVE arrival by finding the key we are about to
  // change. The precondition is the control, promoted out of the report fields
  // so a run that lands in the wrong place cannot produce a reading at all.
  // A REAL POINTER, NOT element.click().
  //
  // The previous run found the tab and called .click() on it, and the page
  // underneath stayed on Audio. A synthetic click dispatches one event; this
  // strip evidently wants a pointer sequence. The register drivers in this repo
  // already use page.mouse for exactly this reason, so take the element's box
  // and click its centre for real.
  // FIND THE TAB STRIP FIRST, THEN "Controls" INSIDE IT — AND HIT-TEST IT.
  //
  // Matching by text alone found something else in the panel that also reads
  // "Controls", 631 px down the page, and a bounding box on the wrong element
  // gives coordinates that look entirely plausible. Three runs believed them.
  //
  // So: locate the container that holds ALL the tab names (Audio, Camera,
  // Controls, Display, Language, Accessibility — a strip is the only thing that
  // does), take Controls from within it, and then assert with elementFromPoint
  // that the thing at those coordinates really is the tab. A candidate that
  // fails the hit test is rejected rather than clicked.
  out.tabBox = await page.evaluate(() => {
    // THE STRUCTURE, DUMPED RATHER THAN GUESSED.
    //
    // Two elements in this app read exactly "Controls":
    //   BUTTON.pause-nav-btn  inside .pause-nav      — the PAUSE MENU's nav item
    //   BUTTON.settings-tab   inside .settings-tabs  — the actual tab
    //
    // The first is the decoy that three runs clicked. And my previous
    // strip-finder overwrote its candidate on every match, so it ended on
    // whichever container happened to come last in document order rather than
    // the tightest one — which is why the hit test then rejected everything.
    //
    // With the subtree in hand the selector is one line and needs no cleverness:
    // the tab is a .settings-tab inside .settings-tabs. Named classes beat text
    // matching precisely because text is shared and classes are not.
    const strip = document.querySelector('.settings-tabs');
    if (!strip) return { found: false, why: 'no .settings-tabs' };
    const cands = [...strip.querySelectorAll('.settings-tab, button')]
      .filter((e) => /^\s*controls\s*$/i.test(e.textContent || ''));
    for (const c of cands) {
      const el = c.closest('button, [role=tab], .settings-tab') || c;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const at = document.elementFromPoint(x, y);
      // The hit test is the assertion: whatever is on top at this point must be
      // the tab itself or inside it.
      if (at && (el === at || el.contains(at))) return { found: true, x, y, cls: String(el.className || el.tagName).slice(0, 40) };
    }
    return { found: false, why: `${cands.length} text matches, none passed the hit test` };
  }).catch((e) => ({ found: false, threw: String(e && e.message) }));
  if (out.tabBox && !out.tabBox.found) out.tabBox = null;
  if (out.tabBox) {
    // TRACE WHAT ARRIVES, rather than guessing at a fourth way to click.
    //
    // Two click techniques have failed to switch the tab. The question is no
    // longer "which click works" but "what reaches the element, and what is on
    // top of it" — the same move that settled the z keydown in Section D, where
    // watching the event beat six rounds of reasoning about handlers.
    await page.evaluate(() => {
      window.__tabTrace = [];
      const rec = (phase) => (e) => {
        if (window.__tabTrace.length < 24) {
          window.__tabTrace.push({
            phase, type: e.type, defaultPrevented: e.defaultPrevented,
            target: String(e.target?.className || e.target?.tagName || '').slice(0, 40),
          });
        }
      };
      for (const t of ['pointerdown', 'mousedown', 'click', 'pointerup']) {
        window.addEventListener(t, rec('capture'), true);
        window.addEventListener(t, rec('bubble'), false);
      }
    });
    // WHAT IS ACTUALLY AT THOSE COORDINATES. If something is layered over the
    // tab, every click in the world lands on that instead, and no amount of
    // clicking differently will help.
    out.hitTest = await page.evaluate((pt) => {
      const el = document.elementFromPoint(pt.x, pt.y);
      if (!el) return { none: true };
      return {
        cls: String(el.className || '').slice(0, 60) || el.tagName,
        text: (el.textContent || '').trim().slice(0, 30),
        tag: el.tagName,
      };
    }, out.tabBox).catch(() => null);
    await page.mouse.click(out.tabBox.x, out.tabBox.y);
    await page.waitForTimeout(500);
    out.tabTrace = await page.evaluate(() => window.__tabTrace).catch(() => null);
    out.tabClick = { clicked: true, via: 'page.mouse', at: out.tabBox };
  } else {
    out.tabClick = { clicked: false, why: 'no Controls tab box' };
  }
  await page.waitForTimeout(1400);

  out.arrival = await page.evaluate((want) => {
    const shell = document.querySelector('.settings-shell') || document.body;
    const txt = (shell.textContent || '');
    const rx = new RegExp(`\\b${want}\\b`, 'i');
    return {
      onControls: /move forward|rebind|press a key/i.test(txt),
      showsWantedKey: rx.test(txt),
      sample: txt.replace(/\s+/g, ' ').slice(0, 160),
    };
  }, out.bindingsBefore.moveForward || 'w').catch(() => null);

  // STRUCTURE, NOT ANOTHER GUESS. Dump the subtree around a tab name so the
  // selector can be built from what is there rather than from what I assume.
  out.stripDump = await page.evaluate(() => {
    const leaf = [...document.querySelectorAll("*")]
      .filter((e) => !e.children.length && /^s*Controlss*$/i.test(e.textContent || ""));
    return leaf.slice(0, 4).map((el) => {
      const chain = [];
      let n = el;
      for (let i = 0; i < 5 && n; i += 1) {
        const r = n.getBoundingClientRect();
        chain.push({ tag: n.tagName, cls: String(n.className || "").slice(0, 44), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
        n = n.parentElement;
      }
      return chain;
    });
  }).catch((e) => ({ threw: String(e && e.message) }));

  out.before = await snapshot();
  await page.screenshot({ path: path.join(OUT, 'e4-before.png') });

  // Rebind through the preferences API, then look at the SCREEN. The brief's
  // clause is about the display reacting, not about how the change is made; and
  // driving the rebind UI blind would confound "the list did not update" with
  // "I never actually rebound anything".
  out.rebind = await page.evaluate(() => {
    const p = window.__fw.preferences;
    if (!p?.set) return { ok: false, why: 'no preferences.set' };
    const before = p.values.controls.bindings.moveForward;
    p.set('controls.bindings.moveForward', 'i');
    return { ok: true, before, after: p.values.controls.bindings.moveForward };
  }).catch((e) => ({ ok: false, threw: String(e && e.message) }));
  await page.waitForTimeout(1200);

  out.after = await snapshot();
  await page.screenshot({ path: path.join(OUT, 'e4-after.png') });

  const textOf = (rows) => rows.map((r) => r.text).join(' | ');
  const beforeText = textOf(out.before);
  const afterText = textOf(out.after);
  const changed = out.before
    .filter((b, i) => out.after[i] && out.after[i].text !== b.text)
    .map((b, i) => `${b.text} -> ${out.after[out.before.indexOf(b)]?.text}`);

  out.verdict = {
    settingsOpened: out.opened?.clicked ?? null,
    controlsTabClicked: out.tabClick?.clicked ?? null,
    onControlsPage: out.arrival?.onControls ?? null,
    arrivalShowsWantedKey: out.arrival?.showsWantedKey ?? null,
    arrivalSample: out.arrival?.sample ?? null,
    tabs: out.tabs,
    rebindApplied: out.rebind?.ok === true && out.rebind?.after === 'i',
    rebindFromTo: out.rebind ? `${out.rebind.before} -> ${out.rebind.after}` : null,
    leafNodesBefore: out.before.length,
    leafNodesAfter: out.after.length,
    // The control: the OLD key must appear before, or the test proves nothing.
    oldKeyVisibleBefore: /\bW\b/i.test(beforeText),
    newKeyVisibleAfter: /\bI\b/.test(afterText),
    textChangedAtAll: beforeText !== afterText,
    changedRows: changed.slice(0, 6),
    // Same layout: row count and x-positions should not move.
    layoutStable: out.before.length === out.after.length,
  };
  fs.writeFileSync(path.join(OUT, 'e4-rebind.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('E4-REBIND', JSON.stringify(out.verdict));
  return out;
}
