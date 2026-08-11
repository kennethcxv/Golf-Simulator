// Renovation-mode inventory and finish drawer. The 3D controller owns gameplay;
// this module only presents its read-only model and sends explicit commands back.

import { ROOM_STYLE_OPTIONS } from '../data/placeableCatalog.js';
import { el } from './ui.js';

const money = (value) => `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function makeBuildPanel({ getApi }) {
  const ui = document.getElementById('ui');
  const root = el('section', { class: 'build-drawer', style: 'display:none', 'aria-label': 'Clubhouse customization' });
  const status = el('section', { class: 'build-status', style: 'display:none', 'aria-live': 'polite' });
  ui.append(root, status);

  let open = false;
  let active = false;
  let tab = 'storage';
  let lastStatus = '';
  let lastStatusKind = '';
  const clickListeners = new Map();

  function button(attrs = {}, ...children) {
    const { onclick, ...plain } = attrs;
    const node = el('button', plain, ...children);
    if (typeof onclick === 'function') {
      node.addEventListener('click', onclick);
      clickListeners.set(node, onclick);
    }
    return node;
  }

  function releaseChildren(container) {
    for (const node of container.querySelectorAll('button')) {
      const listener = clickListeners.get(node);
      if (!listener) continue;
      node.removeEventListener('click', listener);
      clickListeners.delete(node);
    }
  }

  const stop = (event) => event.stopPropagation();
  for (const eventName of ['pointerdown', 'pointerup', 'click', 'wheel']) root.addEventListener(eventName, stop);

  function closeAndLook() {
    open = false;
    render();
    const canvas = document.getElementById('game');
    try {
      const request = canvas?.requestPointerLock?.();
      request?.catch?.(() => {});
    } catch { /* the normal click-to-look hint remains available */ }
  }

  function begin(id) {
    const result = getApi()?.beginObject(id);
    if (result !== false) closeAndLook();
  }

  function objectRow(object, location) {
    const details = el('span', { class: 'build-object-copy' },
      el('strong', { text: object.label }),
      el('small', { text: `${object.placementCategory.replaceAll('-', ' ')} · ${money(object.sellValue)}` }),
    );
    const controls = el('span', { class: 'build-object-actions' });
    if (location !== 'sold' && object.render?.kind !== 'existing') {
      controls.append(button({ class: 'build-mini primary', text: location === 'stored' ? 'Place' : 'Move', onclick: () => begin(object.id) }));
    }
    if (location === 'placed' && !object.requiredObject) {
      controls.append(button({ class: 'build-mini', text: 'Store', onclick: () => { getApi()?.storeById(object.id); renderBody(); } }));
    }
    if (location !== 'sold' && object.variants?.length > 1) {
      controls.append(button({
        class: 'build-mini', text: 'Finish', title: `Current: ${(object.variant || '').replaceAll('-', ' ')}`,
        onclick: () => { getApi()?.cycleVariant(object.id); renderBody(); },
      }));
    }
    if (location !== 'sold' && !object.requiredObject && object.sellValue > 0) {
      controls.append(button({ class: 'build-mini danger', text: 'Sell', onclick: () => { getApi()?.sellById(object.id); renderBody(); } }));
    }
    if (object.requiredObject) {
      controls.append(button({ class: 'build-mini', text: 'Recover', onclick: () => { getApi()?.recoverById(object.id); renderBody(); } }));
    }
    return el('div', { class: `build-object-row ${location}` }, details, controls);
  }

  function objectList(objects, emptyCopy, location) {
    if (!objects.length) return el('p', { class: 'build-empty', text: emptyCopy });
    return el('div', { class: 'build-object-list' }, ...objects.map((object) => objectRow(object, location)));
  }

  function inventoryBody(model) {
    const placed = model.placed.filter((object) => object.render?.kind !== 'existing');
    return el('div', {},
      el('p', { class: 'build-note', text: 'Stored furnishings never block the room. Place one, then aim it at a compatible floor, wall, counter, or shelf.' }),
      el('h3', { text: `Storage · ${model.stored.length}` }),
      objectList(model.stored, 'Storage is empty.', 'stored'),
      el('h3', { text: `In the clubhouse · ${placed.length}` }),
      objectList(placed, 'No movable furnishings are placed.', 'placed'),
      model.sold.length ? el('details', {},
        el('summary', { text: `Sold · ${model.sold.length}` }),
        objectList(model.sold, '', 'sold'),
      ) : null,
    );
  }

  function styleChoice(kind, current, option) {
    return button({
      class: `build-swatch ${current === option.id ? 'selected' : ''}`,
      title: `${option.label} · Asset ${option.sourceAsset}`,
      onclick: () => {
        getApi()?.setStyle(kind, option.id);
        renderBody();
      },
    },
    el('span', { class: 'build-swatch-color', style: `--swatch:#${option.color.toString(16).padStart(6, '0')}` }),
    el('span', { text: option.label }));
  }

  function styleBody(model) {
    return el('div', {},
      el('p', { class: 'build-note', text: 'Finish changes reuse the verified architecture-kit palette and preserve the existing dirt/restoration overlays.' }),
      ...Object.entries(ROOM_STYLE_OPTIONS).map(([kind, options]) => el('section', { class: 'build-style-group' },
        el('h3', { text: kind[0].toUpperCase() + kind.slice(1) }),
        el('div', { class: 'build-swatches' }, ...options.map((option) => styleChoice(kind, model.style[kind], option))),
      )),
    );
  }

  function safetyBody(model) {
    const required = model.placed.filter((object) => object.requiredObject);
    return el('div', {},
      el('p', { class: 'build-note', text: 'The checkout equipment, the office laptop and the exit sign are fixed where they are and cannot be sold. Recovery puts them back safely.' }),
      objectList(required, 'No required objects found.', 'placed'),
      el('h3', { text: 'Placement controls' }),
      el('dl', { class: 'build-controls' },
        el('dt', { text: 'E / Left click' }), el('dd', { text: 'pick up or confirm' }),
        el('dt', { text: 'R / Shift+R' }), el('dd', { text: 'rotate clockwise / counterclockwise' }),
        el('dt', { text: 'Arrow keys' }), el('dd', { text: 'fine nudge; hold Shift for coarse' }),
        el('dt', { text: 'G / T' }), el('dd', { text: 'toggle position / rotation snapping' }),
        el('dt', { text: 'O' }), el('dd', { text: 'return preview to its original transform' }),
        el('dt', { text: 'Ctrl+Z / Ctrl+Y' }), el('dd', { text: 'undo / redo committed changes' }),
        el('dt', { text: 'X / Delete' }), el('dd', { text: 'store / sell (sell requires confirmation)' }),
        el('dt', { text: 'Esc / Right click' }), el('dd', { text: 'cancel move; B exits renovation mode' }),
      ),
    );
  }

  function renderBody() {
    if (!open) return;
    const model = getApi()?.uiModel();
    const body = root.querySelector('.build-drawer-body');
    if (!model || !body) return;
    releaseChildren(body);
    body.replaceChildren(tab === 'storage' ? inventoryBody(model) : tab === 'style' ? styleBody(model) : safetyBody(model));
    root.querySelectorAll('[data-build-tab]').forEach((button) => button.classList.toggle('active', button.dataset.buildTab === tab));
  }

  function render() {
    root.style.display = active && open ? '' : 'none';
    status.style.display = active && !open ? '' : 'none';
    if (!active || !open) return;
    releaseChildren(root);
    root.replaceChildren(
      el('header', { class: 'build-drawer-head' },
        el('div', {}, el('small', { text: 'RENOVATION MODE' }), el('h2', { text: 'Clubhouse collection' })),
        button({ class: 'build-close', text: '×', title: 'Close catalog [I]', onclick: closeAndLook }),
      ),
      el('nav', { class: 'build-tabs' },
        ...[['storage', 'Furniture'], ['style', 'Room style'], ['safety', 'Safety & help']].map(([id, label]) =>
          button({ 'data-build-tab': id, text: label, class: tab === id ? 'active' : '', onclick: () => { tab = id; renderBody(); } })),
      ),
      el('div', { class: 'build-drawer-body' }),
      el('footer', { class: 'build-drawer-foot', text: 'I closes catalog · B exits renovation mode' }),
    );
    renderBody();
  }

  return {
    enter() {
      active = true;
      open = false;
      render();
    },
    exit() {
      active = false;
      open = false;
      render();
    },
    toggle() {
      if (!active) return false;
      open = !open;
      if (open && document.pointerLockElement) document.exitPointerLock();
      render();
      return true;
    },
    isOpen: () => open,
    refresh: renderBody,
    setStatus(copy, kind = '', controls = 'I collection · B finish') {
      const signature = `${kind}\n${copy}\n${controls}`;
      if (signature === lastStatus && kind === lastStatusKind) return;
      lastStatus = signature;
      lastStatusKind = kind;
      status.className = `build-status ${kind}`;
      status.replaceChildren(
        el('small', { text: 'RENOVATION MODE' }),
        el('strong', { text: copy }),
        el('span', { text: controls }),
      );
    },
    dispose() {
      releaseChildren(root);
      for (const eventName of ['pointerdown', 'pointerup', 'click', 'wheel']) root.removeEventListener(eventName, stop);
      root.remove();
      status.remove();
    },
  };
}
