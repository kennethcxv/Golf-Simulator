import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// GOAL 17 R1 — THE CHECKS THAT WOULD HAVE CAUGHT AN UNCLICKABLE PANEL.
//
// The tuning overlay shipped in Goal 16 looking correct and behaving like a
// picture: `#ui > .game-ui` is `pointer-events: none` and the panel root never
// turned it back on, so every press aimed at a slider fell through to the
// canvas, which answered by re-capturing pointer lock. Measured with a real
// mouse drag: the hand-anchor slider read -0.44 before and -0.44 after.
//
// Nothing in the suite could see that, because nothing in the suite asks
// whether a panel can be clicked. These are source contracts rather than
// behaviour, deliberately: the behaviour is proven in Electron by
// tools/qa/electron-r1-tuner.js (which is where the pixels are), and these
// exist so the contract cannot be deleted by accident between sessions.

const tuner = fs.readFileSync(new URL('../src/ui/toolTuner.js', import.meta.url), 'utf8');
const mainJs = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const courseScene = fs.readFileSync(new URL('../src/render3d/courseScene.js', import.meta.url), 'utf8');

test('the game UI layer is still click-through, which is why the panel must opt in', () => {
  // If this ever stops being true the opt-in below becomes redundant rather
  // than wrong — but the reason for it would have quietly changed, and the
  // next person deserves to be told so by a failing test.
  assert.match(
    styles,
    /#ui > \.game-ui \{[^}]*pointer-events:\s*none/,
    'the .game-ui layer passes pointer events through to the canvas',
  );
});

test('the tuning overlay takes pointer events, or no slider can be dragged', () => {
  // \r?\n: with core.autocrlf the worktree copy carries CRLF after any fresh
  // checkout, and a literal \n anchor stops matching its own file.
  const css = /const PANEL_CSS = ([\s\S]*?);\r?\n/.exec(tuner);
  assert.ok(css, 'the panel style block is findable');
  assert.match(css[1], /pointer-events:auto/, 'the panel root opts back into the cursor');
});

test('clicking the overlay does not re-capture pointer lock', () => {
  // The canvas click handler stands down for every modal that owns the cursor.
  // The tuner is one of those; without it, the first press on a slider locks
  // the pointer and the drag becomes a camera pan.
  const guard = /if \(regActive\(\) \|\| editorActive\(\)[\s\S]{0,240}?\) return;/.exec(mainJs);
  assert.ok(guard, 'the click-to-recapture guard is findable');
  assert.match(guard[0], /toolTuner\?\.isOpen\(\)/, 'the tuner is in the stand-down list');
});

test('both elbows have controls, because a two-handed grip has two', () => {
  for (const axis of ['0', '1', '2']) {
    assert.ok(
      tuner.includes(`arms.elbowOffsetLeft.${axis}`),
      `the left elbow's axis ${axis} has a row`,
    );
    assert.ok(
      tuner.includes(`arms.elbowOffsetRight.${axis}`),
      `the right elbow's axis ${axis} has a row`,
    );
  }
});

test('the fibre rows belong to whichever tool has fibres, not to the mop by name', () => {
  assert.doesNotMatch(
    tuner,
    /spec\.strands && tool !== 'mop'/,
    'the fibre group is no longer hard-gated to the mop',
  );
  assert.match(
    tuner,
    /const hasFibres = \(\) =>[\s\S]{0,160}strandRigFor/,
    'the gate asks the scene whether this tool has a fibre rig',
  );
});

test('saved fibre params reach every rig that draws fibres', () => {
  // The old retry pushed to 'mop' and only 'mop'. A saved broom fibre block was
  // merged into the live feel and then never reached the rig that draws it.
  const retry = /const strandRetry = \(\) => \{[\s\S]*?\};/.exec(courseScene);
  assert.ok(retry, 'the strand push retry is findable');
  assert.doesNotMatch(retry[0], /pushStrandParams\('mop'\)/, 'no single tool is named');
  assert.match(retry[0], /fibreTools/, 'it pushes to every tool that carries fibres');
});

test('the panel keeps a control wired to nothing, so it can be caught lying', () => {
  assert.match(tuner, /dead: true/, 'the placebo slider is still in the table');
  assert.match(tuner, /if \(spec\.dead\) return;/, 'the placebo writes nowhere');
});
