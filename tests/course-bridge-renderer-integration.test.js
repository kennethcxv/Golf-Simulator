import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('../src/ui/courseEditor.js', import.meta.url), 'utf8');

test('course scene builds authored bridge decks, supports, and rails from path metadata', () => {
  assert.match(source, /import \{ buildCourseBridgeGeometry \} from '\.\/courseBridgeGeometry\.js'/);
  assert.match(source, /function pathBridgeEnabled\(path\)/);
  assert.match(source, /path\.bridge\.enabled !== false/);
  assert.match(source, /buildCourseBridgeGeometry\(path, \{/);
  assert.match(source, /new THREE\.BufferAttribute\(built\.deck\.positions, 3\)/);
  assert.match(source, /bridge-crossbeam/);
  assert.match(source, /bridge-pier/);
  assert.match(source, /bridge-rail-/);
  assert.match(source, /const bridge = bridgeForPath\(p\)/);
  assert.match(source, /buildCourseBridgeSurfaceIndex\(course, \{/);
  assert.match(source, /queryCourseBridgeSurface\(bridgeSurfaceIndex, courseX, courseY\)/);
  assert.match(source, /function playHeightAt\(x, z\)/);
  assert.match(source, /function playZoneAtWorld\(x, z\)/);
  assert.match(source, /if \(bridgeSurfaceAtWorld\(x, z\)\) return false/,
    'a bridge footprint overrides water blocking');
});

test('bridge materials stay inside the course palette and remain physically shaded', () => {
  assert.match(source, /deckKind === 'concrete'/);
  assert.match(source, /deckKind === 'steel'/);
  assert.match(source, /0x765438/);
  assert.match(source, /0x313c36/);
  assert.match(source, /deck\.castShadow = true/);
  assert.match(source, /deck\.receiveShadow = true/);
});

test('renderer, bridge queries, editor picking, and playtest cameras share path-space deck truth', () => {
  assert.match(source, /function vectorWorldX\(cx\)\s*\{\s*return cx \* CELL_YD - worldW \/ 2;/);
  assert.match(source, /function vectorWorldZ\(cy\)\s*\{\s*return cy \* CELL_YD - worldH \/ 2;/);
  assert.match(source, /createCoursePathCoordinateTransform\(course, \{/);
  assert.match(source, /pointToWorld: \(point\) => \(\{ x: pathWorldX\(point\.x\), z: pathWorldZ\(point\.y\) \}\)/);
  assert.match(source, /terrainHeightYdAt: \(x, y\) => heightAt\(pathWorldX\(x\), pathWorldZ\(y\)\)/);
  assert.match(source, /path\.pts\.map\(\(p\) => new THREE\.Vector3\(pathWorldX\(p\.x\), 0, pathWorldZ\(p\.y\)\)\)/);
  assert.match(source, /const courseX = pathCourseX\(x\);\s*const courseY = pathCourseY\(z\);/);
  assert.match(source, /editorGroundTargets\.push\(deck\)/);
  assert.match(source, /function groundRayPoint\(px, py\)/,
    'cell and fractional editor picks share one ground-ray authority');
  assert.equal((source.match(/const p = groundRayPoint\(px, py\);/g) || []).length, 2,
    'both cell and fractional editor rays use the shared picker');
  assert.match(source, /const hits = raycaster\.intersectObjects\(decks, false\);/,
    'the shared picker still intersects authored raised decks');
  assert.match(source, /!best \|\| hits\[0\]\.point\.distanceToSquared\(_rayOrigin\) < best\.distanceToSquared\(_rayOrigin\)/,
    'the nearest raised deck wins over the terrain march');
  assert.match(source, /rig\.heightAt = \(x, z\) => playHeightAt\(x, z\)/);
  assert.match(editorSource, /sc\.playHeightAt\?\.\(x, z\) \?\? sc\.heightAt\(x, z\)/,
    'the playtest aim guide follows a raised bridge deck');
});
