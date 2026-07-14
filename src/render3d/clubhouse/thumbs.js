// PRODUCT THUMBNAILS — real renders for the laptop's supplier cards. Each SKU
// gets one representative unit built in the same visual language as the shop
// merchandising, shot on a small offscreen renderer with a warm key light,
// cached as a data URL. No more emoji standing in for merchandise.

import * as THREE from 'three';
import { makeProductLabel, roundedBox } from './materials.js';

let renderer = null;
let scene = null;
let camera = null;
const cache = new Map();

function ensureRig() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(192, 192); // the cards draw these at 64 CSS px, and the laptop scales up to 130%
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xfff2dc, 2.6);
  key.position.set(1.4, 2.2, 1.8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe9f5, 0.9);
  fill.position.set(-1.6, 0.8, -1.2);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
}

const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });

// one representative unit per category, in the shop's own design language
function buildUnit(sku) {
  const g = new THREE.Group();
  const tint = { 1: 0x8a8272, 2: 0x2c3e66, 3: 0x1f4a26 }[sku.tier] || 0x1f4a26;
  if (sku.cat === 'clubs') {
    const isDriver = sku.id.startsWith('driver');
    const isPutter = sku.id.startsWith('putter');
    const chrome = std(0xb8bcc2, { roughness: 0.3, metalness: 0.85 });
    const headM = std(sku.tier >= 3 ? 0x23262b : sku.tier === 2 ? 0x2c3e66 : 0x53575d, { roughness: 0.28, metalness: 0.75 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 1.0, 8), isDriver ? std(0x2b2e33, { metalness: 0.4 }) : chrome);
    shaft.position.y = 0.55;
    shaft.rotation.z = 0.14;
    g.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, 0.22, 8), std(0x23262b, { roughness: 0.92 }));
    grip.position.set(-0.07, 1.02, 0);
    grip.rotation.z = 0.14;
    g.add(grip);
    if (isDriver) {
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), headM);
      head.scale.set(1.25, 0.62, 1.05);
      head.position.set(0.1, 0.06, 0);
      g.add(head);
    } else if (isPutter) {
      const head = new THREE.Mesh(roundedBox(0.15, 0.035, 0.05, 0.012), headM);
      head.position.set(0.1, 0.03, 0);
      g.add(head);
    } else {
      const blade = new THREE.Mesh(roundedBox(0.1, 0.09, 0.024, 0.01), headM);
      blade.position.set(0.1, 0.05, 0);
      blade.rotation.y = 0.35;
      g.add(blade);
    }
  } else if (sku.cat === 'balls') {
    const brandOf = { balls1: 'FAIRWAY SUPPLY', balls2: 'IRONWOOD', balls3: 'GREENLINE' };
    const label = new THREE.MeshStandardMaterial({
      map: makeProductLabel({ brand: brandOf[sku.id] || 'FAIRWAY SUPPLY', name: sku.name.replace(/ dozen$/i, '').toUpperCase(), band: `#${tint.toString(16).padStart(6, '0')}` }),
      roughness: 0.7,
    });
    const plain = std(sku.tier >= 3 ? 0x1f4a26 : sku.tier === 2 ? 0x2c3e66 : 0xf0ead8, { roughness: 0.7 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.13, 0.13), [plain, plain, plain, plain, label, plain]);
    box.position.y = 0.065;
    box.rotation.y = -0.25;
    g.add(box);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), std(0xf5f2e8, { roughness: 0.35 }));
    ball.position.set(0.22, 0.045, 0.14);
    g.add(ball);
  } else if (sku.cat === 'apparel') {
    if (/cap|visor/i.test(sku.id) || /cap|visor/i.test(sku.name)) {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(tint));
      crown.position.y = 0.05;
      g.add(crown);
      const brim = new THREE.Mesh(roundedBox(0.16, 0.02, 0.14, 0.01), std(tint));
      brim.position.set(0, 0.045, 0.14);
      brim.rotation.x = -0.08;
      g.add(brim);
    } else if (/sock/i.test(sku.id) || /sock/i.test(sku.name)) {
      for (let i = 0; i < 2; i++) {
        const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 10), std(0xf0ead8));
        roll.rotation.z = Math.PI / 2;
        roll.position.set(i * 0.08 - 0.04, 0.05, i * 0.05);
        g.add(roll);
      }
    } else {
      // folded shirt stack: body + collar band
      const shirtTint = { polo1: 0x3f7a34, polo2: 0x3b6fb3, jacket2: 0x2c3e66 }[sku.id] || tint;
      for (let i = 0; i < 2; i++) {
        const fold = new THREE.Mesh(roundedBox(0.3, 0.05, 0.22, 0.02), std(shirtTint, { roughness: 0.8 }));
        fold.position.y = 0.03 + i * 0.055;
        fold.rotation.y = i * 0.06;
        g.add(fold);
      }
      const collar = new THREE.Mesh(roundedBox(0.12, 0.02, 0.06, 0.008), std(0xf5f2e8));
      collar.position.set(0, 0.12, -0.06);
      g.add(collar);
    }
  } else if (sku.cat === 'shoes' || /shoe/i.test(sku.id)) {
    const body = new THREE.Mesh(roundedBox(0.28, 0.09, 0.11, 0.03), std(0xf5f2e8, { roughness: 0.5 }));
    body.position.y = 0.055;
    g.add(body);
    const sole = new THREE.Mesh(roundedBox(0.3, 0.03, 0.12, 0.012), std(0x2b2e33));
    sole.position.y = 0.015;
    g.add(sole);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), std(0xf5f2e8, { roughness: 0.5 }));
    toe.scale.set(1, 0.75, 1);
    toe.position.set(0.13, 0.06, 0);
    g.add(toe);
  } else if (sku.cat === 'bags' || /bag/i.test(sku.id)) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.62, 12), std(tint, { roughness: 0.55 }));
    body.position.y = 0.31;
    body.rotation.z = 0.12;
    g.add(body);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.015, 8, 14), std(0x23262b));
    rim.rotation.x = Math.PI / 2 - 0.12;
    rim.position.set(-0.075, 0.62, 0);
    g.add(rim);
    const pocket = new THREE.Mesh(roundedBox(0.1, 0.18, 0.05, 0.02), std(0x23262b, { roughness: 0.7 }));
    pocket.position.set(0.1, 0.24, 0.09);
    g.add(pocket);
  } else if (sku.cat === 'supplies') {
    // shop equipment ships as a hard case
    const caseM = new THREE.Mesh(roundedBox(0.34, 0.24, 0.16, 0.02), std(0x3a4044, { roughness: 0.5 }));
    caseM.position.y = 0.12;
    g.add(caseM);
    const stripe2 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.17), std(0xc9a227));
    stripe2.position.y = 0.12;
    g.add(stripe2);
  } else {
    // accessories + decor: a branded carton with the item color band
    const label = new THREE.MeshStandardMaterial({
      map: makeProductLabel({ brand: 'FAIRWAY SUPPLY CO.', name: sku.name.toUpperCase().slice(0, 13), band: '#57795c', glyph: 'bar' }),
      roughness: 0.75,
    });
    const kraft = std(0xd8c3a4, { roughness: 0.9 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.16), [kraft, kraft, kraft, kraft, label, kraft]);
    box.position.y = 0.08;
    box.rotation.y = -0.3;
    g.add(box);
  }
  return g;
}

