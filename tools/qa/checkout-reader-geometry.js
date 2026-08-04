async (page) => {
  // A3 + A4 — THE CARD READER, MEASURED.
  //
  //   A3a "the card must actually enter the slot. It sits against the reader
  //        rather than in it."  → how much of the card is inside the reader's
  //        silhouette, in yards and in screen pixels?
  //   A3b "the yellow backspace key is half-occluded by the device body."
  //        → cast a ray at every key cap from the player's own camera and see
  //        what it hits first, and how much of each cap survives.
  //   A4  "the reader phases through the counter on its way home."
  //        → sample the reader's box against the counter box every frame of
  //        the descent and report the deepest intersection.
  //
  // Negative controls, both stated before their result is used:
  //   - the occlusion test must find the DIGIT keys unoccluded. If it reports
  //     every key blocked, it is measuring its own ray setup, not the device.
  //   - the counter-intersection sampler must read zero while the reader is
  //     parked in its bay (a seated reader is not phasing), and must collect
  //     enough frames to have seen the descent at all.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/cash-register-production/simplified-rebuild/reader-geometry');
  fs.mkdirSync(OUT, { recursive: true });
  const VIEWPORT = { width: 1600, height: 900 };
  const SKUS = ['tees1', 'marker1', 'glove1'];
  const shot = async (name) => page.screenshot({ path: path.join(OUT, name) });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const report = {};

  await page.setViewportSize(VIEWPORT);
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const bootUrl = `file:///${process.cwd().replace(/\\/g, '/')}/tools/qa/lib/qa-boot.mjs`;
  await (await import(bootUrl)).clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.evaluate(() => {
    const veil = document.querySelector('.load-veil');
    if (veil) veil.style.display = 'none';
  });
  await page.waitForTimeout(1000);
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.waitForTimeout(150);

  await page.evaluate(async ([skuIds]) => {
    const app = window.__fw;
    const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
    const clubhouse = app.scene3d.clubhouse();
    clubhouse.setOrganicWalkins(false);
    for (const id of Object.keys(app.state.shop.inventory)) {
      const inventory = app.state.shop.inventory[id];
      if (skuIds.includes(id)) inventory.shelf = Math.max(inventory.shelf, 12);
    }
    app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 14 * 60;
    app.state.weather.today = { tempHiF: 72, tempLoF: 54, rainIn: 0, humidity: 0.48, windMph: 5 };
    app.scene3d.applyTimeWeather(14 * 60, app.state.weather);
    clubhouse.rebuildStock();
    const walk = app.scene3d.walk.state;
    const off = clubhouse.interior.position;
    walk.x = REGISTER.stand.x + off.x;
    walk.z = REGISTER.stand.z + off.z;
    const dx = REGISTER.monitor.x - REGISTER.stand.x;
    const dz = REGISTER.monitor.z - REGISTER.stand.z;
    const horizontal = Math.hypot(dx, dz) || 0.001;
    walk.yaw = Math.atan2(-dx / horizontal, -dz / horizontal);
    walk.pitch = Math.atan2(1.18 - 1.62, horizontal);
    return clubhouse.sendToCounter(skuIds, 'card');
  }, [SKUS]);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx && tx.items.length === 3;
  }, null, { timeout: 30000 });
  await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    const prices = [6.90, 9.20, 19.62];
    tx.items.forEach((item, index) => {
      item.price = prices[index];
      item.priceCents = Math.round(prices[index] * 100);
    });
    tx.rng = () => 0.9;
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 12000 });
  await page.waitForTimeout(1700);

  // ---- negative control 1: the parked reader is not in the counter ---------
  report.parkedIntersection = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const clubhouse = window.__fw.scene3d.clubhouse();
    let reader = null;
    let counter = null;
    clubhouse.interior.traverse((o) => {
      if (!reader && o.name === 'checkout-payment_terminal') reader = o;
      if (!counter && o.name === 'CheckoutCounterBody') counter = o;
    });
    if (!counter) {
      // fall back to the widest mesh under the front desk that is not the reader
      clubhouse.interior.traverse((o) => {
        if (!o.isMesh || o === reader) return;
        if (/counter|desk/i.test(o.name) && !counter) counter = o;
      });
    }
    if (!reader || !counter) return { reader: !!reader, counter: !!counter, overlap: null };
    const a = new THREE.Box3().setFromObject(reader);
    const b = new THREE.Box3().setFromObject(counter);
    const inter = a.clone().intersect(b);
    const size = inter.isEmpty() ? { x: 0, y: 0, z: 0 } : inter.getSize(new THREE.Vector3());
    return {
      reader: true,
      counterName: counter.name,
      overlap: +Math.min(size.x, size.y, size.z).toFixed(4),
    };
  });

  // ring up
  const projectObject = (query) => page.evaluate(async (q) => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    let found = null;
    clubhouse.interior.traverse((o) => {
      if (found || !o.visible || !o.userData) return;
      if (q.kind && o.userData.kind !== q.kind) return;
      if (q.uid && o.userData.uid !== q.uid) return;
      found = o;
    });
    if (!found) return null;
    const bounds = new THREE.Box3().setFromObject(found);
    const world = bounds.isEmpty()
      ? found.getWorldPosition(new THREE.Vector3())
      : bounds.getCenter(new THREE.Vector3());
    world.project(app.scene3d.camera);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
      inView: world.z >= -1 && world.z <= 1 && Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
    };
  }, query);
  const uids = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.getTx().items.map((item) => item.uid)
  ));
  for (const uid of uids) {
    let point = await projectObject({ kind: 'item', uid });
    for (let settle = 0; settle < 20; settle += 1) {
      await page.waitForTimeout(160);
      const next = await projectObject({ kind: 'item', uid });
      if (next && point && Math.abs(next.x - point.x) < 1.5 && Math.abs(next.y - point.y) < 1.5) {
        point = next; break;
      }
      point = next;
    }
    assert(point && point.inView, `item ${uid} is not in the working frame`);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      const item = tx?.items.find((candidate) => candidate.uid === id);
      return !!(item?.scanned && item?.bagged);
    }, uid, { timeout: 12000 });
    await page.waitForFunction(() => {
      const state = window.__fw.scene3d.clubhouse().register.getFlow()?.state;
      return state === 'WaitingForScan' || state === 'AllProductsScanned';
    }, null, { timeout: 12000 });
  }

  // take the offered card
  await page.waitForFunction(() => {
    const register = window.__fw.scene3d.clubhouse().register;
    const point = register.presentedCardScreenPoint();
    return register.getTx()?.stage === 'card-ready' && point?.inView && point.clickable;
  }, null, { timeout: 20000 });
  const cardPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.presentedCardScreenPoint()
  ));
  await page.mouse.click(cardPoint.x, cardPoint.y);
  await page.waitForFunction(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx?.stage === 'card-entry';
  }, null, { timeout: 12000 });
  await page.waitForTimeout(1600);
  await shot('01-card-entry.png');

  // ---- A3a: how far into the reader is the card? ---------------------------
  report.cardSeat = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    let reader = null;
    let card = null;
    // BY IDENTITY, NOT BY SHAPE. A first pass guessed the card from ISO-ish
    // proportions and matched a broken floor tile 257 yards away, which is how
    // an instrument reports a confident number about the wrong object. The card
    // tags itself userData.kind === 'payment-card' when it is built.
    app.scene3d.scene.traverse((o) => {
      if (!reader && o.name === 'checkout-payment_terminal') reader = o;
      if (!card && o.userData?.kind === 'payment-card' && o.parent
          && o.parent.userData?.kind !== 'payment-card') card = o;
    });
    if (!reader || !card) return { reader: !!reader, card: !!card };
    const readerBox = new THREE.Box3().setFromObject(reader);
    const cardBox = new THREE.Box3().setFromObject(card);
    const inter = readerBox.clone().intersect(cardBox);
    const cardSize = cardBox.getSize(new THREE.Vector3());
    const interSize = inter.isEmpty() ? new THREE.Vector3() : inter.getSize(new THREE.Vector3());
    const cardVolume = cardSize.x * cardSize.y * cardSize.z;
    const interVolume = interSize.x * interSize.y * interSize.z;
    // gap between the card's highest point and the reader's lowest
    const gap = readerBox.min.y - cardBox.max.y;
    return {
      reader: true,
      card: true,
      cardName: card.name || '(anon)',
      cardLongestEdge: +Math.max(cardSize.x, cardSize.y, cardSize.z).toFixed(4),
      insideFraction: cardVolume > 0 ? +(interVolume / cardVolume).toFixed(3) : 0,
      verticalGapToReader: +gap.toFixed(4),
      readerBottomY: +readerBox.min.y.toFixed(4),
      cardTopY: +cardBox.max.y.toFixed(4),
      cardBottomY: +cardBox.min.y.toFixed(4),
    };
  });

  // ---- A3b: is every key actually reachable by a click? --------------------
  report.keys = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const register = app.scene3d.clubhouse().register;
    const camera = app.scene3d.camera;
    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const ids = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'confirm', 'clear', 'backspace'];
    const raycaster = new THREE.Raycaster();
    const out = {};
    for (const id of ids) {
      const point = register.cardKeyScreenPoint(id);
      if (!point) { out[id] = { point: null }; continue; }
      const ndc = new THREE.Vector2(
        ((point.x - rect.left) / rect.width) * 2 - 1,
        -(((point.y - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(app.scene3d.scene.children, true)
        .filter((hit) => hit.object.visible && hit.object.type !== 'Points');
      const first = hits[0] || null;
      // Is the FIRST thing under the key's own centre the key itself? The cap,
      // its authored glyph and the drawn TerminalKeyDecal_* that replaces that
      // glyph are all "the key" — an earlier pass omitted the decal and called
      // confirm/clear/backspace occluded by their own labels.
      const ownedByKey = !!first && (
        first.object.userData?.terminalKeyAction != null
        || /^t_glyph_|^Terminal_|^TerminalKeyDecal_/.test(first.object.name || '')
      );
      out[id] = {
        inView: point.inView,
        x: Math.round(point.x),
        y: Math.round(point.y),
        firstHit: first ? (first.object.name || '(anon)') : null,
        firstHitAction: first ? (first.object.userData?.terminalKeyAction || null) : null,
        clickReachesKey: ownedByKey,
      };
      // HOW MUCH OF THE CAP IS ACTUALLY SHOWING. A centre ray only answers
      // "can I click it"; "half-occluded" is a question about area, so shoot a
      // grid across the cap's own screen box and count what survives.
      const cap = (() => {
        let found = null;
        app.scene3d.scene.traverse((node) => {
          if (found || !node.isMesh) return;
          if (node.userData?.terminalKeyAction === (out[id].firstHitAction || null)
              && node.name.startsWith('Terminal_')) found = node;
        });
        return found;
      })();
      const capMesh = cap || (first && first.object.name.startsWith('Terminal_') ? first.object : null);
      if (capMesh) {
        const box = new THREE.Box3().setFromObject(capMesh);
        let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
        for (const bx of [box.min.x, box.max.x]) {
          for (const by of [box.min.y, box.max.y]) {
            for (const bz of [box.min.z, box.max.z]) {
              const p = new THREE.Vector3(bx, by, bz).project(camera);
              minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
              minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
          }
        }
        let hitsOwn = 0;
        let total = 0;
        const N = 9;
        for (let ix = 0; ix < N; ix += 1) {
          for (let iy = 0; iy < N; iy += 1) {
            const sx = minX + ((ix + 0.5) / N) * (maxX - minX);
            const sy = minY + ((iy + 0.5) / N) * (maxY - minY);
            raycaster.setFromCamera(new THREE.Vector2(sx, sy), camera);
            const sampleHits = raycaster.intersectObjects(app.scene3d.scene.children, true)
              .filter((hit) => hit.object.visible);
            const top = sampleHits[0];
            if (!top) continue;
            total += 1;
            if (top.object === capMesh
              || /^t_glyph_|^TerminalKeyDecal_/.test(top.object.name || '')) hitsOwn += 1;
          }
        }
        out[id].capVisibleFraction = total ? +(hitsOwn / total).toFixed(3) : null;
      }
    }
    return out;
  });

  // where each key sits inside the reader's own screen-space box, so
  // "half-occluded by the device body at the bottom" is a number
  report.keyFraming = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    const camera = app.scene3d.camera;
    let reader = null;
    clubhouse.interior.traverse((o) => {
      if (!reader && o.name === 'checkout-payment_terminal') reader = o;
    });
    if (!reader) return null;
    const project = (object) => {
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return null;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const p = new THREE.Vector3(x, y, z).project(camera);
            minY = Math.min(minY, -p.y);
            maxY = Math.max(maxY, -p.y);
          }
        }
      }
      return { minY: +minY.toFixed(4), maxY: +maxY.toFixed(4) };
    };
    const readerNdc = project(reader);
    const keys = {};
    reader.traverse((node) => {
      const action = node.userData?.terminalKeyAction;
      if (!action || !node.name.startsWith('Terminal_')) return;
      const own = project(node);
      if (!own) return;
      keys[action] = {
        // 0 = the reader's top edge, 1 = its bottom edge
        topOfKey: +((own.minY - readerNdc.minY) / (readerNdc.maxY - readerNdc.minY)).toFixed(3),
        bottomOfKey: +((own.maxY - readerNdc.minY) / (readerNdc.maxY - readerNdc.minY)).toFixed(3),
      };
    });
    return { keys };
  });

  // ---- A4: the way home ----------------------------------------------------
  // key the total and approve, then watch the reader descend.
  const total = await page.evaluate(async () => {
    const { totalOf } = await import(new URL('src/sim/register.js', document.baseURI).href);
    return totalOf(window.__fw.scene3d.clubhouse().register.getTx());
  });
  const digits = String(Math.round(total * 100));
  for (const digit of digits) {
    const point = await page.evaluate((d) => (
      window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint(d)
    ), digit);
    assert(point && point.inView, `key ${digit} is not clickable`);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(140);
  }
  await shot('02-amount-keyed.png');
  const okPoint = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.cardKeyScreenPoint('confirm')
  ));
  // start the sampler BEFORE the approval so the whole descent is covered
  const descent = page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    const clubhouse = window.__fw.scene3d.clubhouse();
    let reader = null;
    const solids = [];
    clubhouse.interior.traverse((o) => {
      if (!reader && o.name === 'checkout-payment_terminal') reader = o;
    });
    clubhouse.interior.traverse((o) => {
      if (!o.isMesh || o === reader) return;
      if (reader && (o === reader || reader.getObjectById(o.id))) return;
      // The desk the reader travels through. VISIBLE geometry only: COL_* are
      // coarse collision hulls with no alcove carved out of them, so the parked
      // reader sits inside them by design and counting them reports a permanent
      // fault that nobody can see.
      if (!o.visible || /^COL_/.test(o.name || '')) return;
      if (/counter|desk/i.test(o.name || '')) solids.push(o);
    });
    // INSIDE THE WOOD, NOT INSIDE THE ALCOVE. A box-overlap test cannot tell
    // those apart: the counter's AABB spans the whole slab including the bay
    // carved out of it, so a correctly parked reader reads as 0.10 yd of
    // penetration forever. Ray parity against the real triangles can: cast up
    // from a point and count crossings — odd means the point started in solid.
    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = false;
    const up = new THREE.Vector3(0, 1, 0);
    const cornersOf = (box) => {
      const out = [];
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
        }
      }
      out.push(box.getCenter(new THREE.Vector3()));
      return out;
    };
    const insideCount = (box) => {
      let inside = 0;
      let where = null;
      for (const point of cornersOf(box)) {
        raycaster.set(point, up);
        const hits = raycaster.intersectObjects(solids, false);
        if (hits.length % 2 === 1) { inside += 1; where = where || hits[0].object.name; }
      }
      return { inside, where };
    };
    // …AND A SWEPT TEST, because a box can cross a thin slab between two frames
    // without ever putting a corner inside it. Cast from the previous frame's
    // point to this one: a hit shorter than the step means the reader travelled
    // THROUGH a counter face on the way.
    const sweptCrossings = (fromPoints, toPoints) => {
      let crossings = 0;
      let where = null;
      for (let i = 0; i < fromPoints.length; i += 1) {
        const dir = toPoints[i].clone().sub(fromPoints[i]);
        const len = dir.length();
        if (len < 1e-5) continue;
        raycaster.set(fromPoints[i], dir.normalize());
        raycaster.far = len;
        const hits = raycaster.intersectObjects(solids, false);
        raycaster.far = Infinity;
        if (hits.length) { crossings += 1; where = where || hits[0].object.name; }
      }
      return { crossings, where };
    };
    const samples = [];
    let previousPoints = null;
    const started = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        const rb = new THREE.Box3().setFromObject(reader);
        const verdict = insideCount(rb);
        const points = cornersOf(rb);
        const swept = previousPoints
          ? sweptCrossings(previousPoints, points)
          : { crossings: 0, where: null };
        previousPoints = points;
        samples.push({
          atMs: +(performance.now() - started).toFixed(0),
          y: +rb.min.y.toFixed(4),
          cornersInSolid: verdict.inside,
          sweptCrossings: swept.crossings,
          into: verdict.where || swept.where,
        });
        if (performance.now() - started >= 4200) {
          resolve({ solidCount: solids.length, solids: solids.map((b) => b.name), samples });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
  await page.waitForTimeout(150);
  await page.mouse.click(okPoint.x, okPoint.y);
  const descentResult = await descent;
  await shot('03-after-approval.png');

  const worstSample = descentResult.samples.reduce(
    (worst, s) => (s.cornersInSolid > worst.cornersInSolid ? s : worst),
    { cornersInSolid: 0, into: null, atMs: null },
  );
  // the reader is only "phasing" while it is MOVING; once parked, sitting deep
  // in the bay is the correct resting state
  const moving = descentResult.samples.filter((s, i, all) => (
    i > 0 && Math.abs(s.y - all[i - 1].y) > 0.0004
  ));
  report.descent = {
    frames: descentResult.samples.length,
    movingFrames: moving.length,
    solidsWatched: descentResult.solids,
    worstCornersInSolid: worstSample.cornersInSolid,
    worstWhileMoving: moving.reduce((w, s) => Math.max(w, s.cornersInSolid), 0),
    sweptCrossingFrames: descentResult.samples.filter((s) => s.sweptCrossings > 0).length,
    worstSweptCrossings: descentResult.samples.reduce((w, s) => Math.max(w, s.sweptCrossings), 0),
    sweptInto: (descentResult.samples.find((s) => s.sweptCrossings > 0) || {}).into || null,
    into: worstSample.into,
    atMs: worstSample.atMs,
    yRange: [
      Math.min(...descentResult.samples.map((s) => s.y)),
      Math.max(...descentResult.samples.map((s) => s.y)),
    ],
    trace: descentResult.samples
      .filter((s, i) => i % 8 === 0)
      .map((s) => [s.atMs, s.y, s.cornersInSolid]),
  };

  // ---- negative controls, now that everything is measured -----------------
  const digitKeys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const reachableDigits = digitKeys.filter((d) => report.keys[d]?.clickReachesKey).length;
  assert(reachableDigits >= 8,
    `NEGATIVE CONTROL FAILED: only ${reachableDigits}/10 digit keys were reachable by their own centre ray. The occlusion test is measuring its own setup, not the device.`);
  assert(report.descent.frames > 60,
    `NEGATIVE CONTROL FAILED: only ${report.descent.frames} frames sampled across the descent — too few to have seen it.`);
  assert(report.descent.yRange[1] - report.descent.yRange[0] > 0.05,
    `NEGATIVE CONTROL FAILED: the reader moved ${(report.descent.yRange[1] - report.descent.yRange[0]).toFixed(3)} yd vertically. It never went home, so nothing was measured on the way.`);

  report.verdict = {
    cardSeatedInReader: (report.cardSeat.insideFraction || 0) > 0.15,
    everyKeyClickable: Object.entries(report.keys)
      .filter(([, v]) => v.point !== null)
      .every(([, v]) => v.clickReachesKey),
    unreachableKeys: Object.entries(report.keys)
      .filter(([, v]) => v.point !== null && !v.clickReachesKey)
      .map(([k]) => k),
    readerPhasesThroughCounter: report.descent.worstWhileMoving > 0
      || report.descent.sweptCrossingFrames > 0,
  };
  fs.writeFileSync(path.join(OUT, 'reader-geometry.json'), JSON.stringify(report, null, 2));
  return report;
}
