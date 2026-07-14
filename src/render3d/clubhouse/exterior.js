// EXTERIOR NEGLECT & RESTORATION — the yard tells the same story as the shop
// floor: weeds at the foundation, a choked gutter, cobwebbed porch corners, a
// dead porch bulb, splashed siding. Every one is a physical E-verb against
// sim state (sim/shop.js exterior block) and repaints itself when fixed.

import * as THREE from 'three';
import { SHELL, DOOR_MAIN } from '../../data/shopLayout.js';
import {
  exteriorState, pullWeed, clearGutter, brushCobwebs, replaceBulb, scrubSiding,
  exteriorScore, BULB_COST,
} from '../../sim/shop.js';

export function buildExterior(B) {
  const { group, mats, addProp, L2W, state, hooks } = B;
  const halfD = SHELL.d / 2;
  const ex = exteriorState(state);
  const g = new THREE.Group();
  group.add(g);

  const announce = (msg) => { if (hooks.toast) hooks.toast(msg); };
  const score = () => {
    const s = exteriorScore(state);
    if (s >= 1) announce('The outside finally looks cared for — curb appeal restored.');
  };

  // --- weeds: grass-green cone tufts along the foundation and walk ---------------
  const WEED_SPOTS = [
    { x: -6.6, z: halfD + 0.55 }, { x: -4.3, z: halfD + 0.4 }, { x: 3.1, z: halfD + 0.5 },
    { x: -1.9, z: halfD + 5.6 }, { x: 0.5, z: halfD + 7.4 },
  ];
  const weedMat = new THREE.MeshStandardMaterial({ color: 0x5d7332, roughness: 0.95 });
  const weedDry = new THREE.MeshStandardMaterial({ color: 0x8a8046, roughness: 0.95 });
  const weedGroups = WEED_SPOTS.map((s, i) => {
    const tuft = new THREE.Group();
    for (let b = 0; b < 5; b++) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.34 + (b % 3) * 0.12, 5), b % 2 ? weedMat : weedDry);
      blade.position.set((b - 2) * 0.07, 0.17, ((b * 7) % 3 - 1) * 0.06);
      blade.rotation.z = (b - 2) * 0.16;
      tuft.add(blade);
    }
    tuft.position.set(s.x, 0, s.z);
    tuft.visible = !!ex.weeds[i];
    g.add(tuft);
    const wp = L2W(s.x, s.z);
    addProp({
      x: wp.x, z: wp.z, r: 1.5,
      label: () => (ex.weeds[i] ? 'Weeds — [E] pull them' : null),
      action: () => {
        const res = pullWeed(state, i);
        if (!res.ok) return;
        tuft.visible = false;
        if (hooks.sfx) hooks.sfx('wipe');
        announce(res.left > 0 ? `Weeds pulled — ${res.left} patch${res.left > 1 ? 'es' : ''} left.` : 'Foundation line is clean.');
        score();
      },
    });
    return tuft;
  });

  // --- gutter debris: dark clumps on the south run; clears at the downspout ------
  const debris = new THREE.Group();
  const clumpMat = new THREE.MeshStandardMaterial({ color: 0x4c3d26, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const clump = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), clumpMat);
    clump.scale.set(1.6, 0.7, 1);
    clump.position.set(-7 + i * 2.6, SHELL.wallH - 0.1, halfD + 0.82);
    debris.add(clump);
  }
  debris.visible = !!ex.gutter;
  g.add(debris);
  {
    const s = { x: SHELL.w / 2 - 0.2, z: halfD + 0.2 };
    const wp = L2W(s.x, s.z);
    addProp({
      x: wp.x, z: wp.z, r: 1.9,
      label: () => (ex.gutter ? 'Choked gutter — [E] clear the downspout' : null),
      action: () => {
        if (!clearGutter(state).ok) return;
        debris.visible = false;
        if (hooks.sfx) hooks.sfx('thunk');
        announce('Gutter cleared — rain runs where it should now.');
        score();
      },
    });
  }

  // --- cobwebs: translucent corner sheets under the porch roof -------------------
  const webMat = new THREE.MeshBasicMaterial({
    color: 0xe8e8e0, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false,
  });
  const webs = new THREE.Group();
  const webShape = new THREE.Shape();
  webShape.moveTo(0, 0);
  webShape.lineTo(0.55, 0);
  webShape.lineTo(0, -0.55);
  webShape.closePath();
  const webGeo = new THREE.ShapeGeometry(webShape);
  const porchW = SHELL.w * 0.62;
  for (const px of [-1.0 - porchW / 2 + 0.36, -1.0 + porchW / 2 - 0.36]) {
    const web = new THREE.Mesh(webGeo, webMat);
    web.position.set(px, SHELL.wallH - 0.78, halfD + SHELL.porchD - 0.46);
    web.rotation.y = px < -1 ? 0.4 : -0.4;
    webs.add(web);
  }
  webs.visible = !!ex.cobwebs;
  g.add(webs);
  {
    const wp = L2W(-1.0 - porchW / 2 + 0.5, halfD + SHELL.porchD - 0.5);
    addProp({
      x: wp.x, z: wp.z, r: 1.9,
      label: () => (ex.cobwebs ? 'Cobwebs in the porch corners — [E] brush them down' : null),
      action: () => {
        if (!brushCobwebs(state).ok) return;
        webs.visible = false;
        if (hooks.sfx) hooks.sfx('wipe');
        announce('Porch corners swept clear.');
        score();
      },
    });
  }

  // --- the porch sconce: dead and dark until a new bulb goes in ------------------
  const sconce = new THREE.Group();
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), mats.iron || mats.charcoal);
  sconce.add(bracket);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a26, roughness: 0.4, emissive: 0xffd9a0, emissiveIntensity: 0,
  });
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6, 0, Math.PI * 2, 0, Math.PI / 1.6), glassMat);
  glass.position.y = -0.06;
  sconce.add(glass);
  sconce.position.set(DOOR_MAIN.x + 1.35, 2.3, halfD + SHELL.wallT / 2 + 0.05);
  g.add(sconce);
  const applyBulb = () => {
    glassMat.emissiveIntensity = ex.light ? 0 : 1.1;
    glassMat.color.set(ex.light ? 0x2a2a26 : 0xf5e9c8);
  };
  applyBulb();
  {
    const wp = L2W(DOOR_MAIN.x + 1.35, halfD + 0.6);
    addProp({
      x: wp.x, z: wp.z, r: 1.8,
      label: () => (ex.light ? `Dead porch light — [E] fit a new bulb ($${BULB_COST})` : null),
      action: () => {
        const res = replaceBulb(state);
        if (!res.ok) { if (hooks.toast) hooks.toast(res.reason, 'warn'); return; }
        applyBulb();
        if (hooks.sfx) hooks.sfx('chime');
        announce('The porch light hums back on.');
        score();
      },
    });
  }

  // --- siding grime: splashed patches that scrub off in passes -------------------
  const SIDING_SPOTS = [{ x: -6.2 }, { x: 4.6 }, { x: 7.9 }];
  const sidingMeshes = SIDING_SPOTS.map((s, i) => {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const c2 = cv.getContext('2d');
    c2.clearRect(0, 0, 64, 64);
    for (let b = 0; b < 26; b++) {
      c2.fillStyle = `rgba(56,48,30,${0.14 + (b % 5) * 0.05})`;
      c2.beginPath();
      c2.ellipse(32 + Math.sin(b * 3.7) * 20, 40 + Math.cos(b * 2.3) * 18, 6 + (b % 4) * 3, 4 + (b % 3) * 3, b, 0, Math.PI * 2);
      c2.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.15),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 1, depthWrite: false }),
    );
    m.position.set(s.x, 0.95, halfD + SHELL.wallT / 2 + 0.02);
    g.add(m);
    const applyGrime = () => {
      const v = ex.siding[i];
      m.visible = v > 0.02;
      m.material.opacity = 0.35 + v * 0.65;
    };
    applyGrime();
    const wp = L2W(s.x, halfD + 0.7);
    addProp({
      x: wp.x, z: wp.z, r: 1.7,
      label: () => (ex.siding[i] > 0 ? 'Splashed siding — [E] scrub it' : null),
      action: () => {
        const res = scrubSiding(state, i);
        if (!res.ok) return;
        applyGrime();
        if (hooks.sfx) hooks.sfx('wipe');
        if (res.left === 0) {
          announce('That patch of siding reads cream again.');
          score();
        }
      },
    });
    return m;
  });

  return { weedGroups, sidingMeshes };
}
