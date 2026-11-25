// Área visível da tela, para a folha modal ficar inteira acima do teclado.
//
// No iPhone o teclado não encolhe a página: ele cobre a parte de baixo, e só
// window.visualViewport sabe o que continuou à vista. Quando o campo em foco
// ficaria coberto, o Safari ainda empurra a página inteira para cima. Este
// módulo publica a área visível em <html>:
//   --view-h    altura visível (o que sobra acima do teclado)
//   --view-top  quanto a área visível desceu em relação à tela (página empurrada)
//   classe kb   teclado aberto (kb-short quando sobra pouca altura à vista)
// O aparelho só informa a medida nova quando a animação do teclado termina. Para
// a folha não esperar atrás dele, o módulo adianta o resultado no instante do
// foco, com a última altura de teclado medida neste aparelho: a folha já aparece
// acima do teclado, o Safari não precisa empurrar nada e nada pula depois. A
// medida real sempre prevalece assim que chega.

const vv = window.visualViewport;
const root = document.documentElement;

const STORE_KEY = 'hoje:teclado';
/** Menos que isto é a barra de acessórios de um teclado físico, não o teclado. */
const MIN_KEYBOARD = 120;
/** Prazo para o teclado esperado aparecer (ou sumir) antes de voltar à medida real. */
const WAIT_MS = 1500;
/** Sem medida nova por este tempo, a animação do teclado acabou. */
const SETTLE_MS = 160;
/** Com o teclado aberto, abaixo desta altura visível a folha aperta os espaços para o formulário caber. */
const SHORT_VIEW = 420;
/** Sem nenhuma medida ainda: em telefone o teclado ocupa perto disto da altura da tela. */
const PHONE_KEYBOARD_SHARE = 0.45;
const PHONE_MAX_WIDTH = 500;

const TYPING_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password']);

/** Palpite em vigor enquanto o teclado anima: { open, inset, kind, wait, settle }. */
let guess = null;
let open = false;
const listeners = new Set();

/** O campo abre o teclado ao receber foco? (data, seletor e chave abrem outra coisa ou nada) */
export function opensKeyboard(el) {
  if (!el || el.nodeType !== 1 || el.disabled || el.readOnly) return false;
  if (el.getAttribute('inputmode') === 'none') return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  return el.tagName === 'INPUT' && TYPING_TYPES.has(el.type);
}

export function keyboardOpen() {
  return open;
}

/** Avisa quando a área visível muda (teclado abriu, fechou ou a página foi empurrada). */
export function onViewportChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- o toque em andamento ----------

// O iPhone só abre o teclado para um foco feito durante o tratamento de um toque
// ou de uma tecla. Fora disso o campo ganha o foco, mas o teclado não vem; então
// só vale adiantar a folha quando o foco nasce de um gesto.
let gesture = false;
function markGesture(e) {
  if (!e.isTrusted) return;
  gesture = true;
  setTimeout(() => { gesture = false; }, 0);
}
for (const type of ['pointerup', 'touchend', 'mousedown', 'click', 'keydown']) window.addEventListener(type, markGesture, true);

export function inGesture() {
  return gesture;
}

// ---------- altura do teclado já medida neste aparelho ----------

function readStore() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

/** Teclado de texto e teclado numérico têm alturas diferentes, e cada orientação a sua. */
function slot(el) {
  const kind = el.getAttribute('inputmode') || (el.type === 'tel' || el.type === 'number' ? 'numeric' : 'text');
  return `${window.innerWidth > window.innerHeight ? 'deitado' : 'em-pe'}:${kind}`;
}

/** Marca de que o teclado esperado não veio (teclado físico, por exemplo): até vir um, nada de adiantar. */
const NO_KEYBOARD = 'sem-teclado';

function writeStore(data) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* sem espaço: o palpite fica só para esta visita */ }
}

/** Guarda a altura medida do teclado (ou, com 0, que ele não veio). */
function remember(key, inset) {
  const data = readStore();
  const value = Math.round(inset);
  if (value < MIN_KEYBOARD) {
    if (data[NO_KEYBOARD]) return;
    data[NO_KEYBOARD] = true;
  } else {
    if (data[key] === value && !data[NO_KEYBOARD]) return;
    data[key] = value;
    delete data[NO_KEYBOARD];
  }
  writeStore(data);
}