export function productThumb(sku) {
  if (!sku) return null;
  if (cache.has(sku.id)) return cache.get(sku.id);
  ensureRig();
  const unit = buildUnit(sku);

  scene.add(unit);

  // A CLUB IS A METRE OF STICK WITH THE ENTIRE PRODUCT AT ONE END.
  //
  // Framed whole, a driver renders as a hairline down the middle of a 64px card — and so does an
  // iron, and a wedge, and a putter. Nine clubs, nine identical grey lines: real renders of the
  // real models, and completely useless on a shop page where the whole job is telling them apart.
  //
  // So frame the HEAD, and let the shaft run out of frame. That is what a product photograph of
  // a golf club actually is. Everything else in the catalogue is roughly cubic and is framed
  // whole, as it should be.
  const raw = new THREE.Box3().setFromObject(unit);
  const size = raw.getSize(new THREE.Vector3());
  const slender = size.y > size.x * 1.9 && size.y > size.z * 1.9;
  const box = slender
    ? new THREE.Box3(raw.min.clone(), new THREE.Vector3(raw.max.x, raw.min.y + size.y * 0.30, raw.max.z))
    : raw;

  // frame it: fit the camera to the bounding sphere, from a slightly high three-quarter angle
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dist = (sphere.radius / Math.tan((30 * Math.PI) / 360)) * 1.12;
  camera.position.set(
    sphere.center.x + dist * 0.55,
    sphere.center.y + dist * 0.5,
    sphere.center.z + dist * 0.72,
  );
  camera.lookAt(sphere.center);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(unit);
  unit.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
  cache.set(sku.id, url); // cached forever — never regenerated per frame
  return url;
}
