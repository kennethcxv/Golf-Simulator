// Physical interaction layer for the first-property reopening campaign.
// Every hotspot delegates to sim/campaign.js; markers never own completion.

import * as THREE from 'three';
import {
  CAMPAIGN_FACILITIES,
  campaignRepairStatus,
  facilityInstalled,
  installCampaignFacility,
  openClubhouse,
  openingReadiness,
  workCampaignRepair,
} from '../../sim/campaign.js';
import {
  COUNTER,
  COUNTER_TOP,
  FRONT_DESK,
  HOURS_SIGN,
  OFFICE,
  REGISTER,
} from '../../data/shopLayout.js';

export const CAMPAIGN_FACILITY_SITES = Object.freeze([
  { id: 'officeDesk', x: OFFICE.desk.x - 0.55, z: OFFICE.desk.z + 0.45, w: 1.55, d: 0.75 },
  { id: 'officeChair', ...FRONT_DESK.staffChair, w: 0.72, d: 0.72 },
  { id: 'laptop', ...FRONT_DESK.laptop, y: COUNTER_TOP + 0.004, w: 0.65, d: 0.45 },
  { id: 'displayShelves', x: -4.25, z: -0.7, w: 2.4, d: 0.8 },
  { id: 'stockroomShelves', x: 8.0, z: -2.2, w: 1.9, d: 0.75 },
  { id: 'frontCounter', x: COUNTER.x, z: COUNTER.z, w: COUNTER.len, d: COUNTER.depth },
  { id: 'registerHardware', x: REGISTER.monitor.x, z: REGISTER.monitor.z + 0.35, w: 0.8, d: 0.55 },
  { id: 'safety', x: 5.15, z: -0.85, w: 0.72, d: 0.5 },
]);

const REPAIR_SITES = Object.freeze([
  { id: 'ceiling', x: 7.15, z: 3.55, y: 0.04, w: 1.25, d: 0.8 },
  { id: 'floor', x: -2.1, z: -0.8, y: 0.04, w: 1.45, d: 1.0 },
  { id: 'panels', x: 5.15, z: 0.75, y: 0.04, w: 1.15, d: 0.65 },
  { id: 'trim', x: -2.0, z: 5.72, y: 0.04, w: 1.0, d: 0.45 },
  { id: 'windows', x: 3.0, z: -5.82, y: 0.04, w: 1.1, d: 0.45 },
  { id: 'porch', x: 1.6, z: 7.55, y: 0.04, w: 1.25, d: 0.7 },
  { id: 'shell', x: -10.8, z: 0.1, y: 0.04, w: 0.55, d: 1.25 },
  { id: 'entranceDoor', x: -0.8, z: 6.1, y: 0.04, w: 0.9, d: 0.45 },
]);

function outlineMarker(w, d, color = 0xc59a4a) {
  const root = new THREE.Group();
  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.025, d));
  const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  }));
  line.position.y = 0.025;
  root.add(line);
  const corner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.07, 12),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.28, roughness: 0.55 }),
  );
  corner.position.set(-w / 2, 0.05, -d / 2);
  root.add(corner);
  return root;
}

function capitalized(text) {
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : '';
}

