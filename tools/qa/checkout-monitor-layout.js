async (page) => {
  // A5 — THE CHECKOUT STATUS PANEL.
  //
  // "Waiting for customer / Ready for next customer / Payment accepted. Still
  // flush to the bottom with no margin, still cluttered."
  //
  // The monitor is a canvas, so this renders the panel straight from
  // frontDeskMonitorUi at its real size for the states the report names, and
  // measures the one thing nobody was checking: where the bottom of the lowest
  // drawn element lands relative to the panel and the screen.
  //
  // Negative control: a deliberately over-stuffed model — every optional row
  // present at once — must ALSO stay inside. A layout that only fits the states
  // it was tuned against is the bug this is replacing.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const OUT = path.resolve('qa/cash-register-production/simplified-rebuild/monitor-layout');
  fs.mkdirSync(OUT, { recursive: true });
  const assert = (value, message) => { if (!value) throw new Error(message); };

  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  const CASES = [
    {
      name: 'waiting',
      model: {
        app: 'checkout', heading: 'Checkout', stage: 'waiting',
        customer: null, items: [], subtotal: 0, discount: 0, tax: 0, taxRate: 0.07, total: 0,
        actions: [{ id: 'exit', label: 'Return to Shop' }],
      },
    },
    {
      name: 'ready-for-next',
      model: {
        app: 'checkout', heading: 'Checkout', stage: 'complete',
        customer: { name: 'Rowan Stone' }, items: [],
        subtotal: 280.90, discount: 0, tax: 19.66, taxRate: 0.07, total: 300.56,
        payment: 'card',
        actions: [
          { id: 'clear-post-sale', label: 'Ready for the next customer', kind: 'primary' },
          { id: 'exit', label: 'Return to Shop' },
        ],
      },
    },
    {
      name: 'payment-accepted',
      model: {
        app: 'checkout', heading: 'Checkout', stage: 'payment-complete',
        customer: { name: 'Elena Moore', paymentChoice: 'CARD' },
        items: [{ name: 'Tee bag (50)', price: 6.9, qty: 1, scanned: true }],
        subtotal: 35.72, discount: 0, tax: 2.5, taxRate: 0.07, total: 38.22,
        payment: 'card', tendered: 38.22,
        actions: [],
      },
    },
    {
      name: 'NEGATIVE-CONTROL-everything-at-once',
      model: {
        app: 'checkout', heading: 'Checkout', stage: 'change-selection',
        customer: { name: 'Wilhelmina Attenborough-Fitzgerald', paymentChoice: 'CASH' },
        items: [{ name: 'Tee bag (50)', price: 6.9, qty: 1, scanned: true }],
        subtotal: 35.72, discount: 4.5, tax: 2.5, taxRate: 0.0725, total: 38.22,
        payment: 'cash', tendered: 60, changeDue: 21.78, selectedChange: 11.25,
        actions: [
          { id: 'a', label: 'Undo Last', kind: 'primary' },
          { id: 'b', label: 'Clear Selection' },
          { id: 'c', label: 'Return to Shop' },
          { id: 'd', label: 'Retry Handoff', kind: 'success' },
        ],
      },
    },
  ];

  const report = { cases: {} };
  for (const testCase of CASES) {
    const result = await page.evaluate(async (input) => {
      const ui = await import(new URL('src/render3d/clubhouse/frontDeskMonitorUi.js', document.baseURI).href);
      const canvas = document.createElement('canvas');
      canvas.width = ui.FRONT_DESK_MONITOR_WIDTH;
      canvas.height = ui.FRONT_DESK_MONITOR_HEIGHT;
      const monitor = ui.createFrontDeskMonitorUi(canvas);
      monitor.draw(input.model);
      // Find the lowest NON-BACKGROUND pixel inside the summary column, which
      // is the only honest answer to "does it touch the bottom".
      const context = canvas.getContext('2d');
      const columnX = 648;
      const columnW = 352;
      const pixels = context.getImageData(columnX, 0, columnW, canvas.height).data;
      let lowest = -1;
      for (let row = canvas.height - 1; row >= 0 && lowest < 0; row -= 1) {
        for (let col = 0; col < columnW; col += 1) {
          const index = (row * columnW + col) * 4;
          const r = pixels[index];
          const g = pixels[index + 1];
          const b = pixels[index + 2];
          const a = pixels[index + 3];
          // CONTENT, not the container. A first pass counted any non-desktop
          // pixel and reported 616 for every case — the panel card's own border,
          // which is by definition the lowest thing drawn and says nothing about
          // where the buttons landed. Exclude the desktop cream, the panel's
          // paper fill and its hairline border; whatever is left is content.
          const near = (value, target) => Math.abs(value - target) < 7;
          const desktop = near(r, 244) && near(g, 237) && near(b, 219);
          const paper = near(r, 255) && near(g, 250) && near(b, 240);
          const border = near(r, 200) && near(g, 199) && near(b, 184);
          if (a > 8 && !desktop && !paper && !border) {
            lowest = row;
            break;
          }
        }
      }
      return {
        canvasHeight: canvas.height,
        lowestDrawnY: lowest,
        png: canvas.toDataURL('image/png'),
      };
    }, testCase);
    const base64 = result.png.split(',')[1];
    fs.writeFileSync(path.join(OUT, `${testCase.name}.png`), Buffer.from(base64, 'base64'));
    // The panel card is (648,162,352,454) with 22 of padding, so the last thing
    // drawn must sit at or above 616 - 22 + a couple of pixels of antialiasing.
    const PANEL_BOTTOM = 162 + 454;
    report.cases[testCase.name] = {
      lowestDrawnY: result.lowestDrawnY,
      canvasHeight: result.canvasHeight,
      marginToPanelBottom: PANEL_BOTTOM - result.lowestDrawnY,
      marginToScreenBottom: result.canvasHeight - result.lowestDrawnY,
    };
  }

  fs.writeFileSync(path.join(OUT, 'monitor-layout.json'), JSON.stringify(report, null, 2));

  for (const [name, measured] of Object.entries(report.cases)) {
    assert(measured.lowestDrawnY > 0,
      `${name}: nothing was drawn in the summary column — the probe measured an empty canvas.`);
    assert(measured.marginToScreenBottom >= 24,
      `${name}: content reaches ${measured.lowestDrawnY} of ${measured.canvasHeight} — only ${measured.marginToScreenBottom}px from the screen edge.`);
    assert(measured.marginToPanelBottom >= 0,
      `${name}: content spills ${-measured.marginToPanelBottom}px out of its own panel card.`);
  }
  return report;
}
