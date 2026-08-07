// B2 - THE LIVE TUNING OVERLAY. Full_Goal_16's most-wanted deliverable:
// "a dev-only in-game panel with sliders for every value that governs how
// the mop and broom look and feel … update the held tool LIVE as I drag …
// a button writes the current values back to the config file … show the
// numbers beside each slider, and the diagnostics that matter … so I can
// see your instruments agree or disagree with my eyes in real time."
//
// How it works: courseScene builds every rig against a MUTABLE clone of its
// feel (walk.toolFeelLive/toolFeelSet); almost every value is read by the
// rig per frame, and toolFeelSet calls refreshFromFeel for the handful that
// are constructor-captured, plus pushes strand params. Save serializes the
// live clones to src/data/toolFeelOverrides.json through the main process,
// and courseScene merges that file back over the defaults at boot - what
// you tune is what ships, and the JSON is hand-editable afterwards.
//
// Honest limitations, stated: F9 is reachable in any session (the panel is
// dev-only by audience, not by lock); the exercise replay drives the walk
// key handlers with synthetic KeyboardEvents and pulses the work state
// through walk.setSpraying - one mouse cannot drag a slider and hold the
// work button at once, and the replay exists so stroke/weight values are
// tuned against the motion they govern rather than a statue.
import { el } from './ui.js';

const SLIDERS = [
  { group: 'Hand anchor', label: 'anchor x', path: 'compose.gripAnchor.0', min: -0.8, max: 0.8, step: 0.001 },
  { group: 'Hand anchor', label: 'anchor y', path: 'compose.gripAnchor.1', min: -1.2, max: 0.4, step: 0.001 },
  { group: 'Hand anchor', label: 'anchor z', path: 'compose.gripAnchor.2', min: -1.8, max: -0.2, step: 0.001 },
  { group: 'Grip', label: 'roll upper', path: 'compose.handRollUpper', min: -3.2, max: 3.2, step: 0.01 },
  { group: 'Grip', label: 'roll lower', path: 'compose.handRollLower', min: -3.2, max: 3.2, step: 0.01 },
  { group: 'Grip', label: 'shaft offset', path: 'compose.handShaftOffset', min: 0, max: 0.12, step: 0.001 },
  { group: 'Grip', label: 'hand scale', path: 'compose.handScale', min: 0.6, max: 2.0, step: 0.01 },
  { group: 'Arms', label: 'elbow R x', path: 'arms.elbowOffsetRight.0', min: -0.5, max: 0.5, step: 0.005 },
  { group: 'Arms', label: 'elbow R y', path: 'arms.elbowOffsetRight.1', min: -0.8, max: 0.2, step: 0.005 },
  { group: 'Arms', label: 'elbow R z', path: 'arms.elbowOffsetRight.2', min: -0.3, max: 0.7, step: 0.005 },
  { group: 'Arms', label: 'forearm span', path: 'arms.forearmSpan', min: 0.12, max: 0.5, step: 0.005 },
  { group: 'Arms', label: 'depth ref', path: 'arms.forearmDepthRef', min: 0.3, max: 1.2, step: 0.005 },
  { group: 'Sweep', label: 'arc rad', path: 'sweep.arcRad', min: 0, max: 1.0, step: 0.005 },
  { group: 'Sweep', label: 'stroke rate', path: 'stroke.rate', min: 1, max: 10, step: 0.05 },
  { group: 'Sweep', label: 'hand follow', path: 'sweep.handFollow', min: 0, max: 1.2, step: 0.005 },
  { group: 'Sweep', label: 'wrist roll', path: 'sweep.handRoll', min: 0, max: 1.5, step: 0.01 },
  { group: 'Weight', label: 'lag Hz', path: 'weight.lagHz', min: 1, max: 12, step: 0.05 },
  { group: 'Weight', label: 'damping', path: 'weight.lagDamping', min: 0.1, max: 1.5, step: 0.01 },
  { group: 'Weight', label: 'settle time', path: 'equip.settleTime', min: 0, max: 0.3, step: 0.005 },
  { group: 'Carry & plant', label: 'carry hover', path: 'compose.carryHover', min: 0, max: 1.0, step: 0.005 },
  { group: 'Carry & plant', label: 'plant from (pitch)', path: 'pitch.carryAbove', min: -0.5, max: 0.2, step: 0.005 },
  { group: 'Carry & plant', label: 'planted by (pitch)', path: 'pitch.workBelow', min: -1.0, max: -0.1, step: 0.005 },
  { group: 'Strands', label: 'stiffness (chase)', path: 'strands.chaseBase', min: 2, max: 40, step: 0.5, strands: true },
  { group: 'Strands', label: 'lag (drag)', path: 'strands.dragGain', min: 0, max: 0.6, step: 0.005, strands: true },
  { group: 'Strands', label: 'push gain', path: 'strands.pushGain', min: 0, max: 3, step: 0.01, strands: true },
  { group: 'Strands', label: 'splay', path: 'strands.splayBase', min: 0, max: 1.2, step: 0.01, strands: true },
  { group: 'Strands', label: 'slack', path: 'strands.slackScale', min: 0.2, max: 2.5, step: 0.01, strands: true },
  // R-F: the placebo control - deliberately wired to NOTHING. If dragging
  // this changes anything on screen, the panel cannot be trusted.
  { group: 'QA', label: 'dead control (QA)', path: null, min: 0, max: 1, step: 0.01, dead: true },
];

