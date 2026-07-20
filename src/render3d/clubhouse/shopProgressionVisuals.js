// PHYSICAL PRO-SHOP PROGRESSION.
//
// The fixture filter changes what the operation can sell. This layer makes the
// same state unmistakable from the player camera: compact utility flooring and
// closed lounge at BASIC, an oak working shop at STANDARD, the finished authored
// floor and lounge at PREMIUM, and restrained brass/showcase treatment at LUXURY.

import * as THREE from 'three';
import { COUNTER, INTERIOR, STOCKROOM } from '../../data/shopLayout.js';
import { SHOP_TIERS, shopTier, shopTierIndex } from '../../sim/shopProgression.js';
import { makeSignTexture } from './materials.js';

function signMaterial(lines, options = {}) {
  return new THREE.MeshStandardMaterial({
    map: makeSignTexture(lines, { w: 512, h: 224, ...options }),
    roughness: 0.82,
    side: THREE.DoubleSide,
  });
}

export function buildShopProgressionVisuals(B) {
  const { interior, mats, merch, addCol, removeCol, colBoxAt, state } = B;
  const root = new THREE.Group();
  root.name = 'ShopProgressionVisuals';
  interior.add(root);

  // A finish layer sits just above every possible authored/fallback floor and
  // below grime/debris decals. PREMIUM reveals the production oak underneath.
  const salesMinX = -INTERIOR.w / 2;
  const salesMaxX = STOCKROOM.bounds.minX;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(salesMaxX - salesMinX, INTERIOR.d),
    mats.concrete,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((salesMinX + salesMaxX) / 2, 0.006, 0);
  floor.receiveShadow = true;
  floor.name = 'ShopTierFloorFinish';
  root.add(floor);

  const standardFloor = mats.oakFloor.clone();
  standardFloor.color.setHex(0xd6bd91);
  standardFloor.roughness = 0.96;
  const luxuryFloor = mats.oakFloor.clone();
  luxuryFloor.color.setHex(0xd8c4a2);
  luxuryFloor.roughness = 0.86;

  // The accepted register workspace never moves. A shallow customer-side
  // fascia changes finish without touching its top, devices, drawer, reaches,
  // colliders, or handoff volumes.
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(COUNTER.len - 0.18, 0.58, 0.035), mats.rawWood);
  fascia.position.set(COUNTER.x, 0.54, COUNTER.z - COUNTER.depth / 2 - 0.019);
  fascia.name = 'ShopTierCounterFascia';
  root.add(fascia);
  const luxuryFascia = mats.walnut.clone();
  const fasciaTrim = new THREE.Mesh(new THREE.BoxGeometry(COUNTER.len - 0.10, 0.035, 0.055), mats.brass);
  fasciaTrim.position.set(COUNTER.x, 0.84, COUNTER.z - COUNTER.depth / 2 - 0.04);
  fasciaTrim.name = 'LuxuryCheckoutBrassTrim';
  root.add(fasciaTrim);

  // Premium tiers receive a restrained green customer-facing inset. Luxury
  // adds a fine brass surround, keeping the working counter silhouette intact.
  const counterInset = new THREE.Group();
  counterInset.name = 'PremiumCheckoutInset';
  const insetPanel = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.28, 0.026), mats.greenPaint);
  insetPanel.position.set(COUNTER.x, 0.54, COUNTER.z - COUNTER.depth / 2 - 0.055);
  counterInset.add(insetPanel);
  const insetTrim = new THREE.Group();
  insetTrim.name = 'LuxuryCheckoutInsetTrim';
  for (const [w, h, x, y] of [
    [1.5, 0.025, 0, 0.163],
    [1.5, 0.025, 0, -0.163],
    [0.025, 0.30, -0.738, 0],
    [0.025, 0.30, 0.738, 0],
  ]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.035), mats.brass);
    edge.position.set(x, y, -0.018);
    insetTrim.add(edge);
  }
  insetPanel.add(insetTrim);
  root.add(counterInset);

  const tierSigns = Object.fromEntries(Object.values(SHOP_TIERS).map((tier) => [
    tier.id,
    signMaterial([`${tier.label} PRO SHOP`, tier.name.toUpperCase()], {
      field: tier.id === 'basic' ? '#d9d0bc' : tier.id === 'standard' ? '#e6dcc5' : '#f4f0e6',
      ink: tier.id === 'basic' ? '#3f463e' : '#1f4a26',
      accent: tier.id === 'luxury' ? '#b08a3a' : '#71806c',
      sizes: [44, 25],
    }),
  ]));
  const tierSign = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.76), tierSigns.basic);
  tierSign.position.set(0.6, 2.04, INTERIOR.d / 2 - 0.035);
  tierSign.rotation.y = Math.PI;
  tierSign.name = 'ShopTierStatusSign';
  root.add(tierSign);

  // A real belt across the future lounge makes the smaller starting footprint
  // believable. It has the same collider the player sees, and disappears when
  // the PREMIUM fit-out opens the room.
  const loungeBarrier = new THREE.Group();
  loungeBarrier.name = 'FutureLoungeBarrier';
  for (const x of [2.65, 5.25]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.92, 10), mats.charcoal);
    post.position.set(x, 0.46, -3.16);
    loungeBarrier.add(post);
  }
  const belt = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.075, 0.045), mats.greenPaint);
  belt.position.set(3.95, 0.75, -3.16);
  loungeBarrier.add(belt);
  const loungeSign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 0.38),
    signMaterial(['MEMBER LOUNGE', 'FIT-OUT PLANNED'], {
      w: 384, h: 160, field: '#d9d0bc', ink: '#35453a', accent: '#967842', sizes: [35, 22],
    }),
  );
  loungeSign.position.set(3.95, 1.06, -3.14);
  loungeBarrier.add(loungeSign);
  root.add(loungeBarrier);
  const barrierCollider = colBoxAt(3.95, -3.16, 2.72, 0.16);
  let barrierColliderActive = false;

  // Pending work is visible and physically honest from the main aisle. The
  // shallow obstruction has a matching collider while side routes stay open.
  const construction = new THREE.Group();
  construction.name = 'ShopConstructionMarker';
  for (const x of [-1.0, 1.0]) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.72, 0.10), mats.rawWood);
    stand.position.set(x, 0.36, -1.85);
    construction.add(stand);
  }
  const constructionSign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.62),
    signMaterial(['SHOP IMPROVEMENT', 'CONSTRUCTION IN PROGRESS'], {
      field: '#e6c761', ink: '#2e302e', accent: '#2e302e', sizes: [38, 23],
    }),
  );
  constructionSign.position.set(0, 0.86, -1.82);
  construction.add(constructionSign);
  root.add(construction);
  const constructionCollider = colBoxAt(0, -1.82, 2.22, 0.16);
  let constructionColliderActive = false;

  // Luxury reuses the authored trophy asset; no duplicate physical asset or
  // procedurally imitated sculpture enters the pipeline.
  const luxuryShowcase = new THREE.Group();
  luxuryShowcase.name = 'LuxuryEntranceShowcase';
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.78, 0.58), mats.walnut);
  plinth.position.y = 0.39;
  luxuryShowcase.add(plinth);
  const plinthBand = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.055, 0.62), mats.brass);
  plinthBand.position.y = 0.76;
  luxuryShowcase.add(plinthBand);
  luxuryShowcase.position.set(-2.55, 0, 4.9);
  root.add(luxuryShowcase);
  merch?.onReady(() => {
    const trophy = merch.instantiate('trophy');
    if (!trophy) return;
    trophy.position.y = 0.81;
    luxuryShowcase.add(trophy);
  });

  function setBarrierActive(active) {
    loungeBarrier.visible = active;
    if (active && !barrierColliderActive) {
      addCol(barrierCollider);
      barrierColliderActive = true;
    } else if (!active && barrierColliderActive) {
      removeCol(barrierCollider);
      barrierColliderActive = false;
    }
  }

  function refresh() {
    const tier = shopTier(state);
    const index = shopTierIndex(state);
    tierSign.material = tierSigns[tier.id];
    floor.visible = index !== 2;
    floor.material = index === 0 ? mats.concrete : index === 1 ? standardFloor : luxuryFloor;
    fascia.material = index === 0 ? mats.rawWood : index === 1 ? standardFloor : luxuryFascia;
    fasciaTrim.visible = index >= 3;
    counterInset.visible = index >= 2;
    insetTrim.visible = index >= 3;
    setBarrierActive(index < 2);
    const constructionActive = !!state.shop.progression?.pending;
    construction.visible = constructionActive;
    if (constructionActive && !constructionColliderActive) {
      addCol(constructionCollider);
      constructionColliderActive = true;
    } else if (!constructionActive && constructionColliderActive) {
      removeCol(constructionCollider);
      constructionColliderActive = false;
    }
    luxuryShowcase.visible = index >= 3;
    root.userData.shopTier = tier.id;
    root.userData.customerCapacity = tier.customerCapacity;
    root.userData.pendingTarget = state.shop.progression?.pending?.target || null;
  }

  refresh();
  return {
    root,
    refresh,
    diagnostics: () => ({
      tier: root.userData.shopTier,
      customerCapacity: root.userData.customerCapacity,
      pendingTarget: root.userData.pendingTarget,
      loungeBarrier: loungeBarrier.visible,
      loungeBarrierCollider: barrierColliderActive,
      constructionMarker: construction.visible,
      constructionCollider: constructionColliderActive,
      luxuryShowcase: luxuryShowcase.visible,
      premiumCounterInset: counterInset.visible,
      luxuryCounterTrim: insetTrim.visible && fasciaTrim.visible,
      floorFinish: floor.visible ? (floor.material === mats.concrete ? 'utility' : floor.material === standardFloor ? 'standard' : 'luxury') : 'authored-premium',
    }),
  };
}
