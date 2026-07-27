import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  authoredCutterPathSegment,
  authoredTapeMeshVisible,
  createAuthoredCutterPathContract,
} from '../src/render3d/clubhouse/authoredCutterPath.js';

const BOX_MODELS = Object.freeze([
  'delivery_accessory_carton',
  'delivery_golf_ball_case',
  'delivery_apparel_box',
  'delivery_generic_merchandise_box',
  'delivery_shoe_carton',
  'delivery_golf_club_box',
  'delivery_golf_bag_carton',
  'delivery_fixture_package',
  'delivery_furniture_crate',
  'delivery_bulk_provisions_carton',
  'delivery_umbrella_carton',
  'delivery_iron_set_carton',
]);

function contract(overrides = {}) {
  return createAuthoredCutterPathContract({
    points: '[[0,-0.184,0.425],[0,0.184,0.425]]',
    segmentNodes: '["TAPE_CENTER_SEG_01","TAPE_CENTER_SEG_02"]',
    orderedTapeNames: ['TAPE_CENTER_SEG_01', 'TAPE_CENTER_SEG_02'],
    durationSec: 1.9,
    ...overrides,
  });
}

function glbJson(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'binary glTF magic');
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) {
      return JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8').trim());
    }
    offset += 8 + length;
  }
  throw new Error('GLB has no JSON chunk');
}

test('generic center-only metadata becomes the exact Y-up runtime route', () => {
  const path = contract();
  assert.deepEqual(path.points, [
    { x: 0, y: 0.425, z: 0.184 },
    { x: 0, y: 0.425, z: -0.184 },
  ]);
  const halfway = authoredCutterPathSegment(path, 0.5);
  assert.deepEqual(halfway.start, path.points[0]);
  assert.deepEqual(halfway.end, path.points[1]);
  assert.equal(halfway.progress, 0.5);
  assert.equal(halfway.span, 1);
});

test('club route begins along its authored 1.176 metre X seam and uses length-weighted progress', () => {
  const names = Array.from({ length: 12 }, (_, index) => `TAPE_CENTER_SEG_${String(index + 1).padStart(2, '0')}`)
    .concat('TAPE_END_RIGHT', 'TAPE_END_LEFT');
  const path = contract({
    points: JSON.stringify([
      [-0.588, 0, 0.18], [0.588, 0, 0.18],
      [0.568, -0.078, 0.18], [0.568, 0.078, 0.18],
      [-0.568, 0.078, 0.18], [-0.568, -0.078, 0.18],
    ]),
    segmentNodes: JSON.stringify(names),
    orderedTapeNames: names,
    durationSec: 2.7,
  });
  const first = authoredCutterPathSegment(path, 0.2);
  assert.deepEqual(first.start, { x: -0.588, y: 0.18, z: 0 });
  assert.deepEqual(first.end, { x: 0.588, y: 0.18, z: 0 });
  assert.ok(first.span > 0.43 && first.span < 0.44, `weighted first span ${first.span}`);
  const rightReturn = authoredCutterPathSegment(path, 0.48);
  assert.equal(rightReturn.start.x, 0.568);
  assert.equal(rightReturn.end.x, 0.568);
  assert.notEqual(rightReturn.start.z, rightReturn.end.z);
});

test('reinforcement and side returns never vanish from aggregate cut progress', () => {
  const path = contract();
  assert.equal(authoredTapeMeshVisible(path, 'TAPE_CENTER_SEG_01', 0.5, false), false);
  assert.equal(authoredTapeMeshVisible(path, 'TAPE_CENTER_SEG_02', 0.5, false), true);
  assert.equal(authoredTapeMeshVisible(path, 'TAPE_CROSS_SEG_01', 1, false), true);
  assert.equal(authoredTapeMeshVisible(path, 'TAPE_SIDE_FRONT', 1, false), true);
  assert.equal(authoredTapeMeshVisible(path, 'TAPE_REINFORCEMENT', 1, false), true);
  assert.equal(authoredTapeMeshVisible(path, 'TAPE_CROSS_SEG_01', 1, true), false,
    'non-cuttable reinforcement yields only when opening starts');
});

test('all twelve exact GLBs name every cut_order tape in CUT_PATH segment_nodes', async () => {
  for (const model of BOX_MODELS) {
    const bytes = await readFile(new URL(`../vendor/models/clubhouse/${model}.glb`, import.meta.url));
    const json = glbJson(bytes);
    const pathNode = json.nodes.find((node) => node.name === 'CUT_PATH');
    assert.ok(pathNode, `${model} CUT_PATH`);
    const points = JSON.parse(pathNode.extras?.points || 'null');
    const segmentNodes = JSON.parse(pathNode.extras?.segment_nodes || 'null');
    assert.ok(Array.isArray(points) && points.length >= 2, `${model} point route`);
    assert.ok(Array.isArray(segmentNodes) && segmentNodes.length > 0, `${model} segment_nodes`);
    const ordered = json.nodes
      .filter((node) => Number.isFinite(Number(node.extras?.cut_order)))
      .sort((a, b) => Number(a.extras.cut_order) - Number(b.extras.cut_order))
      .map((node) => node.name);
    assert.deepEqual(segmentNodes, ordered, `${model} segment_nodes follow cut_order exactly`);
  }
});
