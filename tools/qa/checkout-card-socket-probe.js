async (page) => {
  // Where does the reader's CARD_INSERT_SOCKET sit, and which way does a card
  // travel out of it? Answers "the inserted card is invisible" with geometry
  // instead of guesses.
  const VIEWPORT = { width: 1600, height: 900 };
  await page.goto(process.env.QA_BASE_URL || 'http://localhost:8457/');
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(1200);
  await page.getByText('Continue', { exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__fw?.scene3d?.clubhouse?.(), null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  return page.evaluate(async () => {
    const THREE = await import('/vendor/three.module.js');
    const app = window.__fw;
    const clubhouse = app.scene3d.clubhouse();
    let terminal = null;
    let socket = null;
    let slot = null;
    clubhouse.interior.traverse((o) => {
      if (!terminal && /payment_terminal/i.test(o.name || '')) terminal = o;
      if (o.name === 'CARD_INSERT_SOCKET') socket = o;
      if (/ChipSlot/i.test(o.name || '')) slot = o;
    });
    if (!terminal || !socket) return { terminal: !!terminal, socket: !!socket };
    terminal.updateWorldMatrix(true, true);
    const tBox = new THREE.Box3().setFromObject(terminal);
    const sWorld = socket.getWorldPosition(new THREE.Vector3());
    const sQuat = socket.getWorldQuaternion(new THREE.Quaternion());
    const out = new THREE.Vector3(0, 0, -1).applyQuaternion(sQuat).normalize();
    const at = (d) => sWorld.clone().addScaledVector(out, d);
    const insideAt = (d) => tBox.containsPoint(at(d));
    let clears = null;
    for (let d = 0.0; d <= 0.35; d += 0.005) {
      if (!insideAt(d)) { clears = Math.round(d * 1000) / 1000; break; }
    }
    return {
      terminalName: terminal.name,
      terminalBox: {
        min: tBox.min.toArray().map((v) => +v.toFixed(4)),
        max: tBox.max.toArray().map((v) => +v.toFixed(4)),
        size: tBox.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(4)),
      },
      socketWorld: sWorld.toArray().map((v) => +v.toFixed(4)),
      outDirection: out.toArray().map((v) => +v.toFixed(4)),
      socketInsideTerminal: tBox.containsPoint(sWorld),
      distanceThatClearsTheBody: clears,
      chipSlot: slot ? slot.name : null,
      chipSlotWorld: slot ? slot.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(4)) : null,
    };
  });
}
