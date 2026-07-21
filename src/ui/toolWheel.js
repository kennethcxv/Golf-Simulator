import { containFocus, el } from './ui.js';

export function makeToolWheel({ onSelect, onClose, onPause, audio } = {}) {
  const title = el('div', { class: 'tool-wheel-title', text: 'Tool belt' });
  const selectedName = el('div', { class: 'tool-wheel-selected', role: 'status', 'aria-live': 'polite' });
  const selectedDetail = el('div', { class: 'tool-wheel-detail' });
  const ring = el('div', { class: 'tool-wheel-ring', role: 'listbox', 'aria-label': 'Available tools' });
  const root = el('div', { class: 'tool-wheel', style: 'display:none' },
    el('div', { class: 'tool-wheel-scrim' }),
    el('div', { class: 'tool-wheel-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tool belt', tabindex: '-1' },
      title,
      ring,
      el('div', { class: 'tool-wheel-center' }, selectedName, selectedDetail,
        el('div', { class: 'tool-wheel-help', text: 'Mouse or arrows · Enter equips · Esc closes · Q swaps back' })),
    ),
  );
  let entries = [];
  let selectedIndex = 0;
  let releaseFocus = () => {};
  let open = false;

  function selectableIndexes() {
    return entries.map((entry, index) => entry.available !== false ? index : -1).filter((index) => index >= 0);
  }

  function highlight(index, { focus = false } = {}) {
    if (!entries[index]) return;
    selectedIndex = index;
    const buttons = [...ring.querySelectorAll('.tool-wheel-item')];
    buttons.forEach((button, buttonIndex) => {
      const selected = buttonIndex === selectedIndex;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    const entry = entries[selectedIndex];
    selectedName.textContent = entry.label;
    selectedDetail.textContent = entry.available === false ? entry.reason || 'Unavailable' : entry.detail || 'Ready';
    if (focus) buttons[selectedIndex]?.focus();
  }

  function choose(index = selectedIndex) {
    const entry = entries[index];
    if (!entry || entry.available === false) {
      audio?.uiError?.();
      return;
    }
    audio?.uiConfirm?.();
    onSelect?.(entry.id);
    close('selected');
  }

  function close(reason = 'dismissed') {
    if (!open) return;
    open = false;
    releaseFocus();
    releaseFocus = () => {};
    // The wheel remains mounted between uses. If the previous focus target was
    // the document body, HTMLElement.focus() cannot move focus there and the
    // hidden option would keep receiving Tab forever. Explicitly blur it before
    // hiding so gameplay shortcuts regain keyboard ownership.
    if (root.contains(document.activeElement)) document.activeElement.blur();
    root.style.display = 'none';
    document.body.classList.remove('tool-wheel-open');
    onClose?.(reason);
  }

  function onKeyDown(event) {
    // Unavailable tools remain navigable so keyboard players can read the same
    // contextual reason mouse players see on hover. choose() still prevents
    // equipping them.
    const indexes = entries.map((_, index) => index);
    if (event.key === 'p' || event.key === 'P') {
      event.stopPropagation();
      event.preventDefault();
      close('pause');
      queueMicrotask(() => onPause?.());
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.stopPropagation();
      event.preventDefault();
      choose();
      return;
    }
    if (event.key === 'Tab') {
      // Keep keyboard focus inside the wheel even when unavailable entries use
      // aria-disabled instead of the native disabled attribute. Moving the
      // selected option explicitly also makes Shift+Tab and screen-reader
      // navigation predictable.
      event.stopPropagation();
      event.preventDefault();
      if (!indexes.length) return;
      const at = Math.max(0, indexes.indexOf(selectedIndex));
      const direction = event.shiftKey ? -1 : 1;
      highlight(indexes[(at + direction + indexes.length) % indexes.length], { focus: true });
      audio?.uiTick?.();
      return;
    }
    if (/^[0-9]$/.test(event.key)) {
      const index = event.key === '0' ? 9 : Number(event.key) - 1;
      if (entries[index]) {
        event.stopPropagation();
        event.preventDefault();
        if (entries[index].available !== false) choose(index);
        else highlight(index, { focus: true });
      }
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !indexes.length) return;
    event.stopPropagation();
    event.preventDefault();
    const at = Math.max(0, indexes.indexOf(selectedIndex));
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    highlight(indexes[(at + direction + indexes.length) % indexes.length], { focus: true });
    audio?.uiTick?.();
  }

  root.addEventListener('keydown', onKeyDown, true);
  root.addEventListener('pointerdown', (event) => event.stopPropagation());

  function show(nextEntries, currentId = null) {
    entries = nextEntries.map((entry) => ({ available: true, ...entry }));
    root.classList.toggle('is-dense', entries.length > 8);
    ring.replaceChildren(...entries.map((entry, index) => el('button', {
      type: 'button',
      class: `tool-wheel-item${entry.available === false ? ' is-disabled' : ''}`,
      role: 'option',
      'aria-disabled': String(entry.available === false),
      'aria-label': entry.available === false ? `${entry.label}, unavailable: ${entry.reason || 'locked'}` : entry.label,
      style: `--tool-index:${index};--tool-count:${entries.length}`,
      onmouseenter: () => { highlight(index); audio?.uiTick?.(); },
      onfocus: () => highlight(index),
      onclick: () => entry.available === false ? audio?.uiError?.() : choose(index),
    },
    el('span', { class: 'tool-wheel-number', 'aria-hidden': 'true', text: index === 9 ? '0' : String(index + 1) }),
    el('span', { class: 'tool-wheel-icon', 'aria-hidden': 'true', text: entry.icon || '◇' }),
    el('span', { class: 'tool-wheel-label', text: entry.label }),
    entry.available === false ? el('span', { class: 'tool-wheel-lock', 'aria-hidden': 'true', text: '×' }) : null)));
    selectedIndex = Math.max(0, entries.findIndex((entry) => entry.id === currentId && entry.available !== false));
    if (selectedIndex < 0 || entries[selectedIndex]?.available === false) selectedIndex = selectableIndexes()[0] ?? 0;
    root.style.display = '';
    document.body.classList.add('tool-wheel-open');
    open = true;
    highlight(selectedIndex);
    releaseFocus = containFocus(root.querySelector('.tool-wheel-panel'), { initialFocus: ring.children[selectedIndex] });
  }

  return {
    root,
    show,
    close,
    choose,
    isOpen: () => open,
    selected: () => entries[selectedIndex] || null,
  };
}
