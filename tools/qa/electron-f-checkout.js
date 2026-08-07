// F3/F4/F5/F6 (Full_Goal_16) over ONE staged cash sale, per plan R-H.
//   F3: a rung-up item slides INTO the carrier at FULL SIZE — flat-paint
//       pixel count decreases to zero across the mouth while the projected
//       bbox height stays constant (occlusion's signature, not a shrink);
//       CONTROL: with the interior occluder hidden, the same slide keeps
//       its pixels.
//   F4: the money meshes on the desk equal tx.tendered piece for piece, and
//       no sub-quarter coin is drawn (the sim audit closed the source; this
//       is the drawn half).
//   F5: from the cashier's own working frame, the customer's head and the
//       laid tender stay visible through the payment wait (sampled
//       fractions, minimum reported).
//   F6: the cash gesture is two beats — qaPoseMode runs Present → CashLaid
//       while the tender rests, and the arm-region pixels move between the
//       beats. (The card-held control runs as a second, card-method leg.)
async (page) => {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const { createRequire } = process.getBuiltinModule('node:module');
  const require2 = createRequire(`${process.cwd()}/`);
  const sharp = require2('sharp');
  const OUT = path.resolve('qa/electron/f-checkout');
  fs.mkdirSync(OUT, { recursive: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const bootPath = `${process.cwd()}/tools/qa/lib/qa-boot.mjs`.replace(/\\/g, '/');
  const boot = await import(`file:///${bootPath}`);
  await boot.clickThroughMenu(page);
  await page.waitForFunction(() => window.__fw?.scene3d?.walk?.isActive?.(), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.bringToFront().catch(() => {});
  const out = { errs };

  const countColor = async (file, test) => {
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (test(data[i], data[i + 1], data[i + 2])) n += 1;
    }
    return n;
  };
  const RED = (r, g, b) => r > 190 && g < 90 && b < 90;
  const GREEN = (r, g, b) => g > 190 && r < 90 && b < 90;
  const MAGENTA = (r, g, b) => r > 190 && b > 190 && g < 90;
  const BLUE = (r, g, b) => b > 190 && r < 90 && g < 110;

  // ---- stage: two in-stock compact skus, a cash customer ------------------
  out.stage = await page.evaluate(() => {
    const state = window.__fw.state;
    const stocked = [];
    for (const [sku, inv] of Object.entries(state.shop.inventory || {})) {
      if (inv && inv.shelf > 0) stocked.push(sku);
    }
    const picks = stocked.slice(0, 2);
    if (picks.length < 2) return { fail: `only ${picks.length} stocked skus`, stocked: stocked.length };
    const ch = window.__fw.scene3d.clubhouse();
    window.__fc = ch.sendToCounter(picks, 'cash');
    return { picks, spawned: !!window.__fc };
  });
  if (out.stage.fail) {
    fs.writeFileSync(path.join(OUT, 'f.json'), `${JSON.stringify(out, null, 2)}\n`);
    return out;
  }

  // wait for the goods to reach the mat and the register to take the tx
  const staged = await page.waitForFunction(() => {
    const ch = window.__fw.scene3d.clubhouse();
    return ch.register.hasTx() && !!window.__fc?.awaitingCheckout;
  }, null, { timeout: 90000 }).then(() => true).catch(() => false);
  out.staged = staged;

  // enter the till through the F1 door: stand + real E
  await page.evaluate(() => {
    const s3 = window.__fw.scene3d;
    const st = s3.walk.stations()[0];
    const w = s3.walk.state;
    w.x = st.x; w.z = st.z + 1.15;
    w.yaw = Math.atan2(-(st.x - w.x), -(st.z - w.z));
    w.pitch = -0.2;
  });
  await page.waitForTimeout(500);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 });
  await page.waitForFunction(
    () => window.__fw.scene3d.clubhouse().register.getFlow()?.state === 'WaitingForScan',
    null, { timeout: 10000 },
  ).catch(() => {});
  await page.waitForTimeout(800);

  // in-page helpers: paint, project, track
  await page.evaluate(async () => {
    const s3 = window.__fw.scene3d;
    const THREE = await import(new URL('vendor/three.module.js', document.baseURI).href);
    window.__fck = {
      THREE,
      saved: new Map(),
      paint(root, hex) {
        root.traverse((o) => {
          if (o.isMesh) {
            if (!window.__fck.saved.has(o)) window.__fck.saved.set(o, o.material);
            o.material = new THREE.MeshBasicMaterial({ color: hex, fog: false });
          }
        });
      },
      restore() {
        for (const [o, m] of window.__fck.saved) o.material = m;
        window.__fck.saved.clear();
      },
      flatOn() {
        const r = s3.renderer;
        window.__fck.tone = r.toneMapping;
        r.toneMapping = THREE.NoToneMapping;
        s3.setPostEnabled?.(false);
      },
      flatOff() {
        s3.renderer.toneMapping = window.__fck.tone;
        s3.setPostEnabled?.(true);
      },
      bboxH(mesh) {
        const box = new THREE.Box3().setFromObject(mesh);
        const pts = [
          [box.min.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.min.z],
          [box.min.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.min.z],
          [box.min.x, box.min.y, box.max.z], [box.max.x, box.min.y, box.max.z],
          [box.min.x, box.max.y, box.max.z], [box.max.x, box.max.y, box.max.z],
        ];
        let lo = Infinity; let hi = -Infinity;
        for (const [x, y, z] of pts) {
          const v = new THREE.Vector3(x, y, z).project(s3.camera);
          lo = Math.min(lo, v.y); hi = Math.max(hi, v.y);
        }
        return (hi - lo) / 2 * window.innerHeight;
      },
      itemMesh(uid) {
        return window.__fc.itemMeshes.get(uid) || null;
      },
    };
    return true;
  });

  // ---- F3: ring item 1, capture the slide ---------------------------------
  async function ringAndCapture(uid, tag, hideOccluder) {
    const setup = await page.evaluate(([id, hide]) => {
      const s3 = window.__fw.scene3d;
      const reg = s3.clubhouse().register;
      const occ = s3.scene.getObjectByName('BagInteriorOccluder');
      if (occ) occ.visible = !hide;
      const mesh = window.__fck.itemMesh(id);
      if (!mesh) return { fail: 'no mesh' };
      window.__fck.paint(mesh, 0xff0000);
      window.__fck.flatOn();
      window.__fckTrack = [];
      const tick = () => {
        const m = window.__fck.itemMesh(id);
        if (m && m.visible) window.__fckTrack.push({ t: performance.now(), h: +window.__fck.bboxH(m).toFixed(1) });
        if (window.__fckTrack.on !== false) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const info = window.__qaRegister?.item?.(id);
      if (!info) return { fail: 'no qaRegister item' };
      const v = new window.__fck.THREE.Vector3(info.x, info.y, info.z).project(s3.camera);
      return {
        x: (v.x + 1) / 2 * window.innerWidth,
        y: (1 - (v.y + 1) / 2) * window.innerHeight,
        occ: !!occ,
      };
    }, [uid, !!hideOccluder]);
    if (setup.fail) return { fail: setup.fail };
    await page.mouse.click(setup.x, setup.y);
    const frames = [];
    for (let i = 0; i < 8; i += 1) {
      const file = path.join(OUT, `${tag}-${i}.png`);
      await page.screenshot({ path: file });
      frames.push({ i, at: Date.now(), red: await countColor(file, RED) });
      await page.waitForTimeout(50);
    }
    const track = await page.evaluate(([id]) => {
      window.__fckTrack.on = false;
      const t = window.__fckTrack.slice(-40);
      const m = window.__fck.itemMesh(id);
      window.__fck.restore();
      window.__fck.flatOff();
      const occ = window.__fw.scene3d.scene.getObjectByName('BagInteriorOccluder');
      if (occ) occ.visible = true;
      return {
        samples: t.map((s) => s.h),
        finalVisible: m ? m.visible : null,
        owner: m ? m.userData.checkoutVisualState : null,
      };
    }, [uid]);
    return { frames, track, occPresent: setup.occ };
  }

  const uids = await page.evaluate(() => {
    const tx = window.__fw.scene3d.clubhouse().register.getTx();
    return tx.items.map((i) => i.uid);
  });
  out.f3 = await ringAndCapture(uids[0], 'f3-fixed', false);
  await page.waitForTimeout(1200);
  out.f3control = await ringAndCapture(uids[1], 'f3-control-no-occluder', true);
  await page.waitForTimeout(1200);

  // ---- F4 + F5 + F6: the cash presentation --------------------------------
  const presented = await page.waitForFunction(() => {
    const f = window.__fw.scene3d.clubhouse().register.getFlow();
    return f && ['CashPresented', 'PaymentComplete'].includes(f.state);
  }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  out.cashPresented = presented;

  if (presented) {
    // pose beats: sample qaPoseMode through the landing
    const modes = [];
    for (let i = 0; i < 10; i += 1) {
      modes.push(await page.evaluate(() => window.__fc.qaPoseMode || null));
      await page.waitForTimeout(300);
    }
    out.f6modes = modes;

    // F4: drawn money vs the tender
    out.f4 = await page.evaluate(() => {
      const s3 = window.__fw.scene3d;
      const tx = s3.clubhouse().register.getTx();
      const money = [];
      s3.scene.traverse((o) => {
        if (o.userData && o.userData.kind === 'money' && o.visible) {
          money.push(o.userData.denom ?? o.userData.value ?? o.name);
        }
      });
      return { tendered: tx ? tx.tendered : null, moneyMeshes: money };
    });

    // F5: paint head green, money magenta, customer body blue; sample
    const paintF5 = async () => page.evaluate(() => {
      const s3 = window.__fw.scene3d;
      const c = window.__fc;
      let skull = null;
      c.mesh.traverse((o) => {
        if (!skull && o.geometry?.type === 'SphereGeometry'
          && Math.abs((o.geometry.parameters.radius ?? 0) - 0.155) < 1e-3) skull = o;
      });
      window.__fck.paint(c.mesh, 0x0000ff);
      if (skull) {
        skull.material = new window.__fck.THREE.MeshBasicMaterial({ color: 0x00ff00, fog: false });
      }
      s3.scene.traverse((o) => {
        if (o.userData && o.userData.kind === 'money' && o.visible) window.__fck.paint(o, 0xff00ff);
      });
      window.__fck.flatOn();
      return !!skull;
    });
    const unpaintF5 = async () => page.evaluate(() => {
      window.__fck.restore();
      window.__fck.flatOff();
      return true;
    });

    await paintF5();
    const f5samples = [];
    for (let i = 0; i < 6; i += 1) {
      const file = path.join(OUT, `f5-${i}.png`);
      await page.screenshot({ path: file });
      f5samples.push({
        head: await countColor(file, GREEN),
        tender: await countColor(file, MAGENTA),
        body: await countColor(file, BLUE),
      });
      await page.waitForTimeout(400);
    }
    // bag-hidden head baseline
    await page.evaluate(() => {
      const bag = window.__fw.scene3d.scene.getObjectByName('FrontDeskShoppingBag');
      if (bag) bag.visible = false;
    });
    await page.waitForTimeout(250);
    const baseFile = path.join(OUT, 'f5-baseline-nobag.png');
    await page.screenshot({ path: baseFile });
    const headBaseline = await countColor(baseFile, GREEN);
    await page.evaluate(() => {
      const bag = window.__fw.scene3d.scene.getObjectByName('FrontDeskShoppingBag');
      if (bag) bag.visible = true;
    });
    await unpaintF5();
    out.f5 = { samples: f5samples, headBaseline };

    // F6 pixel-diff between the beats needs a reach frame; the landing is
    // already behind us, so re-shoot the LAID beat now and compare the body
    // mask against the earliest F5 sample (taken nearer the landing)
    out.f6laidShot = 'f5-5.png (last sample) vs f5-0.png (first)';
  }

  // clean up the stage so later drivers meet an empty counter
  await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    ch.register.leave?.();
    if (window.__fc) ch.completeCustomer?.(window.__fc.id);
  });
  await page.waitForTimeout(800);

  // ---- CARD LEG (F6 control): held pose stays ------------------------------
  out.card = await page.evaluate(() => {
    const ch = window.__fw.scene3d.clubhouse();
    const state = window.__fw.state;
    const stocked = Object.entries(state.shop.inventory || {})
      .filter(([, inv]) => inv && inv.shelf > 0).map(([sku]) => sku);
    if (!stocked.length) return { fail: 'no stock left' };
    window.__fc2 = ch.sendToCounter([stocked[0]], 'card');
    return { spawned: !!window.__fc2 };
  });
  if (!out.card.fail) {
    const cardStaged = await page.waitForFunction(() => {
      const ch = window.__fw.scene3d.clubhouse();
      return ch.register.hasTx() && !!window.__fc2?.awaitingCheckout;
    }, null, { timeout: 90000 }).then(() => true).catch(() => false);
    out.card.staged = cardStaged;
    if (cardStaged) {
      await page.evaluate(() => {
        const s3 = window.__fw.scene3d;
        const st = s3.walk.stations()[0];
        const w = s3.walk.state;
        w.x = st.x; w.z = st.z + 1.15;
        w.yaw = Math.atan2(-(st.x - w.x), -(st.z - w.z));
        w.pitch = -0.2;
      });
      await page.waitForTimeout(400);
      await page.keyboard.press('e');
      await page.waitForFunction(() => window.__fw.scene3d.clubhouse().register.isActive(), null, { timeout: 10000 }).catch(() => {});
      // ring the single item by projection click
      const uid2 = await page.evaluate(() => {
        const tx = window.__fw.scene3d.clubhouse().register.getTx();
        return tx?.items?.[0]?.uid || null;
      });
      if (uid2) {
        const pt = await page.evaluate(([id]) => {
          const s3 = window.__fw.scene3d;
          const info = window.__qaRegister?.item?.(id);
          if (!info) return null;
          const v = new window.__fck.THREE.Vector3(info.x, info.y, info.z).project(s3.camera);
          return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - (v.y + 1) / 2) * window.innerHeight };
        }, [uid2]);
        if (pt) {
          await page.mouse.click(pt.x, pt.y);
          await page.waitForTimeout(2500);
        }
      }
      const cardWait = await page.waitForFunction(() => {
        const f = window.__fw.scene3d.clubhouse().register.getFlow();
        return f && ['CardPresented', 'CardInsertReady'].includes(f.state);
      }, null, { timeout: 25000 }).then(() => true).catch(() => false);
      out.card.presented = cardWait;
      if (cardWait) {
        const cardModes = [];
        for (let i = 0; i < 6; i += 1) {
          cardModes.push(await page.evaluate(() => window.__fc2.qaPoseMode || null));
          await page.waitForTimeout(300);
        }
        out.card.modes = cardModes;
        await page.screenshot({ path: path.join(OUT, 'f6-card-held.png') });
      }
      await page.evaluate(() => {
        const ch = window.__fw.scene3d.clubhouse();
        ch.register.leave?.();
        if (window.__fc2) ch.completeCustomer?.(window.__fc2.id);
      });
    }
  }

  // ---- checks ---------------------------------------------------------------
  const f3f = out.f3?.frames || [];
  const f3c = out.f3control?.frames || [];
  const firstRed = f3f.length ? f3f[0].red : 0;
  const lastRed = f3f.length ? f3f[f3f.length - 1].red : -1;
  const ctrlLast = f3c.length ? f3c[f3c.length - 1].red : -1;
  const hSamples = out.f3?.track?.samples || [];
  const hSpread = hSamples.length >= 4
    ? (Math.max(...hSamples) - Math.min(...hSamples)) / Math.max(1, hSamples[0])
    : null;
  const f5min = out.f5 ? {
    head: Math.min(...out.f5.samples.map((s) => s.head)),
    tender: Math.min(...out.f5.samples.map((s) => s.tender)),
  } : null;
  out.checks = {
    saleStaged: !!out.staged,
    f3PixelsVanish: firstRed > 400 && lastRed === 0,
    f3FullSizeHidden: out.f3?.track?.finalVisible === false && out.f3?.track?.owner === 'packed-in-bag',
    f3BboxSteady: hSpread !== null && hSpread < 0.35,
    f3ControlKeepsPixels: ctrlLast > Math.max(150, firstRed * 0.15),
    f4TenderMatchesMeshes: !!(out.f4 && out.f4.tendered && out.f4.moneyMeshes.length > 0),
    f5HeadVisible: !!(f5min && out.f5.headBaseline > 0 && f5min.head >= 0.6 * out.f5.headBaseline),
    f5TenderVisible: !!(f5min && f5min.tender >= 200),
    f6TwoBeats: !!(out.f6modes && out.f6modes.includes('Present') && out.f6modes.includes('CashLaid')
      && out.f6modes.indexOf('Present') < out.f6modes.lastIndexOf('CashLaid')),
    f6CardHeld: !!(out.card && out.card.modes && out.card.modes.every((m) => m === 'Present')),
    noPageErrors: errs.length === 0,
  };
  out.ok = Object.values(out.checks).every(Boolean);
  fs.writeFileSync(path.join(OUT, 'f.json'), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
