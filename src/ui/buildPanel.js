// Player-facing furniture catalog, owned collection and renovation controls.
// The 3D controller owns gameplay; this panel reads one immutable view model
// and sends explicit purchase, install and placement commands back to it.

import { FURNITURE_CATEGORIES, FURNITURE_TIERS } from '../data/furnitureCatalog.js';
import { ROOM_STYLE_OPTIONS } from '../data/placeableCatalog.js';
import { el } from './ui.js';

const CATALOG_PAGE_SIZE = 12;
const money = (value) => `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function makeBuildPanel({ getApi }) {
  // Simulation/unit harnesses construct the real controller without a DOM.
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') {
    let active = false;
    let open = false;
    return {
      enter() { active = true; open = false; },
      exit() { active = false; open = false; },
      toggle() { if (!active) return false; open = !open; return true; },
      isOpen: () => open,
      refresh() {},
      setStatus() {},
      dispose() { active = false; open = false; },
    };
  }

  const ui = document.getElementById('ui');
  const root = el('section', { class: 'build-drawer', style: 'display:none', 'aria-label': 'Clubhouse customization' });
  const status = el('section', { class: 'build-status', style: 'display:none', 'aria-live': 'polite' });
  ui.append(root, status);

  let open = false;
  let active = false;
  let tab = 'catalog';
  let catalogSearch = '';
  let catalogCategory = 'all';
  let catalogTier = 'basic';
  let catalogPage = 0;
  let lastStatus = '';
  let lastStatusKind = '';
  const managedListeners = new Map();

  function listen(node, type, listener) {
    node.addEventListener(type, listener);
    const records = managedListeners.get(node) || [];
    records.push([type, listener]);
    managedListeners.set(node, records);
    return node;
  }

  function button(attrs = {}, ...children) {
    const { onclick, ...plain } = attrs;
    const node = el('button', plain, ...children);
    if (typeof onclick === 'function') listen(node, 'click', onclick);
    return node;
  }

  function releaseChildren(container) {
    for (const node of [container, ...container.querySelectorAll('*')]) {
      const records = managedListeners.get(node);
      if (!records) continue;
      for (const [type, listener] of records) node.removeEventListener(type, listener);
      managedListeners.delete(node);
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
      el('small', { text: `${String(object.placementCategory || 'furniture').replaceAll('-', ' ')} / ${money(object.sellValue)}` }),
    );
    const controls = el('span', { class: 'build-object-actions' });
    const fitted = ['installation', 'vehicle'].includes(object.placementMode);
    if (location === 'installed') {
      controls.append(button({ class: 'build-mini', text: 'Uninstall', onclick: () => getApi()?.uninstallById(object.id) }));
    } else if (location !== 'sold' && object.render?.kind !== 'existing') {
      controls.append(button({
        class: 'build-mini primary',
        text: location === 'stored' ? (fitted ? 'Install' : 'Place') : 'Move',
        onclick: () => fitted ? getApi()?.installById(object.id) : begin(object.id),
      }));
    }
    if (location === 'placed' && !object.requiredObject) {
      controls.append(button({ class: 'build-mini', text: 'Store', onclick: () => getApi()?.storeById(object.id) }));
    }
    if (!['sold', 'installed'].includes(location) && object.variants?.length > 1) {
      controls.append(button({
        class: 'build-mini', text: 'Finish', title: `Current: ${(object.variant || '').replaceAll('-', ' ')}`,
        onclick: () => getApi()?.cycleVariant(object.id),
      }));
    }
    if (!['sold', 'installed'].includes(location) && !object.requiredObject && object.sellValue > 0) {
      controls.append(button({ class: 'build-mini danger', text: 'Sell', onclick: () => getApi()?.sellById(object.id) }));
    }
    if (object.requiredObject) {
      controls.append(button({ class: 'build-mini', text: 'Recover', onclick: () => getApi()?.recoverById(object.id) }));
    }
    return el('div', { class: `build-object-row ${location}` }, details, controls);
  }

  function objectList(objects, emptyCopy, location) {
    if (!objects.length) return el('p', { class: 'build-empty', text: emptyCopy });
    return el('div', { class: 'build-object-list' }, ...objects.map((object) => objectRow(object, location)));
  }

  function inventoryBody(model) {
    const placed = model.placed.filter((object) => object.render?.kind !== 'existing');
    const purchased = model.stored.filter((object) => object.catalogSku);
    const renovationStock = model.stored.filter((object) => !object.catalogSku);
    const purchasedPlaced = placed.filter((object) => object.catalogSku);
    const renovationPlaced = placed.filter((object) => !object.catalogSku);
    return el('div', {},
      el('p', { class: 'build-note', text: 'Owned furnishings remain safe in storage until placed or installed. Aim placement previews at a compatible floor, wall, counter, shelf or ceiling.' }),
      el('h3', { text: `Catalog collection / ${purchased.length}` }),
      objectList(purchased, 'Purchase a furnishing from the catalog to begin your collection.', 'stored'),
      model.installed.length ? el('div', {},
        el('h3', { text: `Installed finishes & equipment / ${model.installed.length}` }),
        objectList(model.installed, '', 'installed'),
      ) : null,
      purchasedPlaced.length ? el('div', {},
        el('h3', { text: `Catalog pieces in the clubhouse / ${purchasedPlaced.length}` }),
        objectList(purchasedPlaced, '', 'placed'),
      ) : null,
      renovationStock.length || renovationPlaced.length ? el('details', { class: 'build-inventory-legacy' },
        el('summary', { text: `Existing renovation stock / ${renovationStock.length + renovationPlaced.length}` }),
        renovationStock.length ? el('div', {}, el('h3', { text: `Stored / ${renovationStock.length}` }), objectList(renovationStock, '', 'stored')) : null,
        renovationPlaced.length ? el('div', {}, el('h3', { text: `Placed / ${renovationPlaced.length}` }), objectList(renovationPlaced, '', 'placed')) : null,
      ) : null,
      model.sold.length ? el('details', {},
        el('summary', { text: `Sold / ${model.sold.length}` }),
        objectList(model.sold, '', 'sold'),
      ) : null,
    );
  }

  function catalogSelect(label, value, options, onChange) {
    const select = el('select', { 'aria-label': label }, ...options.map(([id, copy]) =>
      el('option', { value: id, text: copy, selected: id === value })));
    listen(select, 'change', () => onChange(select.value));
    return el('label', { class: 'build-catalog-field' }, el('span', { text: label }), select);
  }

  function catalogCard(entry, model, byId, ownedCount) {
    const { item, unlocked, reasons } = entry;
    const affordable = model.cash >= item.purchaseCost;
    const progressionNames = item.progression.map((id) => byId.get(id)?.item.name || id);
    const isPackage = item.packageQuantity > 1;
    const purchaseLabel = unlocked
      ? (affordable ? `${isPackage ? 'Buy room' : 'Buy'} ${money(item.purchaseCost)}` : `Need ${money(item.purchaseCost)}`)
      : 'Locked';
    const lockCopy = !unlocked ? reasons.join(' ')
      : !affordable ? `${money(item.purchaseCost - model.cash)} more cash needed.`
        : isPackage ? `${item.packageQuantity.toLocaleString()} ${item.priceUnit} room package` : 'Available now';
    return el('article', { class: `build-catalog-card ${unlocked ? '' : 'locked'}` },
      el('div', { class: 'build-catalog-visual' },
        el('img', { src: item.thumbnail, alt: `${item.name} catalog thumbnail`, loading: 'eager', width: 320, height: 180 }),
        el('span', { class: `build-tier-badge tier-${item.progressionTier}`, text: item.qualityLabel }),
      ),
      el('div', { class: 'build-catalog-card-body' },
        el('div', { class: 'build-catalog-title' },
          el('div', {}, el('h3', { text: item.name }), el('small', { text: `${item.brandTier} / ${FURNITURE_CATEGORIES[item.category].label}${ownedCount ? ` / ${ownedCount} owned` : ''}` })),
          el('strong', { text: item.priceUnit === 'each' ? money(item.price) : `${money(item.price)} / ${item.priceUnit}` }),
        ),
        el('p', { class: 'build-catalog-description', text: item.description }),
        el('dl', { class: 'build-catalog-stats' },
          el('div', {}, el('dt', { text: 'Quality' }), el('dd', { text: `${item.quality}/100` })),
          el('div', {}, el('dt', { text: 'Maintenance' }), el('dd', { text: `+${item.maintenanceValue}` })),
          el('div', {}, el('dt', { text: 'Comfort' }), el('dd', { text: `+${item.comfortValue}` })),
          el('div', {}, el('dt', { text: 'Prestige' }), el('dd', { text: `+${item.prestigeValue}` })),
        ),
        el('div', {
          class: 'build-catalog-progression',
          title: progressionNames.join(' -> '),
          'aria-label': `Progression: ${progressionNames.join(', ')}`,
        }, ...FURNITURE_TIERS.map((tier) => el('span', {
          class: tier.id === item.progressionTier ? 'current' : '', text: tier.label,
        }))),
        el('div', { class: 'build-catalog-buyline' },
          el('small', {
            class: unlocked && affordable ? 'available' : 'locked',
            text: unlocked ? `${lockCopy} / Level ${item.unlockLevel} / Rep ${item.requiredReputation}` : lockCopy,
          }),
          button({
            class: 'build-buy primary', text: purchaseLabel,
            disabled: !unlocked || !affordable,
            onclick: () => getApi()?.purchaseSku(item.id),
          }),
        ),
      ),
    );
  }

  function catalogBody(model) {
    const search = catalogSearch.trim().toLowerCase();
    const filtered = model.catalog.filter(({ item }) => {
      if (catalogCategory !== 'all' && item.category !== catalogCategory) return false;
      if (catalogTier !== 'all' && item.progressionTier !== catalogTier) return false;
      const haystack = `${item.name} ${item.familyId} ${item.brandTier} ${item.description} ${item.category} ${FURNITURE_CATEGORIES[item.category].label}`;
      return !search || haystack.toLowerCase().replaceAll('-', ' ').includes(search.replaceAll('-', ' '));
    });
    const pageCount = Math.max(1, Math.ceil(filtered.length / CATALOG_PAGE_SIZE));
    catalogPage = Math.min(catalogPage, pageCount - 1);
    const pageStart = catalogPage * CATALOG_PAGE_SIZE;
    const rows = filtered.slice(pageStart, pageStart + CATALOG_PAGE_SIZE);
    const byId = new Map(model.catalog.map((entry) => [entry.item.id, entry]));
    const owned = new Map();
    for (const object of [...model.stored, ...model.placed, ...model.installed]) {
      if (object.catalogSku) owned.set(object.catalogSku, (owned.get(object.catalogSku) || 0) + 1);
    }
    const searchInput = el('input', {
      type: 'search', value: catalogSearch, placeholder: 'Search 310 furnishings...',
      'aria-label': 'Search furniture catalog', autocomplete: 'off',
    });
    listen(searchInput, 'input', () => {
      catalogSearch = searchInput.value;
      catalogPage = 0;
      renderBody();
      requestAnimationFrame(() => {
        const next = root.querySelector('.build-catalog-tools input[type="search"]');
        next?.focus();
        next?.setSelectionRange(catalogSearch.length, catalogSearch.length);
      });
    });
    const effects = model.furniture.effects;
    return el('div', { class: 'build-catalog' },
      el('section', { class: 'build-catalog-summary' },
        el('div', {}, el('small', { text: 'RENOVATION LEVEL' }), el('strong', { text: model.furniture.level })),
        el('div', {}, el('small', { text: 'CLUB REPUTATION' }), el('strong', { text: Math.round(model.reputation) })),
        el('div', {}, el('small', { text: 'AVAILABLE CASH' }), el('strong', { text: money(model.cash) })),
        el('div', {}, el('small', { text: 'ACTIVE VALUES' }), el('strong', { text: `M${effects.maintenanceValue} / C${effects.comfortValue} / P${effects.prestigeValue}` })),
      ),
      el('div', { class: 'build-catalog-tools' },
        searchInput,
        catalogSelect('Category', catalogCategory,
          [['all', 'All categories'], ...Object.entries(FURNITURE_CATEGORIES).map(([id, category]) => [id, category.label])],
          (value) => { catalogCategory = value; catalogPage = 0; renderBody(); }),
        catalogSelect('Tier', catalogTier,
          [['all', 'All tiers'], ...FURNITURE_TIERS.map((tier) => [tier.id, tier.label])],
          (value) => { catalogTier = value; catalogPage = 0; renderBody(); }),
      ),
      el('div', { class: 'build-catalog-results' },
        el('span', { text: filtered.length ? `${pageStart + 1}-${Math.min(pageStart + rows.length, filtered.length)} of ${filtered.length}` : 'No matching furnishings' }),
        el('span', { text: 'Five linked tiers in every family' }),
      ),
      rows.length ? el('div', { class: 'build-catalog-grid' }, ...rows.map((entry) => catalogCard(entry, model, byId, owned.get(entry.item.id) || 0)))
        : el('p', { class: 'build-empty', text: 'No catalog objects match these filters.' }),
      el('nav', { class: 'build-catalog-pages', 'aria-label': 'Catalog pages' },
        button({ class: 'build-mini', text: 'Previous', disabled: catalogPage === 0, onclick: () => { catalogPage -= 1; renderBody(); } }),
        el('span', { text: `Page ${catalogPage + 1} of ${pageCount}` }),
        button({ class: 'build-mini', text: 'Next', disabled: catalogPage >= pageCount - 1, onclick: () => { catalogPage += 1; renderBody(); } }),
      ),
    );
  }

  function styleChoice(kind, current, option) {
    return button({
      class: `build-swatch ${current === option.id ? 'selected' : ''}`,
      title: `${option.label} / Asset ${option.sourceAsset}`,
      onclick: () => getApi()?.setStyle(kind, option.id),
    },
    el('span', { class: 'build-swatch-color', style: `--swatch:#${option.color.toString(16).padStart(6, '0')}` }),
    el('span', { text: option.label }));
  }

  function styleBody(model) {
    return el('div', {},
      el('p', { class: 'build-note', text: 'Finish changes reuse the verified architecture-kit palette and preserve existing dirt/restoration overlays.' }),
      ...Object.entries(ROOM_STYLE_OPTIONS).map(([kind, options]) => el('section', { class: 'build-style-group' },
        el('h3', { text: kind[0].toUpperCase() + kind.slice(1) }),
        el('div', { class: 'build-swatches' }, ...options.map((option) => styleChoice(kind, model.style[kind], option))),
      )),
    );
  }

  function safetyBody(model) {
    const required = model.placed.filter((object) => object.requiredObject);
    return el('div', {},
      el('p', { class: 'build-note', text: 'Checkout equipment, the office laptop, and the exit sign retain protected authored relationships. Recovery returns them safely; they cannot be sold.' }),
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
    body.replaceChildren(tab === 'catalog' ? catalogBody(model)
      : tab === 'storage' ? inventoryBody(model)
        : tab === 'style' ? styleBody(model) : safetyBody(model));
    root.querySelectorAll('[data-build-tab]').forEach((node) => node.classList.toggle('active', node.dataset.buildTab === tab));
  }

  function render() {
    root.style.display = active && open ? '' : 'none';
    status.style.display = active && !open ? '' : 'none';
    if (!active || !open) return;
    releaseChildren(root);
    root.replaceChildren(
      el('header', { class: 'build-drawer-head' },
        el('div', {}, el('small', { text: 'RENOVATION MODE' }), el('h2', { text: 'Pinehollow Furnishings' })),
        button({ class: 'build-close', text: 'Close', title: 'Close catalog [I]', onclick: closeAndLook }),
      ),
      el('nav', { class: 'build-tabs' },
        ...[['catalog', 'Catalog'], ['storage', 'Owned'], ['style', 'Room style'], ['safety', 'Safety & help']].map(([id, label]) =>
          button({ 'data-build-tab': id, text: label, class: tab === id ? 'active' : '', onclick: () => { tab = id; renderBody(); } })),
      ),
      el('div', { class: 'build-drawer-body' }),
      el('footer', { class: 'build-drawer-foot', text: 'I closes catalog / B exits renovation mode' }),
    );
    renderBody();
  }

  return {
    enter() { active = true; open = false; render(); },
    exit() { active = false; open = false; render(); },
    toggle() {
      if (!active) return false;
      open = !open;
      if (open && document.pointerLockElement) document.exitPointerLock();
      render();
      return true;
    },
    isOpen: () => open,
    refresh: renderBody,
    setStatus(copy, kind = '', controls = 'I collection / B finish') {
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
