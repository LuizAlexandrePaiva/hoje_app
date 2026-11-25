// Área visível da tela, para a folha modal ficar inteira acima do teclado.
//
// No iPhone o teclado não encolhe a página: ele cobre a parte de baixo, e só
// window.visualViewport sabe o que continuou à vista (innerHeight, vh e dvh não
// mudam). Este módulo publica essa área em <html>:
//   --view-h    altura visível (o que sobra acima do teclado)
//   --view-top  quanto a área visível desceu em relação à tela (página empurrada)
//   classe kb   teclado aberto (kb-short quando sobra pouca altura à vista)
// Sem teclado nada disso é usado: a folha fica como sempre foi.
//
// A medida do aparelho chega alguns quadros depois do foco. Para a folha já
// nascer no lugar, o módulo adianta o resultado no instante do foco com a última
// altura de teclado medida neste aparelho ("palpite"). A medida real prevalece
// assim que chega, e o palpite expira sozinho se o teclado não vier.
//
// "Teclado aberto" exige um campo de digitar em foco: quando o foco sai, a
// folha desce na hora, sem esperar o aparelho (que avisa tarde e, no iOS 26.0,
// às vezes deixa uma medida velha para trás).

const vv = window.visualViewport;
const root = document.documentElement;

const STORE_KEY = 'hoje:teclado';
/** Marca, na memória de alturas, de que o teclado esperado não veio (teclado físico, por exemplo). */
const NO_KEYBOARD = 'sem-teclado';
/** Menos que isto é a barra de acessórios de um teclado físico (ou resto de medida), não o teclado. */
const MIN_KEYBOARD = 120;
/** Prazo para o teclado esperado aparecer antes de voltar à medida real. */
const WAIT_MS = 700;
/** Sem medida nova por este tempo, a animação do teclado acabou. */
const SETTLE_MS = 160;
/** Com o teclado aberto, abaixo desta altura visível a folha aperta os espaços para o formulário caber. */
const SHORT_VIEW = 420;
/** Sem nenhuma medida ainda: em telefone o teclado ocupa perto disto da altura da tela. */
const PHONE_KEYBOARD_SHARE = 0.45;
const PHONE_MAX_WIDTH = 500;

const TYPING_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password']);

/** iPhone e iPad (o iPad se apresenta como Mac com tela de toque). */
export const IOS = /^(iPhone|iPad|iPod)/.test(navigator.platform) || (/^Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);

/** Palpite em vigor enquanto o teclado anima: { inset, key, from, base, wait, settle }. */
let guess = null;
/** O foco foi para um calendário ou seletor: a folha fica onde está até o teclado sair de fato. */
let hold = 0;
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
// só vale adiantar a folha (e focar um campo) quando há um gesto em andamento.
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

function writeStore(data) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* sem espaço: o palpite fica só para esta visita */ }
}

/** Teclado de texto e teclado numérico têm alturas diferentes, e cada orientação a sua. */
function slot(el) {
  const kind = el.getAttribute('inputmode') || (el.type === 'tel' || el.type === 'number' ? 'numeric' : 'text');
  return `${window.innerWidth > window.innerHeight ? 'deitado' : 'em-pe'}:${kind}`;
}

/** Guarda a altura medida do teclado; abaixo do mínimo, anota que ele não veio. */
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

/** Altura já medida para este tipo de teclado (0 se nunca foi medida ou não serve mais). */
function measuredBefore(key) {
  const data = readStore();
  const saved = data[key];
  return !data[NO_KEYBOARD] && Number.isFinite(saved) && saved >= MIN_KEYBOARD && saved < window.innerHeight ? saved : 0;
}

/** Altura esperada do teclado: a medida guardada ou, em telefone, uma estimativa. 0 = não adiantar. */
function expectedInset(key) {
  const saved = measuredBefore(key);
  if (saved || readStore()[NO_KEYBOARD]) return saved;
  const phone = window.matchMedia?.('(pointer: coarse)').matches && Math.min(window.innerWidth, window.innerHeight) <= PHONE_MAX_WIDTH;
  return phone ? Math.round(window.innerHeight * PHONE_KEYBOARD_SHARE) : 0;
}

