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

export function toast(msg, kind = '') {
  if (!toastWrap) {
    toastWrap = el('div', { class: 'toast-wrap' });
    document.getElementById('ui').append(toastWrap);
  }
  const t = el('div', { class: `toast ${kind}`, text: msg });
  toastWrap.append(t);
  setTimeout(() => {
    t.style.transition = 'opacity 0.35s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 380);
  }, 2600);
}

export function modal(title, buildBody, onClose = null) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const box = el('div', { class: 'modal' });
  box.append(el('h2', { text: title }));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    if (onClose) onClose();
  };
  buildBody(box, close);
  backdrop.append(box);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  document.getElementById('ui').append(backdrop);
  return close;
}
