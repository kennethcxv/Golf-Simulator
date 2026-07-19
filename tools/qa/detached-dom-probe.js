// Classify the DOM nodes counted by Chromium across normal menu reloads.
// This is intentionally diagnostic-only: it patches node factories before the
// application loads, retains only WeakRefs + allocation metadata, and samples
// after forced GC. Run through tools/qa/run-playwright.cjs with --bootstrap.
async (page) => {
  const cycles = Math.max(2, Math.floor(Number(process.env.DETACHED_PROBE_CYCLES) || 3));

  await page.addInitScript(() => {
    const records = [];
    const finalized = new Set();
    let nextId = 1;
    const registry = typeof FinalizationRegistry === 'function'
      ? new FinalizationRegistry((id) => finalized.add(id))
      : null;

    const appFrame = (stack) => String(stack || '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.includes('/src/')) || 'unknown';
    const remember = (node, factory) => {
      if (!node || typeof WeakRef !== 'function') return node;
      const id = nextId++;
      const record = {
        id,
        factory,
        tag: node.nodeName || node.constructor?.name || 'unknown',
        frame: appFrame(new Error().stack),
        ref: new WeakRef(node),
      };
      records.push(record);
      registry?.register(node, id);
      return node;
    };

    const originalCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function trackedCreateElement(...args) {
      return remember(originalCreateElement.apply(this, args), 'createElement');
    };
    const originalCreateElementNS = Document.prototype.createElementNS;
    Document.prototype.createElementNS = function trackedCreateElementNS(...args) {
      return remember(originalCreateElementNS.apply(this, args), 'createElementNS');
    };
    const originalCreateTextNode = Document.prototype.createTextNode;
    Document.prototype.createTextNode = function trackedCreateTextNode(...args) {
      return remember(originalCreateTextNode.apply(this, args), 'createTextNode');
    };
    const originalCreateDocumentFragment = Document.prototype.createDocumentFragment;
    Document.prototype.createDocumentFragment = function trackedCreateDocumentFragment(...args) {
      return remember(originalCreateDocumentFragment.apply(this, args), 'createDocumentFragment');
    };

    const summarize = () => {
      const by = (items, keyer) => {
        const counts = new Map();
        for (const item of items) {
          const key = keyer(item);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        return [...counts.entries()]
          .map(([key, count]) => ({ key, count }))
          .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
      };
      const live = [];
      for (const record of records) {
        const node = record.ref.deref();
        if (node) live.push({ ...record, connected: node.isConnected === true, ref: undefined });
      }
      const detached = live.filter((record) => !record.connected);
      const connected = live.filter((record) => record.connected);
      return {
        created: records.length,
        finalized: finalized.size,
        live: live.length,
        connected: connected.length,
        detached: detached.length,
        liveByTag: by(live, (record) => record.tag),
        detachedByTag: by(detached, (record) => record.tag),
        detachedByFrame: by(detached, (record) => `${record.tag} | ${record.frame}`),
        connectedByTag: by(connected, (record) => record.tag),
      };
    };

    globalThis.__detachedDomProbe = { summarize };
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('http://localhost:8457/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });

  const waitForGameSettled = async () => {
    await page.waitForFunction(
      () => window.__fw?.screen === 'game' && window.__fw?.prewarming === false,
      null,
      { timeout: 120000 },
    );
    await page.waitForFunction(() => {
      const veil = document.querySelector('.load-veil');
      return !veil || getComputedStyle(veil).display === 'none';
    }, null, { timeout: 10000 });
    await page.waitForTimeout(300);
  };
  await waitForGameSettled();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const samples = [];
  const sample = async (label, cycle, location) => {
    await page.mouse.move(800, 450);
    for (let pass = 0; pass < 4; pass += 1) {
      await cdp.send('HeapProfiler.collectGarbage');
      await page.waitForTimeout(75);
    }
    const domCounters = await cdp.send('Memory.getDOMCounters');
    const tracked = await page.evaluate(() => globalThis.__detachedDomProbe.summarize());
    const attached = await page.evaluate(() => {
      let nodes = 1;
      const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
      while (walker.nextNode()) nodes += 1;
      return {
        nodes,
        elements: document.querySelectorAll('*').length,
        canvases: document.querySelectorAll('canvas').length,
        toasts: document.querySelectorAll('.toast').length,
      };
    });
    samples.push({
      label,
      cycle,
      location,
      domCounters,
      attached,
      derivedOffDocumentNodes: Math.max(0, domCounters.nodes - attached.nodes),
      tracked,
    });
  };

  const exitToMenu = async () => {
    await page.keyboard.press('Escape');
    await page.getByText('Office', { exact: true }).click();
    await page.getByText('Exit to main menu (autosaves)', { exact: true }).click();
    await page.getByText('Continue', { exact: true }).waitFor({ timeout: 20000 });
    await page.waitForFunction(
      () => window.__fw?.screen === 'menu' && window.__fw?.scene3d === null,
      null,
      { timeout: 20000 },
    );
  };
  const continueGame = async () => {
    await page.getByText('Continue', { exact: true }).click();
    await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
    await waitForGameSettled();
  };

  await sample('cold-game-baseline', 0, 'game');
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    await exitToMenu();
    await sample(`cycle-${cycle}-menu`, cycle, 'menu');
    await continueGame();
    await sample(`cycle-${cycle}-game`, cycle, 'game');
  }

  const cold = samples.find((entry) => entry.label === 'cold-game-baseline');
  const warmGames = samples.filter((entry) => entry.location === 'game' && entry.cycle > 0);
  const firstWarm = warmGames[0];
  const lastWarm = warmGames[warmGames.length - 1];
  return {
    ok: true,
    protocol: {
      cycles,
      route: 'normal Escape > Office > Exit to main menu > Continue',
      forcedGcPassesPerSample: 4,
      nodeFactoryTracking: 'WeakRef + FinalizationRegistry installed before app scripts',
    },
    deltas: {
      coldToFirstWarm: {
        cdpNodes: firstWarm.domCounters.nodes - cold.domCounters.nodes,
        attachedNodes: firstWarm.attached.nodes - cold.attached.nodes,
        derivedOffDocumentNodes: firstWarm.derivedOffDocumentNodes - cold.derivedOffDocumentNodes,
        trackedDetached: firstWarm.tracked.detached - cold.tracked.detached,
      },
      firstWarmToLastWarm: {
        cdpNodes: lastWarm.domCounters.nodes - firstWarm.domCounters.nodes,
        attachedNodes: lastWarm.attached.nodes - firstWarm.attached.nodes,
        derivedOffDocumentNodes: lastWarm.derivedOffDocumentNodes - firstWarm.derivedOffDocumentNodes,
        trackedDetached: lastWarm.tracked.detached - firstWarm.tracked.detached,
      },
    },
    samples,
  };
}
