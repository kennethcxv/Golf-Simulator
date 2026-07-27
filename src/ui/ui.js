// Shared DOM primitives, accessible dialogs, formatted prompts, and the single
// notification queue used by every player-facing system.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    // Boolean attributes (disabled, checked, ...) are present/absent, not "true"/"false":
    // setAttribute('disabled', false) yields disabled="false", which still disables the node.
    else if (value === true) node.setAttribute(key, '');
    else if (value === false) node.removeAttribute(key);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function containFocus(container, { onEscape, initialFocus } = {}) {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const onKeyDown = (event) => {
    // A dialog owns its keyboard. Stopping propagation here prevents gameplay's
    // global shortcuts from consuming Tab, Space, or letters behind the menu.
    event.stopPropagation();
    if (event.key === 'Escape' && onEscape) {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...container.querySelectorAll(FOCUSABLE)].filter((node) => {
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
    });
    if (!focusable.length) {
      event.preventDefault();
      container.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', onKeyDown);
  queueMicrotask(() => {
    const requested = typeof initialFocus === 'string' ? container.querySelector(initialFocus) : initialFocus;
    (requested || container.querySelector('[autofocus]') || container.querySelector(FOCUSABLE) || container).focus();
  });
  return () => {
    container.removeEventListener('keydown', onKeyDown);
    if (previous?.isConnected) previous.focus();
  };
}

const CATEGORY = {
  objective: { label: 'Objective', icon: '✓', priority: 55, duration: 4200 },
  delivery: { label: 'Delivery', icon: '▣', priority: 65, duration: 6000 },
  'low-stock': { label: 'Low stock', icon: '!', priority: 60, duration: 6500 },
  booking: { label: 'Booking', icon: '◆', priority: 60, duration: 5000 },
  checkout: { label: 'Checkout', icon: '✓', priority: 70, duration: 4800 },
  'save-success': { label: 'Saved', icon: '✓', priority: 75, duration: 4200 },
  'save-failure': { label: 'Save failed', icon: '!', priority: 100, duration: 0 },
  invalid: { label: 'Not available', icon: '!', priority: 85, duration: 2500 }, // refusal-class: was 5600, capped so it can't linger over unrelated moments
  upgrade: { label: 'Upgrade', icon: '↑', priority: 60, duration: 5000 },
  review: { label: 'Review', icon: '★', priority: 55, duration: 5200 },
  maintenance: { label: 'Maintenance', icon: '!', priority: 70, duration: 6200 },
  success: { label: 'Complete', icon: '✓', priority: 50, duration: 4000 },
  info: { label: 'Update', icon: 'i', priority: 35, duration: 4200 },
};

let notificationRoot = null;
let nextNotificationId = 1;
const visibleNotifications = [];
const queuedNotifications = [];
const recentNotifications = new Map();
const MAX_VISIBLE = 3;

// The shed scene scopes notifications: course/campaign banners are suppressed so only
// shed-relevant (tagged shedScoped) and save-failure notices surface. Set once by main.js
// at boot; null in normal play, so the whole gate below is inert everywhere else.
let notificationScope = null;
export function setNotificationScope(scope) { notificationScope = scope || null; }

function ensureNotificationRoot() {
  if (notificationRoot?.isConnected) return notificationRoot;
  notificationRoot = el('div', {
    class: 'notification-center',
    'aria-label': 'Notifications',
    'aria-live': 'polite',
    'aria-relevant': 'additions text',
  });
  document.getElementById('ui').append(notificationRoot);
  return notificationRoot;
}

function scheduleDismiss(item) {
  clearTimeout(item.timer);
  if (item.persistent || item.duration <= 0) return;
  item.timer = setTimeout(() => dismissNotification(item.id), item.duration);
}

function showNextNotification() {
  while (visibleNotifications.length < MAX_VISIBLE && queuedNotifications.length) {
    queuedNotifications.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    const item = queuedNotifications.shift();
    const spec = CATEGORY[item.category] || CATEGORY.info;
    const message = el('div', { class: 'notification-message', text: item.message });
    const count = el('span', { class: 'notification-count', style: 'display:none' });
    const node = el('article', {
      class: `notification notification-${item.category}`,
      role: item.priority >= 80 ? 'alert' : 'status',
      'data-notification-id': item.id,
    },
    el('div', { class: 'notification-mark', 'aria-hidden': 'true', text: spec.icon }),
    el('div', { class: 'notification-copy' },
      el('div', { class: 'notification-kicker' }, spec.label, count),
      message,
    ),
    el('button', {
      class: 'notification-dismiss',
      type: 'button',
      title: 'Dismiss notification',
      'aria-label': `Dismiss ${spec.label.toLowerCase()} notification`,
      text: '×',
      onclick: () => dismissNotification(item.id),
    }));
    item.node = node;
    item.messageNode = message;
    item.countNode = count;
    visibleNotifications.push(item);
    ensureNotificationRoot().append(node);
    scheduleDismiss(item);
  }
}

export function dismissNotification(id) {
  const activeIndex = visibleNotifications.findIndex((item) => item.id === id);
  if (activeIndex >= 0) {
    const [item] = visibleNotifications.splice(activeIndex, 1);
    clearTimeout(item.timer);
    item.node?.classList.toggle('is-leaving', true);
    setTimeout(() => item.node?.remove(), 180);
    setTimeout(showNextNotification, 190);
    return true;
  }
  const queuedIndex = queuedNotifications.findIndex((item) => item.id === id);
  if (queuedIndex >= 0) {
    queuedNotifications.splice(queuedIndex, 1);
    return true;
  }
  return false;
}

export function notify({
  message,
  category = 'info',
  priority,
  duration,
  persistent = false,
  dedupeKey,
  shedScoped = false,
} = {}) {
  if (!message) return null;
  // Shed scene: drop course/campaign banners; keep shed-tagged notices and save failures.
  if (notificationScope === 'shed' && !shedScoped && category !== 'save-failure') return null;
  const spec = CATEGORY[category] || CATEGORY.info;
  const key = dedupeKey || `${category}:${message}`;
  const duplicate = [...visibleNotifications, ...queuedNotifications].find((item) => item.dedupeKey === key);
  if (duplicate) {
    // A repeat under a shared key REPLACES the earlier text and re-arms the (now capped) timer, so
    // a fresh refusal supersedes the previous banner instead of stacking a queue of stale ones.
    const text = String(message);
    if (duplicate.message !== text) {
      duplicate.message = text;
      if (duplicate.messageNode) duplicate.messageNode.textContent = text;
      duplicate.createdAt = performance.now();
    }
    duplicate.count += 1;
    if (duplicate.countNode) {
      duplicate.countNode.textContent = ` ×${duplicate.count}`;
      duplicate.countNode.style.display = '';
      scheduleDismiss(duplicate);
    }
    return duplicate.id;
  }
  const now = performance.now();
  if ((recentNotifications.get(key) || -Infinity) > now - 2500) return null;
  recentNotifications.set(key, now);
  if (recentNotifications.size > 200) {
    for (const [oldKey, at] of recentNotifications) if (at < now - 30_000) recentNotifications.delete(oldKey);
  }
  const item = {
    id: nextNotificationId++,
    message: String(message),
    category,
    priority: priority ?? spec.priority,
    duration: duration ?? spec.duration,
    persistent,
    dedupeKey: key,
    count: 1,
    createdAt: now,
    timer: null,
    node: null,
  };
  queuedNotifications.push(item);
  showNextNotification();
  return item.id;
}

export function clearNotifications(predicate = () => true) {
  for (const item of [...visibleNotifications, ...queuedNotifications]) {
    if (predicate(item)) dismissNotification(item.id);
  }
}

// Compatibility name used by the course editor while the rest of the game
// moves to the categorized notification center.
export function clearToasts() {
  clearNotifications();
}

function inferCategory(message, kind) {
  const text = String(message).toLowerCase();
  if (kind === 'warn' || kind === 'danger') return 'invalid';
  if (kind === 'good') return 'success';
  if (text.includes('saved')) return text.includes('fail') ? 'save-failure' : 'save-success';
  if (text.includes('delivery') || text.includes('ships today') || text.includes('van')) return 'delivery';
  if (text.includes('checked in') || text.includes('booking')) return 'booking';
  if (text.includes('checkout') || text.includes('receipt') || text.includes('card')) return 'checkout';
  if (text.includes('done.') || text.includes('guide')) return 'objective';
  return 'info';
}

// Compatibility entry point for existing gameplay event hooks. New call sites
// can use notify() to supply an explicit category and persistence policy.
export function toast(message, kind = '', options = {}) {
  const category = inferCategory(message, kind);
  // Refusals (warn/danger -> invalid) share one dedupe key so a new refusal REPLACES the previous
  // banner rather than queueing behind stale "not available" toasts. Explicit keys are respected.
  const dedupe = category === 'invalid' && options.dedupeKey === undefined ? { dedupeKey: 'refusal' } : null;
  return notify({ message, category, ...options, ...dedupe });
}

export function modal(title, buildBody, options = {}) {
  const titleId = `dialog-title-${Math.random().toString(36).slice(2)}`;
  const backdrop = el('div', { class: `modal-backdrop${options.backdropClass ? ` ${options.backdropClass}` : ''}` });
  const box = el('div', {
    class: `modal${options.className ? ` ${options.className}` : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    tabindex: '-1',
  });
  box.append(el('h2', { id: titleId, text: title }));
  let closed = false;
  let releaseFocus = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    releaseFocus();
    backdrop.remove();
    options.onClose?.();
  };
  buildBody(box, close);
  backdrop.append(box);
  backdrop.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    if (event.target === backdrop && options.dismissOnBackdrop !== false) close();
  });
  document.getElementById('ui').append(backdrop);
  releaseFocus = containFocus(box, {
    onEscape: options.escape === false ? null : close,
    initialFocus: options.initialFocus,
  });
  return close;
}

export function confirmDialog({
  title,
  message,
  detail,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
}) {
  return modal(title, (box, close) => {
    box.append(
      el('p', { class: 'dialog-message', text: message }),
      detail ? el('p', { class: 'dialog-detail', text: detail }) : null,
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', text: cancelLabel, onclick: close }),
        el('button', {
          type: 'button',
          class: danger ? 'danger' : 'primary',
          text: confirmLabel,
          onclick: async (event) => {
            event.currentTarget.disabled = true;
            try {
              const result = await onConfirm?.();
              if (result !== false) close();
              else event.currentTarget.disabled = false;
            } catch (error) {
              event.currentTarget.disabled = false;
              notify({ message: 'That action could not be completed. Please try again.', category: 'invalid' });
              console.error('confirmed action failed', error);
            }
          },
        }),
      ),
    );
  }, { dismissOnBackdrop: false, initialFocus: '.dialog-actions button' });
}

// Replaces bracketed legacy control tokens with consistent visual keycaps while
// leaving the source text intact for screen readers.
export function setPromptText(node, text) {
  const value = String(text || '');
  if (node.dataset.promptText === value) return false;
  node.dataset.promptText = value;
  node.replaceChildren();
  const pattern = /\[([^\]]+)\]|\b(LMB|RMB|LEFT|RIGHT)\b/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(value))) {
    if (match.index > cursor) node.append(document.createTextNode(value.slice(cursor, match.index)));
    node.append(el('kbd', { class: 'prompt-key', text: match[1] || match[2] }));
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) node.append(document.createTextNode(value.slice(cursor)));
  node.setAttribute('aria-label', value.replace(/\[([^\]]+)\]/g, '$1'));
  return true;
}
