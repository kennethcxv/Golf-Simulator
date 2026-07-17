// GOLF EMPIRE — the course editor: UI shell + input controller + playtest.
//
// Layout follows the simpler course-editor reference: a top bar (Playtest,
// Undo, Redo, Save, the pending bill, money, daylight preview), a left tool
// rail (Select / Terrain / Paint / Tee / Green / Bunker / Water / Objects /
// Paths / Measure) whose ACTIVE tool shows its few controls beneath it, a TIP
// box, a bottom control-hint bar, and a compass. Hole selection is a card grid;
// hole settings a small dialog; statistics a toggleable panel.
//
// All simulation goes through sim/courseEditor.js (undo/redo, exactly-once
// billing) and sim/playtest.js (the ball). This file owns DOM + pointer input.

import { el, toast } from './ui.js';
import { ZONE, HOLE_STATUS } from '../sim/constants.js';
import { holeNumber, holePar, holeDistanceYd, ensureHoleShape } from '../sim/course.js';
import { ZONE_COLORS } from '../render/palette.js';
import { formatMoney, clamp } from '../core/utils.js';
import {
  makeEditSession, sessionDirty,
  beginTerrainStroke, sculptAt, endTerrainStroke,
  beginPaintStroke, paintAt, endPaintStroke,
  stampGreen, stampBunker, stampWater, stampStream, stampTee, setPinPosition, selectPin, selectTee,
  addObject, removeObject, moveObject, duplicateObject, scatterObjects, objectPlacementOk, OBJECT_CATALOG, objectCostOf,
  addPath, editPath, removePath,
  newHole, deleteHole, setHoleSettings, reorderHole,
  undo, redo, applySession, discardSession,
  measure, courseStats, zoneCost,
} from '../sim/courseEditor.js';
import {
  startPlaytest, strike, stepBall, remainingYd, playtestHud, suggestClub, CLUBS,
} from '../sim/playtest.js';

// Monochrome stroke icons (no emoji — the reference UI is quiet and premium).
// Each icon is a list of [tag, attrs] built with createElementNS: no HTML parsing.
const ICONS = {
  select: [['path', { d: 'M4 2l9 7-4.2 1L7 14z' }]],
  terrain: [['path', { d: 'M1.5 13L6 5l3 4.6L11 6l3.5 7z' }]],
  paint: [['path', { d: 'M9.5 2.5l4 4L7 13H3v-4z' }], ['path', { d: 'M11 8L8 5' }]],
  tee: [['path', { d: 'M4.5 4h7M8 4v6.5M6.5 13h3M8 10.5V13' }], ['circle', { cx: '8', cy: '2.4', r: '1.1' }]],
  green: [['path', { d: 'M5 14V3' }], ['path', { d: 'M5 3.6h6.5L9.5 6l2 2.4H5' }], ['path', { d: 'M2.5 14h7' }]],
  bunker: [['path', { d: 'M2 11.5q6-7.5 12 0' }], ['path', { d: 'M5 13.4h.01M8 12.8h.01M11 13.4h.01' }]],
  water: [['path', { d: 'M8 2.2c2.8 3.6 4.6 5.6 4.6 8a4.6 4.6 0 11-9.2 0c0-2.4 1.8-4.4 4.6-8z' }]],
  objects: [['path', { d: 'M8 2l4 5.4H4z' }], ['path', { d: 'M8 6.6l3.2 4.6H4.8z' }], ['path', { d: 'M8 11.2V14' }]],
  paths: [['path', { d: 'M2 14c4.5-3.5 5-6.5 12-10', 'stroke-dasharray': '2.6 2' }]],
  measure: [['path', { d: 'M3.5 12.5l9-9' }], ['path', { d: 'M5.5 10.5l1.2 1.2M7.5 8.5l1.2 1.2M9.5 6.5l1.2 1.2' }]],
  play: [['path', { d: 'M5.5 3.2l7.5 4.8-7.5 4.8z' }]],
  undo: [['path', { d: 'M6.5 3.5L3 7l3.5 3.5' }], ['path', { d: 'M3 7h6a4 4 0 014 4v1.5' }]],
  redo: [['path', { d: 'M9.5 3.5L13 7l-3.5 3.5' }], ['path', { d: 'M13 7H7a4 4 0 00-4 4v1.5' }]],
  save: [['path', { d: 'M3 3h8.5L13 4.5V13H3z' }], ['path', { d: 'M5 3v3.5h5V3' }], ['path', { d: 'M5 13v-4h6v4' }]],
  holes: [['path', { d: 'M6 14V4' }], ['path', { d: 'M6 4.5h5L9.4 6.4 11 8.3H6' }]],
  stats: [['path', { d: 'M3.5 13V8.5M7.5 13V4M11.5 13V6.5' }], ['path', { d: 'M2 13.5h12' }]],
  exit: [['path', { d: 'M4 4l8 8M12 4l-8 8' }]],
  frame: [['path', { d: 'M2.5 5.5v-3h3M13.5 5.5v-3h-3M2.5 10.5v3h3M13.5 10.5v3h-3' }]],
  shrub: [['path', { d: 'M4.5 13c-2-1.5-2-4.5.5-5.5C4.5 4.5 7 3.5 8 5c1-1.5 3.5-.5 3 2.5 2.5 1 2.5 4 .5 5.5z' }], ['path', { d: 'M8 13v1.5' }]],
  rock: [['path', { d: 'M3 12l1.5-4.5L8 5l4 1.5L13.5 12z' }], ['path', { d: 'M8 5l1 7' }]],
  prop: [['path', { d: 'M3 12.5V9.5h10v3' }], ['path', { d: 'M4 9.5V6h8v3.5' }], ['path', { d: 'M4.5 12.5v1M11.5 12.5v1' }]],
  decor: [['circle', { cx: '8', cy: '5', r: '2.4' }], ['path', { d: 'M8 7.5V12' }], ['path', { d: 'M5.5 13.5h5' }]],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgIcon(name) {
  const span = el('span', { class: 'ced-ico' });
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONS[name] || ICONS.select) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  }
  span.append(svg);
  return span;
}

const TOOLS = [
  { key: 'select', icon: 'select', label: 'Select' },
  { key: 'terrain', icon: 'terrain', label: 'Terrain' },
  { key: 'paint', icon: 'paint', label: 'Paint' },
  { key: 'tee', icon: 'tee', label: 'Tee' },
  { key: 'green', icon: 'green', label: 'Green' },
  { key: 'bunker', icon: 'bunker', label: 'Bunker' },
  { key: 'water', icon: 'water', label: 'Water' },
  { key: 'objects', icon: 'objects', label: 'Objects' },
  { key: 'paths', icon: 'paths', label: 'Paths' },
  { key: 'measure', icon: 'measure', label: 'Measure' },
];

const PAINT_SURFACES = [
  { zone: ZONE.FAIRWAY, label: 'Fairway' },
  { zone: ZONE.SEMI, label: 'First cut' },
  { zone: ZONE.ROUGH, label: 'Rough' },
  { zone: ZONE.HEAVY, label: 'Heavy rough' },
  { zone: ZONE.FRINGE, label: 'Fringe' },
  { zone: ZONE.GREEN, label: 'Green' },
  { zone: ZONE.TEE, label: 'Tee grass' },
  { zone: ZONE.OUT, label: 'Native' },
  { zone: ZONE.DIRT, label: 'Dirt' },
  { zone: ZONE.BED, label: 'Planting bed' },
];

const EXTRA_ZONE_COLORS = {
  [ZONE.FRINGE]: '#89c46a',
  [ZONE.HEAVY]: '#6f7b3c',
  [ZONE.DIRT]: '#8a6f4d',
  [ZONE.BED]: '#5d4630',
  [ZONE.SEMI]: '#6f9c4e',
};
const zoneColor = (z) => EXTRA_ZONE_COLORS[z] || ZONE_COLORS[z] || '#888';

const OBJ_ICON = { tree: 'objects', shrub: 'shrub', rock: 'rock', prop: 'prop', decor: 'decor' };

