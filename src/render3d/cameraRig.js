// FAIRWAY STATE — management camera: an RTS-style orbit rig over the course.
// Target point glides on the terrain; yaw/pitch/distance orbit around it.

import * as THREE from 'three';
import { clamp } from '../core/utils.js';

export function makeCameraRig(camera, worldW, worldH) {
  const rig = {
    camera,
    target: new THREE.Vector3(0, 0, 0),
    yaw: -Math.PI * 0.25,
    pitch: 0.78, // radians above horizontal
    dist: 210, // close enough that turf grain and tree shapes read immediately
    minDist: 28,
    maxDist: 720,
    minPitch: 0.32,
    maxPitch: 1.5,
    heightAt: null, // set by the scene: (x, z) => ground y
  };

  rig.apply = () => {
    if (rig.heightAt) rig.target.y = rig.heightAt(rig.target.x, rig.target.z);
    const cp = Math.cos(rig.pitch);
    const sp = Math.sin(rig.pitch);
    const off = new THREE.Vector3(
      Math.sin(rig.yaw) * cp * rig.dist,
      sp * rig.dist,
      Math.cos(rig.yaw) * cp * rig.dist,
    );
    camera.position.copy(rig.target).add(off);
    camera.lookAt(rig.target);
  };

  // pan in camera-relative ground plane by screen pixels
  rig.pan = (dxPx, dyPx, viewportH) => {
    const worldPerPx = (rig.dist * 1.35) / viewportH;
    const forward = new THREE.Vector3(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    rig.target.addScaledVector(right, -dxPx * worldPerPx);
    rig.target.addScaledVector(forward, dyPx * worldPerPx);
    rig.clampTarget();
    rig.apply();
  };

  rig.clampTarget = () => {
    const mx = worldW / 2 + 60;
    const mz = worldH / 2 + 60;
    rig.target.x = clamp(rig.target.x, -mx, mx);
    rig.target.z = clamp(rig.target.z, -mz, mz);
  };

  rig.dolly = (factor) => {
    rig.dist = clamp(rig.dist * factor, rig.minDist, rig.maxDist);
    rig.apply();
  };

  rig.orbit = (dYaw, dPitch) => {
    rig.yaw += dYaw;
    rig.pitch = clamp(rig.pitch + dPitch, rig.minPitch, rig.maxPitch);
    rig.apply();
  };

  rig.apply();
  return rig;
}
