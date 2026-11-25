// Utilitários mínimos de interface (sem framework).

import { icon } from './icons.js';
import { opensKeyboard, expectKeyboard, expectNoKeyboard, keyboardOpen, onViewportChange } from './viewport.js';

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

// ---------- valor em destaque ----------

/**
 * Valor em dinheiro com a parte inteira em evidência: "R$" e centavos menores.
 * Recebe o texto já formatado ("R$ 124,93"); o textContent continua igual.
 */
export function amountParts(text) {
  const m = /^(.*?R\$\s?)(.*?)(,\d{2})?$/.exec(text);
  return m ? [h('span', { class: 'cur' }, m[1]), m[2], m[3] && h('span', { class: 'dec' }, m[3])].filter(Boolean) : [text];
}

export function amount(text, cls = '', attrs = {}) {
  return h('span', { class: `amount ${cls}`.trim(), ...attrs }, amountParts(text));
}

// ---------- texto que precisa caber ----------

const FIT_MIN_PX = 12;

/** Reduz a fonte dos elementos [data-fit] até o texto caber na largura. */
export function fitText(root = document) {
  for (const el of root.querySelectorAll('[data-fit]')) {
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && size > FIT_MIN_PX) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
  }
}

// ---------- folha modal (bottom sheet) ----------

let openSheet = null;
let sheetSeq = 0;

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

/** Conteúdo atrás da folha fica inerte: o foco e o leitor de tela não chegam nele. */
function setBackgroundInert(on) {
  for (const id of ['main', 'tabbar']) {
    const el = document.getElementById(id);
    if (el) el.inert = on;
  }
}

function focusables(panel) {
  return [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Distância mínima entre o campo em foco e o teclado. Abaixo de 50 px o Safari
 * do iPhone empurra a página inteira para "mostrar melhor" o campo.
 */
const KEYBOARD_GAP = 58;

/** Mantém o campo em foco à vista dentro da folha (o foco é feito sem rolagem do navegador). */
function reveal(el = document.activeElement) {
  const panel = openSheet?.panel;
  if (!panel || !el || el === panel || !panel.contains(el)) return;
  const box = (el.closest('.field, .inline-field, .switch-row') || el).getBoundingClientRect();
  const view = panel.getBoundingClientRect();
  const top = view.top + (panel.querySelector('.sheet-head')?.offsetHeight || 0) + 4;
  const bottom = view.bottom - (keyboardOpen() ? KEYBOARD_GAP : 12);
  if (box.bottom > bottom) panel.scrollTop += Math.min(box.bottom - bottom, box.top - top);
  else if (box.top < top) panel.scrollTop -= top - box.top;
}

/** Foco em um campo da folha, sem deixar o navegador rolar a página para alcançá-lo. */
export function focusField(el) {
  if (!el) return;
  expectKeyboard(el);
  el.focus({ preventScroll: true });
  reveal(el);
}

// O teclado abriu, fechou ou trocou de tamanho: o campo em foco continua à vista
// e, com o teclado fechado, a página atrás volta ao lugar se tiver sido empurrada.
onViewportChange(() => {
  if (!openSheet) return;
  reveal();
  if (!keyboardOpen() && Math.abs(window.scrollY - openSheet.scrollY) > 1) window.scrollTo(window.scrollX, openSheet.scrollY);
});

// Esc fecha e Tab circula dentro da folha aberta.
document.addEventListener('keydown', (e) => {
  if (!openSheet) return;
  const panel = openSheet.panel;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeSheet();
  } else if (e.key === 'Tab') {
    const items = focusables(panel);
    if (!items.length) { e.preventDefault(); panel.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const inside = panel.contains(document.activeElement);
    if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
  }
});

/**
 * Abre uma folha modal. `build(close)` devolve o conteúdo.
 * Fecha ao tocar fora, com Esc ou no botão voltar do Android (via histórico).
 * O foco entra na folha e volta para quem a abriu ao fechar.
 */
export function sheet(title, build, { onClose } = {}) {
  document.querySelector('.toast')?.remove();
  // Trocar de folha reaproveita a entrada de histórico já criada
  const previous = openSheet;
  const returnFocus = previous ? previous.returnFocus : document.activeElement;
  const scrollY = previous ? previous.scrollY : window.scrollY;
  if (previous) {
    openSheet = null;
    previous.onClose?.();
    previous.backdrop.remove();
  }
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const close = () => closeSheet();
  const titleId = `folha-${++sheetSeq}`;
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('div', { class: 'sheet-head' },
      h('h2', { id: titleId }, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: close }, icon('close'))),
    h('div', { class: 'sheet-body' }, build(close)));
  // Tocar fora fecha, mas só quando o toque começou e terminou no fundo: ao focar
  // um campo a folha sobe, e o fim desse mesmo toque cairia no fundo.
  let pressedOutside = false;
  backdrop.addEventListener('pointerdown', (e) => { pressedOutside = e.target === backdrop; });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && pressedOutside) close();
    pressedOutside = false;
  });
  // Teclado: a folha sobe no instante do foco e desce quando o foco sai dos campos de digitar.
  let leaving = 0;
  backdrop.addEventListener('focusin', (e) => {
    clearTimeout(leaving);
    expectKeyboard(e.target);
    reveal(e.target);
  });
  backdrop.addEventListener('focusout', (e) => {
    if (!opensKeyboard(e.target) || opensKeyboard(e.relatedTarget)) return;
    // foi para a data ou para um seletor: a folha desce já, antes de o calendário ou a lista abrir ao lado do campo
    if (e.relatedTarget?.matches?.('input, select')) return expectNoKeyboard();
    // senão, um instante de espera: o toque em um botão pode devolver o foco a um campo
    leaving = setTimeout(() => { if (!opensKeyboard(document.activeElement)) expectNoKeyboard(); }, 100);
  });
  // Com o teclado aberto o iPhone deixa arrastar a página inteira. A folha fica
  // parada: só o conteúdo dela rola, quando não cabe.
  backdrop.addEventListener('touchmove', (e) => {
    if (!e.cancelable || e.touches.length > 1) return;
    const scrolls = panel.scrollHeight > panel.clientHeight + 1;
    if (!scrolls || !panel.contains(e.target)) e.preventDefault();
  }, { passive: false });
  backdrop.append(panel);
  document.body.append(backdrop);
  document.body.classList.add('no-scroll');
  setBackgroundInert(true);
  let onPop = previous?.onPop;
  if (!onPop) {
    history.pushState({ sheet: true }, '');
    onPop = () => closeSheet(true);
    window.addEventListener('popstate', onPop, { once: true });
  }
  openSheet = { backdrop, panel, onPop, onClose, returnFocus, scrollY };
  fitText(panel);
  // Campo de digitar recebe o foco já, dentro do toque que abriu a folha: no iPhone
  // o teclado só sobe assim. Seletor e data esperam, para não abrir sozinhos.
  const first = panel.querySelector('input:not([type=checkbox]):not([type=radio]), select');
  const autofocus = first && !first.dataset.noautofocus ? first : null;
  if (opensKeyboard(autofocus)) focusField(autofocus);
  else expectNoKeyboard(); // a folha anterior tinha o teclado aberto e esta não vai usar
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    if (panel.contains(document.activeElement)) return; // o foco já foi escolhido
    if (autofocus) autofocus.focus({ preventScroll: true });
    else panel.focus({ preventScroll: true });
  });
}

