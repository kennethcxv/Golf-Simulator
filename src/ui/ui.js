// FAIRWAY STATE — tiny DOM helpers, toasts, and modals. No framework, no magic.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

let toastWrap = null;

export function toast(msg, kind = '', options = {}) {
  if (!toastWrap) {
    toastWrap = el('div', { class: 'toast-wrap', 'aria-live': 'polite' });
    document.getElementById('ui').append(toastWrap);
  }
  // Repeated simulation notices used to stack over the active work until the
  // register was hidden behind a wall of identical cards. Keep a short, recent
  // queue and collapse duplicates; checkout's live stage HUD carries the durable
  // instruction.
  const channel = options && options.channel ? String(options.channel) : '';
  if (channel) {
    // The checkout HUD owns the durable instruction; its toast is only the most
    // recent physical response. Replacing that response prevents an old failure
    // (or "all bagged") from sitting under a later success.
    [...toastWrap.children]
      .filter((node) => node.dataset.channel === channel)
      .forEach((node) => node.remove());
  }
  const duplicate = [...toastWrap.children].find((node) => node.dataset.message === msg);
  if (duplicate) return;
  const limit = document.body.classList.contains('register-mode') ? 2 : 4;
  while (toastWrap.children.length >= limit) toastWrap.firstElementChild.remove();
  const t = el('div', { class: `toast ${kind}`, text: msg, role: 'status', 'data-message': msg });
  if (channel) t.dataset.channel = channel;
  toastWrap.append(t);
  setTimeout(() => {
    t.style.transition = 'opacity 0.35s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 380);
  }, 2600);
}

export function modal(title, buildBody) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const box = el('div', { class: 'modal' });
  box.append(el('h2', { text: title }));
  const close = () => backdrop.remove();
  buildBody(box, close);
  backdrop.append(box);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  document.getElementById('ui').append(backdrop);
  return close;
}
