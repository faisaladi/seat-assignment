// Tiny DOM helpers — no framework, just readable element creation.

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, any> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') el.setAttribute('style', value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value' && 'value' in el) (el as any).value = value;
    else if (key === 'checked' && 'checked' in el) (el as any).checked = value;
    else if (key === 'disabled' && 'disabled' in el) (el as any).disabled = value;
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity as 1)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function toast(message: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = h('div', { class: 'toast-host' });
    document.body.append(host);
  }
  const el = h('div', { class: `toast toast-${kind}` }, message);
  host.append(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 4200);
}

export function modal(title: string, body: HTMLElement, actions: HTMLElement[]): { close: () => void } {
  const overlay = h('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  const box = h(
    'div',
    { class: 'modal' },
    h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'btn-icon', onClick: close, title: 'Close' }, '✕')),
    h('div', { class: 'modal-body' }, body),
    h('div', { class: 'modal-actions' }, ...actions),
  );
  overlay.append(box);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
  return { close };
}

export function confirmDialog(title: string, message: string, confirmLabel = 'Yes, continue'): Promise<boolean> {
  return new Promise((resolve) => {
    const m = modal(title, h('p', {}, message), [
      h('button', { class: 'btn', onClick: () => { m.close(); resolve(false); } }, 'Cancel'),
      h('button', { class: 'btn btn-primary', onClick: () => { m.close(); resolve(true); } }, confirmLabel),
    ]);
  });
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function emptyState(icon: string, title: string, lines: string[]): HTMLElement {
  return h(
    'div',
    { class: 'empty-state' },
    h('div', { class: 'empty-icon' }, icon),
    h('h3', {}, title),
    ...lines.map((l) => h('p', {}, l)),
  );
}