export function buildCampaignWorld(B, { refreshWorld = () => {} } = {}) {
  const { state, interior, addProp, L2W, hooks } = B;
  const root = new THREE.Group();
  root.name = 'CampaignInteractionMarkers';
  interior.add(root);
  const facilityEntries = [];
  const repairEntries = [];

  const announce = (message, tone = '') => {
    if (hooks?.toast) hooks.toast(message, tone);
  };

  const changed = (kind, result) => {
    refresh();
    refreshWorld(kind, result);
    if (hooks?.campaignChanged) hooks.campaignChanged(kind, result);
  };

  for (const site of CAMPAIGN_FACILITY_SITES) {
    const marker = outlineMarker(site.w, site.d);
    marker.position.set(site.x, site.y ?? 0.018, site.z);
    marker.rotation.y = site.ry || 0;
    root.add(marker);
    const world = L2W(site.x, site.z);
    const prop = addProp({
      x: world.x,
      z: world.z,
      r: Math.max(1.45, Math.hypot(site.w, site.d) * 0.75),
      label: () => {
        if (facilityInstalled(state, site.id)) return null;
        const spec = CAMPAIGN_FACILITIES[site.id];
        return `Install ${spec?.label || site.id} - [E] place / confirm`;
      },
      action: () => {
        if (facilityInstalled(state, site.id)) return;
        const result = installCampaignFacility(state, site.id);
        if (!result.ok) {
          announce(result.reason, 'warn');
          return;
        }
        announce(`${capitalized(result.label)} installed.`, 'good');
        changed('facility', result);
      },
    });
    facilityEntries.push({ site, marker, prop });
  }

  for (const site of REPAIR_SITES) {
    const marker = outlineMarker(site.w, site.d, 0xb66d3d);
    marker.position.set(site.x, site.y || 0.018, site.z);
    const removedPiece = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(site.w * 0.7, 0.75), 0.055, Math.min(site.d * 0.55, 0.34)),
      new THREE.MeshStandardMaterial({ color: 0x4e4438, roughness: 0.92 }),
    );
    removedPiece.position.set(site.w * 0.18, 0.065, 0);
    removedPiece.rotation.y = -0.22;
    marker.add(removedPiece);
    root.add(marker);
    const world = L2W(site.x, site.z);
    const prop = addProp({
      x: world.x,
      z: world.z,
      r: Math.max(1.55, Math.hypot(site.w, site.d) * 0.8),
      label: () => {
        if (!state.campaign?.enabled) return null;
        const status = campaignRepairStatus(state, site.id);
        if (!status.ok || status.complete) return null;
        if (!status.prerequisiteMet) return `${status.label} - blocked: ${status.blockedReason}`;
        return status.removed
          ? `${status.label} - [E] install repair components (${status.repairKits} available)`
          : `${status.label} - [E] remove damaged piece`;
      },
      action: () => {
        if (!state.campaign?.enabled) return;
        const result = workCampaignRepair(state, site.id);
        if (!result.ok) {
          announce(result.reason, 'warn');
          return;
        }
        announce(result.stage === 'removed'
          ? `${result.label}: damaged piece removed. Bring repair components.`
          : `${result.label} restored.`, result.stage === 'installed' ? 'good' : '');
        changed('repair', result);
      },
    });
    repairEntries.push({ site, marker, removedPiece, prop });
  }

  const signWorld = L2W(HOURS_SIGN.x, HOURS_SIGN.z);
  const openingProp = addProp({
    x: signWorld.x,
    z: signWorld.z,
    r: 1.1,
    // The sign sits beside the double doors. From the straight-on approach the
    // door must win focus; stepping toward the plaque still selects it easily.
    focusBias: -0.65,
    label: () => {
      if (!state.campaign?.enabled) return null;
      if (state.campaign.businessOpen) return 'Clubhouse sign - OPEN FOR BUSINESS';
      const readiness = openingReadiness(state);
      if (readiness.ready) return 'CLOSED sign - [E] open the clubhouse';
      const done = readiness.requirements.filter((item) => item.ok).length;
      return `CLOSED sign - opening readiness ${done}/${readiness.requirements.length}`;
    },
    action: () => {
      if (!state.campaign?.enabled || state.campaign.businessOpen) return;
      const result = openClubhouse(state);
      if (!result.ok) {
        announce(result.reason, 'warn');
        return;
      }
      announce('The clubhouse is open. Your first guests are on the way.', 'good');
      changed('opening', result);
    },
  });

  function refresh() {
    const active = !!state.campaign?.enabled;
    root.visible = active;
    for (const entry of facilityEntries) {
      entry.marker.visible = active && !facilityInstalled(state, entry.site.id);
    }
    for (const entry of repairEntries) {
      const status = active ? campaignRepairStatus(state, entry.site.id) : null;
      entry.marker.visible = !!status?.ok && !status.complete;
      entry.removedPiece.visible = !!status?.removed;
      const material = entry.marker.children.find((child) => child.isLineSegments)?.material;
      if (material) material.color.setHex(status?.removed ? 0xc59a4a : 0xb66d3d);
    }
  }

  refresh();
  return {
    root,
    refresh,
    openingProp,
    diagnostics: () => ({
      facilitiesVisible: facilityEntries.filter((entry) => entry.marker.visible).map((entry) => entry.site.id),
      repairsVisible: repairEntries.filter((entry) => entry.marker.visible).map((entry) => entry.site.id),
    }),
  };
}
