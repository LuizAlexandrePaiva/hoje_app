import * as store from './data/store.js';
import { todayISO } from './core/dates.js';
import { computeDailyBudget } from './core/budget.js';
import { suggestRefill, suggestSurplus } from './core/refill.js';
import { afterSheetClosed } from './ui/dom.js';
import { renderToday } from './ui/screens/today.js';
import { renderSpend } from './ui/screens/spend.js';
import { renderTimeline } from './ui/screens/timeline.js';
import { renderAccounts } from './ui/screens/accounts.js';
import { renderGoals } from './ui/screens/goals.js';
import { renderSettings } from './ui/screens/settings.js';
import { renderSetup } from './ui/screens/setup.js';

const ROUTES = {
  '#/hoje': renderToday,
  '#/gasto': renderSpend,
  '#/linha': renderTimeline,
  '#/contas': renderAccounts,
  '#/metas': renderGoals,
  '#/ajustes': renderSettings,
};
const FULLSCREEN = new Set(['#/gasto']);

const main = document.getElementById('main');
const tabbar = document.getElementById('tabbar');
let currentDay = todayISO();

function navigate(hash, { replace = false } = {}) {
  afterSheetClosed(() => {
    if (location.hash === hash) return render();
    if (replace) location.replace(hash);
    else location.hash = hash;
  });
}

function buildContext(state) {
  const today = todayISO();
  currentDay = today;
  const ctx = { state, today, navigate };
  if (state.setupDone) {
    ctx.budget = computeDailyBudget(state, today);
    ctx.refill = suggestRefill(state, today, ctx.budget);
    ctx.surplus = suggestSurplus(state, today, ctx.budget);
  }
  return ctx;
}

function render() {
  const state = store.getState();
  const ctx = buildContext(state);
  let route = location.hash;
  let view;
  if (!state.setupDone) {
    view = renderSetup(ctx);
    route = '#/setup';
  } else {
    if (!ROUTES[route]) route = '#/hoje';
    view = ROUTES[route](ctx);
  }
  const keepScroll = main.dataset.route === route;
  const y = window.scrollY;
  main.replaceChildren(view);
  main.dataset.route = route;
  window.scrollTo(0, keepScroll ? y : 0);
  tabbar.hidden = !state.setupDone || FULLSCREEN.has(route);
  for (const a of tabbar.querySelectorAll('a')) {
    a.classList.toggle('active', a.getAttribute('href') === route);
    if (a.getAttribute('href') === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

// Recalcula quando o dia vira (meia-noite em São Paulo) ou o app volta à frente.
function checkDay() {
  if (todayISO() !== currentDay) render();
}

store.load();
store.subscribe(render);
window.addEventListener('hashchange', render);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });
setInterval(checkDay, 60 * 1000);
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW não registrado', e));
  });
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
