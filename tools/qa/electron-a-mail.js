// A2 (Goal 19) — THE MAIL CLIENT, SEEN WORKING ON THE LAPTOP.
//
// Walks to the front-desk laptop like a player (E to sit), then drives the
// REAL DOM: the Mail nav entry, the inbox list, the reading pane, and the
// Accept action on a booking-request email — which must land on the tee sheet
// with source 'email' and STAY in the inbox with its resolution stamped.
//
// NEGATIVE CONTROL: before any mail is injected, the home card and the Mail
// page must say the inbox is clear — an inbox that invents messages would
// void every later count.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-a-mail.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const OUT = path.resolve('qa/electron/a-mail');
  fs.mkdirSync(OUT, { recursive: true });
  const out = { errs: [] };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(2500);
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });

  // sit at the LIVE laptop — laptop-tour's proven two-stand retry, verbatim
  await page.evaluate(() => {
    const app = window.__fw;
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
    if (app.state.campaign) app.state.campaign.businessOpen = true;
    app.speedIdx = 0;
  });
  {
    // The desk carries several interactables (tee desk, ledger, register);
    // the crosshair raycast decides which one E means. So: stand near the
    // rig, aim square at the machine, and if the prompt names something
    // else, walk the aim in small steps until it says laptop.
    let opened = false;
    const stands = [0.7, 0.95, 1.2];
    for (const back of stands) {
      await page.evaluate((dist) => {
        const app = window.__fw;
        const ch = app.scene3d.clubhouse();
        const rig = ch.laptopRig ? ch.laptopRig() : null;
        const node = rig && rig.object;
        if (!node) return;
        ch.interior.updateMatrixWorld(true);
        const m = node.matrixWorld.elements;
        const lx = m[12]; const ly = m[13]; const lz = m[14];
        const w = app.scene3d.walk.state;
        w.x = lx;
        w.z = lz + dist;
        const dx = lx - w.x;
        const dz = lz - w.z;
        const h = Math.hypot(dx, dz) || 0.001;
        w.yaw = Math.atan2(-dx / h, -dz / h);
        w.pitch = Math.atan2((ly + 0.12) - 1.62, h);
      }, back);
      await page.waitForTimeout(500);
      for (const dPitch of [0, -0.1, 0.1, -0.2]) {
        const prompt = await page.evaluate((dp) => {
          const w = window.__fw.scene3d.walk.state;
          w.pitch += dp;
          return null;
        }, dPitch).then(() => page.waitForTimeout(350))
          .then(() => page.evaluate(() => document.querySelector('.shop-prompt')?.textContent || ''));
        if (!/laptop|manage|office/i.test(prompt)) continue;
        await page.keyboard.press('e');
        opened = await page.waitForFunction(() => window.__fw.laptopOpen === true, null, { timeout: 5000 })
          .then(() => true).catch(() => false);
        if (opened) break;
      }
      if (opened) break;
    }
    if (!opened) throw new Error('laptop did not open: the crosshair never found a laptop prompt');
  }
  await page.waitForFunction(() => {
    const s = document.querySelector('.laptop-screen');
    const f = document.querySelector('.lt-frame');
    return s && s.style.display !== 'none' && f && f.getBoundingClientRect().width > 100;
  }, null, { timeout: 15000 });
  await page.waitForTimeout(1200); // camera ease + UI landing

  // NEGATIVE CONTROL — a clear inbox says so
  out.control = await page.evaluate(() => ({
    unread: (window.__fw.state.mail?.messages || []).filter((m) => !m.read).length,
    navHasMail: !![...document.querySelectorAll('.lt-navbtn')].find((b) => b.textContent.includes('Mail')),
  }));
  await shot('00-laptop-home-clear.png');

  // inject the three mail kinds in the healed shape + the matching live request
  await page.evaluate(() => {
    const state = window.__fw.state;
    const book = state.reservations;
    book.requests = Array.isArray(book.requests) ? book.requests : [];
    const nowAbs = Math.floor(state.clock.minutes);
    const dayAbs = Math.floor(nowAbs / 1440) + 1;
    book.nextRequestId = (book.nextRequestId || 1) + 1;
    const reqId = `req_qa_mail_${book.nextRequestId}`;
    book.requests.push({
      id: reqId, channel: 'email', holder: 'Priya Anand', partySize: 3,
      dayAbs, minute: 9 * 60, createdAtAbs: nowAbs,
      expiresAtAbs: dayAbs * 1440 + 9 * 60 - 60, status: 'pending',
    });
    state.mail = {
      messages: [
        { id: 3, kind: 'complaint', from: 'An unhappy golfer', data: { reviewId: 'qa-r1', stars: 2, text: 'The porch was filthy and nobody was at the desk.', day: 1 }, atAbs: nowAbs - 30, read: false, resolved: null, dedupeKey: 'qa-c1' },
        { id: 2, kind: 'supplier-order', from: 'Fairway Supply Co', data: { orderId: 7, skuName: 'Tour-soft dozen', lineCount: 1, qty: 5, cost: 140, leadDays: 2 }, atAbs: nowAbs - 60, read: false, resolved: null, dedupeKey: 'qa-s1' },
        { id: 1, kind: 'booking-request', from: 'Priya Anand', data: { requestId: reqId, holder: 'Priya Anand', partySize: 3, dayAbs, minute: 9 * 60 }, atAbs: nowAbs - 5, read: false, resolved: null, dedupeKey: 'qa-b1' },
      ],
      nextId: 4,
    };
  });
  // land on Home fresh so the card re-renders with the unread count
  await page.evaluate(() => {
    const home = [...document.querySelectorAll('.lt-navbtn')].find((b) => b.textContent.includes('Home'));
    home?.click();
  });
  await page.waitForTimeout(400);
  out.homeCard = await page.evaluate(() => {
    const dot = document.querySelector('.lt-minihead .lt-belldot');
    return { unreadShown: dot ? dot.textContent : null };
  });
  await shot('01-home-unread.png');

  await page.evaluate(() => {
    const mail = [...document.querySelectorAll('.lt-navbtn')].find((b) => b.textContent.includes('Mail'));
    mail?.click();
  });
  await page.waitForTimeout(400);
  out.inbox = await page.evaluate(() => ({
    rows: document.querySelectorAll('.lt-mailrow').length,
    unreadRows: document.querySelectorAll('.lt-mailrow.unread').length,
  }));
  await shot('02-inbox-list.png');

  // open the booking request (found by content, not index), read it, accept it
  await page.evaluate(() => {
    [...document.querySelectorAll('.lt-mailrow')]
      .find((r) => r.textContent.includes('Tee time request'))?.click();
  });
  await page.waitForTimeout(400);
  await shot('03-request-reading-pane.png');
  out.readingPane = await page.evaluate(() => ({
    subject: document.querySelector('.lt-mailread .lt-minihead')?.textContent || null,
    hasAccept: !![...document.querySelectorAll('.lt-mailread button')].find((b) => b.textContent === 'Accept'),
    hasPropose: !![...document.querySelectorAll('.lt-mailread button')].find((b) => b.textContent.includes('Propose')),
  }));
  await page.evaluate(() => {
    [...document.querySelectorAll('.lt-mailread button')].find((b) => b.textContent === 'Accept')?.click();
  });
  await page.waitForTimeout(500);
  await shot('04-request-accepted.png');
  out.afterAccept = await page.evaluate(() => {
    const state = window.__fw.state;
    const res = (state.reservations.booked || []).find((r) => (r.holder || r.fullName || r.name) === 'Priya Anand');
    const row = (state.mail.messages || []).find((m) => m.kind === 'booking-request');
    return {
      reservation: res ? { source: res.source, minute: res.minute } : null,
      rowKept: !!row,
      rowResolved: row ? row.resolved : null,
      rowRead: row ? row.read : null,
    };
  });

  // the complaint reads as a letter
  await page.evaluate(() => {
    [...document.querySelectorAll('.lt-mailrow')]
      .find((r) => r.textContent.includes('complaint'))?.click();
  });
  await page.waitForTimeout(400);
  await shot('05-complaint.png');
  out.complaint = await page.evaluate(() => ({
    quoted: !!document.querySelector('.lt-mailquote'),
    unreadLeft: (window.__fw.state.mail.messages || []).filter((m) => !m.read).length,
  }));

  out.ok = out.control.unread === 0
    && out.control.navHasMail === true
    && out.homeCard.unreadShown === '3'
    && out.inbox.rows === 3
    && out.inbox.unreadRows === 3
    && out.readingPane.hasAccept === true
    && out.readingPane.hasPropose === true
    && !!out.afterAccept.reservation
    && out.afterAccept.reservation.source === 'email'
    && out.afterAccept.rowKept === true
    && out.afterAccept.rowResolved === 'accepted'
    && out.complaint.quoted === true
    && out.complaint.unreadLeft === 1;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  console.log('A-MAIL', JSON.stringify(out));
  return { ok: out.ok !== false, ...out };
}