const PANEL_CSS = 'position:fixed;top:0;right:0;bottom:0;width:340px;z-index:60;'
  + 'background:rgba(16,20,17,0.96);color:#cfd8cf;font:12px/1.45 system-ui,sans-serif;'
  + 'overflow-y:auto;padding:10px 12px 40px;border-left:1px solid #2c352c;display:none;';

export function makeToolTuner(appRef) {
  let tool = 'broom';
  let open = false;
  let exercise = null;
  const readouts = new Map();
  const inputs = new Map();

  const walk = () => appRef.scene3d?.walk;
  const feelOf = (id) => walk()?.toolFeelLive?.(id) || null;
  const leaf = (obj, path) => path.split('.').reduce((n, k) => (n == null ? n : n[k]), obj);

  const title = el('div', { style: 'font-weight:700;font-size:13px;margin-bottom:6px', text: 'TOOL TUNER · F9' });
  const tabs = el('div', { style: 'display:flex;gap:6px;margin-bottom:8px' });
  const diag = el('pre', {
    style: 'background:#0c100c;border:1px solid #273027;padding:6px;white-space:pre-wrap;'
      + 'font:11px/1.5 Consolas,monospace;color:#9fc79f;margin:0 0 8px',
    text: 'diagnostics…',
  });
  const body = el('div');
  const status = el('div', { style: 'color:#8fae8f;margin-top:6px;min-height:16px', text: '' });

  const root = el('div', { class: 'tool-tuner', style: PANEL_CSS },
    title, tabs, diag,
    el('div', {
      style: 'color:#7d8a7d;margin:0 0 8px',
      text: 'Drag = live. Hold RIGHT mouse over the game to look. Save writes toolFeelOverrides.json (ships).',
    }),
    body, status);

  function setStatus(text) { status.textContent = text; }

  function buildBody() {
    body.replaceChildren();
    inputs.clear();
    const feel = feelOf(tool);
    let currentGroup = null;
    for (const spec of SLIDERS) {
      if (spec.strands && tool !== 'mop') continue;
      if (spec.group !== currentGroup) {
        currentGroup = spec.group;
        body.append(el('div', {
          style: 'margin:10px 0 4px;color:#e8efe8;font-weight:600;border-bottom:1px solid #273027',
          text: currentGroup,
        }));
      }
      const value = spec.dead ? 0.5
        : spec.strands ? (leaf(feel, spec.path) ?? walk()?.strandRigFor?.(tool)?.params?.()[spec.path.split('.')[1]] ?? 0)
          : leaf(feel, spec.path);
      const readout = el('span', {
        style: 'float:right;color:#ffd98a;font:11px Consolas,monospace',
        text: Number(value ?? 0).toFixed(3),
      });
      const input = el('input', {
        type: 'range',
        min: String(spec.min), max: String(spec.max), step: String(spec.step),
        value: String(value ?? 0),
        style: 'width:100%;accent-color:#7fae7f;height:14px',
        'data-path': spec.path || 'dead',
        oninput: (event) => {
          const v = Number(event.target.value);
          readout.textContent = v.toFixed(3);
          if (spec.dead) return; // the placebo control writes nowhere
          // strand paths live under feel.strands (created on first write)
          if (spec.strands) {
            const f = feelOf(tool);
            if (f && !f.strands) f.strands = {};
          }
          walk()?.toolFeelSet?.(tool, spec.path, v);
        },
      });
      inputs.set(spec.path || 'dead', input);
      body.append(el('div', { style: 'margin:3px 0' },
        el('label', { style: 'display:block', text: spec.label }, readout), input));
    }
    body.append(
      el('div', { style: 'display:flex;gap:6px;margin-top:12px' },
        el('button', {
          text: 'Save → ships',
          style: 'flex:1;padding:6px;background:#2f4a35;color:#e8efe8;border:1px solid #47684f;cursor:pointer',
          onclick: async () => {
            try {
              const snap = walk()?.toolFeelSnapshot?.() || {};
              const payload = { mop: snap.mop, broom: snap.broom };
              const res = await window.fairwayNative?.saveToolFeel?.(payload);
              setStatus(res ? `saved → ${res.path}` : 'no native bridge (browser run): not saved');
            } catch (error) { setStatus(`save failed: ${error.message}`); }
          },
        }),
        el('button', {
          text: exercise ? 'Stop exercise' : 'Exercise',
          style: 'flex:1;padding:6px;background:#33414f;color:#e8efe8;border:1px solid #4b6377;cursor:pointer',
          onclick: (event) => {
            if (exercise) { stopExercise(); event.target.textContent = 'Exercise'; return; }
            startExercise(); event.target.textContent = 'Stop exercise';
          },
        })),
    );
  }

  // Exercise: replay walk/turn/sweep against the real key handlers so motion
  // values are tuned against motion. Work state pulses through setSpraying -
  // the one synthetic step, because pointer lock owns the real button.
  function startExercise() {
    let beat = 0;
    exercise = setInterval(() => {
      beat += 1;
      const phase = beat % 8;
      const key = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
      if (phase === 0) key('keydown', 'w');
      if (phase === 2) key('keyup', 'w');
      if (phase === 3) key('keydown', 'a');
      if (phase === 5) key('keyup', 'a');
      walk()?.setSpraying?.(phase >= 4);
    }, 450);
  }
  function stopExercise() {
    clearInterval(exercise);
    exercise = null;
    const key = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
    key('keyup', 'w'); key('keyup', 'a');
    walk()?.setSpraying?.(false);
  }

  // RMB-to-look while the panel is open.
  const canvas = () => document.getElementById('game');
  const onMouseDown = (event) => {
    if (!open || event.button !== 2) return;
    canvas()?.requestPointerLock?.();
  };
  const onMouseUp = (event) => {
    if (!open || event.button !== 2) return;
    if (document.pointerLockElement) document.exitPointerLock();
  };
  const onContext = (event) => { if (open) event.preventDefault(); };

  // Diagnostics at 4 Hz: the rig's own numbers PLUS two rendered-frame rows
  // (which camera drew the tool; pixel motion in the head region) so the
  // sliders and the screen can disagree VISIBLY when something downstream
  // eats the rig's output - the six-round failure, made observable.
  let diagTimer = null;
  let prevCrop = null;
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = 96; cropCanvas.height = 96;
  const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
  function sampleDiagnostics() {
    const w = walk();
    const s3 = appRef.scene3d;
    if (!w || !s3) return;
    const d = w.toolRigDiagnostics?.(tool);
    const active = w.getTool?.() === tool;
    let regionDiff = 'n/a';
    let palm = 'n/a';
    try {
      const group = s3.scene.getObjectByName(`Tool_${tool}`);
      const socket = group?.getObjectByName('SOCKET_GripPrimary');
      const contact = group?.getObjectByName('SOCKET_FloorContact')
        || group?.getObjectByName('SOCKET_DirtIntake');
      const hand = s3.scene.getObjectByName('FirstPersonRightHand');
      if (socket && hand && contact) {
        const V = Object.getPrototypeOf(hand.position).constructor;
        const hp = hand.getWorldPosition(new V());
        const gp = socket.getWorldPosition(new V());
        const cp = contact.getWorldPosition(new V());
        // distance from the hand to the grip->head LINE = "is the palm on
        // the shaft", the number that must agree with the player's eyes
        const axis = cp.clone().sub(gp);
        const t = Math.max(0, Math.min(1, hp.clone().sub(gp).dot(axis) / axis.lengthSq()));
        palm = hp.distanceTo(gp.clone().addScaledVector(axis, t)).toFixed(3);
      }
      const cam = w.toolDrawCamera?.(tool);
      const renderer = s3.renderer;
      if (contact && cam && renderer && active) {
        const V = Object.getPrototypeOf(contact.position).constructor;
        const ndc = contact.getWorldPosition(new V()).project(cam);
        if (Math.abs(ndc.x) < 1.2 && Math.abs(ndc.y) < 1.2) {
          const cw = renderer.domElement.width; const ch = renderer.domElement.height;
          const cx = Math.round((ndc.x * 0.5 + 0.5) * cw);
          const cy = Math.round((-ndc.y * 0.5 + 0.5) * ch);
          const half = 90;
          cropCtx.drawImage(renderer.domElement,
            Math.max(0, cx - half), Math.max(0, cy - half), half * 2, half * 2, 0, 0, 96, 96);
          const data = cropCtx.getImageData(0, 0, 96, 96).data;
          if (prevCrop) {
            let sum = 0;
            for (let i = 0; i < data.length; i += 16) sum += Math.abs(data[i] - prevCrop[i]);
            regionDiff = String(Math.round(sum / 100));
          }
          prevCrop = data.slice(0);
        }
      }
      const camNow = w.toolDrawCamera?.(tool);
      const mainFov = s3.camera?.fov;
      diag.textContent = [
        `tool ${tool}  ${active ? 'EQUIPPED' : 'not equipped - F wheel to hold it'}`,
        `drawn by ${camNow && camNow.fov !== mainFov ? `VM lens fov ${camNow.fov}` : `MAIN camera fov ${mainFov}`}`,
        `palm-to-shaft ${palm} yd   seatError ${d ? d.seatError : 'n/a'}`,
        `head above floor ${d && d.headAboveFloor != null ? d.headAboveFloor : 'n/a'} yd   headNdc ${d ? JSON.stringify(d.headNdc) : 'n/a'}`,
        `hand NDC ${d && d.handNdcUpper ? JSON.stringify(d.handNdcUpper) : 'n/a'}   geom ${d ? d.geomSource : 'n/a'}`,
        `headLag ${d ? `${d.headLag.reason} @ ${d.headLag.angle}` : 'n/a'}`,
        `region pixel motion (4 Hz) ${regionDiff}`,
      ].join('\n');
    } catch (error) {
      diag.textContent = `diagnostics error: ${error.message}`;
    }
  }

  function setTool(next) {
    tool = next;
    for (const button of tabs.children) {
      button.style.background = button.dataset.tool === tool ? '#2f4a35' : '#1c231c';
    }
    buildBody();
  }
  for (const id of ['broom', 'mop']) {
    tabs.append(el('button', {
      text: id, 'data-tool': id,
      style: 'flex:1;padding:5px;background:#1c231c;color:#cfd8cf;border:1px solid #2c352c;cursor:pointer',
      onclick: () => setTool(id),
    }));
  }

  function toggle(force) {
    open = force != null ? !!force : !open;
    root.style.display = open ? 'block' : 'none';
    if (open) {
      setTool(tool);
      if (document.pointerLockElement) document.exitPointerLock();
      diagTimer = setInterval(sampleDiagnostics, 250);
      window.addEventListener('mousedown', onMouseDown, true);
      window.addEventListener('mouseup', onMouseUp, true);
      window.addEventListener('contextmenu', onContext, true);
    } else {
      clearInterval(diagTimer);
      diagTimer = null;
      if (exercise) stopExercise();
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('contextmenu', onContext, true);
    }
    return open;
  }

  return { root, toggle, isOpen: () => open, setTool };
}

export default makeToolTuner;