/** Altura esperada do teclado para o campo: a medida guardada ou, em telefone, uma estimativa. 0 = não adiantar. */
function recall(key) {
  const data = readStore();
  if (data[NO_KEYBOARD]) return 0;
  const saved = data[key];
  if (Number.isFinite(saved) && saved >= MIN_KEYBOARD) return saved < window.innerHeight ? saved : 0;
  const phone = window.matchMedia?.('(pointer: coarse)').matches && Math.min(window.innerWidth, window.innerHeight) <= PHONE_MAX_WIDTH;
  return phone ? Math.round(window.innerHeight * PHONE_KEYBOARD_SHARE) : 0;
}

// ---------- medida e publicação ----------

/** O que o aparelho informa agora; null quando não dá para confiar (sem a API ou com zoom de pinça). */
function measure() {
  if (!vv || Math.abs(vv.scale - 1) > 0.01) return null;
  return { height: vv.height, top: Math.max(0, vv.offsetTop), inset: Math.max(0, window.innerHeight - vv.height) };
}

function publish(height, top, isOpen) {
  const h = `${Math.round(height * 100) / 100}px`;
  const t = `${Math.round(top * 100) / 100}px`;
  const changed = root.style.getPropertyValue('--view-h') !== h || root.style.getPropertyValue('--view-top') !== t || open !== isOpen;
  if (!changed) return;
  root.style.setProperty('--view-h', h);
  root.style.setProperty('--view-top', t);
  root.classList.toggle('kb', isOpen);
  root.classList.toggle('kb-short', isOpen && height < SHORT_VIEW);
  open = isOpen;
  for (const fn of listeners) fn();
}

function unpublish() {
  if (!open && !root.style.getPropertyValue('--view-h')) return;
  root.style.removeProperty('--view-h');
  root.style.removeProperty('--view-top');
  root.classList.remove('kb', 'kb-short');
  open = false;
  for (const fn of listeners) fn();
}

function dropGuess() {
  if (!guess) return null;
  clearTimeout(guess.wait);
  clearTimeout(guess.settle);
  const g = guess;
  guess = null;
  return g;
}

/** A animação acabou (ou o prazo venceu): vale o que o aparelho informa. */
function endGuess() {
  const g = dropGuess();
  const m = measure();
  // teclado que não veio também fica anotado, para a folha não subir à toa de novo
  if (g?.open && m) remember(g.key, m.inset);
  sync();
}

function startGuess(next) {
  dropGuess();
  guess = next;
  guess.wait = setTimeout(endGuess, WAIT_MS);
  sync();
}

function sync() {
  const m = measure();
  if (!m) { dropGuess(); return unpublish(); }
  const isOpen = m.inset >= MIN_KEYBOARD;
  if (!guess) {
    if (isOpen && opensKeyboard(document.activeElement)) remember(slot(document.activeElement), m.inset);
    return publish(m.height, m.top, isOpen);
  }
  if (guess.open === isOpen) {
    // a medida real chegou; espera assentar, porque podem vir medidas no meio da animação
    clearTimeout(guess.settle);
    guess.settle = setTimeout(endGuess, SETTLE_MS);
  }
  if (guess.open) publish(window.innerHeight - Math.max(guess.inset, m.inset), m.top, true);
  else publish(window.innerHeight, m.top, false);
}

/**
 * O campo vai receber (ou acabou de receber) o foco. Se isso abre o teclado,
 * adianta a área visível para a folha já ficar acima dele.
 */
export function expectKeyboard(el) {
  if (!opensKeyboard(el)) return;
  const m = measure();
  if (!m) return;
  if (m.inset >= MIN_KEYBOARD) {
    // o teclado continua aberto: se a folha já contava com ele fechado, desfaz
    if (guess && !guess.open) { dropGuess(); sync(); }
    return;
  }
  if (guess?.open || !gesture) return;
  const key = slot(el);
  const inset = recall(key);
  if (inset) startGuess({ open: true, inset, key });
}

/** O foco saiu dos campos de digitar: o teclado vai fechar, e a folha já pode descer. */
export function expectNoKeyboard() {
  const m = measure();
  if (!m) return;
  if (guess?.open) { dropGuess(); return sync(); }
  if (m.inset < MIN_KEYBOARD || guess) return;
  startGuess({ open: false });
}

if (vv) {
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  window.addEventListener('pageshow', sync);
  sync();
}
