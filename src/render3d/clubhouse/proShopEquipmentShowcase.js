import * as THREE from 'three';

import { PRO_SHOP_EQUIPMENT_FAMILIES } from '../../data/proShopEquipment.js';


export const PRO_SHOP_EQUIPMENT_SHOWCASE_QUERY = 'equipmentShowcase';

export const proShopEquipmentShowcaseLayout = () => (
  PRO_SHOP_EQUIPMENT_FAMILIES.map((family, index) => ({
    familyId: family.id,
    x: (index % 6 - 2.5) * 4.2,
    z: -10.5 - Math.floor(index / 6) * 4.4,
    ry: 0,
  }))
);

export function buildProShopEquipmentShowcase({ group, merch, enabled = false }) {
  const root = new THREE.Group();
  root.name = 'ProShopEquipmentShowcase';
  root.visible = !!enabled;
  // Lift the inspection deck above the surrounding procedural grass. The
  // showcase is opt-in QA scenery and never exists during normal gameplay.
  root.position.y = 0.62;
  group.add(root);

  const loaded = new Map();
  if (enabled) {
    const padMaterial = new THREE.MeshStandardMaterial({
      color: 0x8d8877,
      roughness: 0.92,
      metalness: 0.0,
    });
    const fill = new THREE.HemisphereLight(0xfff1cf, 0x385244, 1.1);
    fill.name = 'EquipmentShowcaseFill';
    root.add(fill);
    merch.onReady(() => {
      for (const placement of proShopEquipmentShowcaseLayout()) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.08, 3.8), padMaterial);
        pad.name = `EquipmentShowcasePad_${placement.familyId}`;
        pad.position.set(placement.x, 0.04, placement.z);
        pad.receiveShadow = true;
        root.add(pad);
        const object = merch.instantiateEquipment?.(placement.familyId);
        if (!object) continue;
        object.position.set(placement.x, 0.09, placement.z);
        object.rotation.y = placement.ry;
        object.userData.showcase = true;
        root.add(object);
        loaded.set(placement.familyId, object);
      }
    });
  }

  return {
    root,
    enabled: !!enabled,
    diagnostics: () => ({
      enabled: !!enabled,
      tier: merch.equipmentTier?.() || null,
      expected: PRO_SHOP_EQUIPMENT_FAMILIES.length,
      loaded: loaded.size,
      missing: PRO_SHOP_EQUIPMENT_FAMILIES
        .map((family) => family.id)
        .filter((familyId) => !loaded.has(familyId)),
    }),
  };
}
