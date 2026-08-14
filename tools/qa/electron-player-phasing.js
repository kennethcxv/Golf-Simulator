// 2.1 (Goal 26) — DOES MY BODY STOP BLOCKING WHEN I AM AT A STATION, AND START
// AGAIN WHEN I LEAVE?
//
// The full four-customer walk-up clip is blocked on getting live traffic into the
// shop (see OVERNIGHT_REPORT_26 2.1 — the save resumes at 06:01 and moving the
// clock forward does not drive the arrival loop). That is a staging problem, not
// a reason to claim the fix untested, so this measures the part that CAN be
// measured on the running game: the predicate all three crowd tests ask, watched
// flipping as the player enters and leaves each station.
//
// This is deliberately not a source assertion. It calls the SAME function
// _customerBlockedAt, crowdNeighbours and crowdClamp call, on the live clubhouse,
// with the player really in register mode -- so it cannot pass while the crowd is
// being told something different.
//
// THE CONTROL IS THE RESTORE. "Phased out at the till" is easy and half the
// requirement; the half that breaks games is failing to restore, which leaves the
// player permanently walk-through-able. Every station is therefore checked for
// BOTH transitions, and a station that never restores is a failure even though it
// passed the first half.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-player-phasing.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/player-phasing');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [], transitions: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(6000);

  const blocks = () => page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return ch.qaPlayerBlocksCustomers ? ch.qaPlayerBlocksCustomers() : null;
  });

  out.baseline = await blocks();
  console.log('BASELINE (walking about, should be TRUE)', out.baseline);
  if (out.baseline !== true) {
    out.summary = { ABORTED: `baseline is ${out.baseline}, not true — the player should block while walking` };
    fs.writeFileSync(path.join(OUT, 'player-phasing.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log('PHASING', JSON.stringify(out.summary));
    return out;
  }

  const station = async (name, enter, leave) => {
    const before = await blocks();
    const entered = await page.evaluate(enter).catch((e) => ({ ok: false, why: String(e.message) }));
    await page.waitForTimeout(700);
    const during = await blocks();
    await page.evaluate(leave).catch(() => {});
    await page.waitForTimeout(900);
    const after = await blocks();
    const row = {
      station: name,
      entered,
      blocksBefore: before,
      blocksDuring: during,
      blocksAfter: after,
      phasedOut: before === true && during === false,
      restored: after === true,
    };
    out.transitions.push(row);
    console.log('STATION', JSON.stringify(row));
    return row;
  };

  await station(
    'register (the till)',
    () => {
      const reg = window.__fw.scene3d.clubhouse()?.register;
      const ok = reg?.enter?.();
      return { ok: !!ok, active: !!reg?.isActive?.() };
    },
    () => { window.__fw.scene3d.clubhouse()?.register?.leave?.({ restorePointer: false }); },
  );

  // THE BOOK HAS TO BE PICKED UP BEFORE IT CAN BE OPENED. setOpen(true) alone
  // returned isOpen() false, so the first version of this arm reported the ledger
  // as "not phased out" when in fact the book was never open and the predicate
  // was never asked the question. A driver that cannot perform the action reports
  // the same as a game that refused it (FOUND_FALSE, shape 12), so the state is
  // now asserted in `entered` and a false there means UNCONFIRMED, not FAILED.
  await station(
    'ledger (in hand and open)',
    () => {
      const book = window.__fw.scene3d.clubhouse()?.ledgerBook;
      if (!book) return { ok: false, why: 'no ledgerBook' };
      try { book.setCarried?.(true); } catch { /* may refuse when out of reach */ }
      try { book.setOpen?.(true); } catch { /* ditto */ }
      // advance() drives the opening state machine to its settled state
      for (let i = 0; i < 24 && !book.isOpen?.(); i += 1) { try { book.advance?.(); } catch { break; } }
      return {
        ok: !!(book.isOpen?.() || book.isCarried?.()),
        open: !!book.isOpen?.(),
        carried: !!book.isCarried?.(),
      };
    },
    () => {
      const book = window.__fw.scene3d.clubhouse()?.ledgerBook;
      try { book?.setOpen?.(false); } catch { /* ignore */ }
      try { book?.setCarried?.(false); } catch { /* ignore */ }
    },
  );

  await station(
    'laptop',
    () => { window.__fw.laptopOpen = true; return { ok: true }; },
    () => { window.__fw.laptopOpen = false; },
  );

  await station(
    'desk screen',
    () => { window.__fw.deskScreenOpen = true; return { ok: true }; },
    () => { window.__fw.deskScreenOpen = false; },
  );

  const rows = out.transitions;
  out.verdict = {
    baselineBlocks: out.baseline,
    stationsTested: rows.length,
    phasedOutAtEveryStation: rows.every((r) => r.phasedOut),
    restoredAfterEveryStation: rows.every((r) => r.restored),
    failures: rows.filter((r) => !r.phasedOut || !r.restored)
      .map((r) => ({ station: r.station, during: r.blocksDuring, after: r.blocksAfter })),
  };
  fs.writeFileSync(path.join(OUT, 'player-phasing.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('PHASING', JSON.stringify(out.verdict, null, 2));
  return out;
}
