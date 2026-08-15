// C8 — does fixing a lamp teach itself?
//
// The claim to test is not "the repair works" (it does) but "a first-time
// player, with no overlay and no wiki, can work out WHAT is broken, WHAT it
// needs, WHERE to go next, and WHAT TO DO — from what is on screen."
//
// So this stands under a faulty ceiling panel in pine-hills-v2 and records the
// prompt VERBATIM at each rung of the gate ladder, with a screenshot of what
// the player is looking at while reading it. The four questions are scored
// against the prompt text itself rather than against the source.
//
// Usage (the variant matters — CEILING_PANEL_RIG describes v2):
//   node tools/qa/run-electron.cjs tools/qa/lamp-teaches-itself.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/lamp-teaches');
  fs.mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1600, height: 900 });
  await (await import(`file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`))
    .clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(3200);

  // POINTER LOCK IS A PRECONDITION FOR SEEING ANY PROMPT AT ALL.
  //
  // main.js ~2812: `opacity = label && document.pointerLockElement ? '1' : '0'`.
  // Without the click the prompt carries its full text at opacity 0 — so a
  // driver that reads innerText sees a perfect answer and every screenshot it
  // takes is of an empty screen. Both halves of that were true here before the
  // opacity check was added.
  await page.mouse.click(800, 450);
  await page.waitForTimeout(700);
  const pointerLocked = await page.evaluate(() => !!document.pointerLockElement);

  // The two faults and their world stations, read from the layout rather than
  // typed in, so a moved rig moves this driver with it.
  const stations = await page.evaluate(async () => {
    const layout = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const rig = layout.CEILING_PANEL_RIG;
    const panels = (rig?.panels || []).filter((p) => p.simId === 'panel-02' || p.simId === 'panel-07');
    return panels.map((p) => ({ id: p.id, simId: p.simId, x: p.x, z: p.z }));
  });

  // The shipping prompt is `.shop-prompt` inside the walk overlay (main.js
  // ~2753). The first version of this driver guessed five class names, none of
  // which the build uses, so it captured nothing and scored all four questions
  // false — which reads exactly like "the lamp teaches the player nothing".
  //
  // innerText is not enough for the KEY: ui.js splits "[E]" out into a
  // <kbd class="prompt-key"> keycap, so the flattened text reads "E repair with
  // clubhouse kit" and a /\[E\]/ test scores WHAT TO DO false on a prompt that
  // is showing the player a key. Read the keycap element instead of the string
  // it was rendered from.
  const readPrompt = () => page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.shop-prompt,.dirt-reticle')]
      .filter((n) => n.innerText.trim())
      .map((n) => ({
        text: n.innerText.trim().replace(/\s+/g, ' '),
        keys: [...n.querySelectorAll('.prompt-key')].map((k) => k.textContent.trim()),
        // main.js fades the prompt in by OPACITY and leaves the text in place,
        // so a node with text is not the same thing as a line the player can
        // read. The first screenshots from this driver caught the prompt at
        // opacity 0 — full text in the DOM, nothing on screen.
        opacity: +getComputedStyle(n).opacity,
      }));
    return nodes.length ? nodes : null;
  });

  const standUnder = async (station) => {
    await page.evaluate((st) => {
      const app = window.__fw;
      const o = app.scene3d.clubhouse().interior.position;
      const w = app.scene3d.walk;
      w.clearKeys();
      // Stand just south of the panel and FACE IT. Forward is
      // (-sin yaw, -cos yaw), so yaw 0 looks along -z. The first version used
      // yaw PI, which pointed the camera at the far wall and duly captured the
      // door sign's prompt from across the room instead.
      w.state.x = o.x + st.x;
      w.state.z = o.z + st.z + 0.8;
      w.state.yaw = 0;
      w.state.pitch = 0.90;
      const c = app.state.clock;
      c.minutes = Math.floor(c.minutes / 1440) * 1440 + 13 * 60;
    }, station);
    await page.waitForTimeout(1100);
    // A ceiling panel is a small target inside a 1.45 yd interaction radius, so
    // sweep the aim rather than betting the whole run on one guessed pitch.
    let seen = null;
    for (const p of [0.90, 1.05, 0.75, 1.20, 0.60]) {
      await page.evaluate((v) => { window.__fw.scene3d.walk.state.pitch = v; }, p);
      await page.waitForTimeout(420);
      seen = await readPrompt();
      if (seen && seen.some((n) => /panel|ceiling/i.test(n.text))) break;
    }
    // Let the fade finish before anyone takes a picture of it.
    for (let i = 0; i < 12; i += 1) {
      const now = await readPrompt();
      if (now && now.some((n) => /panel|ceiling/i.test(n.text) && n.opacity > 0.6)) {
        return now;
      }
      await page.waitForTimeout(250);
    }
    return (await readPrompt()) || seen;
  };

  const rungs = [];
  const capture = async (rung) => {
    for (const station of stations) {
      const prompt = await standUnder(station);
      // ONLY PANEL PROMPTS COUNT. The room is full of other props with their own
      // prompts — the door sign, the tee desk — and pooling them all into one
      // string is how an earlier pass scored "where does it come from" TRUE off
      // the words "Tee desk". A driver that scores a different object's text is
      // worse than one that scores nothing.
      const panelPrompt = (prompt || []).filter((n) => /ceiling panel/i.test(n.text));
      const readable = panelPrompt.some((n) => n.opacity > 0.6);
      rungs.push({
        rung, station: station.id, simId: station.simId, prompt, panelPrompt, readable,
      });
      if (panelPrompt.length) {
        await page.screenshot({ path: path.join(OUT, `${rung}-${station.id}.png`) });
      }
    }
  };

  const gatesAt = () => page.evaluate(async () => {
    const mod = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    const s = window.__fw.state;
    return {
      ceilingCircuitPowered: mod.ceilingCircuitPowered ? !!mod.ceilingCircuitPowered(s) : null,
      repairKitAvailable: mod.panelRepairKitAvailable ? !!mod.panelRepairKitAvailable(s) : null,
    };
  });

  const gatesFresh = await gatesAt();
  await capture('unpowered');

  // Rung two: restore the ceiling component, which is what the first prompt now
  // tells the player to go and do, and read the panel again.
  await page.evaluate(async () => {
    const mod = await import(new URL('src/sim/clubhouseRestoration.js', document.baseURI).href);
    mod.setCeilingRestored(window.__fw.state, true);
  });
  await page.waitForTimeout(1200);
  const gatesPowered = await gatesAt();
  await capture('powered');

  const panelText = rungs.flatMap((r) => r.panelPrompt);
  if (!panelText.length) {
    return {
      ok: false,
      inconclusive: true,
      why: 'No CEILING PANEL prompt was captured at any station, so nothing about what the '
        + 'lamp teaches can be concluded. Likely causes, in order: the run was not launched '
        + 'with --clubhouse=pine-hills-v2; the stand-off/aim misses the 1.45 yd interaction '
        + 'radius; the .shop-prompt selector no longer matches the shipping DOM.',
      gatesFresh,
      gatesPowered,
      stations,
      rungs,
    };
  }

  // Score each rung on its own text. The four questions C8 names.
  const scoreOf = (text, keys) => ({
    whatIsBroken: /panel|light|lamp|ceiling/i.test(text),
    whatItNeeds: /kit|circuit|power/i.test(text),
    // deliberately NOT a loose "from the" — it has to name a place or an object
    // to go to, not merely contain a preposition
    whereToGoNext: /repair the ceiling|office|stockroom|shelf|back room|backroom|counter/i.test(text),
    whatToDo: keys.includes('E'),
  });
  const byRung = {};
  for (const name of ['unpowered', 'powered']) {
    const picked = rungs.filter((r) => r.rung === name).flatMap((r) => r.panelPrompt);
    const text = picked.map((n) => n.text).join(' | ');
    const keys = [...new Set(picked.flatMap((n) => n.keys))];
    byRung[name] = { text, keys, teaches: text ? scoreOf(text, keys) : null };
  }
  const teaches = {
    whatIsBroken: Object.values(byRung).some((r) => r.teaches?.whatIsBroken),
    whatItNeeds: Object.values(byRung).some((r) => r.teaches?.whatItNeeds),
    whereToGoNext: Object.values(byRung).some((r) => r.teaches?.whereToGoNext),
    whatToDo: Object.values(byRung).some((r) => r.teaches?.whatToDo),
  };
  const result = {
    pointerLocked,
    gatesFresh,
    gatesPowered,
    stations,
    rungs,
    byRung,
    teaches,
    unanswered: Object.entries(teaches).filter(([, v]) => !v).map(([k]) => k),
    // a prompt only teaches what a player can actually READ
    everyCapturedPromptWasVisible: rungs.filter((r) => r.panelPrompt.length).every((r) => r.readable),
    ok: Object.values(teaches).every(Boolean)
      && rungs.filter((r) => r.panelPrompt.length).every((r) => r.readable),
  };
  fs.writeFileSync(path.join(OUT, 'lamp-teaches.json'), `${JSON.stringify(result, null, 1)}\n`);
  return result;
}
