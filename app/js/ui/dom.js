// Utilitários mínimos de interface (sem framework).

import { icon } from './icons.js';
import { IOS, opensKeyboard, expectKeyboard, keyboardLeft, keyboardLeaving, keyboardOpen, inGesture, onViewportChange } from './viewport.js';

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

/**
 * O texto passa da largura? scrollWidth arredonda para pixel inteiro, e onde a
 * sobra vira reticências qualquer fração já corta o fim do texto ("8 de nov de
 * 20…"); nesse caso a medida é feita com fração de pixel.
 */
function overflows(el) {
  if (el.scrollWidth > el.clientWidth + 1) return true;
  if (getComputedStyle(el).textOverflow !== 'ellipsis') return false;
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.01;
}

/** Reduz a fonte dos elementos [data-fit] até o texto caber na largura. */
export function fitText(root = document) {
  for (const el of root.querySelectorAll('[data-fit]')) {
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (size > FIT_MIN_PX && overflows(el)) {
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
 * Folga entre o campo em foco e o teclado. Quem impede o Safari de empurrar a
 * página é o foco com preventScroll; a folga mantém o cursor à vista quando o
 * teclado troca de altura (texto e numérico) e deixa a data longe da borda:
 * para campo sem teclado o Safari empurra o que estiver a menos de 50 px dele.
 */
const KEYBOARD_GAP = 58;
const FIELD = 'input:not([type=checkbox]):not([type=radio]), select, textarea';

/**
 * Mantém o campo à vista dentro da folha, rolando só a própria folha. Só vale
 * para campos: rolar por causa do foco em um botão tiraria o botão de baixo do
 * dedo no meio do toque. `any` aceita qualquer elemento (navegação por Tab).
 */
function reveal(el = document.activeElement, any = false) {
  const panel = openSheet?.panel;
  if (!panel || !el || el === panel || !panel.contains(el) || !(any || el.matches(FIELD))) return;
  const view = panel.getBoundingClientRect();
  const top = view.top + (panel.querySelector('.sheet-head')?.offsetHeight || 0) + 4;
  const bottom = view.bottom - (keyboardOpen() ? KEYBOARD_GAP : 12);
  // o campo com rótulo e erro; se o conjunto não cabe na área, vale só o campo
  let box = (el.closest('label.field, label.inline-field') || el).getBoundingClientRect();
  if (box.height > bottom - top) box = el.getBoundingClientRect();
  if (box.bottom > bottom) panel.scrollTop += Math.min(box.bottom - bottom, box.top - top);
  else if (box.top < top) panel.scrollTop -= top - box.top;
}

/**
 * Foco em um campo da folha sem deixar o navegador rolar a página: a folha se
 * ajusta antes do foco e depois rola só o próprio conteúdo. No iPhone, data e
 * seletor não recebem foco por código: isso abriria o calendário ou a lista.
 */
export function focusField(el) {
  if (!el) return;
  if (IOS && !opensKeyboard(el) && el.matches('input, select')) return reveal(el);
  expectKeyboard(el);
  el.focus({ preventScroll: true });
  reveal(el);
}

/** Rola a folha aberta até `el` ficar no meio dela (sem scrollIntoView, que também move a página). */
export function centerInSheet(el) {
  const panel = openSheet?.panel;
  if (!panel || !el || !panel.contains(el)) return;
  const view = panel.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  panel.scrollTop += box.top + box.height / 2 - (view.top + view.height / 2);
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
    dismissSheet();
  } else if (e.key === 'Tab') {
    const items = focusables(panel);
    const quiet = { preventScroll: true }; // quem mostra o campo é reveal(), sem mover a página
    if (!items.length) { e.preventDefault(); panel.focus(quiet); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const inside = panel.contains(document.activeElement);
    if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(quiet); reveal(last, true); }
    else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(quiet); reveal(first, true); }
  }
});

// Com o teclado aberto o iPhone deixa arrastar a página inteira, e `overflow:
// hidden` não segura. Enquanto há folha aberta, um dedo só rola o conteúdo da
// folha (quando ele não cabe). Ficam livres: a pinça, a tela ampliada e o
// arrasto das alças de uma seleção de texto.
let touchFree = false;
function onTouchStart(e) {
  const t = e.target;
  touchFree = t.type === 'range' || (t === document.activeElement && typeof t.selectionStart === 'number' && t.selectionStart < t.selectionEnd);
}
function onTouchMove(e) {
  if (!openSheet || !e.cancelable || e.touches.length > 1 || touchFree) return;
  if (Math.abs((window.visualViewport?.scale ?? 1) - 1) > 0.01) return;
  const { panel } = openSheet;
  const scrolls = panel.scrollHeight > panel.clientHeight + 1;
  if (!scrolls || !panel.contains(e.target)) e.preventDefault();
}

/** Trava (ou solta) a página atrás da folha. */
function lockPage(on) {
  document.documentElement.classList.toggle('no-scroll', on);
  document.body.classList.toggle('no-scroll', on);
  setBackgroundInert(on);
  const listen = on ? 'addEventListener' : 'removeEventListener';
  document[listen]('touchstart', onTouchStart, { capture: true, passive: true });
  document[listen]('touchmove', onTouchMove, { capture: true, passive: false });
}