export function closeSheet(fromPop = false) {
  if (!openSheet) return;
  const { backdrop, onPop, onClose, returnFocus, scrollY } = openSheet;
  openSheet = null;
  onClose?.();
  window.removeEventListener('popstate', onPop);
  backdrop.remove();
  document.body.classList.remove('no-scroll');
  setBackgroundInert(false);
  expectNoKeyboard();
  // o iPhone pode ter empurrado a página para mostrar um campo: ela volta para onde estava
  if (Math.abs(window.scrollY - scrollY) > 1) window.scrollTo(window.scrollX, scrollY);
  if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus({ preventScroll: true });
  if (!fromPop && history.state?.sheet) history.back();
}

/** Fecha a folha aberta (se houver) e só então executa fn, evitando corrida com history.back(). */
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

/** Tempo para ler: cresce com o texto (3 a 9 s); com ação, pelo menos 6 s. */
function toastDuration(message, action) {
  const reading = Math.min(9000, Math.max(3000, 1500 + String(message).length * 55));
  return action ? Math.max(6000, reading) : reading;
}

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
  const ms = toastDuration(message, action);
  toastTimer = setTimeout(() => el.remove(), ms);
  // tocar ou focar o aviso pausa o tempo
  el.addEventListener('pointerdown', () => clearTimeout(toastTimer));
  el.addEventListener('focusin', () => clearTimeout(toastTimer));
  el.addEventListener('focusout', () => { toastTimer = setTimeout(() => el.remove(), 3000); });
}

/** "Salário, Aluguel e Fatura": lista em português. */
export function joinList(items) {
  return new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' }).format(items);
}

export function confirmDialog(title, message, okLabel = 'Confirmar', danger = false) {
  return new Promise((resolve) => {
    let answer = false;
    sheet(title, (close) => [
      h('p', { class: 'sheet-lead' }, message),
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn grow', onclick: close }, 'Cancelar'),
        h('button', { class: `btn grow ${danger ? 'danger' : 'primary'}`, onclick: () => { answer = true; close(); } }, okLabel)),
    ], { onClose: () => resolve(answer) });
  });
}
