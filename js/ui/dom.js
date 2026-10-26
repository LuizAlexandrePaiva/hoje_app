// Utilitários mínimos de interface (sem framework).

/** h('div', { class: 'x', onclick }, filho1, filho2…) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  append(el, children);
  return el;
}

// ---------- folha modal (bottom sheet) ----------

let openSheet = null;

/**
 * Abre uma folha modal. `build(close)` devolve o conteúdo.
 * Fecha ao tocar fora ou no botão voltar do Android (via histórico).
 */
export function sheet(title, build, { onClose } = {}) {
  // Trocar de folha reaproveita a entrada de histórico já criada
  const previous = openSheet;
  if (previous) {
    openSheet = null;
    previous.onClose?.();
    previous.backdrop.remove();
  }
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const close = () => closeSheet();
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: close }, '✕')),
    h('div', { class: 'sheet-body' }, build(close)));
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.append(panel);
  document.body.append(backdrop);
  document.body.classList.add('no-scroll');
  let onPop = previous?.onPop;
  if (!onPop) {
    history.pushState({ sheet: true }, '');
    onPop = () => closeSheet(true);
    window.addEventListener('popstate', onPop, { once: true });
  }
  openSheet = { backdrop, onPop, onClose };
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    const first = panel.querySelector('input:not([type=checkbox]):not([type=radio]), select');
    if (first && !first.dataset.noautofocus) first.focus({ preventScroll: true });
  });
}

export function closeSheet(fromPop = false) {
  if (!openSheet) return;
  const { backdrop, onPop, onClose } = openSheet;
  openSheet = null;
  onClose?.();
  window.removeEventListener('popstate', onPop);
  backdrop.remove();
  document.body.classList.remove('no-scroll');
  if (!fromPop && history.state?.sheet) history.back();
}

/** Fecha a folha aberta (se houver) e só então executa fn — evita corrida com history.back(). */
export function afterSheetClosed(fn) {
  if (openSheet && history.state?.sheet) {
    window.addEventListener('popstate', () => setTimeout(fn), { once: true });
    closeSheet();
  } else {
    closeSheet();
    fn();
  }
}

// ---------- toast ----------

let toastTimer = null;

export function toast(message, action) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast', role: 'status' },
    h('span', {}, message),
    action && h('button', {
      class: 'toast-action',
      onclick: () => { el.remove(); action.run(); },
    }, action.label));
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), action ? 6000 : 3000);
}

export function confirmDialog(title, message, okLabel = 'Confirmar', danger = false) {
  return new Promise((resolve) => {
    let answer = false;
    sheet(title, (close) => [
      h('p', { class: 'muted' }, message),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn ghost grow', onclick: close }, 'Cancelar'),
        h('button', { class: `btn grow ${danger ? 'danger' : 'primary'}`, onclick: () => { answer = true; close(); } }, okLabel)),
    ], { onClose: () => resolve(answer) });
  });
}