/**
 * Abre uma folha modal. `build(close)` devolve o conteúdo.
 * Fecha ao tocar fora, com Esc ou no botão voltar do Android (via histórico).
 * O foco entra na folha e volta para quem a abriu ao fechar.
 * `onDismiss` troca o que esses caminhos (e o X) fazem: a folha aberta de dentro
 * de outra volta para ela em vez de fechar tudo. `close` continua fechando.
 */
export function sheet(title, build, { onClose, onDismiss } = {}) {
  document.querySelector('.toast')?.remove();
  // Trocar de folha reaproveita a entrada de histórico já criada
  const previous = openSheet;
  const returnFocus = previous ? previous.returnFocus : document.activeElement;
  const scrollY = previous ? previous.scrollY : window.scrollY;
  // tirar da tela um campo em foco não gera evento de foco: anota antes se o teclado estava em uso
  const wasTyping = keyboardOpen() && opensKeyboard(document.activeElement);
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
      h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: dismissSheet }, icon('close'))),
    h('div', { class: 'sheet-body' }, build(close)));
  // Tocar fora fecha, mas só quando o toque começou e terminou no fundo: ao focar
  // um campo a folha sobe, e o fim desse mesmo toque cairia no fundo.
  let pressedOutside = false;
  backdrop.addEventListener('pointerdown', (e) => { pressedOutside = e.target === backdrop; });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && pressedOutside) dismissSheet();
    pressedOutside = false;
    // campo que já tinha o foco, com o teclado recolhido: o toque traz o teclado de volta sem evento de foco
    if (e.target === document.activeElement) expectKeyboard(e.target);
  });
  // Teclado: a folha sobe quando um campo de digitar ganha o foco e desce quando o foco sai deles.
  let leaving = 0;
  backdrop.addEventListener('focusin', (e) => {
    if (!opensKeyboard(e.target)) return;
    clearTimeout(leaving);
    expectKeyboard(e.target);
    reveal(e.target);
  });
  backdrop.addEventListener('focusout', (e) => {
    if (!opensKeyboard(e.target) || opensKeyboard(e.relatedTarget)) return;
    // foi para a data ou para um seletor: a folha espera o teclado sair, sem se mexer no meio do toque
    if (e.relatedTarget?.matches?.('input, select')) return keyboardLeaving();
    // senão, um instante de espera: o toque em um botão pode devolver o foco a um campo
    leaving = setTimeout(() => { if (!opensKeyboard(document.activeElement)) keyboardLeft(); }, 100);
  });
  if (IOS) {
    // No iPhone, foco dado por toque (ou pelas setas acima do teclado) faz o Safari
    // empurrar a página para centralizar o campo; só o foco feito por código com
    // preventScroll escapa. Então o foco é refeito aqui, na saída do elemento
    // anterior e ainda dentro do toque: o navegador abandona o foco original.
    backdrop.addEventListener('blur', (e) => {
      if (openSheet?.panel !== panel || !panel.isConnected) return;
      const next = e.relatedTarget;
      if (next && next !== e.target && panel.contains(next) && opensKeyboard(next)) focusField(next);
      // "OK" do teclado (ou fechar o calendário) deixa a página sem foco: ele volta para
      // a folha, para o próximo toque em um campo ser de novo uma troca de foco.
      // Quando o app inteiro perde o foco o elemento continua ativo, e nada muda.
      else if (!next && document.activeElement !== e.target) panel.focus({ preventScroll: true });
    }, true);
  }
  backdrop.append(panel);
  document.body.append(backdrop);
  if (!previous) lockPage(true);
  let onPop = previous?.onPop;
  if (!onPop) {
    history.pushState({ sheet: true }, '');
    // A entrada de histórico é herdada por quem troca de folha, então o destino do
    // "voltar" é lido na hora. Ela já foi gasta: a folha que reabrir cria a sua.
    onPop = () => {
      const reopen = openSheet?.onDismiss;
      closeSheet(true);
      reopen?.();
    };
    window.addEventListener('popstate', onPop, { once: true });
  }
  openSheet = { backdrop, panel, onPop, onClose, onDismiss, returnFocus, scrollY };
  fitText(panel);
  // O foco é decidido já, dentro do toque que abriu a folha, e uma vez só. Campo de
  // digitar: no iPhone o teclado só sobe com foco feito durante o toque (ou se já
  // estava aberto na folha anterior); fora disso o foco fica na folha, e o toque do
  // dono no campo abre o teclado. Data e seletor nunca recebem o foco sozinhos.
  const first = panel.querySelector('input:not([type=checkbox]):not([type=radio]), select');
  const field = first && !first.dataset.noautofocus && opensKeyboard(first) ? first : null;
  if (field && (!IOS || inGesture() || wasTyping)) focusField(field);
  else {
    panel.focus({ preventScroll: true });
    keyboardLeft();
  }
  requestAnimationFrame(() => backdrop.classList.add('open'));
}

/** X, toque fora e Esc: volta para a folha de onde esta veio, ou fecha. */
function dismissSheet() {
  if (openSheet?.onDismiss) openSheet.onDismiss();
  else closeSheet();
}

export function closeSheet(fromPop = false) {
  if (!openSheet) return;
  const { backdrop, onPop, onClose, returnFocus, scrollY } = openSheet;
  openSheet = null;
  onClose?.();
  window.removeEventListener('popstate', onPop);
  backdrop.remove();
  lockPage(false);
  keyboardLeft();
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
