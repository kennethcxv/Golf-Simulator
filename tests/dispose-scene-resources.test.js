import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import {
  collectSceneResources, disposeSceneResources, mergeSceneResources,
} from '../src/render3d/disposeSceneResources.js';

test('disposeSceneResources releases each unique scene resource exactly once', () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const uniformTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const shader = new THREE.ShaderMaterial({
    uniforms: { nestedTexture: { value: uniformTexture } },
    vertexShader: 'void main(){gl_Position=vec4(position,1.0);}',
    fragmentShader: 'void main(){gl_FragColor=vec4(1.0);}',
  });
  const counts = { geometry: 0, texture: 0, uniformTexture: 0, material: 0, shader: 0 };
  geometry.addEventListener('dispose', () => { counts.geometry += 1; });
  texture.addEventListener('dispose', () => { counts.texture += 1; });
  uniformTexture.addEventListener('dispose', () => { counts.uniformTexture += 1; });
  material.addEventListener('dispose', () => { counts.material += 1; });
  shader.addEventListener('dispose', () => { counts.shader += 1; });

  scene.add(new THREE.Mesh(geometry, material));
  scene.add(new THREE.Mesh(geometry, [material, shader]));
  const summary = disposeSceneResources(scene);

  assert.deepEqual(summary, {
    geometries: 1,
    materials: 2,
    textures: 2,
    imageBitmaps: 0,
    instancedMeshes: 0,
    skeletons: 0,
    renderTargets: 0,
  });
  assert.deepEqual(counts, { geometry: 1, texture: 1, uniformTexture: 1, material: 1, shader: 1 });
});

test('disposeSceneResources dispatches instanced-mesh disposal', () => {
  const scene = new THREE.Scene();
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    2,
  );
  let disposals = 0;
  mesh.addEventListener('dispose', () => { disposals += 1; });
  scene.add(mesh);

  const summary = disposeSceneResources(scene);

  assert.equal(summary.instancedMeshes, 1);
  assert.equal(disposals, 1);
});

test('disposeSceneResources protects shared resources and releases explicit extras', () => {
  const scene = new THREE.Scene();
  const sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sharedTexture = new THREE.Texture();
  const sharedMaterial = new THREE.MeshBasicMaterial({ map: sharedTexture });
  const ownedTexture = new THREE.Texture();
  const renderTarget = new THREE.WebGLRenderTarget(4, 4);
  const counts = { geometry: 0, material: 0, sharedTexture: 0, ownedTexture: 0, target: 0 };
  sharedGeometry.addEventListener('dispose', () => { counts.geometry += 1; });
  sharedMaterial.addEventListener('dispose', () => { counts.material += 1; });
  sharedTexture.addEventListener('dispose', () => { counts.sharedTexture += 1; });
  ownedTexture.addEventListener('dispose', () => { counts.ownedTexture += 1; });
  renderTarget.addEventListener('dispose', () => { counts.target += 1; });
  scene.add(new THREE.Mesh(sharedGeometry, sharedMaterial));

  const protectedResources = collectSceneResources(scene);
  const extraResources = mergeSceneResources({
    textures: new Set([ownedTexture]),
    renderTargets: new Set([renderTarget]),
  });
  const summary = disposeSceneResources(scene, { protectedResources, extraResources });

  assert.deepEqual(counts, { geometry: 0, material: 0, sharedTexture: 0, ownedTexture: 1, target: 1 });
  assert.equal(summary.textures, 1);
  assert.equal(summary.renderTargets, 1);
  assert.equal(summary.geometries, 0);
  assert.equal(summary.materials, 0);
});
