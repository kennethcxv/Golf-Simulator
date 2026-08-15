async (page) => {
  // B4 — ASKED VERSUS OFFERED, at 1x, in the live game.
  //
  // "A customer asking for 1:00 must be checked in at 1:00, 1:30 or 2:00 — a
  // slot at or near what they asked for. If nothing is free within 30 minutes
  // either side, the player OFFERS the nearest available time and the customer
  // accepts or declines."
  //
  // Walks several requested times through the LIVE reservation state and
  // reports, for each: what was asked, what the desk would put in front of the
  // player, and whether every one of those slots is genuinely available.
  //
  // Negative controls, stated before the results are used:
  //   - every offered slot must appear in availableSlots() for the same day and
  //     party size. An offer the sheet cannot honour is worse than no offer.
  //   - a deliberately impossible ask (3 AM) must come back flagged
  //     beyondWindow with exactly one offer. If it comes back "within window",
  //     the window is not being applied and the rest means nothing.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/tee-times');
  fs.mkdirSync(OUT, { recursive: true });
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const bootUrl = `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`;
  await (await import(bootUrl)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 180000 });
  await page.waitForTimeout(1200);

  const speed = await page.evaluate(() => {
    window.__fw.speedIdx = 1;           // 1x — speedIdx 0 is PAUSED in this build
    window.__fw.state.clock.minutes = Math.floor(window.__fw.state.clock.minutes / 1440) * 1440 + 7 * 60;
    return window.__fw.speedIdx;
  });
  assert(speed === 1, `could not set 1x (got ${speed})`);

  const ASKS = [
    ['7:00 AM', 7 * 60],
    ['9:30 AM', 9 * 60 + 30],
    ['1:00 PM', 13 * 60],
    ['4:00 PM', 16 * 60],
    ['6:30 PM', 18 * 60 + 30],
    ['3:00 AM (impossible)', 3 * 60],
  ];

  const rows = await page.evaluate(async (asks) => {
    const { availableSlots, fmtSlot } = await import(new URL('src/sim/reservations.js', document.baseURI).href);
    const { teeTimeOffers, TEE_OFFER, walkInAcceptsOffer } = await import(new URL('src/sim/teeTimeOffer.js', document.baseURI).href);
    const { calendarOf } = await import(new URL('src/sim/time.js', document.baseURI).href);
    const state = window.__fw.state;
    const cal = calendarOf(state.clock.minutes);
    const partySize = 2;
    const open = availableSlots(state, cal.dayAbs, { partySize, walkIn: true });
    const openMinutes = open.map((slot) => slot.minute);
    return asks.map(([label, asked]) => {
      const result = teeTimeOffers(open, asked, { partySize });
      return {
        askedLabel: label,
        askedMinute: asked,
        beyondWindow: result.beyondWindow,
        none: result.none,
        offered: result.offers.map((entry) => ({
          at: fmtSlot(entry.slot.minute),
          minute: entry.slot.minute,
          deltaMin: entry.deltaMin,
          reallyAvailable: openMinutes.includes(entry.slot.minute),
        })),
        // what a customer with no special patience does with the first offer
        firstOfferAccepted: result.offers.length
          ? walkInAcceptsOffer(asked, result.offers[0].slot.minute).accepts
          : null,
        windowMin: TEE_OFFER.windowMin,
      };
    });
  }, ASKS);

  const report = { speedIdx: speed, partySize: 2, rows };
  fs.writeFileSync(path.join(OUT, 'tee-time-offers.json'), JSON.stringify(report, null, 2));

  for (const row of rows) {
    for (const offer of row.offered) {
      assert(offer.reallyAvailable,
        `NEGATIVE CONTROL FAILED: ${row.askedLabel} was offered ${offer.at}, which is not in availableSlots.`);
    }
    if (!row.beyondWindow && !row.none) {
      for (const offer of row.offered) {
        assert(Math.abs(offer.deltaMin) <= row.windowMin,
          `${row.askedLabel} was offered ${offer.at}, ${offer.deltaMin} min away — outside the ${row.windowMin} min window but not flagged.`);
      }
    }
  }
  const impossible = rows.find((row) => row.askedLabel.includes('impossible'));
  assert(impossible && impossible.beyondWindow === true && impossible.offered.length === 1,
    `NEGATIVE CONTROL FAILED: a 3 AM ask came back ${JSON.stringify(impossible)}. The window is not being applied.`);
  return report;
}
