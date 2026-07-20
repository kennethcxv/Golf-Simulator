// High-resolution maintenance texture bridge. The simulation owns one-yard
// fields; this module packs only what the terrain shader needs and uploads the
// dirty spans produced by physical tools.

import * as THREE from 'three';
import {
  NEVER_DAY,
  SURFACE,
  consumeCourseMaintenanceDirtyRows,
} from '../sim/courseMaintenance.js';
import { clamp } from '../core/utils.js';

const bytes = (value) => clamp(Math.round(value * 2.55), 0, 255);

export function makeCourseMaintenanceTextureState(state, worldWidthYd, worldHeightYd) {
  const model = state.courseMaintenance;
  const width = model?.width || 1;
  const height = model?.height || 1;
  const conditionData = new Uint8Array(width * height * 4);
  const treatmentData = new Uint8Array(width * height * 4);
  const conditionTexture = new THREE.DataTexture(conditionData, width, height);
  const treatmentTexture = new THREE.DataTexture(treatmentData, width, height);
  for (const texture of [conditionTexture, treatmentTexture]) {
    texture.name = 'Course maintenance one-yard state';
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
  }

  const worldMin = model
    ? new THREE.Vector2(
        model.bounds.minCourseYdX - worldWidthYd / 2,
        model.bounds.minCourseYdY - worldHeightYd / 2,
      )
    : new THREE.Vector2(0, 0);
  const worldSize = model
    ? new THREE.Vector2(
        model.width * model.resolutionYd,
        model.height * model.resolutionYd,
      )
    : new THREE.Vector2(1, 1);

  function pack(index) {
    const offset = index * 4;
    if (!model) {
      conditionData.fill(0, offset, offset + 4);
      treatmentData.fill(0, offset, offset + 4);
      return;
    }
    const surface = model.surface[index];
    conditionData[offset] = surface * 30;
    conditionData[offset + 1] = bytes(model.health[index]);
    conditionData[offset + 2] = bytes(model.moisture[index]);
    conditionData[offset + 3] = model.heightQ[index];
    treatmentData[offset] = bytes(model.diseaseSeverity[index]);
    treatmentData[offset + 1] = bytes(model.fertilizer[index]);
    treatmentData[offset + 2] = surface === SURFACE.BUNKER
      ? model.rakeAngle[index]
      : model.mowAngle[index];
    treatmentData[offset + 3] = surface === SURFACE.BUNKER
      ? model.lastRakeDay[index] === NEVER_DAY ? 0 : bytes(model.bunkerSmooth[index])
      : model.mowPasses[index] > 0
        ? 128 + clamp(Math.round(model.mowQuality[index] * 1.27), 0, 127)
        : 0;
  }

  let initialized = false;
  function update({ force = false } = {}) {
    if (!model) return 0;
    const rows = force || !initialized
      ? Array.from({ length: height }, (_, y) => ({ y, minX: 0, maxX: width - 1 }))
      : consumeCourseMaintenanceDirtyRows(model);
    if (!rows.length) return 0;
    for (const row of rows) {
      const minX = clamp(row.minX, 0, width - 1);
      const maxX = clamp(row.maxX, minX, width - 1);
      for (let x = minX; x <= maxX; x++) pack(row.y * width + x);
      if (initialized && !force) {
        const start = (row.y * width + minX) * 4;
        const count = (maxX - minX + 1) * 4;
        conditionTexture.addUpdateRange(start, count);
        treatmentTexture.addUpdateRange(start, count);
      }
    }
    conditionTexture.needsUpdate = true;
    treatmentTexture.needsUpdate = true;
    initialized = true;
    return rows.length;
  }

  update({ force: true });

  return {
    width,
    height,
    conditionTexture,
    treatmentTexture,
    worldMin,
    worldSize,
    update,
    dispose() {
      conditionTexture.dispose();
      treatmentTexture.dispose();
    },
  };
}