export function makeCourseEditor(app, hooks) {
  // hooks: { onExit(), afterApply(), autosave(), money() }
  let session = null;
  let active = false;
  let tool = 'select';
  const ui = {}; // live element refs

  // per-tool tunables (progressive disclosure: only the active tool shows)
  const opt = {
    terrain: { mode: 'raise', radiusYd: 20, strength: 55, autoSmooth: true },
    paint: { zone: ZONE.FAIRWAY, radiusYd: 16 },
    tee: { holeId: null, teeKey: 'back' },
    green: { shape: 'oval', sizeYd: 30, rot: 0, pin: null }, // pin: null | 'A'|'B'|'C'
    bunker: { shape: 'kidney', sizeYd: 14, depth: 1.6 },
    water: { shape: 'pond', sizeYd: 36, depth: 2.4 },
    objects: { cat: 'tree', type: 'tree_oak', scale: 1, randomRot: true, assist: false, assistCount: 8 },
    paths: { width: 3.2, material: 'asphalt' },
  };

  // transient input state
  let stroke = null; // active terrain/paint stroke
  let strokeClock = 0;
  let drawingPath = null; // [{x,y}...] while placing a path
  let measurePts = []; // world pts
  let selected = null; // selected object (Select tool)
  let draggingObj = false;
  let camDrag = null; // {mode:'orbit'|'pan', x, y}
  let hover = null; // last raycastGround hit
  let pt = null; // playtest session
  let ptPower = null; // {t, dir} while charging
  let ptAim = 0;
  let ptClub = null;
  let lightMode = 'day';

  const scene = () => app.scene3d;
  const state = () => app.state;

  // ---------------------------------------------------------------- DOM ----

  const topLeft = el('div', { class: 'ced-top-left' },
    el('div', { class: 'ced-title' }, svgIcon('green'), el('span', { text: 'COURSE EDITOR' })),
    ui.playtestBtn = el('button', { class: 'ced-top-btn primary', title: 'Play the selected hole', onclick: () => enterPlaytest() },
      svgIcon('play'), el('span', { text: 'Playtest' })),
    ui.undoBtn = el('button', { class: 'ced-top-btn', title: 'Undo (Ctrl+Z)', onclick: () => doUndo() },
      svgIcon('undo'), el('span', { text: 'Undo' })),
    ui.redoBtn = el('button', { class: 'ced-top-btn', title: 'Redo (Ctrl+Y)', onclick: () => doRedo() },
      svgIcon('redo'), el('span', { text: 'Redo' })),
    ui.saveBtn = el('button', { class: 'ced-top-btn', title: 'Save the course', onclick: () => openSaveDialog() },
      svgIcon('save'), el('span', { text: 'Save' })),
    ui.statsBtn = el('button', { class: 'ced-top-btn', title: 'Course statistics', onclick: () => toggleStats() },
      svgIcon('stats'), el('span', { text: 'Stats' })),
  );

  // the selected hole is the editor's center of gravity: one chip names it,
  // clicking it opens the hole cards
  ui.holeChip = el('button', { class: 'ced-holechip', title: 'Select a hole to edit', onclick: () => openHoleSelect() },
    svgIcon('holes'), el('span', { text: 'Select a hole' }));

  ui.billChip = el('span', { class: 'ced-bill', text: '' });
  ui.applyBtn = el('button', { class: 'ced-top-btn primary', text: 'Build it', onclick: () => doApply() });
  ui.discardBtn = el('button', { class: 'ced-top-btn', text: 'Discard', onclick: () => doDiscard() });
  const billWrap = el('div', { class: 'ced-bill-wrap' }, ui.holeChip, ui.billChip, ui.applyBtn, ui.discardBtn);

  ui.moneyChip = el('span', { class: 'ced-money', text: '' });
  ui.clockChip = el('span', { class: 'ced-clock', text: '' });
  ui.lightSel = el('select', { class: 'ced-light', title: 'Editor lighting preview' },
    el('option', { value: 'day', text: 'Midday' }),
    el('option', { value: 'morning', text: 'Morning' }),
    el('option', { value: 'golden', text: 'Golden hour' }),
    el('option', { value: 'overcast', text: 'Overcast' }),
  );
  ui.lightSel.onchange = () => {
    lightMode = ui.lightSel.value;
    if (scene()) scene().setLightingOverride(lightMode);
  };
  const topRight = el('div', { class: 'ced-top-right' },
    ui.moneyChip,
    ui.clockChip,
    ui.lightSel,
    el('button', { class: 'ced-top-btn', title: 'Leave the editor', onclick: () => requestExit() },
      svgIcon('exit'), el('span', { text: 'Exit' })),
  );

  const topBar = el('div', { class: 'ced-top' }, topLeft, billWrap, topRight);

  // tool rail + contextual controls
  const railButtons = new Map();
  const rail = el('div', { class: 'ced-rail' },
    el('div', { class: 'ced-rail-head', text: 'SELECT TOOL' }),
    ...TOOLS.map((t, i) => {
      const b = el('button', {
        class: 'ced-tool',
        onclick: () => setTool(t.key),
        title: `${t.label} (${i + 1})`,
      }, svgIcon(t.icon), el('span', { text: t.label }));
      railButtons.set(t.key, b);
      return b;
    }),
  );
  ui.toolPanel = el('div', { class: 'ced-tool-panel' });
  const tip = el('div', { class: 'ced-tip' },
    el('b', { text: 'TIP' }),
    el('div', { text: 'Choose a tool and click on the course to begin.' }),
  );
  const leftCol = el('div', { class: 'ced-left' }, rail, ui.toolPanel, tip);

  ui.hintBar = el('div', { class: 'ced-hints', text: '' });
  ui.measureChip = el('div', { class: 'ced-measure', style: 'display:none' });
  ui.compass = el('div', { class: 'ced-compass' }, el('span', { text: 'N' }));

  // stats panel (toggleable)
  ui.statsPanel = el('div', { class: 'ced-stats', style: 'display:none' });

  // playtest overlay + its hole mini-map card
  ui.ptBar = el('div', { class: 'ced-pt', style: 'display:none' });
  ui.ptMap = el('div', { class: 'ced-pt-map', style: 'display:none' });

  const root = el('div', { class: 'ced-root', style: 'display:none' },
    topBar, leftCol, ui.hintBar, ui.measureChip, ui.compass, ui.statsPanel, ui.ptBar, ui.ptMap);

  // ------------------------------------------------------------- helpers ----

  function holesOf() {
    const c = state().course;
    c.holes.forEach((h, i) => ensureHoleShape(h, i + 1));
    return c.holes;
  }

  function refreshTop() {
    const bill = session ? Math.round(session.bill) : 0;
    const dirty = !!(session && sessionDirty(session));
    // the bill trio only exists while something is actually pending — a clean
    // course shows a clean bar, not permanent status text
    ui.billChip.style.display = bill > 0 ? '' : 'none';
    ui.billChip.textContent = bill > 0 ? `Pending works: ${formatMoney(bill)}` : '';
    const canPay = bill <= state().cash;
    ui.applyBtn.style.display = dirty ? '' : 'none';
    ui.applyBtn.disabled = !dirty;
    ui.applyBtn.textContent = bill > 0 && !canPay ? 'Not enough cash' : 'Build it';
    ui.applyBtn.classList.toggle('danger', bill > 0 && !canPay);
    ui.discardBtn.style.display = dirty ? '' : 'none';
    ui.discardBtn.disabled = !dirty;
    ui.undoBtn.disabled = !(session && session.undo.length);
    ui.redoBtn.disabled = !(session && session.redo.length);
    ui.moneyChip.textContent = formatMoney(state().cash);
    // the game date rides along, like the reference's "Y1 · Spring · Day 2"
    try {
      const chip = document.querySelector('.hud-clock');
      ui.clockChip.textContent = chip ? chip.textContent.replace(/[⏸▶]/g, '').trim() : '';
    } catch { /* clock is decoration */ }
    refreshHoleChip();
    if (ui.statsPanel.style.display !== 'none') renderStats();
  }

  function selectedHole() {
    return holesOf().find((h) => h.id === opt.tee.holeId) || holesOf()[0] || null;
  }

  function refreshHoleChip() {
    const hole = selectedHole();
    const label = ui.holeChip.querySelector('span:last-child');
    if (!hole) {
      label.textContent = 'Select a hole';
      return;
    }
    const n = holeNumber(state().course, hole.id);
    const yd = hole.tee && hole.pin ? ` · ${Math.round(holeDistanceYd(hole))} yd` : '';
    const named = hole.name && hole.name !== `Hole ${n}` ? ` — ${hole.name}` : '';
    label.textContent = `Hole ${n}${named} · Par ${holePar(hole)}${yd}`;
  }

  // Selecting a hole is the editor's core gesture: it frames the camera, aims
  // the tee tool, and names itself in the top bar.
  function selectHole(hole, { frame = true } = {}) {
    if (!hole) return;
    opt.tee.holeId = hole.id;
    if (frame && scene()) scene().frameHole(hole);
    refreshHoleChip();
  }

  function hint(text) {
    ui.hintBar.textContent = text;
  }

  const HINTS = {
    select: 'Left click: select an object · Drag: move it · Right-drag: rotate camera · Middle: pan · Wheel: zoom',
    terrain: 'Hold left: sculpt · Right-drag: rotate camera · Middle: pan · Wheel: zoom',
    paint: 'Hold left: paint · Hold right: erase to rough · Middle: pan · Wheel: zoom',
    tee: 'Click on the ground: build the tee box aimed at the pin',
    green: 'Click: build the green · Pick pin A/B/C then click the green to set the pin',
    bunker: 'Click: dig the bunker · Right-drag: rotate camera · Wheel: zoom',
    water: 'Pond/Lake: click to flood · Stream: click points, right-click to finish',
    objects: 'Click: place · Right-click: remove nearest · Fill area: pick a spot',
    paths: 'Click: add points · Right-click: finish the path · Drag a point to adjust',
    measure: 'Click two (or more) points · Right-click: clear',
  };

  function setTool(key) {
    tool = key;
    stroke = null;
    drawingPath = null;
    if (key !== 'measure') {
      measurePts = [];
      if (scene()) scene().setMeasureLine(null);
    }
    if (key !== 'select') setSelected(null);
    if (scene()) {
      scene().setPlacementGhost(null);
      // TOOL FOCUS: picking a brush from a satellite distance is guesswork —
      // ease in far enough that the brush ring stays a readable size
      const rig = scene().rig;
      if (key !== 'select' && rig.dist > 340) {
        rig.dist = 260;
        rig.pitch = Math.min(rig.pitch, 0.95);
        rig.apply();
      }
    }
    for (const [k, b] of railButtons) b.classList.toggle('on', k === key);
    renderToolPanel();
    hint(HINTS[key] || '');
  }

  function setSelected(obj) {
    selected = obj;
    if (!obj && scene()) scene().setEditorBrush(null);
    if (tool === 'select') renderToolPanel();
  }

  // ------------------------------------------------------ tool panels ----

  function slider(label, value, min, max, step, oninput, format = (v) => v) {
    const val = el('span', { class: 'ced-val', text: String(format(value)) });
    const input = el('input', {
      type: 'range', min: String(min), max: String(max), step: String(step), value: String(value),
      oninput: (e) => {
        const v = Number(e.target.value);
        val.textContent = String(format(v));
        oninput(v);
      },
    });
    return el('div', { class: 'ced-row' }, el('label', { text: label }), input, val);
  }

  function segButtons(options, current, onpick) {
    return el('div', { class: 'ced-seg' }, ...options.map(([key, label]) =>
      el('button', {
        class: key === current ? 'on' : '',
        text: label,
        onclick: (e) => {
          onpick(key);
          for (const sib of e.target.parentElement.children) sib.classList.toggle('on', sib === e.target);
        },
      })));
  }

  function holePicker(current, onpick) {
    const sel = el('select');
    for (const h of holesOf()) {
      sel.append(el('option', { value: String(h.id), text: `${h.name} · par ${holePar(h)}` }));
    }
    if (current) sel.value = String(current);
    sel.onchange = () => onpick(Number(sel.value));
    return sel;
  }

  function renderToolPanel() {
    const p = ui.toolPanel;
    p.replaceChildren();
    const head = (t) => p.append(el('div', { class: 'ced-panel-head', text: t }));
    switch (tool) {
      case 'select': {
        head('Select');
        if (!selected) {
          p.append(el('div', { class: 'ced-note', text: 'Click a tree, rock, or prop on the course.' }));
          break;
        }
        const entry = OBJECT_CATALOG.find((o) => o.type === selected.type);
        p.append(el('div', { class: 'ced-note', text: `${entry ? entry.name : selected.type}` }));
        p.append(slider('Rotate', Math.round(((selected.rot || 0) * 180) / Math.PI) % 360, 0, 359, 1, (v) => {
          moveObject(state(), session, selected.id, { rot: (v * Math.PI) / 180 });
          scene().rebuildObjects();
          scene().rebuildTrees();
          refreshTop();
        }, (v) => `${v}°`));
        p.append(slider('Scale', Math.round((selected.scale || 1) * 100), 55, 165, 5, (v) => {
          moveObject(state(), session, selected.id, { scale: v / 100 });
          scene().rebuildObjects();
          scene().rebuildTrees();
          refreshTop();
        }, (v) => `${v}%`));
        p.append(el('div', { class: 'ced-row' },
          el('button', {
            text: 'Duplicate',
            onclick: () => {
              const res = duplicateObject(state(), session, selected.id);
              if (res.ok) {
                refreshObjects();
                toast('Copied — drag it into place.');
                setSelected(res.object);
              }
            },
          }),
          el('button', {
            class: 'danger',
            text: 'Remove',
            onclick: () => {
              removeObject(state(), session, selected.id);
              setSelected(null);
              refreshObjects();
            },
          }),
        ));
        break;
      }
      case 'terrain': {
        head('Terrain');
        p.append(segButtons([['raise', '▲ Raise'], ['lower', '▼ Lower'], ['smooth', '≈ Smooth'], ['flatten', '▭ Flatten']], opt.terrain.mode, (k) => { opt.terrain.mode = k; }));
        p.append(slider('Size', opt.terrain.radiusYd, 8, 60, 2, (v) => { opt.terrain.radiusYd = v; }, (v) => `${v} yd`));
        p.append(slider('Strength', opt.terrain.strength, 10, 100, 5, (v) => { opt.terrain.strength = v; }, (v) => `${v}%`));
        p.append(el('label', { class: 'ced-check' },
          el('input', {
            type: 'checkbox', ...(opt.terrain.autoSmooth ? { checked: '' } : {}),
            onchange: (e) => { opt.terrain.autoSmooth = e.target.checked; },
          }),
          el('span', { text: 'Auto smooth' }),
        ));
        break;
      }
      case 'paint': {
        head('Paint');
        const grid = el('div', { class: 'ced-swatches' });
        for (const s of PAINT_SURFACES) {
          const b = el('button', {
            class: opt.paint.zone === s.zone ? 'on' : '',
            title: `${formatMoney(zoneCost(s.zone))} per cell`,
            onclick: (e) => {
              opt.paint.zone = s.zone;
              for (const sib of grid.children) sib.classList.toggle('on', sib === e.currentTarget);
            },
          }, el('span', { class: 'sw', style: `background:${zoneColor(s.zone)}` }), el('span', { text: s.label }));
          grid.append(b);
        }
        p.append(grid);
        p.append(slider('Size', opt.paint.radiusYd, 8, 48, 2, (v) => { opt.paint.radiusYd = v; }, (v) => `${v} yd`));
        break;
      }
      case 'tee': {
        head('Tee boxes');
        if (opt.tee.holeId === null) opt.tee.holeId = holesOf()[0] && holesOf()[0].id;
        p.append(el('div', { class: 'ced-row' }, el('label', { text: 'Hole' }), holePicker(opt.tee.holeId, (id) => { opt.tee.holeId = id; renderToolPanel(); })));
        p.append(segButtons([['back', 'Back'], ['middle', 'Middle'], ['forward', 'Forward']], opt.tee.teeKey, (k) => { opt.tee.teeKey = k; }));
        const hole = holesOf().find((h) => h.id === opt.tee.holeId);
        if (hole) {
          const rows = el('div', { class: 'ced-note' });
          for (const key of ['back', 'middle', 'forward']) {
            const t = hole.tees[key];
            const yd = t && hole.pin ? Math.round(Math.hypot(hole.pin.x - t.x, hole.pin.y - t.y) * 8) : null;
            rows.append(el('div', { text: `${key}: ${t ? `${yd} yd to pin` : 'not built'}${hole.activeTee === key ? ' · playing' : ''}` }));
          }
          p.append(rows);
          p.append(el('div', { class: 'ced-row' },
            el('button', {
              text: 'Play this tee',
              onclick: () => {
                const res = selectTee(state(), session, hole.id, opt.tee.teeKey);
                if (!res.ok) toast(res.reason, 'warn');
                else {
                  scene().updateHoles();
                  scene().rebuildFlowField();
                  scene().updateTurf(state());
                  renderToolPanel();
                }
              },
            }),
          ));
        }
        break;
      }
      case 'green': {
        head('Green');
        p.append(segButtons([['round', 'Round'], ['oval', 'Oval'], ['kidney', 'Kidney']], opt.green.shape, (k) => { opt.green.shape = k; }));
        p.append(slider('Size', opt.green.sizeYd, 18, 44, 1, (v) => { opt.green.sizeYd = v; }, (v) => `${v} yd`));
        p.append(slider('Rotate', opt.green.rot, 0, 179, 1, (v) => { opt.green.rot = v; }, (v) => `${v}°`));
        head('Pin position');
        p.append(segButtons([['none', 'Off'], ['A', 'A'], ['B', 'B'], ['C', 'C']], opt.green.pin || 'none', (k) => { opt.green.pin = k === 'none' ? null : k; }));
        p.append(el('div', { class: 'ced-note', text: 'With a pin letter armed, clicking a green sets that pin.' }));
        break;
      }
      case 'bunker': {
        head('Bunker');
        p.append(segButtons([['round', 'Round'], ['oval', 'Oval'], ['kidney', 'Kidney']], opt.bunker.shape, (k) => { opt.bunker.shape = k; }));
        p.append(slider('Size', opt.bunker.sizeYd, 8, 26, 1, (v) => { opt.bunker.sizeYd = v; }, (v) => `${v} yd`));
        p.append(slider('Depth', opt.bunker.depth * 10, 6, 30, 2, (v) => { opt.bunker.depth = v / 10; }, (v) => `${(v / 10).toFixed(1)} ft`));
        break;
      }
      case 'water': {
        head('Water');
        p.append(segButtons([['pond', 'Pond'], ['lake', 'Lake'], ['stream', 'Stream']], opt.water.shape, (k) => { opt.water.shape = k; drawingPath = null; }));
        p.append(slider('Size', opt.water.sizeYd, 20, 64, 2, (v) => { opt.water.sizeYd = v; }, (v) => `${v} yd`));
        p.append(slider('Depth', opt.water.depth * 10, 10, 40, 2, (v) => { opt.water.depth = v / 10; }, (v) => `${(v / 10).toFixed(1)} ft`));
        break;
      }
      case 'objects': {
        head('Objects');
        const cats = [['tree', 'Trees'], ['shrub', 'Shrubs'], ['rock', 'Rocks'], ['prop', 'Props'], ['decor', 'Decor']];
        p.append(segButtons(cats, opt.objects.cat, (k) => {
          opt.objects.cat = k;
          const first = OBJECT_CATALOG.find((o) => o.cat === k);
          if (first) opt.objects.type = first.type;
          renderToolPanel();
        }));
        const grid = el('div', { class: 'ced-objgrid' });
        for (const o of OBJECT_CATALOG.filter((o) => o.cat === opt.objects.cat)) {
          grid.append(el('button', {
            class: opt.objects.type === o.type ? 'on' : '',
            title: `${o.name} — ${formatMoney(objectCostOf(o.type))}`,
            onclick: (e) => {
              opt.objects.type = o.type;
              for (const sib of grid.children) sib.classList.toggle('on', sib === e.currentTarget);
            },
          }, svgIcon(OBJ_ICON[o.cat] || 'decor'), el('span', { text: o.name })));
        }
        p.append(grid);
        p.append(slider('Size', Math.round(opt.objects.scale * 100), 60, 160, 5, (v) => { opt.objects.scale = v / 100; }, (v) => `${v}%`));
        p.append(el('label', { class: 'ced-check' },
          el('input', {
            type: 'checkbox', ...(opt.objects.randomRot ? { checked: '' } : {}),
            onchange: (e) => { opt.objects.randomRot = e.target.checked; },
          }),
          el('span', { text: 'Random rotation' }),
        ));
        p.append(el('label', { class: 'ced-check' },
          el('input', {
            type: 'checkbox', ...(opt.objects.assist ? { checked: '' } : {}),
            onchange: (e) => { opt.objects.assist = e.target.checked; hint(e.target.checked ? 'Fill area: click the middle of the area to scatter' : HINTS.objects); },
          }),
          el('span', { text: 'Fill area (scatter)' }),
        ));
        if (opt.objects.assist) {
          p.append(slider('Count', opt.objects.assistCount, 3, 24, 1, (v) => { opt.objects.assistCount = v; }));
        }
        break;
      }
      case 'paths': {
        head('Paths');
        p.append(slider('Width', opt.paths.width * 10, 16, 60, 2, (v) => { opt.paths.width = v / 10; }, (v) => `${(v / 10).toFixed(1)} yd`));
        const sel = el('select');
        for (const m of ['asphalt', 'concrete', 'gravel', 'dirt']) sel.append(el('option', { value: m, text: m[0].toUpperCase() + m.slice(1) }));
        sel.value = opt.paths.material;
        sel.onchange = () => { opt.paths.material = sel.value; };
        p.append(el('div', { class: 'ced-row' }, el('label', { text: 'Material' }), sel));
        const list = el('div', { class: 'ced-note' });
        for (const path of state().course.paths) {
          list.append(el('div', { class: 'ced-pathrow' },
            el('span', { text: `Path ${path.id} · ${path.material} · ${path.pts.length} pts` }),
            el('button', {
              text: '✕',
              title: 'Remove this path',
              onclick: () => {
                removePath(state(), session, path.id);
                scene().rebuildPaths();
                scene().updateTurf(state());
                refreshTop();
                renderToolPanel();
              },
            }),
          ));
        }
        p.append(list);
        break;
      }
      case 'measure': {
        head('Measure');
        p.append(el('div', { class: 'ced-note', text: 'Click two points to measure. Extra clicks extend the chain.' }));
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------- stats ----

  function toggleStats() {
    ui.statsPanel.style.display = ui.statsPanel.style.display === 'none' ? '' : 'none';
    if (ui.statsPanel.style.display !== 'none') renderStats();
  }

  function renderStats() {
    const s = courseStats(state(), session);
    const row = (k, v) => el('div', { class: 'ced-stat-row' }, el('span', { text: k }), el('b', { text: String(v) }));
    ui.statsPanel.replaceChildren(
      el('div', { class: 'ced-panel-head', text: 'Course statistics' }),
      row('Holes', `${s.openHoles} open / ${s.holes}`),
      row('Par', s.totalPar),
      row('Yardage', `${s.totalYd.toLocaleString('en-US')} yd`),
      row('Difficulty', '★'.repeat(s.difficulty) + '☆'.repeat(5 - s.difficulty)),
      row('Pending works', formatMoney(s.pendingCost)),
      el('details', { class: 'ced-adv' },
        el('summary', { text: 'Acreage & inventory' }),
        row('Fairway', `${s.fairwayAcres} ac`),
        row('Greens', `${s.greenAcres} ac`),
        row('Rough', `${s.roughAcres} ac`),
        row('Bunkers', `${s.bunkerAcres} ac`),
        row('Water', `${s.waterAcres} ac`),
        row('Cart paths', `${s.pathAcres} ac`),
        row('Trees', s.treeCount),
        row('Placed objects', s.objectCount),
      ),
    );
  }

  // ------------------------------------------------------ hole dialogs ----

  let modalEl = null;
  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }
  function openModal(...kids) {
    closeModal();
    modalEl = el('div', {
      class: 'ced-modal-veil',
      onclick: (e) => { if (e.target === modalEl) closeModal(); },
    }, el('div', { class: 'ced-modal' }, ...kids));
    root.append(modalEl);
  }

  // full-course thumbnail (save panel): every zone, whole property
  function courseThumbCanvas(w = 216, h = 148) {
    const c = state().course;
    const cnv = el('canvas', { width: String(w), height: String(h), class: 'ced-mini' });
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = '#15251a';
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w / c.w, h / c.h);
    const ox = (w - c.w * s) / 2;
    const oy = (h - c.h * s) / 2;
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const z = c.zones[y * c.w + x];
        if (z === ZONE.OUT) continue;
        ctx.fillStyle = zoneColor(z);
        ctx.fillRect(ox + x * s, oy + y * s, Math.ceil(s), Math.ceil(s));
      }
    }
    return cnv;
  }

  // mini overhead layout of one hole (canvas): local zone window around the corridor
  function holeMiniCanvas(hole, w = 92, h = 128) {
    const c = state().course;
    const cnv = el('canvas', { width: String(w), height: String(h), class: 'ced-mini' });
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = '#1d2a18';
    ctx.fillRect(0, 0, w, h);
    if (!hole.tee || !hole.pin) {
      ctx.fillStyle = '#7c8a74';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('unbuilt', w / 2, h / 2);
      return cnv;
    }
    const pts = [hole.tee, ...(hole.wp || []), hole.pin];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    minX -= 6; maxX += 6; minY -= 6; maxY += 6;
    const sx = w / (maxX - minX);
    const sy = h / (maxY - minY);
    const s = Math.min(sx, sy);
    const ox = (w - (maxX - minX) * s) / 2;
    const oy = (h - (maxY - minY) * s) / 2;
    for (let y = Math.max(0, Math.floor(minY)); y < Math.min(c.h, Math.ceil(maxY)); y++) {
      for (let x = Math.max(0, Math.floor(minX)); x < Math.min(c.w, Math.ceil(maxX)); x++) {
        const z = c.zones[y * c.w + x];
        if (z === ZONE.OUT) continue;
        ctx.fillStyle = zoneColor(z);
        ctx.fillRect(ox + (x - minX) * s, oy + (y - minY) * s, Math.ceil(s), Math.ceil(s));
      }
    }
    // tee + pin dots
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ox + (hole.tee.x - minX) * s, oy + (hole.tee.y - minY) * s, 2.5, 0, 7);
    ctx.fill();
    ctx.fillStyle = '#ffdd66';
    ctx.beginPath();
    ctx.arc(ox + (hole.pin.x - minX) * s, oy + (hole.pin.y - minY) * s, 2.5, 0, 7);
    ctx.fill();
    return cnv;
  }

  function openHoleSelect() {
    const holes = holesOf();
    const grid = el('div', { class: 'ced-holegrid' });
    let picked = selectedHole() || holes[0] || null;
    const foot = el('div', { class: 'ced-holefoot' });
    const renderFoot = () => {
      foot.replaceChildren();
      if (!picked) return;
      const yd = Math.round(holeDistanceYd(picked));
      foot.append(
        el('div', {},
          el('b', { text: `${picked.name}` }),
          el('span', { class: 'ced-note', text: `  Par ${holePar(picked)} · ${yd} yd · ${picked.status}` }),
        ),
        el('div', {},
          el('button', {
            title: 'Fly the hole from tee to green',
            onclick: () => {
              closeModal();
              selectHole(picked, { frame: false });
              startFlyover(picked);
            },
          }, svgIcon('play'), el('span', { text: 'Flyover' })),
          el('button', {
            onclick: () => {
              selectHole(picked);
              closeModal();
            },
          }, svgIcon('frame'), el('span', { text: 'Frame it' })),
          el('button', {
            class: 'primary',
            text: 'Edit Hole',
            onclick: () => {
              closeModal();
              selectHole(picked);
              openHoleSettings(picked);
            },
          }),
        ),
      );
    };
    holes.forEach((h) => {
      const n = holeNumber(state().course, h.id);
      const card = el('button', { class: 'ced-holecard', onclick: () => { picked = h; renderFoot(); for (const sib of grid.children) sib.classList.toggle('on', sib === card); } },
        el('div', { class: 'ced-holenum', text: String(n) }),
        holeMiniCanvas(h),
        el('div', { class: 'ced-holemeta', text: h.tee && h.pin ? `Par ${holePar(h)} · ${Math.round(holeDistanceYd(h))} yd` : 'unbuilt' }),
      );
      if (h === picked) card.classList.add('on');
      grid.append(card);
    });
    // add-hole card
    grid.append(el('button', {
      class: 'ced-holecard add',
      onclick: () => {
        const res = newHole(state(), session);
        if (res.ok) {
          toast(`Hole ${state().course.holes.length} surveyed (${formatMoney(res.cost)} pending) — paint its fairway, green and tee.`);
          refreshTop();
          closeModal();
          openHoleSelect();
        }
      },
    }, el('div', { class: 'ced-holenum', text: '+' }), el('div', { class: 'ced-holemeta', text: 'Add hole' })));

    const par = holes.reduce((a, h) => a + (h.tee && h.pin ? holePar(h) : 0), 0);
    const yds = Math.round(holes.reduce((a, h) => a + holeDistanceYd(h), 0));
    openModal(
      el('div', { class: 'ced-modal-head' },
        el('b', { text: 'Select a Hole to Edit' }),
        el('span', { class: 'ced-note', text: `Par ${par} · ${yds.toLocaleString('en-US')} yards` }),
        el('button', { text: '✕', class: 'ced-x', onclick: closeModal }),
      ),
      grid,
      foot,
    );
    renderFoot();
  }

  function openHoleSettings(hole) {
    ensureHoleShape(hole, holeNumber(state().course, hole.id));
    const name = el('input', { type: 'text', value: hole.name, maxlength: '28' });
    const parAuto = holePar({ ...hole, parOverride: null });
    let parOv = hole.parOverride;
    const parLabel = el('b', { text: String(parOv ?? parAuto) });
    const handicap = el('input', { type: 'number', min: '1', max: '18', value: String(hole.handicap) });
    const yd = Math.round(holeDistanceYd(hole));

    const pinSeg = segButtons([['A', 'A'], ['B', 'B'], ['C', 'C']], hole.activePin, (k) => {
      const res = selectPin(state(), session, hole.id, k);
      if (!res.ok) toast(res.reason, 'warn');
      else {
        scene().updateHoles();
        refreshTop();
      }
    });
    const teeSeg = segButtons([['back', 'Back'], ['middle', 'Middle'], ['forward', 'Fwd']], hole.activeTee, (k) => {
      const res = selectTee(state(), session, hole.id, k);
      if (!res.ok) toast(res.reason, 'warn');
      else {
        scene().updateHoles();
        refreshTop();
      }
    });

    openModal(
      el('div', { class: 'ced-modal-head' },
        el('b', { text: `${hole.name} — settings` }),
        el('button', { text: '✕', class: 'ced-x', onclick: closeModal }),
      ),
      el('div', { class: 'ced-settings' },
        el('div', { class: 'ced-set-col' },
          el('div', { class: 'ced-row' }, el('label', { text: 'Hole name' }), name),
          el('div', { class: 'ced-row' }, el('label', { text: 'Par' }),
            el('button', {
              text: '−',
              onclick: () => { parOv = clamp((parOv ?? parAuto) - 1, 3, 5); parLabel.textContent = String(parOv); },
            }),
            parLabel,
            el('button', {
              text: '+',
              onclick: () => { parOv = clamp((parOv ?? parAuto) + 1, 3, 5); parLabel.textContent = String(parOv); },
            }),
            el('button', {
              text: 'Auto',
              title: `Distance says par ${parAuto}`,
              onclick: () => { parOv = null; parLabel.textContent = String(parAuto); },
            }),
          ),
          el('div', { class: 'ced-row' }, el('label', { text: 'Yardage' }), el('b', { text: `${yd} yd` }), el('span', { class: 'ced-note', text: '(tee → pin)' })),
          el('div', { class: 'ced-row' }, el('label', { text: 'Handicap' }), handicap),
          el('div', { class: 'ced-row' }, el('label', { text: 'Tee box' }), teeSeg),
          el('div', { class: 'ced-row' }, el('label', { text: 'Pin position' }), pinSeg),
          el('div', { class: 'ced-row' },
            el('button', { text: '↑ Earlier', onclick: () => { reorderHole(state(), session, hole.id, -1); refreshTop(); } }),
            el('button', { text: '↓ Later', onclick: () => { reorderHole(state(), session, hole.id, +1); refreshTop(); } }),
          ),
        ),
        el('div', { class: 'ced-set-col' }, holeMiniCanvas(hole, 150, 210)),
      ),
      el('div', { class: 'ced-modal-foot' },
        el('button', {
          class: 'danger',
          text: 'Delete hole',
          onclick: () => {
            openModal(
              el('div', { class: 'ced-modal-head' }, el('b', { text: `Delete ${hole.name}?` })),
              el('div', { class: 'ced-note', text: 'The land stays as painted; the hole (tee/pin/score card) is removed. Undo can bring it back before you build.' }),
              el('div', { class: 'ced-modal-foot' },
                el('button', { text: 'Keep it', onclick: () => { closeModal(); openHoleSettings(hole); } }),
                el('button', {
                  class: 'danger',
                  text: 'Delete',
                  onclick: () => {
                    deleteHole(state(), session, hole.id);
                    scene().updateHoles();
                    refreshTop();
                    closeModal();
                    toast(`${hole.name} deleted.`);
                  },
                }),
              ),
            );
          },
        }),
        el('button', {
          text: 'Duplicate settings',
          title: 'Creates a new unbuilt hole with these settings — paint its ground, then place tee and pin',
          onclick: () => {
            const res = newHole(state(), session);
            if (res.ok) {
              setHoleSettings(state(), session, res.hole.id, { name: `${name.value} II`, handicap: Number(handicap.value) || hole.handicap });
              toast('New hole added with these settings — it needs its own tee, fairway and green.');
              refreshTop();
            }
          },
        }),
        el('button', { text: 'Cancel', onclick: closeModal }),
        el('button', {
          class: 'primary',
          text: 'Apply',
          onclick: () => {
            setHoleSettings(state(), session, hole.id, {
              name: name.value.trim() || hole.name,
              handicap: clamp(Number(handicap.value) || hole.handicap, 1, 18),
              parOverride: parOv,
            });
            scene().updateHoles();
            refreshTop();
            closeModal();
          },
        }),
      ),
    );
  }

  // ------------------------------------------------------------ save ----

  let lastSavedText = null;

  function openSaveDialog() {
    const bill = session ? Math.round(session.bill) : 0;
    const nameInput = el('input', { type: 'text', value: state().clubName, maxlength: '40' });
    openModal(
      el('div', { class: 'ced-modal-head' },
        el('b', { text: 'Save course' }),
        el('button', { text: '✕', class: 'ced-x', onclick: closeModal }),
      ),
      el('div', { class: 'ced-save-body' },
        el('div', { class: 'ced-save-fields' },
          el('div', { class: 'ced-row' }, el('label', { text: 'Course name' }), nameInput),
          bill > 0
            ? el('div', { class: 'ced-note warn', text: `Unbuilt works worth ${formatMoney(bill)} are pending — Build applies and pays for them first.` })
            : el('div', { class: 'ced-note', text: 'The course is settled — saving stores it to the autosave.' }),
          el('div', { class: 'ced-note', text: lastSavedText ? `Last saved: ${lastSavedText}` : 'Not saved from the editor yet this visit.' }),
        ),
        el('div', { class: 'ced-save-thumbwrap' },
          courseThumbCanvas(),
          el('div', { class: 'ced-holemeta', text: `${state().clubName}` }),
        ),
      ),
      el('div', { class: 'ced-modal-foot' },
        el('button', {
          text: 'Export JSON',
          title: 'Download the raw course data as a backup',
          onclick: () => {
            const c = state().course;
            const data = {
              clubName: state().clubName,
              w: c.w,
              h: c.h,
              zones: Array.from(c.zones),
              elevation: Array.from(c.elevation),
              holes: c.holes,
              objects: c.objects,
              paths: c.paths,
              structures: c.structures,
            };
            const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${state().clubName.replace(/\W+/g, '_').toLowerCase()}_course.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            toast('Course data exported.');
          },
        }),
        el('button', { text: 'Cancel', onclick: closeModal }),
        el('button', {
          class: 'primary',
          text: bill > 0 ? 'Build & save' : 'Save',
          onclick: () => {
            if (nameInput.value.trim()) state().clubName = nameInput.value.trim();
            if (bill > 0) {
              if (!doApply()) return;
            }
            hooks.autosave();
            lastSavedText = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            toast('Course saved.');
            closeModal();
            refreshTop();
          },
        }),
      ),
    );
  }

  // ------------------------------------------------------- apply flow ----

  function doApply() {
    const res = applySession(state(), session);
    if (!res.ok) {
      toast(res.reason, 'warn');
      return false;
    }
    hooks.afterApply();
    const closed = res.report.holesAffected.length;
    toast(`Works complete — ${formatMoney(res.report.cost)}${closed ? ` · ${closed} hole${closed > 1 ? 's' : ''} closed for renovation` : ''}.`);
    refreshTop();
    renderToolPanel();
    return true;
  }

  function doDiscard() {
    openModal(
      el('div', { class: 'ced-modal-head' }, el('b', { text: 'Discard all pending works?' })),
      el('div', { class: 'ced-note', text: 'Every unbuilt change since your last Build will be rolled back. Nothing already built is touched.' }),
      el('div', { class: 'ced-modal-foot' },
        el('button', { text: 'Keep editing', onclick: closeModal }),
        el('button', {
          class: 'danger',
          text: 'Discard',
          onclick: () => {
            discardSession(state(), session);
            fullRefresh();
            closeModal();
            toast('Pending works discarded.');
          },
        }),
      ),
    );
  }

  function doUndo() {
    const res = undo(state(), session);
    if (res.ok) {
      fullRefresh();
      toast(`Undid: ${res.label}`);
    }
  }

  function doRedo() {
    const res = redo(state(), session);
    if (res.ok) {
      fullRefresh();
      toast(`Redid: ${res.label}`);
    }
  }

  function refreshObjects() {
    scene().rebuildObjects();
    scene().rebuildTrees();
    refreshTop();
  }

  function fullRefresh() {
    scene().refreshGround(state(), { water: true, objects: true, paths: true, holes: true, flow: true });
    refreshTop();
    renderToolPanel();
  }

  function requestExit() {
    if (session && sessionDirty(session)) {
      const bill = Math.round(session.bill);
      openModal(
        el('div', { class: 'ced-modal-head' }, el('b', { text: 'Leave the editor?' })),
        el('div', { class: 'ced-note', text: bill > 0 ? `Pending works worth ${formatMoney(bill)} are not built yet.` : 'There are unapplied edits.' }),
        el('div', { class: 'ced-modal-foot' },
          el('button', { text: 'Stay', onclick: closeModal }),
          el('button', {
            class: 'danger',
            text: 'Discard & leave',
            onclick: () => {
              discardSession(state(), session);
              fullRefresh();
              closeModal();
              hooks.onExit();
            },
          }),
          el('button', {
            class: 'primary',
            text: 'Build & leave',
            onclick: () => {
              if (doApply()) {
                closeModal();
                hooks.onExit();
              }
            },
          }),
        ),
      );
      return;
    }
    hooks.onExit();
  }

  // ------------------------------------------------------ pointer input ----

  function groundAt(e) {
    return scene() ? scene().raycastGround(e.clientX, e.clientY) : null;
  }

  function yd2cells(yd) {
    return Math.max(0.5, yd / 8 / 2); // diameter yd → radius cells
  }

  function liveRefreshThrottled() {
    const now = performance.now();
    if (now - strokeClock > 80) {
      strokeClock = now;
      scene().refreshGround(state(), {});
    }
  }

  function onPointerDown(e) {
    if (!active || pt) return;
    if (flyover) {
      stopFlyover();
      return;
    }
    if (modalEl) return;
    if (e.target !== scene().renderer.domElement) return;
    const g = groundAt(e);
    if (e.button === 1) {
      camDrag = { mode: 'pan', x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      // paint's right button IS the eraser (drag to erase) — everywhere else,
      // right button is contextual action on CLICK, camera orbit on DRAG
      if (tool === 'paint' && g && g.inBounds) {
        stroke = { s: beginPaintStroke(), erase: true };
        applyPaintAt(g, true);
        return;
      }
      camDrag = { mode: 'maybe-orbit', x: e.clientX, y: e.clientY, moved: 0 };
      return;
    }
    if (e.button !== 0) return;
    if (!g || !g.inBounds) {
      if (tool === 'select') setSelected(null);
      return;
    }
    switch (tool) {
      case 'select': {
        const obj = scene().pickObject(g.point.x, g.point.z, 3.5);
        setSelected(obj);
        if (obj) draggingObj = true;
        break;
      }
      case 'terrain': {
        stroke = beginTerrainStroke(state(), session);
        applyTerrainAt(g);
        break;
      }
      case 'paint': {
        stroke = { s: beginPaintStroke(), erase: false };
        applyPaintAt(g, false);
        break;
      }
      case 'tee': {
        const hole = holesOf().find((h) => h.id === opt.tee.holeId);
        if (!hole) {
          toast('Pick a hole first.', 'warn');
          break;
        }
        const aim = hole.pin || { x: g.fx + 4, y: g.fy };
        const res = stampTee(state(), session, hole.id, opt.tee.teeKey, g.fx, g.fy, aim.x, aim.y);
        if (!res.ok) toast(res.reason || 'Cannot build here.', 'warn');
        else {
          scene().refreshGround(state(), { holes: true, flow: true });
          refreshTop();
          renderToolPanel();
          toast(`${opt.tee.teeKey[0].toUpperCase()}${opt.tee.teeKey.slice(1)} tee built (${formatMoney(res.cost)} pending).`);
        }
        break;
      }
      case 'green': {
        if (opt.green.pin) {
          const hole = nearestHoleTo(g.x, g.y) || holesOf()[0];
          const res = setPinPosition(state(), session, hole.id, opt.green.pin, g.x, g.y);
          if (!res.ok) toast(res.reason, 'warn');
          else {
            scene().updateHoles();
            refreshTop();
            toast(`Pin ${opt.green.pin} set for ${hole.name}.`);
          }
          break;
        }
        const r = yd2cells(opt.green.sizeYd);
        const res = stampGreen(state(), session, g.fx, g.fy, {
          r,
          elong: opt.green.shape === 'round' ? 1.02 : 1.35,
          angle: (opt.green.rot * Math.PI) / 180,
          kidney: opt.green.shape === 'kidney',
        });
        if (res.ok) {
          scene().refreshGround(state(), { zoneRect: zr(g.fx, g.fy, r * 1.6 + 2) });
          refreshTop();
        }
        break;
      }
      case 'bunker': {
        const res = stampBunker(state(), session, g.fx, g.fy, {
          r: yd2cells(opt.bunker.sizeYd),
          depth: opt.bunker.depth,
          lobes: opt.bunker.shape === 'round' ? 1 : opt.bunker.shape === 'oval' ? 2 : 3,
          angle: Math.random() * Math.PI,
        });
        if (res.ok) {
          scene().refreshGround(state(), { zoneRect: zr(g.fx, g.fy, yd2cells(opt.bunker.sizeYd) * 2 + 2) });
          refreshTop();
        } else {
          toast('No sand here — bunkers dig into grass.', 'warn');
        }
        break;
      }
      case 'water': {
        if (opt.water.shape === 'stream') {
          if (!drawingPath) drawingPath = [];
          drawingPath.push({ x: g.fx, y: g.fy });
          drawMeasurePreview(drawingPath, 'stream');
          break;
        }
        const res = stampWater(state(), session, g.fx, g.fy, {
          r: yd2cells(opt.water.sizeYd) * (opt.water.shape === 'lake' ? 1.6 : 1),
          depth: opt.water.depth,
          elong: opt.water.shape === 'lake' ? 1.4 : 1.15,
          angle: Math.random() * Math.PI,
        });
        if (res.ok) {
          scene().refreshGround(state(), { water: true, zoneRect: zr(g.fx, g.fy, yd2cells(opt.water.sizeYd) * 2.2 + 2) });
          refreshTop();
        } else {
          toast('The water needs open ground.', 'warn');
        }
        break;
      }
      case 'objects': {
        if (opt.objects.assist) {
          const types = OBJECT_CATALOG.filter((o) => o.cat === opt.objects.cat).map((o) => o.type);
          const res = scatterObjects(state(), session, types, g.fx, g.fy, {
            radius: 4.5, count: opt.objects.assistCount,
          });
          if (!res.ok) toast(res.reason, 'warn');
          else {
            refreshObjects();
            toast(`${res.count} planted (${formatMoney(res.cost)} pending).`);
          }
          break;
        }
        const rot = opt.objects.randomRot ? Math.random() * Math.PI * 2 : 0;
        const res = addObject(state(), session, opt.objects.type, g.fx, g.fy, { rot, scale: opt.objects.scale });
        if (!res.ok) toast(res.reason, 'warn');
        else refreshObjects();
        break;
      }
      case 'paths': {
        // drag an existing point if one is close, else add to the new path
        const near = nearestPathPoint(g.fx, g.fy, 1.6);
        if (near && !drawingPath) {
          draggingObj = near; // reuse the drag slot for a path point
          break;
        }
        if (!drawingPath) drawingPath = [];
        drawingPath.push({ x: g.fx, y: g.fy });
        drawMeasurePreview(drawingPath, 'path');
        break;
      }
      case 'measure': {
        measurePts.push({ x: g.point.x, z: g.point.z, fx: g.fx, fy: g.fy });
        updateMeasure();
        break;
      }
      default:
        break;
    }
  }

  function nearestHoleTo(cx, cy) {
    let best = null;
    let bestD = Infinity;
    for (const h of holesOf()) {
      if (!h.pin) continue;
      const d = Math.hypot(h.pin.x - cx, h.pin.y - cy);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  function nearestPathPoint(fx, fy, maxD) {
    for (const p of state().course.paths) {
      for (let i = 0; i < p.pts.length; i++) {
        if (Math.hypot(p.pts[i].x - fx, p.pts[i].y - fy) <= maxD) {
          return { pathId: p.id, index: i, kind: 'path-point' };
        }
      }
    }
    return null;
  }

  function applyTerrainAt(g) {
    const radius = yd2cells(opt.terrain.radiusYd * 2);
    const strength = (opt.terrain.strength / 100) * (opt.terrain.mode === 'smooth' ? 0.8 : 0.55);
    sculptAt(state(), stroke, g.fx, g.fy, {
      mode: opt.terrain.mode, radius, strength,
    });
    if (opt.terrain.autoSmooth && opt.terrain.mode !== 'smooth' && opt.terrain.mode !== 'flatten') {
      sculptAt(state(), stroke, g.fx, g.fy, { mode: 'smooth', radius: radius * 1.15, strength: 0.24 });
    }
    liveRefreshThrottled();
  }

  function applyPaintAt(g, erase) {
    const r = yd2cells(opt.paint.radiusYd * 2);
    paintAt(state(), stroke.s, g.fx, g.fy, erase ? ZONE.ROUGH : opt.paint.zone, { radius: r });
    stroke.erase = erase;
    // grow the stroke's dirty rect (cells) for visual-field updates
    stroke.rect = stroke.rect || { x0: g.fx - r, y0: g.fy - r, x1: g.fx + r, y1: g.fy + r };
    stroke.rect.x0 = Math.min(stroke.rect.x0, g.fx - r);
    stroke.rect.y0 = Math.min(stroke.rect.y0, g.fy - r);
    stroke.rect.x1 = Math.max(stroke.rect.x1, g.fx + r);
    stroke.rect.y1 = Math.max(stroke.rect.y1, g.fy + r);
    const now = performance.now();
    if (now - strokeClock > 70) {
      strokeClock = now;
      scene().updateZoneField(state(), stroke.rect);
      scene().updateTurf(state());
    }
  }

  function onPointerMove(e) {
    if (!active || pt) return;
    if (camDrag) {
      const dx = e.clientX - camDrag.x;
      const dy = e.clientY - camDrag.y;
      if (camDrag.mode === 'maybe-orbit') {
        camDrag.moved = (camDrag.moved || 0) + Math.abs(dx) + Math.abs(dy);
        if (camDrag.moved > 5) camDrag.mode = 'orbit';
      }
      if (camDrag.mode === 'orbit') scene().rig.orbit(-dx * 0.0052, dy * 0.0038);
      else if (camDrag.mode === 'pan') scene().rig.pan(dx, dy, window.innerHeight);
      camDrag.x = e.clientX;
      camDrag.y = e.clientY;
      return;
    }
    const g = groundAt(e);
    hover = g;
    updateHoverVisuals(g, e);
    if (!g) return;
    if (stroke && tool === 'terrain' && (e.buttons & 1)) applyTerrainAt(g);
    else if (stroke && tool === 'paint' && (e.buttons & 3)) applyPaintAt(g, !!(e.buttons & 2));
    else if (draggingObj === true && selected && (e.buttons & 1) && g.inBounds) {
      moveObject(state(), session, selected.id, { x: g.fx, y: g.fy });
      refreshObjects();
    } else if (draggingObj && draggingObj.kind === 'path-point' && (e.buttons & 1) && g.inBounds) {
      const path = state().course.paths.find((p) => p.id === draggingObj.pathId);
      if (path) {
        // live preview only — commit on release for one undo step
        path.pts[draggingObj.index] = { x: g.fx, y: g.fy };
        scene().rebuildPaths();
        draggingObj.movedTo = { x: g.fx, y: g.fy };
      }
    }
  }

  function updateHoverVisuals(g, e) {
    const sc = scene();
    if (!g || !g.inBounds) {
      sc.setEditorBrush(null);
      sc.setPlacementGhost(null);
      return;
    }
    const brushTools = { terrain: opt.terrain.radiusYd, paint: opt.paint.radiusYd, green: opt.green.sizeYd, bunker: opt.bunker.sizeYd, water: opt.water.sizeYd };
    if (tool in brushTools) {
      sc.setPlacementGhost(null);
      sc.setEditorBrush({
        x: g.point.x,
        z: g.point.z,
        radiusYd: brushTools[tool] / (tool === 'terrain' || tool === 'paint' ? 1 : 2),
        color: tool === 'water' ? 0x9fd4ff : tool === 'bunker' ? 0xf2dfae : 0xffffff,
      });
    } else if (tool === 'objects' && !opt.objects.assist) {
      sc.setEditorBrush(null);
      const legal = objectPlacementOk(state().course, opt.objects.type, g.fx, g.fy);
      sc.setPlacementGhost(opt.objects.type, g.point.x, g.point.z, {
        rot: 0, scale: opt.objects.scale, valid: legal.ok,
      });
    } else if (tool === 'objects') {
      sc.setPlacementGhost(null);
      sc.setEditorBrush({ x: g.point.x, z: g.point.z, radiusYd: 4.5 * 8, color: 0xb7e39a });
    } else if (tool === 'select' && selected) {
      sc.setEditorBrush({ x: sc.worldX(selected.x), z: sc.worldZ(selected.y), radiusYd: 3, color: 0xffe9a0 });
      sc.setPlacementGhost(null);
    } else {
      sc.setEditorBrush(null);
      sc.setPlacementGhost(null);
    }
  }

  function onPointerUp(e) {
    if (!active || pt) return;
    if (camDrag) {
      const wasClick = camDrag.mode === 'maybe-orbit' && (camDrag.moved || 0) <= 5;
      camDrag = null;
      if (!wasClick) return;
      // right-CLICK contextual actions
      const g = groundAt(e);
      if (!g) return;
      if (tool === 'objects') {
        const obj = scene().pickObject(g.point.x, g.point.z, 3);
        if (obj) {
          removeObject(state(), session, obj.id);
          refreshObjects();
        }
      } else if (tool === 'paint' && stroke) {
        // handled as erase-drag; nothing on click
      } else if ((tool === 'paths' || (tool === 'water' && opt.water.shape === 'stream')) && drawingPath) {
        finishDrawing();
      } else if (tool === 'measure') {
        measurePts = [];
        updateMeasure();
      }
      return;
    }
    if (stroke && tool === 'terrain') {
      const res = endTerrainStroke(state(), session, stroke, 'Terrain');
      stroke = null;
      // sculpting moves land, not surfaces: skip the visual-field recompute
      scene().refreshGround(state(), { water: true, paths: true, zones: false });
      if (res.ok) refreshTop();
    } else if (stroke && tool === 'paint') {
      const res = endPaintStroke(state(), session, stroke.s, 'Paint');
      const rect = stroke.rect;
      stroke = null;
      scene().updateZoneField(state(), rect || null);
      scene().updateTurf(state());
      if (res.ok) refreshTop();
    }
    if (draggingObj && draggingObj.kind === 'path-point') {
      const moved = draggingObj.movedTo;
      const path = state().course.paths.find((p) => p.id === draggingObj.pathId);
      if (moved && path) {
        const pts = path.pts.map((q, i) => (i === draggingObj.index ? moved : q));
        editPath(state(), session, path.id, { pts });
        scene().rebuildPaths();
        scene().updateTurf(state());
        refreshTop();
      }
    }
    draggingObj = false;
  }

  function finishDrawing() {
    if (!drawingPath || drawingPath.length < 2) {
      drawingPath = null;
      scene().setMeasureLine(null);
      return;
    }
    if (tool === 'paths') {
      const res = addPath(state(), session, drawingPath, { width: opt.paths.width, material: opt.paths.material });
      if (res.ok) {
        scene().rebuildPaths();
        scene().updateTurf(state());
        refreshTop();
        renderToolPanel();
        toast(`Path laid (${formatMoney(res.cost)} pending).`);
      }
    } else {
      const res = stampStream(state(), session, drawingPath, { width: Math.max(0.8, yd2cells(opt.water.sizeYd) * 0.55), depth: opt.water.depth });
      if (res.ok) {
        const xs = drawingPath.map((q) => q.x);
        const ys = drawingPath.map((q) => q.y);
        scene().refreshGround(state(), {
          water: true,
          zoneRect: { x0: Math.min(...xs) - 3, y0: Math.min(...ys) - 3, x1: Math.max(...xs) + 3, y1: Math.max(...ys) + 3 },
        });
        refreshTop();
        toast('Stream cut.');
      }
    }
    drawingPath = null;
    scene().setMeasureLine(null);
  }

  function drawMeasurePreview(cellPts, kind) {
    const sc = scene();
    sc.setMeasureLine(cellPts.map((p) => ({ x: sc.worldX(p.x), z: sc.worldZ(p.y) })), kind === 'path' ? 'path…' : 'stream…');
  }

  function updateMeasure() {
    const sc = scene();
    if (measurePts.length === 0) {
      sc.setMeasureLine(null);
      ui.measureChip.style.display = 'none';
      return;
    }
    let label = null;
    if (measurePts.length >= 2) {
      const a = measurePts[measurePts.length - 2];
      const b = measurePts[measurePts.length - 1];
      const m = measure(state().course, { x: a.fx, y: a.fy }, { x: b.fx, y: b.fy });
      let total = 0;
      for (let i = 1; i < measurePts.length; i++) {
        total += measure(state().course, { x: measurePts[i - 1].fx, y: measurePts[i - 1].fy }, { x: measurePts[i].fx, y: measurePts[i].fy }).yards;
      }
      label = `${m.yards} yd`;
      ui.measureChip.style.display = '';
      const rows = [
        el('div', {}, el('b', { text: `${m.yards} yd` }), el('span', { text: '  last segment' })),
        el('div', { text: `Elevation ${m.elevationFt > 0 ? '+' : ''}${m.elevationFt} ft · Slope ${m.slopeDeg}°` }),
      ];
      if (measurePts.length > 2) rows.push(el('div', { text: `Chain total ${total} yd` }));
      ui.measureChip.replaceChildren(...rows);
    } else {
      ui.measureChip.style.display = '';
      ui.measureChip.replaceChildren(el('div', { text: 'Click the second point…' }));
    }
    sc.setMeasureLine(measurePts, label);
  }

  function onWheel(e) {
    if (!active || modalEl) return;
    if (e.target !== scene().renderer.domElement) return;
    e.preventDefault();
    scene().rig.dolly(e.deltaY > 0 ? 1.13 : 1 / 1.13);
  }

  function onKey(e) {
    if (!active) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    if (pt) {
      onPlaytestKey(e);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      doRedo();
      return;
    }
    const idx = Number(e.key);
    if (idx >= 1 && idx <= TOOLS.length && !e.ctrlKey && !e.metaKey) {
      setTool(TOOLS[idx - 1].key);
      return;
    }
    switch (e.key) {
      case 'f':
      case 'F': {
        const hole = holesOf().find((h) => h.id === opt.tee.holeId) || holesOf()[0];
        scene().frameHole(hole);
        break;
      }
      case 'Home':
        scene().frameCourse();
        break;
      case 'Escape':
        if (flyover) stopFlyover();
        else if (modalEl) closeModal();
        else if (drawingPath) finishDrawing();
        else if (selected) setSelected(null);
        else if (measurePts.length) {
          measurePts = [];
          updateMeasure();
        } else requestExit();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ flyover ----
  // A slow camera ride from tee to green — the classic course-preview shot.
  let flyover = null; // { hole, t }

  function startFlyover(hole) {
    if (!hole || !hole.tee || !hole.pin) return;
    flyover = { hole, t: 0 };
    hint('Flying the hole — click or press Esc to stop');
  }

  function stopFlyover() {
    if (!flyover) return;
    const hole = flyover.hole;
    flyover = null;
    scene().frameHole(hole);
    hint(HINTS[tool] || '');
  }

  function stepFlyover(dt) {
    if (!flyover) return;
    const sc = scene();
    const { hole } = flyover;
    flyover.t = Math.min(1, flyover.t + dt / 7.5);
    const t = flyover.t;
    const ease = t * t * (3 - 2 * t);
    const tx = sc.worldX(hole.tee.x);
    const tz = sc.worldZ(hole.tee.y);
    const px = sc.worldX(hole.pin.x);
    const pz = sc.worldZ(hole.pin.y);
    const rig = sc.rig;
    rig.target.set(tx + (px - tx) * ease, 0, tz + (pz - tz) * ease);
    rig.yaw = Math.atan2(tx - px, tz - pz); // always looking up the hole
    rig.pitch = 0.52;
    rig.dist = 105 + Math.sin(t * Math.PI) * 30;
    rig.apply();
    if (t >= 1) stopFlyover();
  }

  // ------------------------------------------------------------ playtest ----

  function enterPlaytest(holeId = null) {
    const holes = holesOf().filter((h) => h.tee && h.pin);
    if (!holes.length) {
      toast('No playable hole yet — a hole needs a tee and a pin.', 'warn');
      return;
    }
    const sc = scene();
    const hole = holes.find((h) => h.id === (holeId ?? opt.tee.holeId)) || holes[0];
    pt = startPlaytest(state(), hole.id, {
      cellToWorld: (p) => ({ x: sc.worldX(p.x), z: sc.worldZ(p.y) }),
      heightAt: (x, z) => sc.heightAt(x, z),
      zoneAt: (x, z) => sc.zoneAtWorld(x, z),
      inBoundsWorld: (x, z) => sc.inBoundsWorld(x, z),
    });
    if (!pt) {
      toast('That hole is not playable yet.', 'warn');
      return;
    }
    ptAim = pt.aimYaw;
    ptClub = null;
    ptPower = null;
    sc.setBallVisual(pt.ball);
    leftCol.style.display = 'none';
    topBar.style.display = 'none';
    ui.ptBar.style.display = '';
    // the reference playtest carries a hole mini-map beside the first-person view
    ui.ptMap.replaceChildren(
      holeMiniCanvas(hole, 108, 150),
      el('div', { class: 'ced-holemeta', text: `${hole.name} · Par ${holePar(hole)}` }),
    );
    ui.ptMap.style.display = '';
    hint('Drag: aim · Hold left button: power · Release: swing · Esc: back to the editor');
    renderPtBar();
    followBallCamera(true);
  }

  function exitPlaytest() {
    pt = null;
    ptPower = null;
    scene().setBallVisual(null);
    scene().setAimArc(null);
    ui.ptBar.style.display = 'none';
    ui.ptMap.style.display = 'none';
    leftCol.style.display = '';
    topBar.style.display = '';
    hint(HINTS[tool] || '');
    const hole = selectedHole();
    if (hole) scene().frameHole(hole);
    else scene().frameCourse();
  }

  function renderPtBar() {
    if (!pt) return;
    const hud = playtestHud(pt);
    const n = holeNumber(state().course, pt.holeId);
    ptClub = hud.club; // fresh suggestion for the new lie; the select still overrides
    const clubSel = el('select');
    for (const c of CLUBS) clubSel.append(el('option', { value: c.key, text: c.name }));
    clubSel.value = ptClub.key;
    clubSel.onchange = () => { ptClub = CLUBS.find((c) => c.key === clubSel.value); };
    ui.ptBar.replaceChildren(
      el('span', { class: 'ced-pt-chip', text: `Hole ${n}` }),
      el('span', { class: 'ced-pt-chip', text: `Par ${holePar(pt.hole)}` }),
      el('span', { class: 'ced-pt-chip', text: `${hud.remainingYd} yd` }),
      el('span', { class: 'ced-pt-chip', text: `Lie: ${hud.lie}` }),
      el('span', { class: 'ced-pt-chip hot', text: `Strokes ${hud.strokes}` }),
      el('span', { class: 'ced-pt-club' }, el('label', { text: 'Club ' }), clubSel),
      ui.ptPowerBar = el('span', { class: 'ced-pt-power' }, el('span', { class: 'fill' })),
      el('button', { class: 'ced-top-btn', text: '← Back to editor', onclick: () => exitPlaytest() }),
    );
    if (hud.holed) {
      ui.ptBar.append(el('span', { class: 'ced-pt-chip good', text: pt.events[pt.events.length - 1] || 'Holed!' }));
      ui.ptBar.append(el('button', {
        class: 'ced-top-btn primary',
        text: 'Replay hole',
        onclick: () => enterPlaytest(pt.holeId),
      }));
    }
  }

  function onPlaytestKey(e) {
    if (e.key === 'Escape') exitPlaytest();
  }

  function playtestPointerDown(e) {
    if (!pt || pt.phase !== 'aim' || pt.holedOut) return;
    if (e.target !== scene().renderer.domElement) return;
    if (e.button === 0) {
      ptPower = { t: 0, dir: 1 };
    } else if (e.button === 2) {
      camDrag = { mode: 'aim', x: e.clientX, y: e.clientY };
    }
  }

  function playtestPointerMove(e) {
    if (!pt) return;
    if (camDrag && camDrag.mode === 'aim') {
      ptAim -= (e.clientX - camDrag.x) * 0.004;
      camDrag.x = e.clientX;
      camDrag.y = e.clientY;
    } else if (e.buttons & 1 && !ptPower) {
      // dragging with left also aims before charging
      ptAim -= e.movementX * 0.004;
    } else if (!e.buttons) {
      ptAim -= e.movementX * 0; // aim only on drag
    }
  }

  function playtestPointerUp(e) {
    if (!pt) return;
    if (camDrag && camDrag.mode === 'aim') {
      camDrag = null;
      return;
    }
    if (e.button === 0 && ptPower) {
      const club = ptClub || playtestHud(pt).club;
      strike(pt, club, ptPower.t, ptAim);
      ptPower = null;
      setPowerFill(0);
      renderPtBar();
    }
  }

  function setPowerFill(t) {
    if (!ui.ptPowerBar) return;
    const fill = ui.ptPowerBar.querySelector('.fill');
    if (fill) fill.style.width = `${Math.round(t * 100)}%`;
  }

  function followBallCamera(snap = false) {
    const sc = scene();
    const rig = sc.rig;
    const b = pt.ball;
    rig.target.set(b.x, 0, b.z);
    if (pt.phase === 'aim') {
      rig.yaw = ptAim + Math.PI; // camera behind the ball looking down the line
      rig.pitch = 0.42;
      rig.dist = snap ? 30 : clamp(rig.dist, 22, 46);
    } else {
      rig.pitch = 0.65;
      rig.dist = clamp(rig.dist, 30, 90);
    }
    rig.apply();
  }

  function aimArcPoints() {
    // a simple preview arc along the aim direction for the selected club/power
    const club = ptClub || playtestHud(pt).club;
    const power = ptPower ? ptPower.t : 0.75;
    const carry = club.carry * Math.max(0.15, power);
    const pts = [];
    const sc = scene();
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const d = carry * t;
      const x = pt.ball.x + Math.sin(ptAim) * d;
      const z = pt.ball.z + Math.cos(ptAim) * d;
      const y = sc.heightAt(pt.ball.x, pt.ball.z) + Math.sin(t * Math.PI) * (club.key === 'putter' ? 0.1 : carry * 0.16);
      pts.push({ x, y: Math.max(y, sc.heightAt(x, z) + 0.15), z });
    }
    return pts;
  }

  // ------------------------------------------------------------ lifecycle ----

  let camLimits = null; // the rig's own limits, restored on hide

  function show() {
    active = true;
    session = makeEditSession(state());
    root.style.display = '';
    setTool('select');
    lightMode = 'day';
    ui.lightSel.value = 'day';
    scene().setLightingOverride('day');
    scene().setGolfersFrozen(true);
    // the editor camera never becomes a satellite: cap distance and pitch so
    // the course always reads as a 3D place (reference: 35–55° angles)
    const rig = scene().rig;
    camLimits = { maxDist: rig.maxDist, maxPitch: rig.maxPitch, minDist: rig.minDist };
    rig.maxDist = 700; // enough to frame the property on a 16:9 monitor…
    rig.maxPitch = 1.08; // …but never the flat satellite look (≈62° max)
    rig.minDist = 36;
    // open ON the first hole — the selected-hole workflow, not the whole map
    selectHole(selectedHole(), { frame: true });
    refreshTop();
    window.addEventListener('pointerdown', pdHandler, true);
    window.addEventListener('pointermove', pmHandler, true);
    window.addEventListener('pointerup', puHandler, true);
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('keydown', onKey, true);
  }

  function hide() {
    if (pt) exitPlaytest();
    active = false;
    closeModal();
    if (camLimits) {
      const rig = scene().rig;
      rig.maxDist = camLimits.maxDist;
      rig.maxPitch = camLimits.maxPitch;
      rig.minDist = camLimits.minDist;
      camLimits = null;
    }
    scene().setLightingOverride(null);
    scene().setGolfersFrozen(false);
    scene().setEditorBrush(null);
    scene().setPlacementGhost(null);
    scene().setMeasureLine(null);
    root.style.display = 'none';
    window.removeEventListener('pointerdown', pdHandler, true);
    window.removeEventListener('pointermove', pmHandler, true);
    window.removeEventListener('pointerup', puHandler, true);
    window.removeEventListener('wheel', onWheel, { capture: true });
    window.removeEventListener('keydown', onKey, true);
  }

  const pdHandler = (e) => (pt ? playtestPointerDown(e) : onPointerDown(e));
  const pmHandler = (e) => (pt ? playtestPointerMove(e) : onPointerMove(e));
  const puHandler = (e) => (pt ? playtestPointerUp(e) : onPointerUp(e));

  // called from the main frame loop while the editor is open
  function onFrame(dtMs) {
    if (!active) return;
    // compass follows the camera
    const yawDeg = -(scene().rig.yaw * 180) / Math.PI;
    ui.compass.style.transform = `rotate(${yawDeg}deg)`;
    if (flyover) stepFlyover(Math.min(0.05, dtMs / 1000));
    if (pt) {
      const dt = Math.min(0.05, dtMs / 1000);
      if (ptPower) {
        ptPower.t += ptPower.dir * dt * 0.9;
        if (ptPower.t >= 1) {
          ptPower.t = 1;
          ptPower.dir = -1;
        } else if (ptPower.t <= 0) {
          ptPower.t = 0;
          ptPower.dir = 1;
        }
        setPowerFill(ptPower.t);
      }
      const wasMoving = pt.phase === 'flying' || pt.phase === 'rolling';
      if (wasMoving) {
        stepBall(pt, dt);
        scene().setBallVisual(pt.ball);
        if (pt.phase === 'aim' || pt.phase === 'holed') {
          for (const ev of pt.events.splice(0)) toast(ev);
          // the next shot starts aimed at the flag — drag to shape it from there
          ptAim = Math.atan2(pt.pin.x - pt.ball.x, pt.pin.z - pt.ball.z);
          renderPtBar();
        }
      }
      if (pt.phase === 'aim' && !pt.holedOut) {
        scene().setAimArc(aimArcPoints());
      } else {
        scene().setAimArc(null);
      }
      followBallCamera();
      scene().setBallVisual(pt.ball);
    }
  }

  return {
    root,
    show,
    hide,
    onFrame,
    isActive: () => active,
    isPlaytesting: () => !!pt,
    session: () => session,
    qa: {
      playtest: () => pt,
      tool: () => tool,
      setTool,
      power: () => ptPower,
    },
  };
}
