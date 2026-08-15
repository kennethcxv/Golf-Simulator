// PLAYTEST 5, ITEM 2 — CUSTOMERS ANNOUNCE THEMSELVES FROM THE BACK OF THE LINE.
//
//   "While someone is still standing in the queue, I get a notification saying
//    'hey I'm X and these are for me' or 'hey I'm X, can I get a tee time for X
//    o'clock'. They must reach the counter first, then ask."
//
// THE MEASUREMENT IS THE SPEAKER'S OWN SLOT. Every customer carries
// `queueSlotHeld`: the slot their BODY currently holds, which Goal 23's queue
// note explains advances only when the floor is clear, deliberately lagging the
// array. So a greeting from anybody whose queueSlotHeld is greater than 0 is a
// greeting from the back of the line, by the game's own bookkeeping, with no
// geometry to argue about.
//
// The three greetings were gated on `counterQueue.indexOf(c) === 0` -- an ARRAY
// position. This driver records both numbers at the instant each line is
// spoken, so the gap between them is visible rather than asserted.
//
// NEGATIVE CONTROL, and the first version of it was NOT STRONG ENOUGH -- see
// the note below, because getting this wrong produced a green verdict about a
// condition the run never created.
//
// A run in which no queue ever forms proves nothing: every speaker would be at
// slot 0 legitimately. But that is only half of it. The two predicates --
// `counterQueue.indexOf(c) === 0` and "the body has reached the head slot" --
// AGREE for as long as nobody leaves the line. They diverge only at the moment
// the head is SPLICED OUT, when the next person becomes index 0 instantly while
// still standing several slots back with someone in front of them.
//
// So the run must observe a REMOVAL FROM A NON-EMPTY QUEUE. The first version
// checked only that a queue formed, watched three customers stand politely in
// line for a minute with nobody served, and printed
// "PASS -- every line came from slot 0" about a divergence window that never
// opened. Without a removal this is INCONCLUSIVE, and it now says so.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-queue-speaks-too-early.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/queue-speaks-too-early');
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.env.QA_TAG || 'run';
  const out = { tag, errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(4000);

  // The shop has to be open for anyone to come in and queue.
  out.opened = await page.evaluate(() => {
    const fw = window.__fw;
    const st = fw.state;
    if (st?.shop) st.shop.signOpen = true;
    if (st?.campaign) st.campaign.businessOpen = true;
    return { signOpen: st?.shop?.signOpen ?? null, businessOpen: st?.campaign?.businessOpen ?? null };
  });
  console.log(`shop opened for trade: ${JSON.stringify(out.opened)}`);

  // Watch every customer-dialogue toast, and at the instant it appears record
  // the SPEAKER's own slot. The toast text carries the name, which is how the
  // speaker is identified -- the same string the player reads.
  await page.evaluate(() => {
    const w = {
      lines: [], deepestQueue: 0, highestSlotSeen: 0,
      // The divergence window: someone left the line while others were still in it.
      removalsFromNonEmptyQueue: 0, lastQueueNames: [],
    };
    window.__queueWatch = w;
    const ch = () => window.__fw?.scene3d?.clubhouse?.();
    const snapshot = () => {
      const list = ch()?.customers?.() || [];
      return list.map((c) => ({
        name: c.fullName || c.name || null,
        short: c.name || null,
        slot: Number.isFinite(c.queueSlotHeld) ? c.queueSlotHeld : null,
        queued: !!c.queued,
        phase: c.checkoutPhase || null,
        cart: Array.isArray(c.cart) ? c.cart.length : 0,
        spoken: !!c.deskGreetingSpoken,
      }));
    };
    // Track how deep the line ever gets, so a run with no queue can be caught.
    setInterval(() => {
      const s = snapshot();
      const queued = s.filter((c) => c.queued);
      w.deepestQueue = Math.max(w.deepestQueue, queued.length);
      for (const c of s) if (Number.isFinite(c.slot)) w.highestSlotSeen = Math.max(w.highestSlotSeen, c.slot);
      const names = queued.map((c) => c.short);
      const gone = w.lastQueueNames.filter((n) => !names.includes(n));
      // Somebody left while somebody else was still standing there: this is the
      // only moment the array head and the floor head can disagree.
      if (gone.length && names.length > 0) w.removalsFromNonEmptyQueue += gone.length;
      w.lastQueueNames = names;
    }, 120);

    const CUSTOMER_LINE = /(these are all for me|could i get|could we get|do you have anything open|have the .* tee time|i have a reservation)/i;
    const seen = new WeakSet();
    const check = (node) => {
      if (!node || node.nodeType !== 1 || seen.has(node)) return;
      const text = (node.textContent || '').trim();
      if (!text || !CUSTOMER_LINE.test(text)) return;
      seen.add(node);
      // The toast node is re-rendered as it animates in, so the same sentence
      // arrives two or three times ("iUpdateHi, I'm..." then "Hi, I'm..."). One
      // line per speaker per sentence, or the count flatters itself.
      const already = w.lines.some((l) => l.text.replace(/[^a-z ]/gi, '').includes(
        text.replace(/[^a-z ]/gi, '').slice(-40),
      ));
      if (already) return;
      const s = snapshot();
      // Whose line is it? The toast carries the speaker's name.
      const speaker = s.find((c) => (c.name && text.includes(c.name)) || (c.short && text.includes(c.short)));
      w.lines.push({
        t: +performance.now().toFixed(0),
        text: text.slice(0, 120),
        speakerSlot: speaker ? speaker.slot : 'SPEAKER-NOT-MATCHED',
        speakerPhase: speaker ? speaker.phase : null,
        queueDepth: s.filter((c) => c.queued).length,
        everyone: s.filter((c) => c.queued).map((c) => `${c.short}@slot${c.slot}`),
      });
    };
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          check(n);
          if (n.querySelectorAll) for (const d of n.querySelectorAll('*')) check(d);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });

  // Build a line using the game's own spawn. The POPULATION is staged; the
  // walking, the queueing and the speaking are entirely the game's.
  out.spawned = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    if (typeof ch.debugSpawn !== 'function') return 'no-debugSpawn';
    let n = 0;
    for (let i = 0; i < 5; i += 1) { ch.debugSpawn(true); n += 1; }
    return n;
  });
  console.log(`spawned toward the counter: ${out.spawned}`);

  // Let them walk in and form a line. Speed the clock so this is minutes of
  // shop time rather than minutes of mine; locomotion is rung-scaled, so they
  // still walk at a walking pace.
  await page.evaluate(() => { window.__fw.speedIdx = 1; });
  // Long enough for the head's patience to run out with nobody serving them,
  // which is what splices the line and opens the divergence window. That is not
  // an exotic scenario: it is what happens whenever the owner is anywhere other
  // than behind the till, which is most of the time.
  const rounds = Number(process.env.QA_ROUNDS) || 40;
  for (let i = 0; i < rounds; i += 1) {
    await page.waitForTimeout(6000);
    const st = await page.evaluate(() => ({
      lines: window.__queueWatch.lines.length,
      deepest: window.__queueWatch.deepestQueue,
      highestSlot: window.__queueWatch.highestSlotSeen,
      removals: window.__queueWatch.removalsFromNonEmptyQueue,
    }));
    console.log(`  +${(i + 1) * 6}s  lines ${st.lines}  deepest ${st.deepest}  highest slot ${st.highestSlot}  removals-from-a-line ${st.removals}`);
    // Stop once the window has actually opened AND somebody has spoken since.
    if (st.removals >= 2 && st.lines >= 2) break;
  }
  await page.screenshot({ path: path.join(OUT, `${tag}-floor.png`) });

  const watch = await page.evaluate(() => ({ ...window.__queueWatch, lines: window.__queueWatch.lines }));
  out.watch = watch;

  console.log(`\nLINES HEARD: ${watch.lines.length}`);
  for (const l of watch.lines) {
    const flag = (typeof l.speakerSlot === 'number' && l.speakerSlot > 0) ? '  <<< SPOKE FROM THE BACK' : '';
    console.log(`  slot ${String(l.speakerSlot).padEnd(20)} depth ${l.queueDepth}  ${JSON.stringify(l.text.slice(0, 70))}${flag}`);
    if (l.everyone?.length) console.log(`      line: ${l.everyone.join(', ')}`);
  }

  const fromTheBack = watch.lines.filter((l) => typeof l.speakerSlot === 'number' && l.speakerSlot > 0);
  const unmatched = watch.lines.filter((l) => l.speakerSlot === 'SPEAKER-NOT-MATCHED');
  out.verdict = {
    linesHeard: watch.lines.length,
    spokenFromTheBack: fromTheBack.length,
    speakersNotMatched: unmatched.length,
    deepestQueueObserved: watch.deepestQueue,
    highestSlotObserved: watch.highestSlotSeen,
    removalsFromNonEmptyQueue: watch.removalsFromNonEmptyQueue,
    // A run where nobody ever stood behind anybody cannot tell the two
    // predicates apart. Neither can a run where nobody ever LEFT a line that
    // still had people in it — that splice is the whole divergence.
    conclusive: watch.lines.length > 0
      && watch.highestSlotSeen >= 1
      && watch.removalsFromNonEmptyQueue >= 1,
  };
  out.verdict.result = !out.verdict.conclusive
    ? `INCONCLUSIVE — queue depth ${watch.deepestQueue}, highest slot ${watch.highestSlotSeen}, `
      + `removals from a non-empty line ${watch.removalsFromNonEmptyQueue}: the divergence window never opened`
    : fromTheBack.length > 0 ? 'REPRODUCED — someone spoke from behind the head slot'
      : 'PASS — every line came from slot 0, and the line did splice while others waited';
  console.log(`\nVERDICT ${JSON.stringify(out.verdict, null, 2)}`);

  fs.writeFileSync(path.join(OUT, `${tag}-result.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
