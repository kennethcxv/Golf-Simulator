// THE EDITOR'S CURSOR IS NEVER ABSENT — the wiring guard.
//
// These are SOURCE assertions and they certify nothing about behaviour; the
// check that does is tools/qa/editor-cursor-affordance.js, which opens the
// editor in Electron, screenshots before touching the mouse, and reads what the
// renderer will submit. It was watched failing on the build before this fix
// with sixteen `cursor absent` rows (qa/editor-cursor/control1.json).
//
// What these guard is the WIRING that check depends on, because every piece of
// it is a single call that a later edit can drop without any test going red:
// the indicator is drawn from entry and from every tool change rather than only
// from a pointer event, an off-course pointer anchors instead of clearing, and
// the tools that draw no preview of their own still get a ring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editorSource = readFileSync(
  new URL('../src/ui/courseEditor.js', import.meta.url),
  'utf8',
);
const sceneSource = readFileSync(
  new URL('../src/render3d/courseScene.js', import.meta.url),
  'utf8',
);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `found source boundary: ${start}`);
  assert.ok(endIndex > startIndex, `found source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('the cursor is drawn from entry and from every tool change, not only from a pointer event', () => {
  const show = sourceBetween(editorSource, '  function show() {', '  function hide() {');
  const setTool = sourceBetween(editorSource, '  function setTool(key) {', '  function setSelected(');

  assert.match(show, /refreshCursorIndicator\(\)/,
    'entry must seed the indicator: no pointermove follows pressing the editor key');
  assert.match(setTool, /refreshCursorIndicator\(\)/,
    'picking a tool from the rail leaves the mouse ON THE RAIL, so no pointermove follows it either');

  // ORDER MATTERS. setTool clears all three overlays at the top and snaps the
  // camera in the middle; the redraw has to come after both, in the same turn,
  // or the indicator blinks out between tools.
  const clearIndex = setTool.indexOf('setPlacementGhost(null)');
  const snapIndex = setTool.indexOf('rig.apply()');
  const redrawIndex = setTool.indexOf('refreshCursorIndicator()');
  assert.ok(clearIndex >= 0 && snapIndex > clearIndex && redrawIndex > snapIndex,
    'refreshCursorIndicator must run after the overlay clear and after the camera snap');
});

test('a pointer that is not over the course anchors the indicator instead of clearing it', () => {
  const hover = sourceBetween(editorSource, '  function updateHoverVisuals(', '  function onPointerUp(e)');

  assert.match(hover, /const g = hit && hit\.inBounds \? hit : rigTargetGround\(\)/,
    'off the course, the indicator falls back to the rig target');
  assert.doesNotMatch(hover, /if \(!g \|\| !g\.inBounds\) \{\s*\n\s*sc\.setEditorBrush\(null\)/,
    'the old unconditional clear on an out-of-bounds hit is what left the course empty');

  const anchor = sourceBetween(editorSource, '  function rigTargetGround()', '  function pointerSeed()');
  assert.match(anchor, /clamp\(sc\.rig\.target\.x/,
    'the anchor is clamped into the course so its record comes back inBounds');
  assert.match(anchor, /return g && g\.inBounds \? g : null/);
});

test('every tool state draws something, including the three that used to draw nothing', () => {
  const hover = sourceBetween(editorSource, '  function updateHoverVisuals(', '  function onPointerUp(e)');
  const tail = hover.slice(hover.lastIndexOf('} else {'));

  assert.match(tail, /setEditorBrush\(\{[^}]*radiusYd: CURSOR_RING_YD/,
    'select-with-nothing-selected, paths and measure reach the final else and must still show a ring');
  assert.doesNotMatch(tail, /setEditorBrush\(null\)/,
    'the final else clearing the brush IS the missing affordance');
});

test('the scene can answer for a ground point with no ray, and report what the cursor will submit', () => {
  assert.match(sceneSource, /\n  function groundAtWorld\(x, z\) \{/);
  assert.match(sceneSource, /\n  function groundRecordAt\(p\) \{/,
    'raycastGround and groundAtWorld must build the SAME record, or the anchor and the '
    + 'pointer disagree about bounds');
  assert.match(sourceBetween(sceneSource, '  function raycastGround(px, py)', '  function groundAtWorld'),
    /return groundRecordAt\(p\)/);
  // Anchored per line, not on a literal \n: a fresh checkout with autocrlf on
  // hands this file CRLF and every \n-terminated source scan in the repo goes
  // red at once.
  assert.match(sceneSource, /^\s*groundAtWorld,\s*$/m, 'exported to the editor');
  assert.match(sceneSource, /^\s*editorCursorState,\s*$/m, 'exported to the QA driver');

  // The read side has to cover all three overlays: any one of them alone can be
  // the indicator, so a probe that reads only the brush would call the tee tool
  // empty.
  const readSide = sourceBetween(sceneSource, '  function editorCursorState()', '  // --- the playtest ball');
  for (const field of ['brush:', 'preview:', 'ghost:', 'measure:']) {
    assert.ok(readSide.includes(field), `editorCursorState reports ${field}`);
  }
});
