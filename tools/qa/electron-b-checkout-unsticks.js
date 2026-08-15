// B (Goal 24) — THE SALE COMPLETES. BOTH WAYS.
//
// "I bagged everything and the sale will not complete — no card offered."
//
// WHAT THE OLD CHECK MEASURED, and why it passed while this was broken:
// electron-b2-one-visit-one-payment.js plays a combined visit end to end and is
// green. It stages a customer who ALREADY HOLDS A BOOKING, so the errand is a
// CHECK-IN — `reservationId != null` — and check-in has a row on the desk list,
// a button, and a path that clears the errand. The owner's customer is the other
// kind: no booking, wanting a time. That path had no row, no button and no way
// to clear the errand at all, so it never reached payment.
//
// The wall, exactly: openWalkInCustomer deliberately excludes anyone still
// holding goods (the unpaid-exit guard), and the desk bridge used that same
// predicate to decide what the SCREEN may act on. So the moment a shopper asked
// for a tee time mid-sale they vanished from Check In, `deskErrandPending` could
// never be cleared, and the automatic payment advance is gated on
// !deskErrandOutstanding(). Everything bagged, nothing offered, no way out.
//
// This drives both outcomes the brief names, through the shipped screen:
//   B4a  tee time BOOKED   -> one payment, goods AND green fee on one ticket
//   B4b  tee time REFUSED  -> they still pay, for the goods only, and DO NOT
//                             walk out with unpaid stock
// and checks B2's wording and B3's status line on the way past.
//
//   node tools/qa/run-electron.cjs tools/qa/electron-b-checkout-unsticks.js --clubhouse=pine-hills-v2
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const crypto = process.getBuiltinModule('node:crypto');
  const requestedCase = String(process.env.GOAL24_CHECKOUT_CASE || 'both').trim().toLowerCase();
  const requestedMethod = String(process.env.GOAL24_CHECKOUT_METHOD || 'card').trim().toLowerCase();
  const requestedFault = String(process.env.GOAL24_CHECKOUT_FAULT || '').trim().toLowerCase();
  if (!['book', 'adjusted', 'refuse', 'existing', 'both'].includes(requestedCase)) {
    throw new Error(`Unknown GOAL24_CHECKOUT_CASE: ${requestedCase}`);
  }
  if (!['card', 'cash'].includes(requestedMethod)) {
    throw new Error(`Unknown GOAL24_CHECKOUT_METHOD: ${requestedMethod}`);
  }
  const POST_BANK_FAULTS = Object.freeze({
    'paid-customer-presentation': Object.freeze({
      stage: 'paid-customer-presentation',
      message: 'QA injected paid-customer presentation failure.',
      armMethod: 'debugFailNextPaidCustomerPresentation',
    }),
    'paid-customer-release': Object.freeze({
      stage: 'paid-customer-route-release',
      message: 'QA injected paid-customer route-release failure.',
      armMethod: 'debugFailNextPaidCustomerRelease',
    }),
    'bank-helper-return': Object.freeze({
      stage: 'bank-helper-partial-commit-recovered',
      message: 'QA injected bank-helper interruption after core commit.',
      armMethod: 'debugFailNextBankHelperReturn',
    }),
  });
  if (requestedFault && !POST_BANK_FAULTS[requestedFault]) {
    throw new Error(`Unknown GOAL24_CHECKOUT_FAULT: ${requestedFault}`);
  }
  if (requestedFault && (requestedCase !== 'book' || requestedMethod !== 'card')) {
    throw new Error('GOAL24_CHECKOUT_FAULT requires an isolated book/card run.');
  }
  const OUT = path.resolve(process.env.GOAL24_CHECKOUT_OUT
    || `qa/electron/b-checkout-unsticks${requestedCase === 'both' ? '' : `-${requestedCase}`}`);
  fs.mkdirSync(OUT, { recursive: true });
  const out = {
    requestedCase,
    requestedMethod,
    requestedFault: requestedFault || null,
    errs: [],
    consoleErrors: [],
    failedRequests: [],
    httpErrors: [],
    runs: {},
  };
  page.on('pageerror', (e) => out.errs.push(String(e.message || e)));
  page.on('console', (message) => {
    if (message.type() === 'error') out.consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText || 'request failed';
    if (error !== 'net::ERR_ABORTED') out.failedRequests.push({ url: request.url(), error });
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    out.httpErrors.push({
      url: response.url(),
      status: response.status(),
      method: response.request().method(),
      resourceType: response.request().resourceType(),
    });
  });
  const say = (n, d) => { console.log('B', n, JSON.stringify(d)); return d; };

  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  await (await import(`file:///${bootPath}`)).clickThroughMenu(page, { forceNew: true });
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('.load-veil');
    return !v || getComputedStyle(v).opacity === '0';
  }, null, { timeout: 300000 });
  await page.waitForTimeout(3500);

  out.paymentGpuPrewarm = await page.evaluate(() => (
    window.__fw.scene3d.clubhouse().register.cashGpuPrewarmStatus?.() || null
  ));
  out.initialSceneReadiness = await page.evaluate(() => {
    const scene = window.__fw?.scene3d;
    const clubhouse = scene?.clubhouse?.();
    return {
      firstDoorVisibility: scene?.firstDoorVisibilityReport?.() || null,
      sheet06: clubhouse?.sheet06Production?.diagnostics?.() || null,
      paymentGpuPrewarm: clubhouse?.register?.cashGpuPrewarmStatus?.() || null,
    };
  });

  const clickItem = async (uid) => {
    const spot = await page.evaluate(async (id) => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const app = window.__fw;
      const mesh = app.scene3d.clubhouse().register.itemMesh(id);
      if (!mesh) return null;
      const world = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      world.project(app.scene3d.camera);
      const rect = document.querySelector('canvas').getBoundingClientRect();
      return {
        x: rect.left + ((world.x + 1) / 2) * rect.width,
        y: rect.top + ((-world.y + 1) / 2) * rect.height,
        ok: Math.abs(world.x) <= 1 && Math.abs(world.y) <= 1,
      };
    }, uid);
    if (!spot || !spot.ok) return false;
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(1600);
    return true;
  };

  const waitCamera = async (workspace) => {
    await page.evaluate(() => { window.__goal24CheckoutCameraProbe = null; });
    return page.waitForFunction((wanted) => {
      const app = window.__fw;
      const register = app.scene3d.clubhouse().register;
      if (register.workspace() !== wanted) return false;
      const camera = app.scene3d.camera;
      const now = {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        qx: camera.quaternion.x,
        qy: camera.quaternion.y,
        qz: camera.quaternion.z,
        qw: camera.quaternion.w,
        fov: camera.fov,
      };
      const prior = window.__goal24CheckoutCameraProbe;
      if (!prior) {
        window.__goal24CheckoutCameraProbe = { ...now, stable: 0 };
        return false;
      }
      const delta = Math.max(...Object.keys(now).map((key) => Math.abs(now[key] - prior[key])));
      const stable = delta < 0.0008 ? prior.stable + 1 : 0;
      window.__goal24CheckoutCameraProbe = { ...now, stable };
      return stable >= 4;
    }, workspace, { timeout: 12000, polling: 80 }).then(() => true).catch(() => false);
  };

  const waitFreeWalkCamera = async () => {
    await page.evaluate(() => { window.__goal24FreeWalkCameraProbe = null; });
    return page.waitForFunction(() => {
      const app = window.__fw;
      const register = app?.scene3d?.clubhouse?.()?.register;
      if (!app?.scene3d?.walk?.isActive?.() || !register || register.isActive()
          || register.getTx() || register.getCustomer()
          || document.body.classList.contains('register-mode')) return false;
      const camera = app.scene3d.camera;
      const now = {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        qx: camera.quaternion.x,
        qy: camera.quaternion.y,
        qz: camera.quaternion.z,
        qw: camera.quaternion.w,
        fov: camera.fov,
      };
      const prior = window.__goal24FreeWalkCameraProbe;
      if (!prior) {
        window.__goal24FreeWalkCameraProbe = { ...now, stable: 0 };
        return false;
      }
      const delta = Math.max(...Object.keys(now).map((key) => Math.abs(now[key] - prior[key])));
      const stable = delta < 0.0008 ? prior.stable + 1 : 0;
      window.__goal24FreeWalkCameraProbe = { ...now, stable };
      return stable >= 4;
    }, null, { timeout: 12000, polling: 80 }).then(() => true).catch(() => false);
  };

  const leaveRegisterThroughPlayerControls = async () => {
    const trace = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const status = await page.evaluate(() => {
        const register = window.__fw.scene3d.clubhouse().register;
        return {
          active: register.isActive(),
          workspace: register.workspace?.() ?? null,
          hasTx: !!register.getTx(),
          hasCustomer: !!register.getCustomer(),
          bodyClass: document.body.classList.contains('register-mode'),
        };
      });
      trace.push(status);
      if (!status.active) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    const cameraStable = await waitFreeWalkCamera();
    const final = await page.evaluate(() => {
      const app = window.__fw;
      const register = app.scene3d.clubhouse().register;
      return {
        active: register.isActive(),
        walkActive: app.scene3d.walk.isActive(),
        hasTx: !!register.getTx(),
        hasCustomer: !!register.getCustomer(),
        bodyClass: document.body.classList.contains('register-mode'),
      };
    });
    return {
      controls: trace.filter((entry) => entry.active).map(() => 'Escape'),
      trace,
      final,
      cameraStable,
      ok: cameraStable && !final.active && final.walkActive && !final.hasTx
        && !final.hasCustomer && !final.bodyClass,
    };
  };

  const checkoutSaveDigest = async (identity, reservationId) => page.evaluate((args) => {
    const [wanted, wantedReservationId] = args;
    const app = window.__fw;
    const ch = app.scene3d.clubhouse();
    const state = app.state;
    // Missing and non-finite money is corruption, never a convenient zero.
    const cents = (value) => (
      typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null
    );
    const canonical = (value) => {
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === 'object') return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
      );
      return value;
    };
    const sortedPairs = (record, mapValue = (value) => value) => Object.entries(record || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, canonical(mapValue(value))]);
    const exactRows = (state.shop?.transactionHistory || []).filter((row) => (
      Number(row.number) === Number(wanted.number)
        && String(row.customerId || '') === String(wanted.customerId || '')
        && String(row.referenceId || '') === String(wanted.referenceId || '')
    ));
    const ticket = exactRows[0] || null;
    const reservation = (state.reservations?.booked || []).find((entry) => (
      String(entry.id) === String(wantedReservationId)
    )) || null;
    const customer = (state.customerDirectory?.customers || []).find((entry) => (
      String(entry.customerId) === String(wanted.customerId)
    )) || null;
    const entryRelevant = (entry) => (
      String(entry.relatedId || '') === String(wanted.transactionId || '')
        || String(entry.relatedId || '') === String(wanted.referenceId || '')
    );
    const entries = (state.ledger?.entries || []).filter(entryRelevant)
      .map((entry) => ({
        id: entry.id,
        idempotencyKey: entry.idempotencyKey,
        direction: entry.direction,
        category: entry.category,
        lineKey: entry.lineKey,
        accountingClass: entry.accountingClass,
        source: entry.source,
        relatedId: entry.relatedId,
        amountCents: cents(entry.amount),
        cashImpactCents: cents(entry.cashImpact),
        profitImpactCents: cents(entry.profitImpact),
        units: entry.units ?? null,
        customerCount: entry.customerCount ?? null,
        metadata: sortedPairs(entry.metadata),
      }))
      .sort((a, b) => String(a.idempotencyKey).localeCompare(String(b.idempotencyKey)));
    const outcomes = (state.ledger?.outcomes || []).filter(entryRelevant)
      .map((outcome) => ({
        id: outcome.id,
        idempotencyKey: outcome.idempotencyKey,
        type: outcome.type,
        count: outcome.count,
        amountCents: cents(outcome.amount),
        relatedId: outcome.relatedId,
        metadata: sortedPairs(outcome.metadata),
      }))
      .sort((a, b) => String(a.idempotencyKey).localeCompare(String(b.idempotencyKey)));
    const skuIds = [...new Set(wanted.goodsSkuIds || [])].sort();
    const register = ch.register;
    const lifecycle = state.shop?.inventoryLifecycle || {};
    return {
      world: {
        clockMinutes: Number.isFinite(state.clock?.minutes) ? state.clock.minutes : null,
        golfDaySpeedRung: Number.isInteger(state.golfDay?.speedRung)
          ? state.golfDay.speedRung : null,
        propertyId: state.property?.id ?? null,
        holdingId: state.propertyInventory?.propertyId ?? null,
      },
      identity: {
        number: wanted.number,
        transactionId: wanted.transactionId,
        customerId: wanted.customerId,
        reservationId: wantedReservationId,
        referenceId: wanted.referenceId,
      },
      history: {
        totalRows: state.shop?.transactionHistory?.length || 0,
        nextTransactionNo: state.shop?.nextTransactionNo || 1,
        exactRows: exactRows.length,
        ticket: ticket ? {
          number: ticket.number,
          customer: ticket.customer,
          customerId: ticket.customerId,
          method: ticket.method,
          type: ticket.type ?? null,
          referenceId: ticket.referenceId ?? null,
          totalCents: cents(ticket.total),
          netCents: cents(ticket.net),
          taxCents: cents(ticket.tax),
          cashCents: cents(ticket.cash),
          serviceTotalCents: cents(ticket.serviceTotal),
          serviceRevenueKey: ticket.serviceRevenueKey ?? null,
          transactionId: ticket.transactionId ?? ticket.id ?? null,
          taxRate: Number.isFinite(ticket.taxRate) ? ticket.taxRate : null,
          tenderedCents: cents(ticket.tendered),
          changeGivenCents: cents(ticket.changeGiven),
          extraChangeCents: cents(ticket.extraChange),
          lostCents: cents(ticket.lost),
          minute: ticket.minute ?? null,
          customerVisitRecorded: ticket.customerVisitRecorded === true,
          customerVisitEvent: ticket.customerVisitEvent ? {
            schemaVersion: ticket.customerVisitEvent.schemaVersion ?? null,
            id: ticket.customerVisitEvent.id ?? null,
            customerId: ticket.customerVisitEvent.customerId ?? null,
            dayAbs: ticket.customerVisitEvent.dayAbs ?? null,
            purpose: ticket.customerVisitEvent.purpose ?? null,
            outcomes: [...(ticket.customerVisitEvent.outcomes || [])],
            countsAsVisit: ticket.customerVisitEvent.countsAsVisit ?? null,
            paymentMethod: ticket.customerVisitEvent.paymentMethod ?? null,
            amountCents: cents(ticket.customerVisitEvent.amount),
            reservationId: ticket.customerVisitEvent.reservationId ?? null,
            status: ticket.customerVisitEvent.status ?? null,
            failureReason: ticket.customerVisitEvent.failureReason ?? null,
          } : null,
          items: (ticket.items || []).map((item) => ({
            uid: item.uid,
            skuId: item.skuId,
            name: item.name,
            priceCents: cents(item.price),
          })).sort((a, b) => String(a.uid).localeCompare(String(b.uid))),
        } : null,
      },
      reservation: reservation ? {
        id: reservation.id,
        customerId: reservation.customerId ?? null,
        fullName: reservation.fullName ?? reservation.name ?? null,
        dayAbs: reservation.dayAbs ?? null,
        minute: reservation.minute ?? null,
        status: reservation.status ?? null,
        feeCents: cents(reservation.fee),
        paidAmountCents: cents(reservation.paidAmount),
        totalPaidCents: cents(reservation.totalPaid),
        balanceDueCents: cents(reservation.balanceDue),
        checkInTransactionNumber: reservation.checkInTransactionNumber ?? null,
        checkInReferenceId: reservation.checkInReferenceId ?? null,
        paymentMethod: reservation.paymentMethod ?? null,
        paymentStatus: reservation.paymentStatus ?? null,
        checkInStatus: reservation.checkInStatus ?? null,
        currentDestination: reservation.currentDestination ?? null,
        arrivalStatus: reservation.arrivalStatus ?? null,
        visitHistoryRecorded: !!reservation.visitHistoryRecorded,
      } : null,
      inventory: Object.entries(state.shop?.inventory || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([skuId, inventory]) => ({
          skuId,
          shelf: Number(inventory?.shelf || 0),
          back: Number(inventory?.back || 0),
        })),
      shopMovement: canonical({
        held: state.shop?.held || [],
        carry: state.shop?.carry || null,
        deliveries: state.shop?.deliveries || [],
        orders: state.shop?.orders || [],
        lifecycle: {
          schemaVersion: lifecycle.schemaVersion ?? null,
          nextLotId: lifecycle.nextLotId ?? null,
          nextFailureId: lifecycle.nextFailureId ?? null,
          targetLots: (lifecycle.lots || []).filter((lot) => skuIds.includes(lot.skuId)),
          heldAllocations: lifecycle.heldAllocations || {},
        },
      }),
      soldHeldUids: (state.shop?.held || []).filter((unit) => (
        (wanted.goodsUids || []).includes(unit.uid)
      )).map((unit) => unit.uid).sort(),
      books: {
        cashCents: cents(state.cash),
        drawer: Object.entries(state.shop?.drawer || {})
          .map(([denom, count]) => [Number(denom), Number(count)])
          .sort(([a], [b]) => a - b),
        salesLive: {
          units: Number(state.shop?.salesLive?.units || 0),
          revenueCents: cents(state.shop?.salesLive?.revenue),
        },
        salesToday: skuIds.map((skuId) => [skuId, Number(state.shop?.salesToday?.[skuId] || 0)]),
        todayRevenue: sortedPairs(state.ledger?.today?.revenue, cents),
        todayExpense: sortedPairs(state.ledger?.today?.expense, cents),
        ledgerNextSequence: state.ledger?.nextSequence ?? null,
        entries,
        processedEntries: entries.map((entry) => [
          entry.idempotencyKey,
          state.ledger?.processedIds?.[entry.idempotencyKey] ?? null,
        ]),
        outcomes,
        processedOutcomes: outcomes.map((outcome) => [
          outcome.idempotencyKey,
          state.ledger?.processedOutcomeIds?.[outcome.idempotencyKey] ?? null,
        ]),
      },
      salesTax: {
        collectedCents: cents(state.salesTax?.collected),
        remittedCents: cents(state.salesTax?.remitted),
        owedCents: cents(state.salesTax?.owed),
        taxableSalesCents: cents(state.salesTax?.taxableSales),
        nextRemitDay: state.salesTax?.nextRemitDay ?? null,
        lastRemitAmountCents: cents(state.salesTax?.lastRemitAmount),
        lastRemitDay: state.salesTax?.lastRemitDay ?? null,
      },
      customer: customer ? {
        customerId: customer.customerId,
        fullName: customer.fullName,
        visitHistory: {
          totalVisits: customer.visitHistory?.totalVisits ?? 0,
          completedPurchases: customer.visitHistory?.completedPurchases ?? 0,
          completedCheckIns: customer.visitHistory?.completedCheckIns ?? 0,
          noShows: customer.visitHistory?.noShows ?? 0,
          cancellations: customer.visitHistory?.cancellations ?? 0,
          cashPayments: customer.visitHistory?.cashPayments ?? 0,
          cardPayments: customer.visitHistory?.cardPayments ?? 0,
          lifetimeSpendCents: cents(customer.visitHistory?.lifetimeSpend),
          firstVisitDayAbs: customer.visitHistory?.firstVisitDayAbs ?? null,
          lastVisitDayAbs: customer.visitHistory?.lastVisitDayAbs ?? null,
          lastVisitPurpose: customer.visitHistory?.lastVisitPurpose ?? null,
          lastPaymentMethod: customer.visitHistory?.lastPaymentMethod ?? null,
          appliedEvents: [...(customer.visitHistory?.appliedEvents || [])]
            .map((event) => ({ id: event.id, signature: event.signature }))
            .sort((a, b) => String(a.id).localeCompare(String(b.id))),
        },
      } : null,
      runtime: {
        registerActive: register.isActive(),
        registerHasTx: !!register.getTx(),
        registerHasCustomer: !!register.getCustomer(),
        workspace: register.workspace?.() ?? null,
        targetInQueue: (ch.checkoutQueue?.() || []).some((entry) => (
          String(entry.customerId) === String(wanted.customerId)
        )),
        targetInWorld: ch.customers().some((entry) => (
          String(entry.customerId) === String(wanted.customerId)
        )),
        registerModeClass: document.body.classList.contains('register-mode'),
        cardOwnedLive: (() => {
          const status = register.cardOwnedResourceStatus?.() || {};
          return {
            geometries: Number(status.liveGeometries || 0),
            materials: Number(status.liveMaterials || 0),
            textures: Number(status.liveTextures || 0),
          };
        })(),
      },
    };
  }, [identity, reservationId]);

  // Runtime cleanliness remains a separate acceptance gate. Only authorities
  // that are actually serialized participate in byte-for-byte save equality.
  const durableCheckoutDigest = (digest) => {
    const { runtime: _runtime, ...durable } = digest || {};
    // The shipping load flow resumes normal time after the startup veil, so the
    // live clock may advance by a fraction of a minute before Playwright can
    // freeze it. It is checked independently against the saved/canary moments.
    const { clockMinutes: _clockMinutes, ...world } = durable.world || {};
    return { ...durable, world };
  };

  const stableCheckoutSaveDigest = async (identity, reservationId) => {
    let prior = null;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const digest = await checkoutSaveDigest(identity, reservationId);
      const encoded = JSON.stringify(digest);
      if (prior?.encoded === encoded) return { digest, attempts: attempt };
      prior = { digest, encoded };
      await page.waitForTimeout(180);
    }
    throw new Error('Checkout save digest did not reach two consecutive identical samples.');
  };

  // This is deliberately pure so the Node regression can exercise the same
  // accounting oracle against mutated artifact-shaped data. Persistence alone
  // is not correctness: a duplicated or internally consistent bad posting must
  // fail on both sides of a save/load round trip.
  const exactCheckoutDurableAccounting = (digest, identity) => {
    const ticket = digest?.history?.ticket;
    const goods = (ticket?.items || []).filter((item) => !String(item.skuId).startsWith('service:'));
    const services = (ticket?.items || []).filter((item) => String(item.skuId).startsWith('service:'));
    const expectedGoods = [...(identity.expectedGoods || [])]
      .sort((a, b) => String(a.uid).localeCompare(String(b.uid)));
    const actualGoods = goods.map((item) => ({
      uid: item.uid,
      skuId: item.skuId,
      priceCents: item.priceCents,
    })).sort((a, b) => String(a.uid).localeCompare(String(b.uid)));
    const entries = digest?.books?.entries || [];
    const processedEntries = digest?.books?.processedEntries || [];
    const outcomes = digest?.books?.outcomes || [];
    const processedOutcomes = digest?.books?.processedOutcomes || [];
    const expectedEntryKeys = [
      `checkout:${identity.transactionId}:cogs`,
      `checkout:${identity.transactionId}:sale`,
      `checkout:${identity.transactionId}:salestax`,
      `service:reservation-check-in:${identity.referenceId}:revenue`,
    ].sort();
    const entryKeys = entries.map((entry) => entry.idempotencyKey);
    const entryIds = entries.map((entry) => entry.id);
    const processedEntryKeys = processedEntries.map(([key]) => key);
    const processedEntryIds = processedEntries.map(([, id]) => id);
    const outcomeKeys = outcomes.map((entry) => entry.idempotencyKey);
    const outcomeIds = outcomes.map((entry) => entry.id);
    const processedOutcomeKeys = processedOutcomes.map(([key]) => key);
    const processedOutcomeIds = processedOutcomes.map(([, id]) => id);
    const uniqueNonEmpty = (values) => values.length > 0
      && values.every((value) => typeof value === 'string' && value.length > 0)
      && new Set(values).size === values.length;
    if (entries.length !== expectedEntryKeys.length
        || processedEntries.length !== expectedEntryKeys.length
        || outcomes.length !== 1 || processedOutcomes.length !== 1
        || !uniqueNonEmpty(entryKeys) || !uniqueNonEmpty(entryIds)
        || !uniqueNonEmpty(processedEntryKeys) || !uniqueNonEmpty(processedEntryIds)
        || !uniqueNonEmpty(outcomeKeys) || !uniqueNonEmpty(outcomeIds)
        || !uniqueNonEmpty(processedOutcomeKeys) || !uniqueNonEmpty(processedOutcomeIds)
        || JSON.stringify([...entryKeys].sort()) !== JSON.stringify(expectedEntryKeys)
        || JSON.stringify([...processedEntryKeys].sort()) !== JSON.stringify(expectedEntryKeys)) {
      return false;
    }
    const entriesByKey = new Map(entries.map((entry) => [entry.idempotencyKey, entry]));
    const processedEntriesByKey = new Map(processedEntries);
    const cogsEntry = entriesByKey.get(`checkout:${identity.transactionId}:cogs`);
    const saleEntry = entriesByKey.get(`checkout:${identity.transactionId}:sale`);
    const taxEntry = entriesByKey.get(`checkout:${identity.transactionId}:salestax`);
    const serviceEntry = entriesByKey.get(
      `service:reservation-check-in:${identity.referenceId}:revenue`,
    );
    const processedOutcomesByKey = new Map(processedOutcomes);
    const todayRevenue = new Map(digest?.books?.todayRevenue || []);
    const saleMetadata = new Map(saleEntry?.metadata || []);
    const taxMetadata = new Map(taxEntry?.metadata || []);
    const appliedEvents = digest?.customer?.visitHistory?.appliedEvents || [];
    const event = ticket?.customerVisitEvent;
    const expectedVisitEventId = `checkout:${identity.transactionId}:customer-visit`;
    const expectedVisitSignature = JSON.stringify([
      identity.customerId,
      identity.visitDayAbs,
      'tee-time+retail',
      ['purchase', 'check-in'],
      true,
      'card',
      identity.expectedTotalCents / 100,
      String(identity.reservationId),
    ]);
    const entryCashImpact = entries.every((entry) => Number.isInteger(entry.cashImpactCents))
      ? entries.reduce((sum, entry) => sum + entry.cashImpactCents, 0) : null;
    const entryProfitImpact = entries.every((entry) => Number.isInteger(entry.profitImpactCents))
      ? entries.reduce((sum, entry) => sum + entry.profitImpactCents, 0) : null;
    const taxRateMatches = Number.isFinite(ticket?.taxRate)
      && Number.isFinite(identity.expectedTaxRate)
      && Math.abs(ticket.taxRate - identity.expectedTaxRate) <= 1e-12;
    const exactExpectedMoney = [
      identity.expectedGoodsNetCents,
      identity.expectedServiceTotalCents,
      identity.expectedTaxCents,
      identity.expectedTotalCents,
      identity.expectedGoodsCostCents,
      identity.shopSalesBeforeCents,
      identity.greenFeesBeforeCents,
    ].every(Number.isInteger);
    return exactExpectedMoney
      && ticket?.transactionId === identity.transactionId
      && JSON.stringify(actualGoods) === JSON.stringify(expectedGoods)
      && services.length === 1
      && services[0]?.priceCents === identity.expectedServiceTotalCents
      && ticket?.netCents === identity.expectedGoodsNetCents
      && ticket?.serviceTotalCents === identity.expectedServiceTotalCents
      && taxRateMatches
      && ticket?.taxCents === identity.expectedTaxCents
      && ticket.taxCents === Math.round(ticket.netCents * ticket.taxRate)
      && ticket?.totalCents === identity.expectedTotalCents
      && ticket.totalCents === ticket.netCents + ticket.taxCents + ticket.serviceTotalCents
      && cogsEntry?.amountCents === identity.expectedGoodsCostCents
      && cogsEntry?.units === expectedGoods.length
      && cogsEntry?.cashImpactCents === 0
      && cogsEntry?.profitImpactCents === -identity.expectedGoodsCostCents
      && saleEntry?.amountCents === identity.expectedGoodsNetCents
      && saleEntry?.units === expectedGoods.length
      && saleEntry?.cashImpactCents === identity.expectedGoodsNetCents
      && saleEntry?.profitImpactCents === identity.expectedGoodsNetCents
      && taxEntry?.amountCents === identity.expectedTaxCents
      && taxEntry?.cashImpactCents === identity.expectedTaxCents
      && taxEntry?.profitImpactCents === 0
      && serviceEntry?.amountCents === identity.expectedServiceTotalCents
      && serviceEntry?.cashImpactCents === identity.expectedServiceTotalCents
      && serviceEntry?.profitImpactCents === identity.expectedServiceTotalCents
      && entryCashImpact === identity.expectedTotalCents
      && entryProfitImpact === identity.expectedGoodsNetCents
        + identity.expectedServiceTotalCents - identity.expectedGoodsCostCents
      && entries.every((entry) => processedEntriesByKey.get(entry.idempotencyKey) === entry.id)
      && todayRevenue.get('shopSales')
        === identity.shopSalesBeforeCents + identity.expectedGoodsNetCents
      && todayRevenue.get('greenFees')
        === identity.greenFeesBeforeCents + identity.expectedServiceTotalCents
      && saleMetadata.get('tax') === identity.expectedTaxCents / 100
      && saleMetadata.get('taxRate') === identity.expectedTaxRate
      && saleMetadata.get('ticketTotal') === identity.expectedTotalCents / 100
      && taxMetadata.get('taxRate') === identity.expectedTaxRate
      && taxMetadata.get('ticketTotal') === identity.expectedTotalCents / 100
      && digest?.salesTax?.collectedCents
        === identity.salesTaxBefore.collectedCents + identity.expectedTaxCents
      && digest?.salesTax?.owedCents
        === identity.salesTaxBefore.owedCents + identity.expectedTaxCents
      && digest?.salesTax?.taxableSalesCents
        === identity.salesTaxBefore.taxableSalesCents + identity.expectedGoodsNetCents
      && event?.schemaVersion === 1
      && event?.id === expectedVisitEventId
      && event?.customerId === identity.customerId
      && event?.dayAbs === identity.visitDayAbs
      && event?.purpose === 'tee-time+retail'
      && JSON.stringify(event?.outcomes) === JSON.stringify(['purchase', 'check-in'])
      && event?.countsAsVisit === true
      && event?.paymentMethod === 'card'
      && event?.amountCents === identity.expectedTotalCents
      && String(event?.reservationId) === String(identity.reservationId)
      && event?.status === 'applied'
      && event?.failureReason === null
      && appliedEvents.length === 1
      && appliedEvents[0]?.id === expectedVisitEventId
      && appliedEvents[0]?.signature === expectedVisitSignature
      && outcomes[0]?.idempotencyKey === `checkout:${identity.transactionId}:completed`
      && outcomes[0]?.amountCents === identity.expectedTotalCents
      && processedOutcomesByKey.get(outcomes[0].idempotencyKey) === outcomes[0].id;
  };

  const validCheckoutSaveDigest = (digest, identity) => {
    const ticket = digest?.history?.ticket;
    const goods = (ticket?.items || []).filter((item) => !String(item.skuId).startsWith('service:'));
    const services = (ticket?.items || []).filter((item) => String(item.skuId).startsWith('service:'));
    const history = digest?.customer?.visitHistory;
    const expectedGoods = [...(identity.goodsUids || [])].sort();
    const revenue = new Map(digest?.books?.todayRevenue || []);
    const entries = digest?.books?.entries || [];
    const entriesByKey = new Map(entries.map((entry) => [entry.idempotencyKey, entry]));
    const expectedEntryKeys = [
      `checkout:${identity.transactionId}:cogs`,
      `checkout:${identity.transactionId}:sale`,
      `checkout:${identity.transactionId}:salestax`,
      `service:reservation-check-in:${identity.referenceId}:revenue`,
    ].sort();
    const actualEntryKeys = entries.map((entry) => entry.idempotencyKey).sort();
    const cogsEntry = entriesByKey.get(`checkout:${identity.transactionId}:cogs`);
    const saleEntry = entriesByKey.get(`checkout:${identity.transactionId}:sale`);
    const taxEntry = entriesByKey.get(`checkout:${identity.transactionId}:salestax`);
    const serviceEntry = entriesByKey.get(`service:reservation-check-in:${identity.referenceId}:revenue`);
    const processedEntries = new Map(digest?.books?.processedEntries || []);
    const outcomes = digest?.books?.outcomes || [];
    const processedOutcomes = new Map(digest?.books?.processedOutcomes || []);
    const targetInventory = new Map((digest?.inventory || []).map((entry) => [entry.skuId, entry]));
    const drawerBefore = identity.drawerBeforePairs || [];
    const salesTaxBefore = identity.salesTaxBefore || {};
    const finiteTicketMoney = [
      ticket?.totalCents, ticket?.netCents, ticket?.taxCents,
      ticket?.cashCents, ticket?.serviceTotalCents, ticket?.lostCents,
    ].every(Number.isInteger);
    const entryCashImpact = entries.reduce((sum, entry) => sum + entry.cashImpactCents, 0);
    const eventOutcomes = [...(ticket?.customerVisitEvent?.outcomes || [])].sort();
    const inventoryStayedDebited = Object.entries(identity.inventoryBeforeBank || {}).every(
      ([skuId, before]) => {
        const after = targetInventory.get(skuId);
        return after?.shelf === before.shelf && after?.back === before.back;
      },
    );
    const exactSalesToday = Object.entries(identity.salesTodayBefore || {}).every(
      ([skuId, before]) => new Map(digest?.books?.salesToday || []).get(skuId)
        === before + Number(identity.goodsSkuCounts?.[skuId] || 0),
    );
    return exactCheckoutDurableAccounting(digest, identity)
      && digest?.history?.exactRows === 1
      && digest.history.totalRows === Math.min(100, identity.historyBefore + 1)
      && digest.history.nextTransactionNo === Number(identity.number) + 1
      && ticket?.method === 'card'
      && ticket?.referenceId === identity.referenceId
      && JSON.stringify(goods.map((item) => item.uid).sort()) === JSON.stringify(expectedGoods)
      && services.length === 1
      && finiteTicketMoney
      && ticket.totalCents > 0 && ticket.netCents > 0 && ticket.serviceTotalCents > 0
      && ticket.taxCents > 0 && ticket.taxRate > 0
      && ticket.totalCents === ticket.netCents + ticket.taxCents + ticket.serviceTotalCents
      && ticket.cashCents === ticket.totalCents
      && ticket.lostCents === 0
      && ticket.tenderedCents === null && ticket.changeGivenCents === null
      && ticket.extraChangeCents === null
      && digest?.reservation?.status === 'played'
      && Number(digest?.reservation?.checkInTransactionNumber) === Number(identity.number)
      && digest?.reservation?.checkInReferenceId === identity.referenceId
      && String(digest?.reservation?.customerId || '') === String(identity.customerId || '')
      && digest.reservation.feeCents === ticket.serviceTotalCents
      && digest.reservation.paidAmountCents === ticket.serviceTotalCents
      && digest.reservation.totalPaidCents === ticket.serviceTotalCents
      && digest.reservation.balanceDueCents === 0
      && digest.reservation.paymentMethod === 'card'
      && digest.reservation.paymentStatus === 'paid'
      && digest.reservation.checkInStatus === 'checked-in'
      && digest.reservation.visitHistoryRecorded === true
      && digest?.soldHeldUids?.length === 0
      && inventoryStayedDebited
      && JSON.stringify(digest?.books?.drawer || []) === JSON.stringify(drawerBefore)
      && digest?.books?.cashCents === identity.cashBeforeCents + ticket.totalCents
      && digest?.books?.salesLive?.units === identity.salesLiveBefore.units + goods.length
      && digest?.books?.salesLive?.revenueCents
        === identity.salesLiveBefore.revenueCents + ticket.netCents
      && exactSalesToday
      && revenue.get('shopSales') === identity.shopSalesBeforeCents + ticket.netCents
      && revenue.get('greenFees') === identity.greenFeesBeforeCents + ticket.serviceTotalCents
      && JSON.stringify(actualEntryKeys) === JSON.stringify(expectedEntryKeys)
      && cogsEntry?.lineKey === 'costOfGoods' && cogsEntry.amountCents > 0
      && cogsEntry.cashImpactCents === 0 && cogsEntry.profitImpactCents === -cogsEntry.amountCents
      && saleEntry?.lineKey === 'shopSales' && saleEntry.amountCents === ticket.netCents
      && saleEntry.cashImpactCents === ticket.netCents
      && taxEntry?.lineKey === 'salesTaxCollected' && taxEntry.amountCents === ticket.taxCents
      && taxEntry.cashImpactCents === ticket.taxCents && taxEntry.profitImpactCents === 0
      && serviceEntry?.lineKey === 'greenFees'
      && serviceEntry.amountCents === ticket.serviceTotalCents
      && serviceEntry.cashImpactCents === ticket.serviceTotalCents
      && entryCashImpact === ticket.totalCents
      && entries.every((entry) => processedEntries.get(entry.idempotencyKey) === entry.id)
      && outcomes.length === 1
      && outcomes[0].idempotencyKey === `checkout:${identity.transactionId}:completed`
      && outcomes[0].type === 'checkoutCompleted'
      && outcomes[0].count === 1
      && outcomes[0].amountCents === ticket.totalCents
      && processedOutcomes.get(outcomes[0].idempotencyKey) === outcomes[0].id
      && digest?.salesTax?.collectedCents
        === salesTaxBefore.collectedCents + ticket.taxCents
      && digest?.salesTax?.owedCents === salesTaxBefore.owedCents + ticket.taxCents
      && digest?.salesTax?.taxableSalesCents
        === salesTaxBefore.taxableSalesCents + ticket.netCents
      && digest?.salesTax?.remittedCents === salesTaxBefore.remittedCents
      && digest?.world?.clockMinutes >= ticket.minute
      && digest?.world?.clockMinutes < ticket.minute + 0.5
      && digest?.world?.golfDaySpeedRung === 1
      && digest?.world?.propertyId === identity.propertyId
      && digest?.world?.holdingId === identity.holdingId
      && history?.totalVisits === 1
      && history?.completedPurchases === 1
      && history?.completedCheckIns === 1
      && history?.cardPayments === 1
      && history?.cashPayments === 0
      && history?.lifetimeSpendCents === ticket?.totalCents
      && ticket?.customerVisitRecorded === true
      && ticket?.customerVisitEvent?.status === 'applied'
      && ticket?.customerVisitEvent?.id === `checkout:${identity.transactionId}:customer-visit`
      && ticket?.customerVisitEvent?.customerId === identity.customerId
      && String(ticket?.customerVisitEvent?.reservationId) === String(identity.reservationId)
      && ticket?.customerVisitEvent?.paymentMethod === 'card'
      && ticket?.customerVisitEvent?.amountCents === ticket.totalCents
      && ticket?.customerVisitEvent?.countsAsVisit === true
      && ticket?.customerVisitEvent?.failureReason === null
      && JSON.stringify(eventOutcomes) === JSON.stringify(['check-in', 'purchase'])
      && history?.appliedEvents?.some((event) => (
        event.id === ticket.customerVisitEvent.id && !!event.signature
      ))
      && digest?.runtime?.registerActive === false
      && digest?.runtime?.registerHasTx === false
      && digest?.runtime?.registerHasCustomer === false
      && digest?.runtime?.targetInQueue === false
      && digest?.runtime?.targetInWorld === false
      && digest?.runtime?.registerModeClass === false
      && Object.values(digest?.runtime?.cardOwnedLive || {}).every((value) => value === 0);
  };

  const readNativeSlotEvidence = async () => page.evaluate(async () => {
    if (!window.fairwayNative?.loadStatus) {
      return { native: false, source: 'unavailable', recovered: null, bytes: 0 };
    }
    const [record, metadata] = await Promise.all([
      window.fairwayNative.loadStatus('slot1', { repair: false }),
      window.fairwayNative.loadStatus('slot1-meta', { repair: false }),
    ]);
    const raw = record?.value == null ? '' : JSON.stringify(record.value);
    const encoded = new TextEncoder().encode(raw);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return {
      native: true,
      bytes: encoded.byteLength,
      source: record?.source || 'none',
      recovered: record?.recovered === true,
      repairedPrimary: record?.repairedPrimary === true,
      missing: record?.missing === true,
      primaryError: record?.primaryError || null,
      backupError: record?.backupError || null,
      sha256: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      metadata: {
        source: metadata?.source || 'none',
        recovered: metadata?.recovered === true,
        repairedPrimary: metadata?.repairedPrimary === true,
        missing: metadata?.missing === true,
        primaryError: metadata?.primaryError || null,
        backupError: metadata?.backupError || null,
        savedAt: Number.isFinite(metadata?.value?.savedAt) ? metadata.value.savedAt : null,
      },
    };
  });

  const isDeserializeOrSchemaRepairNotice = (message) => (
    /repaired\s+\d+\s+invalid save field\(s\)/i.test(String(message || ''))
      || /migrated\s+\d+\s+save schema step\(s\)/i.test(String(message || ''))
  );

  const isVisualFallbackNotice = (message) => (
    /used safe fallback visuals/i.test(String(message || ''))
  );

  const manualCheckoutSaveLoad = async (identity, reservationId) => {
    const referenceId = `reservation:${reservationId}:check-in`;
    const durableIdentity = { ...identity, referenceId, reservationId };
    const registerExit = await leaveRegisterThroughPlayerControls();
    const beforeStable = await stableCheckoutSaveDigest(durableIdentity, reservationId);
    const before = beforeStable.digest;
    const beforeJson = JSON.stringify(durableCheckoutDigest(before));
    const beforeSha256 = crypto.createHash('sha256').update(beforeJson).digest('hex');
    const nativeBefore = await readNativeSlotEvidence();
    await page.keyboard.press('p');
    const pause = page.getByRole('dialog', { name: 'Pause menu', exact: true });
    await pause.waitFor({ state: 'visible', timeout: 10000 });
    await pause.getByRole('button', { name: 'Save game', exact: true }).click();
    const slotOne = pause.locator('.slot-card').nth(0);
    await slotOne.locator('.slot-name').getByText('Slot 1', { exact: true })
      .waitFor({ state: 'visible', timeout: 10000 });
    const saveHere = slotOne.getByRole('button', { name: 'Save here', exact: true });
    await saveHere.waitFor({ state: 'visible', timeout: 10000 });
    await saveHere.click();
    const replace = page.getByRole('dialog', { name: 'Replace slot 1?', exact: true });
    const overwriteConfirmed = await replace.waitFor({ state: 'visible', timeout: 1200 })
      .then(() => true).catch(() => false);
    if (overwriteConfirmed) {
      await replace.getByRole('button', { name: 'Replace and save', exact: true }).click();
    }
    await page.waitForFunction(() => (
      document.querySelector('.pause-status')?.textContent?.includes('Saved to slot 1')
    ), null, { timeout: 15000 });
    const storage = await readNativeSlotEvidence();
    storage.metadataFresh = storage.metadata?.savedAt != null
      && (nativeBefore.metadata?.savedAt == null
        || storage.metadata.savedAt > nativeBefore.metadata.savedAt);
    await page.screenshot({ path: path.join(OUT, 'book-card-save-slot-1.png'), scale: 'css' });

    // A new scene is not proof that Load consumed the saved slot. Advance the
    // durable clock through normal controls after saving, prove live state has
    // diverged, then ask the real menu to restore the saved moment.
    await pause.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.keyboard.press('Space');
    await page.waitForFunction((savedMinute) => (
      window.__fw.state.clock.minutes >= savedMinute + 2
    ), before.world.clockMinutes, { timeout: 20000 });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__fw.speedIdx === 0, null, { timeout: 5000 });
    const canaryDigest = await checkoutSaveDigest(durableIdentity, reservationId);
    const canary = {
      controls: ['Resume', 'Space (run)', 'Space (pause)'],
      savedClockMinutes: before.world.clockMinutes,
      liveClockMinutes: canaryDigest.world.clockMinutes,
      advanced: canaryDigest.world.clockMinutes >= before.world.clockMinutes + 2,
      durableChanged: canaryDigest.world.clockMinutes !== before.world.clockMinutes,
    };
    await page.keyboard.press('p');
    await pause.waitFor({ state: 'visible', timeout: 10000 });
    await pause.getByRole('button', { name: 'Load game', exact: true }).click();
    const loadSlotOne = pause.locator('.slot-card').nth(0);
    await loadSlotOne.locator('.slot-name').getByText('Slot 1', { exact: true })
      .waitFor({ state: 'visible', timeout: 10000 });
    const load = loadSlotOne.getByRole('button', { name: 'Load', exact: true });
    await load.waitFor({ state: 'visible', timeout: 10000 });
    await page.evaluate(() => { window.__goal24SceneBeforeSlotLoad = window.__fw.scene3d; });
    await load.click();
    const confirmation = page.getByRole('dialog', { name: 'Load slot 1?', exact: true });
    await confirmation.waitFor({ state: 'visible', timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'book-card-load-slot-1-confirmation.png'), scale: 'css' });
    await page.evaluate(() => {
      window.__goal24LoadNoticeObserver?.disconnect?.();
      window.__goal24LoadNoticeMessages = [];
      const capture = () => {
        for (const node of document.querySelectorAll('.notification-message')) {
          const message = String(node.textContent || '').trim();
          if (message) window.__goal24LoadNoticeMessages.push(message);
        }
      };
      window.__goal24LoadNoticeObserver = new MutationObserver(capture);
      window.__goal24LoadNoticeObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      capture();
    });
    await confirmation.getByRole('button', { name: 'Load game', exact: true }).click();
    await page.waitForFunction(() => (
      window.__fw?.scene3d
        && window.__fw.scene3d !== window.__goal24SceneBeforeSlotLoad
        && window.__fw.scene3d.clubhouse?.()
    ), null, { timeout: 90000 });
    await page.waitForFunction(() => {
      const app = window.__fw;
      const veil = document.querySelector('.load-veil');
      const prewarm = app?.scene3d?.clubhouse?.()?.register?.cashGpuPrewarmStatus?.();
      const firstDoor = app?.scene3d?.firstDoorVisibilityReport?.();
      return app?.screen === 'game'
        && app.scene3d.walk?.isActive?.()
        && (!veil || veil.style.display === 'none' || Number.parseFloat(getComputedStyle(veil).opacity) <= 0.01)
        && prewarm?.complete === true && prewarm?.released === true
        && typeof firstDoor?.status === 'string';
    }, null, { timeout: 120000 });
    // Read the shipping runtime before the verifier changes anything. A direct
    // speed assignment or clearKeys here would hide a bad restore behind QA.
    const restoredRuntime = await page.evaluate(() => {
      const app = window.__fw;
      const register = app.scene3d.clubhouse().register;
      return {
        screen: app.screen,
        prewarming: !!app.prewarming,
        speedIdx: app.speedIdx,
        savedSpeedRung: app.state.golfDay?.speedRung ?? null,
        clockMinutes: app.state.clock?.minutes ?? null,
        walkActive: app.scene3d.walk?.isActive?.() === true,
        registerActive: register.isActive(),
        registerHasTx: !!register.getTx(),
        registerHasCustomer: !!register.getCustomer(),
        registerModeClass: document.body.classList.contains('register-mode'),
        pointerLocked: !!document.pointerLockElement,
        firstDoorVisibility: app.scene3d.firstDoorVisibilityReport?.() || null,
        sheet06: app.scene3d.clubhouse().sheet06Production?.diagnostics?.() || null,
        paymentGpuPrewarm: register.cashGpuPrewarmStatus?.() || null,
      };
    });
    // loadNotice is intentionally presented 460 ms after the veil drops. Keep
    // the observer alive across that boundary so a short-lived repair banner
    // cannot disappear before the artifact reads it.
    await page.waitForTimeout(900);
    const loadNotifications = await page.evaluate(() => {
      for (const node of document.querySelectorAll('.notification-message')) {
        const message = String(node.textContent || '').trim();
        if (message) window.__goal24LoadNoticeMessages.push(message);
      }
      window.__goal24LoadNoticeObserver?.disconnect?.();
      window.__goal24LoadNoticeObserver = null;
      const messages = [...new Set(window.__goal24LoadNoticeMessages || [])];
      window.__goal24LoadNoticeMessages = [];
      return messages;
    });
    const deserializeOrSchemaRepairNotices = loadNotifications
      .filter(isDeserializeOrSchemaRepairNotice);
    const visualFallbackNotices = loadNotifications.filter(isVisualFallbackNotice);
    let pausedRestoredRuntimeThroughControl = restoredRuntime.speedIdx === 0;
    if (!pausedRestoredRuntimeThroughControl) {
      await page.keyboard.press('Space');
      pausedRestoredRuntimeThroughControl = await page.waitForFunction(() => (
        window.__fw.speedIdx === 0
      ), null, { timeout: 5000 }).then(() => true).catch(() => false);
    }
    await page.waitForFunction(() => window.__fw.speedIdx === 0, null, { timeout: 5000 });
    const loadedCameraStable = await waitFreeWalkCamera();
    const afterStable = await stableCheckoutSaveDigest(durableIdentity, reservationId);
    const after = afterStable.digest;
    const afterJson = JSON.stringify(durableCheckoutDigest(after));
    const afterSha256 = crypto.createHash('sha256').update(afterJson).digest('hex');
    const storageAfter = await readNativeSlotEvidence();
    const clockRestored = after.world.clockMinutes >= before.world.clockMinutes
      && after.world.clockMinutes < before.world.clockMinutes + 0.5
      && after.world.clockMinutes < canary.liveClockMinutes - 1;
    const sceneChanged = await page.evaluate(() => (
      window.__fw.scene3d !== window.__goal24SceneBeforeSlotLoad
    ));
    await page.evaluate(() => { window.__goal24SceneBeforeSlotLoad = null; });
    await page.screenshot({ path: path.join(OUT, 'book-card-after-slot-1-load.png'), scale: 'css' });
    return {
      controls: overwriteConfirmed
        ? [...registerExit.controls, 'P', 'Save game', 'Slot 1 Save here', 'Replace and save',
          ...canary.controls, 'P', 'Load game', 'Slot 1 Load', 'Load game confirmation',
          ...(restoredRuntime.speedIdx === 0 ? [] : ['Space (pause restored runtime)'])]
        : [...registerExit.controls, 'P', 'Save game', 'Slot 1 Save here',
          ...canary.controls, 'P', 'Load game', 'Slot 1 Load', 'Load game confirmation',
          ...(restoredRuntime.speedIdx === 0 ? [] : ['Space (pause restored runtime)'])],
      overwriteConfirmed,
      registerExit,
      beforeStableSamples: beforeStable.attempts,
      afterStableSamples: afterStable.attempts,
      loadedCameraStable,
      restoredRuntime,
      loadNotifications,
      deserializeOrSchemaRepairNotices,
      visualFallbackNotices,
      pausedRestoredRuntimeThroughControl,
      nativeBefore,
      storage,
      storageAfter,
      canary,
      clockRestored,
      sceneChanged,
      before,
      after,
      beforeSha256,
      afterSha256,
      exact: beforeJson === afterJson && beforeSha256 === afterSha256,
      validBefore: validCheckoutSaveDigest(before, durableIdentity),
      validAfter: validCheckoutSaveDigest(after, durableIdentity),
    };
  };

  // ONE VISIT, played the same way twice, differing only in the answer given.
  const playVisit = async (answer, method = requestedMethod) => {
    const run = { answer, method };
    // reset to a clean shop between the two
    run.staged = await page.evaluate(async ([skus, minute, paymentMethod, scenario]) => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const reservations = await import(new URL('src/sim/reservations.js', document.baseURI).href);
      const fixtures = await import(new URL('src/data/fixtureSlots.js', document.baseURI).href);
      app.state.clock.minutes = Math.floor(app.state.clock.minutes / 1440) * 1440 + 10 * 60;
      app.speedIdx = 0;
      ch.setOrganicWalkins?.(false);
      if (app.state.shop) app.state.shop.open = true;
      // This verifier owns one explicit booking. Remove cold-boot tee-sheet
      // work and disable its generator through the production configuration API
      // so save/load cannot race unrelated prepaid/deposit postings.
      reservations.resetGolfOperationsQA(app.state);
      const configured = reservations.configureTeeSheet(app.state, { autoBookings: false });
      if (!configured.ok) return { ok: false, why: configured.reason || 'could not disable auto bookings' };
      if (app.state.campaign) app.state.campaign.businessOpen = true;
      const fixtureStock = skus.map((id) => {
        const inv = app.state.shop.inventory[id];
        return { id, shelf: Number(inv?.shelf || 0), back: Number(inv?.back || 0), capacity: fixtures.capacityOf(id) };
      });
      const invalidStock = fixtureStock.find((entry) => (
        entry.shelf < 1 || entry.shelf > entry.capacity || entry.back < 0
      ));
      if (invalidStock) return { ok: false, why: 'starter stock is outside authored fixture capacity', invalidStock };
      ch.rebuildStock();
      const name = ch.sendToCounter(skus, paymentMethod);
      if (!name) return { ok: false, why: 'sendToCounter returned nothing' };
      const c = ch.customerByName(name);
      if (!c) return { ok: false, why: 'staged customer not found' };
      const dayAbs = Math.floor(app.state.clock.minutes / 1440);
      let reservationId = null;
      let reservationMinute = null;
      let reservationFee = null;
      let filledRequestedSlot = false;
      if (scenario === 'adjusted') {
        const attempts = [];
        for (let i = 0; i < 8; i += 1) {
          const blocker = reservations.bookReservation(app.state, {
            fullName: `Adjusted Slot Blocker ${i + 1}`,
            dayAbs,
            minute,
            partySize: 4,
            walkIn: false,
          });
          attempts.push(!!blocker.ok);
          if (!blocker.ok) break;
        }
        const askedSlot = reservations.slotByMinute?.(app.state, dayAbs, minute) || null;
        filledRequestedSlot = attempts.some(Boolean) && attempts[attempts.length - 1] === false;
        if (!filledRequestedSlot) {
          return {
            ok: false,
            why: 'could not fill the requested adjustment slot',
            attempts,
            askedSlot,
          };
        }
      }
      if (scenario === 'existing') {
        const minuteOfDay = app.state.clock.minutes % 1440;
        reservationMinute = reservations.slotTimes(app.state).find((value) => value > minuteOfDay + 20) ?? null;
        if (reservationMinute == null) return { ok: false, why: 'no due check-in slot' };
        // Make this shopper the booking owner before the browser yields a frame.
        // This both prevents updateArrivals from manufacturing a duplicate and
        // exercises the production counter classifier: an open reservation with
        // unpaid goods must enter checkout before it can enter desk service.
        const made = reservations.bookReservation(app.state, {
          fullName: c.fullName,
          customerId: c.customerId,
          customerIdentity: c.identity,
          dayAbs,
          minute: reservationMinute,
          partySize: 1,
          paymentPreference: paymentMethod,
          arrivalStatus: 'arrived',
          source: 'goal24-existing-booking-verifier',
        });
        if (!made.ok) return { ok: false, why: made.reason || 'existing booking failed' };
        reservationId = made.res.id;
        reservationFee = made.res.fee;
        c.reservationId = reservationId;
        c.combinedVisit = true;
        c.deskErrandPending = true;
        c.deskErrandSpoken = false;
      }
      // THE OWNER'S CUSTOMER: goods in hand, NO booking, wanting a time. Not the
      // check-in case the existing driver covers.
      if (scenario !== 'existing') {
        c.customerType = 'walk-in-tee';
        c.reservationId = null;
        c.requestedTeeMinute = minute;
        c.combinedVisit = true;
        c.deskErrandPending = true;
        c.deskErrandSpoken = false;
      }
      return {
        ok: true,
        name,
        fullName: c.fullName,
        customerId: c.customerId,
        minute,
        method: paymentMethod,
        reservationId,
        reservationMinute,
        reservationFee,
        filledRequestedSlot,
        fixtureStock,
        autoBookings: app.state.reservations.config.autoBookings,
        sameReservationCharacterCount: reservationId == null ? null : ch.customers().filter((candidate) => (
          String(candidate.reservationId) === String(reservationId)
        )).length,
        sameIdentityCharacterCount: scenario !== 'existing' ? null : ch.customers().filter((candidate) => (
          String(candidate.customerId) === String(c.customerId)
        )).length,
      };
    }, [['balls1', 'glove1'], 660, method, answer]);
    say(`${answer}:staged`, run.staged);
    if (!run.staged.ok) return run;

    await page.evaluate(async () => {
      const app = window.__fw;
      const { REGISTER } = await import(new URL('src/data/shopLayout.js', document.baseURI).href);
      const ch = app.scene3d.clubhouse();
      const w = app.scene3d.walk.state;
      const off = ch.interior.position;
      w.x = REGISTER.stand.x + off.x;
      w.z = REGISTER.stand.z + off.z;
      const dx = REGISTER.monitor.x - REGISTER.stand.x;
      const dz = REGISTER.monitor.z - REGISTER.stand.z;
      const h = Math.hypot(dx, dz) || 0.001;
      w.yaw = Math.atan2(-dx / h, -dz / h);
      w.pitch = Math.atan2(1.18 - 1.62, h);
    });
    run.reachedCounter = await page.waitForFunction(() => {
      const tx = window.__fw.scene3d.clubhouse().register.getTx();
      return !!tx && tx.items.length >= 2;
    }, null, { timeout: 90000 }).then(() => true).catch(() => false);
    if (!run.reachedCounter) return say(`${answer}:NO-COUNTER`, run);

    // Prove the ordinary identity route selects the same cached artwork as the
    // corresponding finite design. Both reads are side-effect-free: repainting
    // here would manufacture fresh bag textures immediately before cashier
    // entry and turn the verifier itself into a first-use rendering stall.
    if (method === 'card') {
      run.naturalCardBrand = await page.evaluate(async () => {
        const mod = await import(new URL('src/data/paymentCards.js', document.baseURI).href);
        const register = window.__fw.scene3d.clubhouse().register;
        const customer = register.getCustomer();
        const identity = customer?.customerId ?? customer?.fullName ?? customer?.name;
        const expectedCardId = mod.paymentCardFor(identity).id;
        const hashCanvas = async (canvas) => {
          if (!canvas?.toDataURL) return null;
          const bytes = new TextEncoder().encode(canvas.toDataURL('image/png'));
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          return [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, '0')).join('');
        };
        const naturalSha256 = await hashCanvas(register.cardBrandCanvas?.());
        const expectedSha256 = await hashCanvas(
          register.debugPaymentCardCanvas?.(expectedCardId),
        );
        return {
          customerId: customer?.customerId ?? null,
          expectedCardId,
          naturalSha256,
          expectedSha256,
          cache: register.cardTextureCacheStatus?.() || null,
        };
      });
    }

    if (answer === 'existing') {
      run.existingAttached = {
        ok: run.staged.reservationId != null,
        customerId: run.staged.customerId,
        fullName: run.staged.fullName,
        reservationId: run.staged.reservationId,
        reservationMinute: run.staged.reservationMinute,
        reservationFee: run.staged.reservationFee,
        sameReservationCharacterCount: run.staged.sameReservationCharacterCount,
        sameIdentityCharacterCount: run.staged.sameIdentityCharacterCount,
      };
    }

    await page.keyboard.press('e');
    run.cashierEntryReady = await page.waitForFunction(() => {
      const register = window.__fw.scene3d.clubhouse().register;
      return register.isActive() && register.getFlow?.()?.state === 'WaitingForScan';
    }, null, { timeout: 20000 }).then(() => true).catch(() => false);
    if (!run.cashierEntryReady) return say(`${answer}:NO-CASHIER-ENTRY`, run);
    await page.waitForTimeout(250);
    const uids = await page.evaluate(() => window.__fw.scene3d.clubhouse().register.getTx().items.map((i) => i.uid));
    for (const uid of uids) await clickItem(uid);
    await page.waitForTimeout(2500);

    // B2 + B3, read at the moment the player is stuck.
    run.afterScan = say(`${answer}:after-scan`, await page.evaluate(([name, reservationId]) => {
      const ch = window.__fw.scene3d.clubhouse();
      const r = ch.register;
      const c = ch.customerByName(name) || r.getCustomer();
      const bridge = ch.frontDeskBridge ? ch.frontDeskBridge() : null;
      const walkIns = bridge && bridge.walkIns ? bridge.walkIns() : [];
      const mine = walkIns.find((w) => w.customerId === c?.customerId) || null;
      const reservationRows = bridge && bridge.list ? bridge.list() : [];
      const reservationRow = reservationRows.find((row) => String(row.id) === String(reservationId)) || null;
      return {
        dialogue: c?.dialogue ?? null,
        // B2: a specific time, in the words
        askNamesATime: /\b\d{1,2}[:.]\d{2}\s*(am|pm)?\b/i.test(String(c?.dialogue || '')),
        errandPending: !!c?.deskErrandPending,
        stage: r.getTx()?.stage ?? null,
        // B1: is there anything on screen to act on at all?
        onWalkInList: !!mine,
        slotsOffered: (bridge && bridge.walkInSlotsFor
          ? bridge.walkInSlotsFor(c?.customerId) : []).length,
        onReservationList: !!reservationRow,
        reservationStatus: reservationRow?.status ?? null,
        // B3: does the screen say why nothing is happening?
        status: r.checkoutStatus ? r.checkoutStatus() : null,
        instruction: r.checkoutInstruction ? r.checkoutInstruction() : null,
        deskTargets: r.deskHitTargets ? r.deskHitTargets().map((h) => h.id) : null,
        watchdogEventCount: r.checkoutWatchdogDiagnostics?.().events?.length ?? 0,
      };
    }, [run.staged.name, run.staged.reservationId]));

    // ---- the answer, THROUGH THE SCREEN THE PLAYER CLICKS -------------------
    //
    // Every action here is a real mouse click on a hotspot the monitor is
    // actually drawing, located by its own screen point. Calling the bridge
    // directly would prove the sim can do it, which was never in doubt -- the
    // whole failure was that the player had no way to reach it.
    const clickDesk = async (action) => {
      const pt = await page.evaluate((a) => {
        const r = window.__fw.scene3d.clubhouse().register;
        const p = r.monitorScreenPoint ? r.monitorScreenPoint(a) : null;
        return p ? { x: p.x, y: p.y, inView: p.inView !== false } : { missing: true };
      }, action);
      if (pt.missing) return { action, clicked: false, reason: 'not drawn on the screen' };
      if (!pt.inView) return { action, clicked: false, reason: 'drawn outside the player view' };
      // The monitor camera may still be easing after the preceding tab click.
      // Wait until the screen-space center itself settles, then prove the live
      // raycaster resolves that exact point to the intended drawn action.
      const projectionSettled = await page.waitForFunction((wanted) => {
        const r = window.__fw.scene3d.clubhouse().register;
        const point = r.monitorScreenPoint?.(wanted);
        if (!point?.inView) return false;
        const prior = window.__goal24DeskPointProbe;
        const current = { action: wanted, x: point.x, y: point.y };
        if (!prior || prior.action !== wanted) {
          window.__goal24DeskPointProbe = { ...current, stable: 0 };
          return false;
        }
        const delta = Math.max(Math.abs(current.x - prior.x), Math.abs(current.y - prior.y));
        const stable = delta < 0.35 ? prior.stable + 1 : 0;
        window.__goal24DeskPointProbe = { ...current, stable };
        return stable >= 3;
      }, action, { timeout: 3000, polling: 50 }).then(() => true).catch(() => false);
      if (!projectionSettled) {
        return { action, clicked: false, reason: 'monitor projection did not settle' };
      }
      const live = await page.evaluate((a) => {
        const r = window.__fw.scene3d.clubhouse().register;
        const point = r.monitorScreenPoint?.(a);
        if (!point?.inView) return null;
        return {
          x: point.x,
          y: point.y,
          inView: true,
          picked: r.debugPickAt?.(point.x, point.y)?.monitorAction ?? null,
        };
      }, action);
      if (!live || live.picked !== action) {
        return {
          action,
          clicked: false,
          reason: 'drawn action did not match the live monitor ray target',
          projected: live,
        };
      }
      await page.mouse.click(live.x, live.y);
      await page.waitForTimeout(100);
      return { action, clicked: true, inView: true, picked: live.picked };
    };
    run.trail = [await clickDesk('tab-check-in')];
    run.checkInCameraStable = await waitCamera('monitor');
    // What the screen is ACTUALLY drawing, captured after each step rather than
    // once at the start. The first run reported 'select-walkin-slot not drawn'
    // with a hotspot list from before the walk-in was even selected, which says
    // nothing about why.
    const walkInId = run.staged.customerId;
    const hotspotsBeforeSelect = await page.evaluate(() => {
      const r = window.__fw.scene3d.clubhouse().register;
      return r.deskHitTargets().map((h) => `${h.id}${h.disabled ? ' [DIS]' : ''}`);
    });
    const selectionAction = answer === 'existing'
      ? `select-reservation:${run.staged.reservationId}`
      : `select-walkin:${walkInId}`;
    run.trail.push(await clickDesk(selectionAction));
    run.selectionApplied = await page.waitForFunction(([scenario, id]) => {
      const targets = window.__fw.scene3d.clubhouse().register.deskHitTargets();
      if (scenario === 'existing') {
        return targets.some((target) => target.id === 'reservation-check-in' && !target.disabled);
      }
      return targets.some((target) => (
        (target.id.startsWith(`select-walkin-slot:${id}:`) || target.id === 'reject-walkin')
          && !target.disabled
      ));
    }, [answer, answer === 'existing' ? run.staged.reservationId : walkInId], { timeout: 5000 })
      .then(() => true).catch(() => false);
    const hotspotsAfterSelect = await page.evaluate(() => {
      const r = window.__fw.scene3d.clubhouse().register;
      return r.deskHitTargets().map((h) => `${h.id}${h.disabled ? ' [DIS]' : ''}`);
    });
    // Compare the UI before and after the REAL mouse click. The old probe took
    // its baseline after the click, dispatched the same selection a second time,
    // and then interpreted the expected no-op as a failed first click.
    run.hotspotsAfterSelect = {
      before: hotspotsBeforeSelect,
      after: hotspotsAfterSelect,
    };
    say(`${answer}:hotspots-after-select`, run.hotspotsAfterSelect);
    if (answer === 'existing') {
      run.trail.push(await clickDesk('reservation-check-in'));
    } else if (answer === 'refuse') {
      run.trail.push(await clickDesk('reject-walkin'));
    } else {
      const slot = await page.evaluate((id) => {
        const b = window.__fw.scene3d.clubhouse().frontDeskBridge();
        const slots = b && b.walkInSlotsFor ? b.walkInSlotsFor(id) : [];
        return slots.length ? { dayAbs: slots[0].dayAbs, minute: slots[0].minute } : null;
      }, walkInId);
      run.slot = slot;
      if (slot) run.trail.push(await clickDesk(`select-walkin-slot:${walkInId}:${slot.dayAbs}:${slot.minute}`));
    }
    const errandCleared = await page.waitForFunction(() => {
      const r = window.__fw.scene3d.clubhouse().register;
      const c = r.getCustomer();
      return !c?.deskErrandPending;
    }, null, { timeout: 5000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(50);
    run.answerTabPixels = await page.evaluate(() => (
      window.__fw.scene3d.clubhouse().register.debugMonitorTabPixels?.() || null
    ));
    run.answerApplied = errandCleared
      && Array.isArray(run.answerTabPixels?.checkout)
      && run.answerTabPixels.checkout[0] === 23
      && run.answerTabPixels.checkout[1] === 63
      && run.answerTabPixels.checkout[2] === 53;
    run.reservationOutcome = await page.evaluate((name) => {
      const ch = window.__fw.scene3d.clubhouse();
      const customer = ch.customerByName(name) || ch.register.getCustomer();
      const reservationId = customer?.reservationId ?? null;
      const reservations = window.__fw.state.reservations?.booked || [];
      const reservation = reservations.find((entry) => String(entry.id) === String(reservationId)) || null;
      return {
        reservationId,
        customerId: reservation?.customerId ?? null,
        fullName: reservation?.fullName ?? reservation?.name ?? null,
        minute: reservation?.minute ?? null,
        status: reservation?.status ?? null,
      };
    }, run.staged.name);
    run.answered = say(`${answer}:answered`, {
      trail: run.trail,
      everyClickLanded: run.trail.every((t) => t.clicked && t.inView),
      selectionApplied: run.selectionApplied,
      answerApplied: run.answerApplied,
    });

    // WHERE DOES IT STOP? Read the gate's own inputs right after the answer,
    // rather than inferring from "it did not bank".
    await page.waitForTimeout(1200);
    run.returnTenderStageReached = await page.waitForFunction((paymentMethod) => {
      const stage = window.__fw.scene3d.clubhouse().register.getTx()?.stage;
      return paymentMethod === 'cash' ? stage === 'cash-tender' : stage === 'card-ready';
    }, method, { timeout: 20000, polling: 100 }).then(() => true).catch(() => false);
    // The card workspace has an authored pointer-follow glance. Measure the
    // neutral return pose before hovering the tender, otherwise a legitimate
    // affordance animation looks like a failed camera reset. Centre the real
    // mouse, wait for the shipping camera to settle, and only then take the
    // single physical-target projection used by the hover proof below.
    const canvasBox = await page.locator('canvas').boundingBox();
    if (canvasBox) {
      await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    }
    run.returnCameraStable = await waitCamera(method === 'cash' ? 'monitor' : 'card');
    run.returnPresentation = say(`${answer}:return-presentation`, await page.evaluate(async () => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const app = window.__fw;
      const r = app.scene3d.clubhouse().register;
      const solved = r.debugWorkingPose?.() || null;
      const camera = app.scene3d.camera;
      const position = camera.position.toArray();
      const expectedPosition = solved ? [solved.x, solved.y, solved.z] : null;
      const cameraPositionDelta = expectedPosition
        ? new THREE.Vector3(...position).distanceTo(new THREE.Vector3(...expectedPosition)) : null;
      const orientation = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
      const yawDelta = solved ? Math.abs(wrap(orientation.y - solved.yaw)) : null;
      const pitchDelta = solved ? Math.abs(wrap(orientation.x - solved.pitch)) : null;
      const roll = Math.abs(wrap(orientation.z));
      const cardNode = r.cardNode?.() || null;
      let card = null;
      if (cardNode) {
        const projected = cardNode.getWorldPosition(new THREE.Vector3()).project(camera);
        const rect = document.querySelector('canvas').getBoundingClientRect();
        card = {
          x: rect.left + ((projected.x + 1) / 2) * rect.width,
          y: rect.top + ((-projected.y + 1) / 2) * rect.height,
          inView: projected.z >= -1 && projected.z <= 1
            && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1,
        };
      }
      const cash = r.presentedCashScreenPoint?.() || null;
      const ticketItems = r.getTx()?.items || [];
      return {
        active: r.isActive(),
        stage: r.getTx()?.stage ?? null,
        method: r.getTx()?.method ?? null,
        flow: r.getFlow?.()?.state ?? null,
        status: r.checkoutStatus?.() ?? null,
        instruction: r.checkoutInstruction?.() ?? null,
        cameraPosition: position.map((value) => +value.toFixed(4)),
        expectedPosition: expectedPosition?.map((value) => +value.toFixed(4)) ?? null,
        cameraPositionDelta: cameraPositionDelta == null ? null : +cameraPositionDelta.toFixed(4),
        yaw: +orientation.y.toFixed(5),
        pitch: +orientation.x.toFixed(5),
        roll: +orientation.z.toFixed(5),
        expectedYaw: solved?.yaw ?? null,
        expectedPitch: solved?.pitch ?? null,
        yawDelta: yawDelta == null ? null : +yawDelta.toFixed(5),
        pitchDelta: pitchDelta == null ? null : +pitchDelta.toFixed(5),
        rollMagnitude: +roll.toFixed(5),
        fov: camera.fov,
        expectedFov: solved?.fov ?? null,
        card,
        cash,
        pointerLocked: !!document.pointerLockElement,
        neutralCursor: getComputedStyle(document.querySelector('canvas')).cursor,
        registerClass: document.body.classList.contains('register-mode'),
        goodsLineCount: ticketItems.filter((item) => !String(item.skuId).startsWith('service:')).length,
        serviceLineCount: ticketItems.filter((item) => String(item.skuId).startsWith('service:')).length,
      };
    }));
    run.returnHoverTarget = await page.evaluate((paymentMethod) => {
      const register = window.__fw.scene3d.clubhouse().register;
      const point = paymentMethod === 'cash'
        ? register.presentedCashScreenPoint?.()
        : register.presentedCardScreenPoint?.();
      if (!point) return null;
      const samples = [{ x: point.x, y: point.y }];
      for (let radius = 3; radius <= 30; radius += 3) {
        for (let step = 0; step < 16; step += 1) {
          const angle = (step / 16) * Math.PI * 2;
          samples.push({
            x: point.x + Math.cos(angle) * radius,
            y: point.y + Math.sin(angle) * radius,
          });
        }
      }
      for (const sample of samples) {
        const physical = register.debugPickAt?.(sample.x, sample.y)?.physical || null;
        const matches = paymentMethod === 'card'
          ? physical?.kind === 'payment-card'
          : physical?.kind === 'money' && physical?.from === 'tender';
        if (matches) return { ...point, ...sample, physical };
      }
      return { ...point, physical: null };
    }, method);
    if (run.returnHoverTarget?.inView && run.returnHoverTarget?.clickable) {
      await page.mouse.move(run.returnHoverTarget.x, run.returnHoverTarget.y);
    }
    await page.waitForTimeout(100);
    run.returnHoverAffordance = await page.evaluate((target) => {
      return {
        cursor: getComputedStyle(document.querySelector('canvas')).cursor,
        // The pointer-follow camera may have moved after the mouse event. The
        // physical hit was therefore captured at the neutral projected point
        // above, before hover motion could make those coordinates stale.
        physical: target?.physical || null,
      };
    }, run.returnHoverTarget);
    run.returnPresentation.tabPixels = run.answerTabPixels;
    run.returnPresentation.checkoutTabPainted = run.answerTabPixels?.checkout?.[0] === 23
      && run.answerTabPixels?.checkout?.[1] === 63 && run.answerTabPixels?.checkout?.[2] === 53;
    run.returnPresentation.checkInTabUnpainted = run.answerTabPixels?.checkIn?.[0] === 255
      && run.answerTabPixels?.checkIn?.[1] === 250 && run.answerTabPixels?.checkIn?.[2] === 240;
    await page.screenshot({
      path: path.join(OUT, `${answer}-${method}-returned-to-checkout.png`),
      scale: 'css',
    });
    run.afterAnswer = say(`${answer}:after-answer`, await page.evaluate((name) => {
      const ch = window.__fw.scene3d.clubhouse();
      const r = ch.register;
      const tx = r.getTx();
      const c = ch.customerByName(name) || r.getCustomer();
      return {
        stage: tx?.stage ?? null,
        banked: !!tx?.banked,
        lines: tx ? tx.items.length : 0,
        method: tx?.method ?? null,
        prefer: tx?.prefer ?? null,
        flow: r.getFlow ? r.getFlow() : null,
        errandPending: !!c?.deskErrandPending,
        errandAwaiting: !!c?.deskErrandAwaitingAnswer,
        walkInRejected: !!c?.walkInRejected,
        customerPhase: c?.checkoutPhase ?? null,
        watchdog: r.checkoutWatchdogDiagnostics ? r.checkoutWatchdogDiagnostics() : null,
      };
    }, run.staged.name));

    // ---- PLAY THE PAYMENT OUT, the way the b2 driver does -------------------
    //
    // The first version waited for the ticket to bank and reported "the sale
    // does not complete". It does; a CARD sale asks the player to type the total
    // on the terminal keypad and press OK, and nothing was typing. That is a
    // missing step in the driver, not a wall in the game, and reporting it as a
    // wall would have been the fifth false finding of the night.
    const cardPoint = () => page.evaluate(async () => {
      const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
      const r = window.__fw.scene3d.clubhouse().register;
      const flow = r.getFlow?.()?.state ?? null;
      const pick = (fn) => { try { return fn ? fn() : null; } catch { return null; } };
      let card = null;
      const node = pick(r.cardNode);
      if (node) {
        const v = node.getWorldPosition(new THREE.Vector3());
        v.project(window.__fw.scene3d.camera);
        const rect = document.querySelector('canvas').getBoundingClientRect();
        card = {
          x: rect.left + ((v.x + 1) / 2) * rect.width,
          y: rect.top + ((-v.y + 1) / 2) * rect.height,
          onScreen: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
        };
      }
      return {
        flow, card,
        terminal: pick(r.cardTerminalScreenPoint),
        confirm: pick(r.cardXScreenPoint),
      };
    });
    const cashPoint = () => page.evaluate(async () => {
      const app = window.__fw;
      const r = app.scene3d.clubhouse().register;
      const reg = await import(new URL('src/sim/register.js', document.baseURI).href);
      const tx = r.getTx();
      if (!tx) return { flow: null, stage: null };
      const plan = tx.stage === 'cash-drawer' && tx.deposited
        ? reg.makeChangeFrom(reg.drawerContents(tx, app.state.shop.drawer), reg.changeDue(tx))
        : null;
      const slots = plan ? Object.entries(plan).map(([denom, count]) => {
        const point = r.drawerSlotScreenPoint(Number(denom));
        return point ? {
          denom: Number(denom),
          count,
          x: point.x,
          y: point.y,
          inView: point.inView !== false,
          visible: point.visible !== false,
          clickable: point.clickable === true,
          pick: r.debugPickAt?.(point.x, point.y)?.physical || null,
        } : { denom: Number(denom), count, missing: true };
      }) : [];
      const confirm = r.monitorScreenPoint?.('confirm-change') || null;
      const confirmTarget = (r.deskHitTargets?.() || [])
        .find((target) => target.id === 'confirm-change') || null;
      return {
        flow: r.getFlow?.()?.state ?? null,
        stage: tx.stage,
        deposited: !!tx.deposited,
        drawerOpen: !!tx.drawerOpen,
        presented: r.presentedCashScreenPoint?.() || null,
        changeDue: reg.changeDue(tx),
        handTotal: reg.handTotal(tx),
        hand: { ...(tx.hand || {}) },
        giving: reg.changeGivingState(tx),
        plan,
        slots,
        confirm,
        confirmEnabled: !!confirmTarget && !confirmTarget.disabled,
      };
    });
    const drawerTarget = (denom) => page.evaluate((wanted) => {
      const register = window.__fw.scene3d.clubhouse().register;
      const center = register.drawerSlotScreenPoint?.(wanted) || null;
      if (!center?.inView || !center.clickable) return null;
      const samples = [{ x: center.x, y: center.y }];
      for (let radius = 4; radius <= 36; radius += 4) {
        for (let step = 0; step < 16; step += 1) {
          const angle = (step / 16) * Math.PI * 2;
          samples.push({
            x: center.x + Math.cos(angle) * radius,
            y: center.y + Math.sin(angle) * radius,
          });
        }
      }
      for (const point of samples) {
        const picked = register.debugPickAt?.(point.x, point.y)?.physical || null;
        if (Number(picked?.denom) === Number(wanted)
            && (picked.kind === 'drawer-slot' || picked.from === 'drawer')) {
          return { ...point, denom: Number(wanted), picked, center };
        }
      }
      return null;
    }, denom);
    // ALREADY-TRUE IS NOT DONE. The first version asked "is transactionHistory
    // non-empty" -- true for the second visit before it started, because the
    // first visit had banked. Both are counted from a baseline taken here.
    run.saleIdentity = await page.evaluate(async (customerId) => {
      const app = window.__fw;
      const register = app.scene3d.clubhouse().register;
      const tx = register.getTx();
      const catalog = await import(new URL('src/data/shopItems.js', document.baseURI).href);
      const salesTax = await import(new URL('src/sim/salesTax.js', document.baseURI).href);
      const goods = (tx?.items || []).filter((item) => !String(item.skuId).startsWith('service:'));
      const services = (tx?.items || []).filter((item) => String(item.skuId).startsWith('service:'));
      const uids = goods.map((item) => item.uid);
      const skuIds = [...new Set(goods.map((item) => item.skuId))];
      const cents = (value) => Math.round(Number(value) * 100);
      const expectedGoods = goods.map((item) => ({
        uid: item.uid,
        skuId: item.skuId,
        priceCents: cents(item.price),
      })).sort((a, b) => String(a.uid).localeCompare(String(b.uid)));
      const expectedGoodsSubtotalCents = expectedGoods
        .reduce((sum, item) => sum + item.priceCents, 0);
      const discountRate = Number.isFinite(Number(tx?.discount)) ? Number(tx.discount) : 0;
      const expectedDiscountCents = Math.round(expectedGoodsSubtotalCents * discountRate);
      const expectedGoodsNetCents = expectedGoodsSubtotalCents - expectedDiscountCents;
      const expectedServiceTotalCents = services
        .reduce((sum, item) => sum + cents(item.price), 0);
      // The persisted ticket is the subject under test, so derive the expected
      // rate independently from the property's authored tax jurisdiction.
      const expectedTaxRate = salesTax.salesTaxRate(app.state);
      const expectedTaxCents = Math.round(expectedGoodsNetCents * expectedTaxRate);
      const expectedTotalCents = expectedGoodsNetCents
        + expectedTaxCents + expectedServiceTotalCents;
      const catalogCosts = goods.map((item) => catalog.skuById(item.skuId)?.cost);
      const expectedGoodsCostCents = catalogCosts.every((cost) => (
        typeof cost === 'number' && Number.isFinite(cost)
      )) ? catalogCosts.reduce((sum, cost) => sum + cents(cost), 0) : null;
      const goodsSkuCounts = Object.fromEntries(skuIds.map((skuId) => [
        skuId, goods.filter((item) => item.skuId === skuId).length,
      ]));
      const matchingRowsBefore = (app.state.shop.transactionHistory || []).filter((row) => (
        Number(row.number) === Number(tx?.number)
          && String(row.customerId || '') === String(customerId || '')
      )).length;
      const directoryCustomer = (app.state.customerDirectory?.customers || []).find((entry) => (
        String(entry.customerId) === String(customerId || '')
      )) || null;
      return {
        historyBefore: (app.state.shop.transactionHistory || []).length,
        matchingRowsBefore,
        number: tx?.number ?? null,
        transactionId: tx?.id ?? null,
        customerId,
        goodsUids: uids,
        goodsSkuIds: skuIds,
        goodsSkuCounts,
        expectedGoods,
        expectedGoodsSubtotalCents,
        expectedDiscountCents,
        expectedGoodsNetCents,
        expectedServiceTotalCents,
        expectedTaxRate,
        expectedTaxCents,
        expectedTotalCents,
        expectedGoodsCostCents,
        visitDayAbs: Math.floor(app.state.clock.minutes / 1440),
        cashBeforeCents: cents(app.state.cash),
        shopSalesBeforeCents: cents(app.state.ledger?.today?.revenue?.shopSales || 0),
        greenFeesBeforeCents: cents(app.state.ledger?.today?.revenue?.greenFees || 0),
        salesLiveBefore: {
          units: Number(app.state.shop.salesLive?.units || 0),
          revenueCents: cents(app.state.shop.salesLive?.revenue || 0),
        },
        salesTodayBefore: Object.fromEntries(skuIds.map((skuId) => [
          skuId, Number(app.state.shop.salesToday?.[skuId] || 0),
        ])),
        salesTaxBefore: {
          collectedCents: cents(app.state.salesTax?.collected || 0),
          remittedCents: cents(app.state.salesTax?.remitted || 0),
          owedCents: cents(app.state.salesTax?.owed || 0),
          taxableSalesCents: cents(app.state.salesTax?.taxableSales || 0),
        },
        propertyId: app.state.property?.id ?? null,
        holdingId: app.state.propertyInventory?.propertyId ?? null,
        inventoryBeforeBank: Object.fromEntries(skuIds.map((skuId) => {
          const inv = app.state.shop.inventory?.[skuId] || {};
          return [skuId, { shelf: inv.shelf ?? 0, back: inv.back ?? 0 }];
        })),
        heldGoodsBeforeBank: (app.state.shop.held || [])
          .filter((unit) => uids.includes(unit.uid)).map((unit) => unit.uid).sort(),
        drawerBefore: structuredClone(app.state.shop.drawer || {}),
        drawerBeforePairs: Object.entries(app.state.shop.drawer || {})
          .map(([denom, count]) => [Number(denom), Number(count)])
          .sort(([a], [b]) => a - b),
        visitHistoryBefore: structuredClone(directoryCustomer?.visitHistory || null),
        paidBagResourcesBefore: register.paidBagResourceStatus?.() || null,
      };
    }, run.staged.customerId);
    run.historyBefore = run.saleIdentity.historyBefore;
    if (requestedFault) {
      run.postBankFault = await page.evaluate((fault) => {
        const register = window.__fw.scene3d.clubhouse().register;
        const before = register.checkoutWatchdogDiagnostics?.().postBankFailures || [];
        return {
          failuresBefore: before.length,
          expected: fault,
          armed: register[fault.armMethod]?.() || null,
        };
      }, POST_BANK_FAULTS[requestedFault]);
    }
    run.flowTrail = [];
    if (method === 'cash') {
      run.cash = { clicks: [] };
      const presented = await page.waitForFunction(() => {
        const r = window.__fw.scene3d.clubhouse().register;
        const point = r.presentedCashScreenPoint?.() || null;
        return r.getTx()?.stage === 'cash-tender' && point?.inView ? point : false;
      }, null, { timeout: 20000 }).then((handle) => handle.jsonValue()).catch(() => null);
      run.cash.presented = presented;
      if (presented) {
        await page.mouse.click(presented.x, presented.y);
        run.cash.clicks.push({ kind: 'presented-cash', ...presented });
      }
      const ready = await page.waitForFunction(() => {
        const r = window.__fw.scene3d.clubhouse().register;
        const probe = r.drawerSlotScreenPoint?.(1) || null;
        return r.getTx()?.stage === 'cash-drawer' && r.getTx()?.deposited
          && r.getFlow?.()?.state === 'SelectingChange' && probe?.clickable === true;
      }, null, { timeout: 20000 }).then(() => true).catch(() => false);
      run.cash.readyForChange = ready;
      run.cash.cameraStable = ready ? await waitCamera('cash') : false;
      let st = await cashPoint();
      run.flowTrail.push(st.flow);
      run.cash.plan = st.plan;
      run.cash.changeDue = st.changeDue;
      run.cash.slotTargets = st.slots;
      if (ready && st.plan) {
        for (const slot of st.slots) {
          if (slot.missing || !slot.inView || !slot.visible || !slot.clickable) {
            run.cash.clicks.push({ kind: 'drawer-slot', ...slot, clicked: false });
            continue;
          }
          for (let count = 0; count < slot.count; count += 1) {
            const before = await cashPoint();
            const target = await drawerTarget(slot.denom);
            if (!target) {
              run.cash.clicks.push({
                kind: 'drawer-slot', denom: slot.denom, clicked: false, reason: 'no-live-ray-target',
              });
              continue;
            }
            await page.mouse.click(target.x, target.y);
            const changedExactly = await page.waitForFunction(([beforeTotal, beforeCount, denom]) => {
              const tx = window.__fw.scene3d.clubhouse().register.getTx();
              if (!tx) return false;
              const hand = Object.entries(tx.hand || {})
                .reduce((total, [denom, pieces]) => total + Number(denom) * Number(pieces), 0);
              const countNow = Number(tx.hand?.[denom] || 0);
              return Math.round(hand * 100) === Math.round(beforeTotal * 100) + Math.round(denom * 100)
                && countNow === beforeCount + 1;
            }, [before.handTotal, Number(before.hand?.[slot.denom] || 0), slot.denom], { timeout: 3000 })
              .then(() => true).catch(() => false);
            run.cash.clicks.push({
              kind: 'drawer-slot',
              denom: slot.denom,
              x: target.x,
              y: target.y,
              picked: target.picked,
              clicked: true,
              changedExactly,
            });
          }
        }
      }
      st = await cashPoint();
      run.flowTrail.push(st.flow);
      run.cash.beforeConfirm = st;
      run.cash.accountingCheckpoint = await page.evaluate(() => {
        const app = window.__fw;
        const tx = app.scene3d.clubhouse().register.getTx();
        return {
          expectedCommittedDrawer: structuredClone(tx?.drawerPending || {}),
          persistentDrawerStillBaseline: JSON.stringify(app.state.shop.drawer || {})
            === JSON.stringify(tx?.drawerStart || {}),
        };
      });
      if (st.confirm?.inView !== false && Number.isFinite(st.confirm?.x)) {
        await page.mouse.click(st.confirm.x, st.confirm.y);
        run.cash.clicks.push({ kind: 'confirm-change', ...st.confirm });
      }
    } else {
      for (let i = 0; i < 26; i += 1) {
        const st = await cardPoint();
        run.flowTrail.push(st.flow);
        if (!st.flow || st.flow === 'Done' || st.flow === 'Complete') break;
        if (st.flow === 'CardAmountEntry') {
          const keys = await page.evaluate(async () => {
            const r = window.__fw.scene3d.clubhouse().register;
            const reg = await import(new URL('src/sim/register.js', document.baseURI).href);
            const tx = r.getTx();
            if (!tx) return null;
            const cents = String(Math.round(reg.totalOf(tx) * 100));
            const pt = (id) => { try { const p = r.cardKeyScreenPoint(id); return p ? { id, x: p.x, y: p.y } : null; } catch { return null; } };
            return { cents, digits: cents.split('').map(pt), ok: pt('OK') };
          });
          if (keys) {
            run.typed = keys.cents;
            for (const k of keys.digits) if (k) { await page.mouse.click(k.x, k.y); await page.waitForTimeout(160); }
            if (keys.ok) { await page.mouse.click(keys.ok.x, keys.ok.y); await page.waitForTimeout(900); }
          }
        } else {
          const target = (st.card && st.card.onScreen ? st.card : null) || st.terminal || st.confirm;
          if (target && Number.isFinite(target.x)) await page.mouse.click(target.x, target.y);
        }
        await page.waitForTimeout(900);
        const done = await page.evaluate((identity) => (
          (window.__fw.state.shop.transactionHistory || []).filter((row) => (
            Number(row.number) === Number(identity.number)
              && String(row.customerId || '') === String(identity.customerId || '')
          )).length > identity.matchingRowsBefore
        ), run.saleIdentity);
        if (done) break;
      }
    }
    run.completed = await page.waitForFunction((identity) => (
      (window.__fw.state.shop.transactionHistory || []).filter((row) => (
        Number(row.number) === Number(identity.number)
          && String(row.customerId || '') === String(identity.customerId || '')
      )).length > identity.matchingRowsBefore
    ), run.saleIdentity, { timeout: 45000 }).then(() => true).catch(() => false);
    if (run.postBankFault) {
      run.postBankFault.released = await page.waitForFunction(([identity, failuresBefore, expected]) => {
        const register = window.__fw.scene3d.clubhouse().register;
        const failures = register.checkoutWatchdogDiagnostics?.().postBankFailures || [];
        const recoveries = register.checkoutWatchdogDiagnostics?.().postBankRecoveries || [];
        const recovered = failures.slice(failuresBefore).filter((failure) => (
          failure.stage === expected.stage
            && Number(failure.transactionNumber) === Number(identity.number)
            && String(failure.customerId || '') === String(identity.customerId || '')
            && failure.message === expected.message
        ));
        return !register.getTx() && !register.getCustomer() && recovered.length === 1;
      }, [run.saleIdentity, run.postBankFault.failuresBefore, run.postBankFault.expected], {
        timeout: 12000,
        polling: 50,
      })
        .then(() => true).catch(() => false);
      run.postBankFault.immediate = await page.evaluate(([identity, failuresBefore]) => {
        const app = window.__fw;
        const ch = app.scene3d.clubhouse();
        const register = ch.register;
        const c = ch.customers().find((customer) => (
          String(customer.customerId) === String(identity.customerId)
        )) || null;
        const descendsFrom = (node, ancestor) => {
          for (let current = node; current; current = current.parent) {
            if (current === ancestor) return true;
          }
          return false;
        };
        const failures = register.checkoutWatchdogDiagnostics?.().postBankFailures || [];
        const recoveries = register.checkoutWatchdogDiagnostics?.().postBankRecoveries || [];
        const inventoryNow = Object.fromEntries(identity.goodsSkuIds.map((skuId) => {
          const inv = app.state.shop.inventory?.[skuId] || {};
          return [skuId, { shelf: inv.shelf ?? 0, back: inv.back ?? 0 }];
        }));
        const exactRows = (app.state.shop.transactionHistory || []).filter((row) => (
          Number(row.number) === Number(identity.number)
            && String(row.customerId || '') === String(identity.customerId || '')
        ));
        const directoryCustomer = (app.state.customerDirectory?.customers || []).find((entry) => (
          String(entry.customerId) === String(identity.customerId)
        )) || null;
        const visitHistoryNow = structuredClone(directoryCustomer?.visitHistory || null);
        const historyBefore = identity.visitHistoryBefore || {};
        const visitHistoryDelta = visitHistoryNow ? {
          totalVisits: Number(visitHistoryNow.totalVisits || 0)
            - Number(historyBefore.totalVisits || 0),
          completedCheckIns: Number(visitHistoryNow.completedCheckIns || 0)
            - Number(historyBefore.completedCheckIns || 0),
          completedPurchases: Number(visitHistoryNow.completedPurchases || 0)
            - Number(historyBefore.completedPurchases || 0),
          cashPayments: Number(visitHistoryNow.cashPayments || 0)
            - Number(historyBefore.cashPayments || 0),
          cardPayments: Number(visitHistoryNow.cardPayments || 0)
            - Number(historyBefore.cardPayments || 0),
          lifetimeSpendCents: Math.round(Number(visitHistoryNow.lifetimeSpend || 0) * 100)
            - Math.round(Number(historyBefore.lifetimeSpend || 0) * 100),
        } : null;
        const matchingRecoveries = recoveries.filter((entry) => (
          Number(entry.transactionNumber) === Number(identity.number)
            && String(entry.customerId || '') === String(identity.customerId || '')
        ));
        return {
          failuresAdded: failures.slice(failuresBefore),
          exactRowsAdded: Math.max(0, exactRows.length - identity.matchingRowsBefore),
          registerTxReleased: !register.getTx(),
          registerCustomerReleased: !register.getCustomer(),
          queueHasCustomer: (ch.checkoutQueue?.() || []).some((entry) => (
            String(entry.customerId) === String(identity.customerId)
          )),
          customerAlreadyGone: !c,
          customerBought: !!c?.bought,
          customerCartLength: c?.cart?.length ?? null,
          customerCheckoutPhase: c?.checkoutPhase ?? null,
          customerBagDescendsFromCustomer: !!(
            c?.bagMesh && c?.mesh && descendsFrom(c.bagMesh, c.mesh)
          ),
          customerBagOwner: c?.bagMesh?.userData?.checkoutOwner ?? null,
          pendingHandoffBagCleared: c ? c.checkoutHandoffBag == null : null,
          registerBagOwnership: register.checkoutBagOwnershipStatus?.() || null,
          heldGoods: (app.state.shop.held || [])
            .filter((unit) => identity.goodsUids.includes(unit.uid)).map((unit) => unit.uid).sort(),
          inventoryNow,
          inventoryMatchesPreBank: JSON.stringify(inventoryNow)
            === JSON.stringify(identity.inventoryBeforeBank),
          visitHistoryNow,
          visitHistoryDelta,
          recoverySnapshots: matchingRecoveries,
        };
      }, [run.saleIdentity, run.postBankFault.failuresBefore]);
    }
    await page.waitForTimeout(2500);
    run.books = say(`${answer}:books`, await page.evaluate(([name, identity, reservationId]) => {
      const app = window.__fw;
      const ch = app.scene3d.clubhouse();
      const rows = app.state.shop?.transactionHistory || [];
      // Match and count this exact transaction identity. A capped 100-row
      // history can prepend one ticket while evicting one old row, so a total
      // length delta is not evidence that nothing banked.
      const exactRows = rows.filter((row) => (
        Number(row.number) === Number(identity.number)
          && String(row.customerId || '') === String(identity.customerId || '')
      ));
      const rowsAdded = Math.max(0, exactRows.length - identity.matchingRowsBefore);
      const newest = exactRows[0] || null;
      const c = ch.customers().find((customer) => (
        String(customer.customerId) === String(identity.customerId)
      )) || null;
      const heldGoods = (app.state.shop.held || [])
        .filter((unit) => identity.goodsUids.includes(unit.uid)).map((unit) => unit.uid).sort();
      const inventoryNow = Object.fromEntries(identity.goodsSkuIds.map((skuId) => {
        const inv = app.state.shop.inventory?.[skuId] || {};
        return [skuId, { shelf: inv.shelf ?? 0, back: inv.back ?? 0 }];
      }));
      const reservation = (app.state.reservations?.booked || [])
        .find((entry) => String(entry.id) === String(reservationId)) || null;
      const out0 = {
        ticketTotal: newest ? newest.total : null,
        serviceTotal: newest ? (newest.serviceTotal ?? 0) : null,
        method: newest?.method ?? null,
        tendered: newest?.tendered ?? null,
        changeGiven: newest?.changeGiven ?? null,
        extraChange: newest?.extraChange ?? null,
        lost: newest?.lost ?? null,
        cash: newest?.cash ?? null,
        referenceId: newest?.referenceId ?? null,
        ticketGoodsLines: newest?.items?.filter((item) => !String(item.skuId).startsWith('service:')).length ?? null,
        ticketServiceLines: newest?.items?.filter((item) => String(item.skuId).startsWith('service:')).length ?? null,
        // B4b: refused must NOT mean the goods went back on the shelf
        stillInShop: !!c,
        customerBought: !!c?.bought,
        customerCartLength: c?.cart?.length ?? null,
        heldGoods,
        inventoryNow,
        inventoryMatchesPreBank: JSON.stringify(inventoryNow)
          === JSON.stringify(identity.inventoryBeforeBank),
        matchedNumber: newest?.number ?? null,
        matchedCustomerId: newest?.customerId ?? null,
        persistentDrawer: structuredClone(app.state.shop.drawer || {}),
        cardOwnedResources: ch.register.cardOwnedResourceStatus?.() || null,
        reservation: reservation ? {
          id: reservation.id,
          customerId: reservation.customerId ?? null,
          fullName: reservation.fullName ?? reservation.name ?? null,
          minute: reservation.minute,
          status: reservation.status,
          checkInTransactionNumber: reservation.checkInTransactionNumber ?? null,
        } : null,
      };
      return { ...out0, rowsAdded };
    }, [run.staged.name, run.saleIdentity, run.reservationOutcome?.reservationId]));
    await page.screenshot({ path: path.join(OUT, `${answer}-${method}.png`), scale: 'css' });
    run.departed = await page.waitForFunction((customerId) => {
      const ch = window.__fw.scene3d.clubhouse();
      return !ch.customers().some((customer) => String(customer.customerId) === String(customerId))
        && !ch.register.getCustomer() && !ch.register.getTx();
    }, run.staged.customerId, { timeout: 20000 }).then(() => true).catch(() => false);
    run.afterVisit = await page.evaluate((identity) => {
      const app = window.__fw;
      const ch = window.__fw.scene3d.clubhouse();
      const inventoryNow = Object.fromEntries(identity.goodsSkuIds.map((skuId) => {
        const inv = app.state.shop.inventory?.[skuId] || {};
        return [skuId, { shelf: inv.shelf ?? 0, back: inv.back ?? 0 }];
      }));
      return {
        customerGone: !ch.customers().some((customer) => (
          String(customer.customerId) === String(identity.customerId)
        )),
        registerCustomerGone: !ch.register.getCustomer(),
        ticketReleased: !ch.register.getTx(),
        queue: ch.checkoutQueue?.() || [],
        heldGoods: (app.state.shop.held || [])
          .filter((unit) => identity.goodsUids.includes(unit.uid)).map((unit) => unit.uid).sort(),
        inventoryNow,
        inventoryMatchesPreBank: JSON.stringify(inventoryNow)
          === JSON.stringify(identity.inventoryBeforeBank),
        exactRowsAdded: Math.max(0, (app.state.shop.transactionHistory || []).filter((row) => (
          Number(row.number) === Number(identity.number)
            && String(row.customerId || '') === String(identity.customerId || '')
        )).length - identity.matchingRowsBefore),
        paidBagResources: ch.register.paidBagResourceStatus?.() || null,
      };
    }, run.saleIdentity);
    if (answer === 'book' && method === 'card' && requestedCase === 'book' && !requestedFault) {
      run.saveLoad = await manualCheckoutSaveLoad(
        run.saleIdentity,
        run.reservationOutcome?.reservationId,
      );
    }
    return run;
  };

  if (requestedCase === 'book' || requestedCase === 'both') {
    out.runs.book = await playVisit('book', requestedMethod);
  }
  if (requestedCase === 'adjusted') {
    out.runs.adjusted = await playVisit('adjusted', requestedMethod);
  }
  if (requestedCase === 'existing') {
    out.runs.existing = await playVisit('existing', requestedMethod);
  }
  // B5, used as the tool it is: the second visit cannot be staged on top of the
  // first. The first run of this driver left run one's customer standing at the
  // counter, so run two's shopper never reached the walk-in list and every
  // refuse-side check failed for a reason that had nothing to do with refusing.
  if (requestedCase === 'both') {
    out.clearedBetweenRuns = await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      const names = [];
      for (let i = 0; i < 6; i += 1) {
        const n = ch.dismissCounterCustomer?.();
        if (!n) break;
        names.push(n);
      }
      return names;
    });
    say('cleared-between-runs', out.clearedBetweenRuns);
    await page.waitForTimeout(1500);
  }
  if (requestedCase === 'refuse' || requestedCase === 'both') {
    out.runs.refuse = await playVisit('refuse', requestedMethod);
  }

  // B5 ON ITS OWN. Clearing between the two visits found nobody once the first
  // sale started completing properly, so the button was being "verified" by a
  // no-op. A customer is staged specifically for it.
  if (requestedCase === 'both') {
    await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      if (window.__fw.state.shop) window.__fw.state.shop.open = true;
      ch.sendToCounter(['balls1'], 'card');
    });
    await page.waitForTimeout(9000);
    out.b5 = say('b5-clear-the-counter', await page.evaluate(() => {
      const ch = window.__fw.scene3d.clubhouse();
      const before = ch.register.getTx();
      const name = ch.dismissCounterCustomer?.() ?? null;
      return {
        name,
        hadATicket: !!before,
        ticketGone: !ch.register.getTx(),
        registerReleased: !ch.register.getCustomer(),
      };
    }));
  }

  const b = out.runs.book;
  const a = out.runs.adjusted;
  const e = out.runs.existing;
  const r = out.runs.refuse;
  // B4's two outcomes, computed BEFORE out.checks -- spreading `out.outcomes`
  // into a literal that ran first spread `undefined`, which is legal, silent,
  // and contributed nothing. The checks printed green while saying nothing.
  out.outcomes = {
    ...(b ? {
      bookedSaleCompletesExactlyOnce: b.completed === true && b.books?.rowsAdded === 1,
      bookedTicketCarriesExactlyOneGreenFee: (b.books?.serviceTotal ?? 0) > 0
        && b.returnPresentation?.serviceLineCount === 1
        && Number(b.reservationOutcome?.minute) === Number(b.staged?.minute)
        && b.books?.reservation?.status === 'played'
        && b.books?.referenceId === `reservation:${b.reservationOutcome?.reservationId}:check-in`
        && Number(b.books?.reservation?.checkInTransactionNumber) === Number(b.saleIdentity?.number)
        && b.books?.matchedNumber === b.saleIdentity?.number
        && String(b.books?.matchedCustomerId || '') === String(b.saleIdentity?.customerId || ''),
    } : {}),
    ...(r ? {
      refusedSaleCompletesExactlyOnce: r.completed === true && r.books?.rowsAdded === 1,
      refusedTicketIsGoodsOnly: (r.books?.serviceTotal ?? 0) === 0
        && (r.books?.ticketTotal ?? 0) > 0
        && r.returnPresentation?.serviceLineCount === 0
        && r.books?.ticketGoodsLines === 2
        && r.books?.ticketServiceLines === 0
        && r.reservationOutcome?.reservationId == null
        && r.books?.matchedNumber === r.saleIdentity?.number
        && String(r.books?.matchedCustomerId || '') === String(r.saleIdentity?.customerId || ''),
    } : {}),
    ...(a ? {
      adjustedSaleCompletesExactlyOnce: a.completed === true && a.books?.rowsAdded === 1,
      adjustedSlotIsDifferentAndCarriesOneGreenFee: a.staged?.filledRequestedSlot === true
        && Number(a.slot?.minute) !== Number(a.staged?.minute)
        && Number(a.reservationOutcome?.minute) === Number(a.slot?.minute)
        && a.returnPresentation?.serviceLineCount === 1
        && a.books?.ticketServiceLines === 1,
      adjustedIdentitySurvivesBookingAndPayment: String(a.reservationOutcome?.customerId || '')
        === String(a.staged?.customerId || '')
        && String(a.books?.matchedCustomerId || '') === String(a.staged?.customerId || '')
        && a.books?.reservation?.status === 'played'
        && a.books?.referenceId === `reservation:${a.reservationOutcome?.reservationId}:check-in`
        && Number(a.books?.reservation?.checkInTransactionNumber) === Number(a.saleIdentity?.number),
    } : {}),
    ...(e ? {
      existingCheckInSaleCompletesExactlyOnce: e.completed === true && e.books?.rowsAdded === 1,
      existingBookingCarriesOneGreenFeeAndIsPlayed: e.afterScan?.onReservationList === true
        && e.returnPresentation?.serviceLineCount === 1
        && e.books?.ticketServiceLines === 1
        && e.books?.reservation?.status === 'played'
        && e.books?.referenceId === `reservation:${e.staged?.reservationId}:check-in`
        && Number(e.books?.reservation?.checkInTransactionNumber) === Number(e.saleIdentity?.number),
      existingIdentitySurvivesCheckInAndPayment: String(e.books?.reservation?.customerId || '')
        === String(e.staged?.customerId || '')
        && String(e.books?.matchedCustomerId || '') === String(e.staged?.customerId || '')
        && e.existingAttached?.sameReservationCharacterCount === 1
        && e.existingAttached?.sameIdentityCharacterCount === 1,
    } : {}),
  };
  const runs = [b, a, e, r].filter(Boolean);
  const walkInRuns = runs.filter((run) => run.answer !== 'existing');
  const returnedCorrectly = (run) => run.answerApplied === true
    && run.returnTenderStageReached === true
    && run.returnCameraStable === true
    && run.returnPresentation?.active === true
    && run.returnPresentation?.checkoutTabPainted === true
    && run.returnPresentation?.checkInTabUnpainted === true
    && Number.isFinite(run.returnPresentation?.cameraPositionDelta)
    && Number(run.returnPresentation.cameraPositionDelta) <= 0.05
    && Number.isFinite(run.returnPresentation?.yawDelta)
    && Number(run.returnPresentation.yawDelta) <= 0.01
    && Number.isFinite(run.returnPresentation?.pitchDelta)
    && Number(run.returnPresentation.pitchDelta) <= 0.01
    && Number.isFinite(run.returnPresentation?.rollMagnitude)
    && Number(run.returnPresentation.rollMagnitude) <= 0.01
    && Math.abs(Number(run.returnPresentation?.fov) - Number(run.returnPresentation?.expectedFov)) <= 0.1
    && run.returnPresentation?.method === run.method
    && run.returnHoverTarget?.inView === true
    && run.returnHoverTarget?.clickable === true
    && (run.method === 'card'
      ? run.returnPresentation?.card?.inView === true
      : run.returnPresentation?.cash?.inView === true)
    && run.returnPresentation?.registerClass === true
    && run.returnPresentation?.pointerLocked === false
    && run.returnHoverAffordance?.cursor === 'pointer'
    && (run.method === 'card'
      ? run.returnHoverAffordance?.physical?.kind === 'payment-card'
      : run.returnHoverAffordance?.physical?.kind === 'money'
        && run.returnHoverAffordance?.physical?.from === 'tender')
    && run.returnPresentation?.goodsLineCount === 2
    && run.returnPresentation?.serviceLineCount === (run.answer === 'refuse' ? 0 : 1);
  const paidBagResourcesReleasedForRun = (run) => {
    const before = run?.saleIdentity?.paidBagResourcesBefore;
    const after = run?.afterVisit?.paidBagResources;
    const fields = [
      'transferredBags', 'successfullyDisposedBags', 'failedDisposals',
      'ownedGeometriesTransferred', 'ownedMaterialsTransferred',
      'ownedGeometriesDisposed', 'ownedMaterialsDisposed', 'livePaidBags',
    ];
    if (!before || !after || !fields.every((field) => (
      Number.isInteger(before[field]) && before[field] >= 0
        && Number.isInteger(after[field]) && after[field] >= 0
    ))) return false;
    const delta = (field) => after[field] - before[field];
    return delta('transferredBags') === 1
      && delta('successfullyDisposedBags') === 1
      && delta('failedDisposals') === 0
      && after.transferredBags === after.successfullyDisposedBags
      && after.failedDisposals === 0
      && after.livePaidBags === 0
      && delta('ownedGeometriesTransferred') > 0
      && delta('ownedMaterialsTransferred') > 0
      && delta('ownedGeometriesDisposed') === delta('ownedGeometriesTransferred')
      && delta('ownedMaterialsDisposed') === delta('ownedMaterialsTransferred');
  };
  const cashVarianceFieldsAreExplicitAndZero = (run) => {
    const books = run?.books;
    return !!books
      && Object.prototype.hasOwnProperty.call(books, 'lost')
      && Object.prototype.hasOwnProperty.call(books, 'extraChange')
      && Number.isFinite(books.lost)
      && Number.isFinite(books.extraChange)
      && Math.round(books.lost * 100) === 0
      && Math.round(books.extraChange * 100) === 0;
  };
  const cashCompletedCorrectly = (run) => run.method !== 'cash' || (
    Number(run.cash?.changeDue) > 0
      && run.cash?.plan && Object.keys(run.cash.plan).length > 0
      && run.cash?.cameraStable === true
      && run.cash?.readyForChange === true
      && run.cash?.beforeConfirm?.giving?.state === 'exact'
      && Number(run.cash?.beforeConfirm?.giving?.deltaCents) === 0
      && run.cash?.beforeConfirm?.confirm?.inView === true
      && run.cash?.beforeConfirm?.confirmEnabled === true
      && run.cash?.clicks?.filter((click) => click.kind === 'drawer-slot').length > 0
      && run.cash?.clicks?.filter((click) => click.kind === 'drawer-slot')
        .every((click) => click.clicked === true && click.changedExactly === true)
      && run.cash?.accountingCheckpoint?.persistentDrawerStillBaseline === true
      && JSON.stringify(run.books?.persistentDrawer || {})
        === JSON.stringify(run.cash?.accountingCheckpoint?.expectedCommittedDrawer || {})
      && run.books?.method === 'cash'
      && cashVarianceFieldsAreExplicitAndZero(run)
      && Math.round(Number(run.books?.changeGiven || 0) * 100)
        === Math.round(Number(run.cash?.changeDue || 0) * 100)
      && Math.round((Number(run.books?.tendered || 0) - Number(run.books?.changeGiven || 0)) * 100)
        === Math.round(Number(run.books?.cash || 0) * 100)
      && Math.round(Number(run.books?.cash || 0) * 100)
        === Math.round(Number(run.books?.ticketTotal || 0) * 100)
      && run.cash?.clicks?.some((click) => click.kind === 'confirm-change')
  );
  const expectedPostBankFault = POST_BANK_FAULTS[requestedFault] || null;
  const postBankFaultRecoversWithoutDuplication = !expectedPostBankFault || (
    b?.postBankFault?.armed?.armed === true
      && Number(b.postBankFault.armed.transactionNumber) === Number(b.saleIdentity?.number)
      && String(b.postBankFault.armed.customerId || '') === String(b.saleIdentity?.customerId || '')
      && b.postBankFault.released === true
      && b.postBankFault.immediate?.failuresAdded?.length === 1
      && b.postBankFault.immediate.failuresAdded[0]?.stage === expectedPostBankFault.stage
      && Number(b.postBankFault.immediate.failuresAdded[0]?.transactionNumber)
        === Number(b.saleIdentity?.number)
      && String(b.postBankFault.immediate.failuresAdded[0]?.customerId || '')
        === String(b.saleIdentity?.customerId || '')
      && b.postBankFault.immediate.failuresAdded[0]?.message === expectedPostBankFault.message
      && b.postBankFault.immediate.exactRowsAdded === 1
      && b.postBankFault.immediate.registerTxReleased === true
      && b.postBankFault.immediate.registerCustomerReleased === true
      && b.postBankFault.immediate.queueHasCustomer === false
      && b.postBankFault.immediate.heldGoods?.length === 0
      && b.postBankFault.immediate.inventoryMatchesPreBank === true
      && b.postBankFault.immediate.recoverySnapshots?.length === 1
      && b.postBankFault.immediate.recoverySnapshots[0]?.firstFailureStage
        === expectedPostBankFault.stage
      && b.postBankFault.immediate.recoverySnapshots[0]?.salvageAttempted === true
      && b.postBankFault.immediate.recoverySnapshots[0]?.salvageSucceeded === true
      && b.postBankFault.immediate.recoverySnapshots[0]
        ?.authoritativeReleaseSucceeded === true
      && b.postBankFault.immediate.recoverySnapshots[0]
        ?.customerBagOwnerBeforeCleanup === 'customer'
      && b.postBankFault.immediate.recoverySnapshots[0]
        ?.pendingHandoffBagClearedBeforeCleanup === true
      && b.postBankFault.immediate.recoverySnapshots[0]
        ?.customerOwnedUnderRegisterBeforeCleanup?.length === 0
      && b.postBankFault.immediate.recoverySnapshots[0]
        ?.counterBagOwnerAfterCleanup === 'register'
      && b.postBankFault.immediate.visitHistoryDelta?.totalVisits === 1
      && b.postBankFault.immediate.visitHistoryDelta?.completedCheckIns === 1
      && b.postBankFault.immediate.visitHistoryDelta?.completedPurchases === 1
      && b.postBankFault.immediate.visitHistoryDelta?.cashPayments === 0
      && b.postBankFault.immediate.visitHistoryDelta?.cardPayments === 1
      && b.postBankFault.immediate.visitHistoryDelta?.lifetimeSpendCents
        === Math.round(Number(b.books?.ticketTotal || 0) * 100)
      && b.postBankFault.immediate.registerBagOwnership
        ?.customerOwnedUnderRegister?.length === 0
      && b.postBankFault.immediate.registerBagOwnership?.counterBagOwner === 'register'
      && b.postBankFault.immediate.customerBagDescendsFromCustomer === true
      && b.postBankFault.immediate.customerBagOwner === 'customer'
      && b.afterVisit?.exactRowsAdded === 1
  );
  out.checks = {
    firstDoorAndSheet06ReadyBeforeCheckout:
      out.initialSceneReadiness?.firstDoorVisibility?.status === 'ready'
      && out.initialSceneReadiness?.firstDoorVisibility?.safeToPrewarm === true
      && out.initialSceneReadiness?.firstDoorVisibility?.degradedSources?.length === 0
      && out.initialSceneReadiness?.sheet06?.activationStatus === 'active'
      && out.initialSceneReadiness?.sheet06?.actualSharedGameIntegrated === true
      && out.initialSceneReadiness?.sheet06?.activationError == null,
    paymentGpuPrewarmDrewAndReleasedEveryTender: out.paymentGpuPrewarm?.ready === true
      && out.paymentGpuPrewarm?.complete === true
      && out.paymentGpuPrewarm?.expected === 12
      && out.paymentGpuPrewarm?.built === 12
      && out.paymentGpuPrewarm?.drawn === 12
      && Number(out.paymentGpuPrewarm?.expectedDrawUnits) > 12
      && Number(out.paymentGpuPrewarm?.observedDrawUnits)
        === Number(out.paymentGpuPrewarm?.expectedDrawUnits)
      && Array.isArray(out.paymentGpuPrewarm?.observedStems)
      && out.paymentGpuPrewarm.observedStems.length === 12
      && Array.isArray(out.paymentGpuPrewarm?.exactVariantStems)
      && out.paymentGpuPrewarm.exactVariantStems.length === 12
      && out.paymentGpuPrewarm?.expectedCardVariants === 6
      && out.paymentGpuPrewarm?.observedCardVariants === 6
      && out.paymentGpuPrewarm?.cachedCardVariants === 6
      && Array.isArray(out.paymentGpuPrewarm?.expectedCardVariantIds)
      && out.paymentGpuPrewarm.expectedCardVariantIds.length === 6
      && Array.isArray(out.paymentGpuPrewarm?.observedCardVariantIds)
      && JSON.stringify(out.paymentGpuPrewarm.observedCardVariantIds)
        === JSON.stringify(out.paymentGpuPrewarm.expectedCardVariantIds)
      && out.paymentGpuPrewarm?.cardTextureCacheDisposed === false
      && out.paymentGpuPrewarm?.released === true
      && out.paymentGpuPrewarm?.aborted === false
      && out.paymentGpuPrewarm?.releasedCount === 12
      && out.paymentGpuPrewarm?.representatives === 0,
    // CONTROL: both visits actually got to the counter with goods on it
    everyRequestedVisitReachedTheCounter: runs.length > 0
      && runs.every((run) => run.reachedCounter === true),
    everyVisitBanksExactlyOneIdentityMatchedTicket: runs.every((run) => run.completed === true
      && run.books?.rowsAdded === 1
      && Number(run.books?.matchedNumber) === Number(run.saleIdentity?.number)
      && String(run.books?.matchedCustomerId || '') === String(run.saleIdentity?.customerId || '')
      && run.books?.ticketGoodsLines === 2
      && run.books?.ticketServiceLines === (run.answer === 'refuse' ? 0 : 1)),
    everyBankedSaleTransfersGoodsWithoutRestocking: runs.every((run) => (
      run.saleIdentity?.heldGoodsBeforeBank?.length === 2
        && run.books?.customerCartLength === 0
        && run.books?.heldGoods?.length === 0
        && run.books?.inventoryMatchesPreBank === true
        && run.afterVisit?.heldGoods?.length === 0
        && run.afterVisit?.inventoryMatchesPreBank === true
    )),
    everyCardVisitReleasesOwnedPresentationResources: runs.every((run) => (
      run.method !== 'card' || (
        run.books?.cardOwnedResources?.geometriesCreated > 0
          && run.books.cardOwnedResources.geometriesCreated
            === run.books.cardOwnedResources.geometriesDisposed
          && run.books.cardOwnedResources.materialsCreated
            === run.books.cardOwnedResources.materialsDisposed
          && run.books.cardOwnedResources.texturesCreated
            === run.books.cardOwnedResources.texturesDisposed
          && run.books.cardOwnedResources.liveGeometries === 0
          && run.books.cardOwnedResources.liveMaterials === 0
          && run.books.cardOwnedResources.liveTextures === 0
      )
    )),
    everyNaturalCustomerCardUsesItsExactCachedIdentityVariant: runs.every((run) => (
      run.method !== 'card' || (
        String(run.naturalCardBrand?.customerId || '')
          === String(run.staged?.customerId || '')
          && !!run.naturalCardBrand?.expectedCardId
          && !!run.naturalCardBrand?.naturalSha256
          && run.naturalCardBrand.naturalSha256 === run.naturalCardBrand.expectedSha256
          && run.naturalCardBrand?.cache?.entries === 6
          && run.naturalCardBrand?.cache?.disposed === false
      )
    )),
    ...(requestedFault === 'paid-customer-presentation' ? {
      postBankPresentationFailureRecoversWithoutDuplication:
        postBankFaultRecoversWithoutDuplication,
    } : {}),
    ...(requestedFault === 'paid-customer-release' ? {
      postBankReleaseFailureRecoversWithoutDuplication:
        postBankFaultRecoversWithoutDuplication,
    } : {}),
    ...(requestedFault === 'bank-helper-return' ? {
      bankHelperPartialCommitRecoversWithoutDuplication:
        postBankFaultRecoversWithoutDuplication,
    } : {}),
    // B2 — the ask names a time. WATCHED FAIL: it read "have you got a time
    // free today?" before, which is a question with nothing in it to book.
    askNamesATime: walkInRuns.every((run) => run.afterScan?.askNamesATime === true),
    existingVisitNamesCheckIn: runs.filter((run) => run.answer === 'existing').every((run) => (
      /check in/i.test(String(run.afterScan?.dialogue || ''))
    )),
    // B1, first half — the customer EXISTS on the desk list with times to
    // offer. WATCHED FAIL: reverted, this reads onWalkInList false and
    // slotsOffered 0, which is the wall the sale was stuck behind.
    customerIsOnTheCorrectDeskList: runs.every((run) => (run.answer === 'existing'
      ? run.afterScan?.onReservationList === true
      : run.afterScan?.onWalkInList === true)),
    slotsAreOfferedToWalkIns: walkInRuns.every((run) => (run.afterScan?.slotsOffered ?? 0) > 0),
    everyRowSelectionChangedTheDrawnScreen: runs.every((run) => run.selectionApplied === true),
    everyDeskAnswerChangedTheDrawnScreen: runs.every((run) => run.answerApplied === true),
    everyDeskClickWasVisible: runs.every((run) => run.answered?.everyClickLanded === true),
    everyAnswerReturnedToVisibleCheckoutAndTender: runs.every(returnedCorrectly),
    everyCashVisitUsesExactPhysicalChangeAndBalancesTheDrawer: runs.every(cashCompletedCorrectly),
    everyCustomerLeavesAndReleasesTheRegister: runs.every((run) => run.departed === true
      && run.afterVisit?.customerGone === true
      && run.afterVisit?.registerCustomerGone === true
      && run.afterVisit?.ticketReleased === true),
    everyPaidBagTransferReleasesItsOwnedResources: runs.every(paidBagResourcesReleasedForRun),
    ...(requestedCase === 'book' && requestedMethod === 'card' && !requestedFault ? {
      acceptedCombinedSaleSurvivesManualSlotRoundTrip: b?.saveLoad?.storage?.bytes > 0
        && b.saveLoad.registerExit?.ok === true
        && b.saveLoad.loadedCameraStable === true
        && b.saveLoad.beforeStableSamples >= 2
        && b.saveLoad.afterStableSamples >= 2
        && b.saveLoad.storage.native === true
        && b.saveLoad.storage.source === 'primary'
        && b.saveLoad.storage.recovered === false
        && b.saveLoad.storage.repairedPrimary === false
        && b.saveLoad.storage.primaryError == null
        && b.saveLoad.storage.backupError == null
        && b.saveLoad.storage.metadata?.source === 'primary'
        && b.saveLoad.storage.metadata?.recovered === false
        && b.saveLoad.storage.metadata?.primaryError == null
        && b.saveLoad.storage.metadata?.backupError == null
        && b.saveLoad.storage.metadataFresh === true
        && b.saveLoad.storageAfter?.source === 'primary'
        && b.saveLoad.storageAfter?.recovered === false
        && b.saveLoad.storageAfter?.primaryError == null
        && b.saveLoad.storageAfter?.backupError == null
        && b.saveLoad.storageAfter?.sha256 === b.saveLoad.storage.sha256
        && b.saveLoad.deserializeOrSchemaRepairNotices?.length === 0
        && b.saveLoad.visualFallbackNotices?.length === 0
        && b.saveLoad.restoredRuntime?.screen === 'game'
        && b.saveLoad.restoredRuntime?.prewarming === false
        && b.saveLoad.restoredRuntime?.walkActive === true
        && b.saveLoad.restoredRuntime?.registerActive === false
        && b.saveLoad.restoredRuntime?.registerHasTx === false
        && b.saveLoad.restoredRuntime?.registerHasCustomer === false
        && b.saveLoad.restoredRuntime?.registerModeClass === false
        && b.saveLoad.restoredRuntime?.pointerLocked === false
        && b.saveLoad.restoredRuntime?.firstDoorVisibility?.status === 'ready'
        && b.saveLoad.restoredRuntime?.firstDoorVisibility?.safeToPrewarm === true
        && b.saveLoad.restoredRuntime?.firstDoorVisibility?.degradedSources?.length === 0
        && b.saveLoad.restoredRuntime?.sheet06?.activationStatus === 'active'
        && b.saveLoad.restoredRuntime?.sheet06?.actualSharedGameIntegrated === true
        && b.saveLoad.restoredRuntime?.sheet06?.activationError == null
        && b.saveLoad.restoredRuntime?.paymentGpuPrewarm?.ready === true
        && b.saveLoad.restoredRuntime?.paymentGpuPrewarm?.complete === true
        && b.saveLoad.restoredRuntime?.paymentGpuPrewarm?.released === true
        && b.saveLoad.restoredRuntime?.paymentGpuPrewarm?.aborted === false
        && b.saveLoad.restoredRuntime?.paymentGpuPrewarm?.expected === 12
        && b.saveLoad.restoredRuntime?.paymentGpuPrewarm?.built === 12
        && b.saveLoad.restoredRuntime?.paymentGpuPrewarm?.drawn === 12
        && Number(b.saveLoad.restoredRuntime?.paymentGpuPrewarm?.observedDrawUnits)
          === Number(b.saveLoad.restoredRuntime?.paymentGpuPrewarm?.expectedDrawUnits)
        && b.saveLoad.restoredRuntime?.paymentGpuPrewarm?.expectedCardVariants === 6
        && b.saveLoad.restoredRuntime?.paymentGpuPrewarm?.observedCardVariants === 6
        && b.saveLoad.restoredRuntime?.paymentGpuPrewarm?.releasedCount === 12
        && b.saveLoad.restoredRuntime?.paymentGpuPrewarm?.representatives === 0
        && Number(b.saveLoad.restoredRuntime?.speedIdx)
          === Number(b.saveLoad.restoredRuntime?.savedSpeedRung)
        && Number(b.saveLoad.restoredRuntime?.savedSpeedRung)
          === Number(b.saveLoad.before?.world?.golfDaySpeedRung)
        && Number(b.saveLoad.restoredRuntime?.clockMinutes)
          >= Number(b.saveLoad.before?.world?.clockMinutes)
        && Number(b.saveLoad.restoredRuntime?.clockMinutes)
          < Number(b.saveLoad.before?.world?.clockMinutes) + 0.5
        && b.saveLoad.pausedRestoredRuntimeThroughControl === true
        && b.saveLoad.canary?.advanced === true
        && b.saveLoad.canary?.durableChanged === true
        && b.saveLoad.clockRestored === true
        && b.saveLoad.sceneChanged === true
        && b.saveLoad.validBefore === true
        && b.saveLoad.validAfter === true
        && b.saveLoad.exact === true,
    } : {}),
    noDeskWaitTriggeredWatchdogRecovery: runs.every((run) => (
      (run.afterAnswer?.watchdog?.events || []).length === (run.afterScan?.watchdogEventCount ?? 0)
    )),
    // B3 — the screen says WHY it is waiting
    statusNamesTheTeeTime: runs.every((run) => (
      /tee time/i.test(String(run.afterScan?.status || ''))
        || /tee time/i.test(String(run.afterScan?.instruction || ''))
    )),
    // B5 — the laptop's verb, exercised here because this driver needs it
    ...out.outcomes,
    ...(requestedCase === 'both' ? {
      b5ClearTheCounterWorks: !!out.b5?.name && out.b5.ticketGone === true
        && out.b5.registerReleased === true,
    } : {}),
    noPageErrors: out.errs.length === 0,
    noConsoleErrors: out.consoleErrors.length === 0,
    noFailedRequests: out.failedRequests.length === 0,
    noHttpErrors: out.httpErrors.length === 0,
  };
  // Keep the formerly-failing UI probes visible in the artifact. These now
  // compare the state surrounding the actual mouse click; they do not dispatch
  // a second synthetic selection or mistake the prior sale for this one.
  out.notDone = {
    slotButtonsNeverDrawn: runs.some((run) => !run.selectionApplied),
    hotspotsUnchangedAfterSelect: runs.some((run) => (
      JSON.stringify(run.hotspotsAfterSelect?.before) === JSON.stringify(run.hotspotsAfterSelect?.after)
    )),
    selectionDidDispatch: runs.every((run) => run.selectionApplied === true),
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'checkout.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('B-CHECKOUT', JSON.stringify({
    completed: Object.fromEntries(Object.entries(out.runs).map(([name, run]) => [name, run.completed ?? null])),
    rows: Object.fromEntries(Object.entries(out.runs).map(([name, run]) => [name, run.books ?? null])),
    checks: out.checks, notDone: out.notDone,
  }, null, 2));
  return out;
}