// ---------- medida e publicação ----------

/** O que o aparelho informa agora; null quando não dá para confiar (sem a API ou com zoom de pinça). */
function measure() {
  if (!vv || Math.abs(vv.scale - 1) > 0.01) return null;
  return { height: vv.height, top: Math.max(0, vv.offsetTop), inset: Math.max(0, window.innerHeight - vv.height) };
}

const px = (n) => `${Math.round(n * 100) / 100}px`;

function publish(height, top, isOpen) {
  const h = px(height);
  const t = px(top);
  if (root.style.getPropertyValue('--view-h') === h && root.style.getPropertyValue('--view-top') === t && open === isOpen) return;
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

function dropHold() {
  clearTimeout(hold);
  hold = 0;
}

/** A animação acabou (ou o prazo venceu): vale o que o aparelho informa. */
function endGuess() {
  const g = dropGuess();
  const m = measure();
  // teclado que não veio também fica anotado, para a folha não subir à toa de novo
  if (g && m) remember(g.key, m.inset);
  sync();
}

function startGuess(inset, key, from) {
  dropGuess();
  guess = { inset, key, from, base: window.innerHeight };
  guess.wait = setTimeout(endGuess, WAIT_MS);
  sync();
}

function sync() {
  const m = measure();
  if (!m) { dropGuess(); dropHold(); return unpublish(); }
  const measured = m.inset >= MIN_KEYBOARD;
  if (!measured) dropHold();
  if (guess) {
    if (guess.base - window.innerHeight >= MIN_KEYBOARD) {
      // este navegador encolhe a própria página para o teclado: não há o que adiantar aqui
      remember(guess.key, 0);
      dropGuess();
    } else {
      // a medida mudou: o teclado está chegando; espera assentar, porque podem vir várias no caminho
      if (measured && Math.abs(m.inset - guess.from) > 1) {
        clearTimeout(guess.settle);
        guess.settle = setTimeout(endGuess, SETTLE_MS);
      }
      return publish(window.innerHeight - Math.max(guess.inset, m.inset), m.top, true);
    }
  }
  const typing = opensKeyboard(document.activeElement);
  if (measured && typing) remember(slot(document.activeElement), m.inset);
  if (measured && (typing || hold)) publish(m.height, m.top, true);
  else publish(m.height, 0, false);
}

/**
 * O campo vai receber o foco (chame ANTES de focar: até o iOS 26 o Safari mede
 * o campo dentro do próprio focus()). Se isso abre ou aumenta o teclado, adianta
 * a área visível para a folha já estar no lugar.
 */
export function expectKeyboard(el) {
  if (!opensKeyboard(el)) return;
  const m = measure();
  if (!m || guess) return;
  dropHold();
  const key = slot(el);
  if (m.inset >= MIN_KEYBOARD) {
    // teclado já aberto: só adianta se o deste campo for mais alto (numérico para texto)
    const next = measuredBefore(key);
    if (next > m.inset + 1) startGuess(next, key, m.inset);
    return;
  }
  if (!gesture) return;
  const inset = expectedInset(key);
  if (inset) startGuess(inset, key, m.inset);
}

/** O foco saiu dos campos de digitar (ou a folha fechou): o teclado vai embora e a folha desce já. */
export function keyboardLeft() {
  dropGuess();
  dropHold();
  sync();
}

/**
 * O foco foi de um campo de digitar para a data ou um seletor. A folha fica
 * parada até o aparelho informar que o teclado saiu: descer no meio do toque
 * tiraria o campo de baixo do dedo e o poria atrás do teclado que ainda está ali.
 */
export function keyboardLeaving() {
  dropGuess();
  if (!open) return sync();
  dropHold();
  hold = setTimeout(() => { hold = 0; sync(); }, WAIT_MS);
  sync();
}

if (vv) {
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  for (const type of ['resize', 'orientationchange', 'pageshow', 'focus', 'blur']) window.addEventListener(type, sync);
  document.addEventListener('visibilitychange', sync);
  sync();
}
