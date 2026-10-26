// Lançar gasto: teclado numérico grande, só o valor (nome opcional).

import { h, toast, sheet, fitText } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import { formatBRL, formatBRLShort } from '../../core/money.js';
import { computeDailyBudget } from '../../core/budget.js';
import { suggestRefill } from '../../core/refill.js';
import { todayISO } from '../../core/dates.js';
import { refillSheet } from './today.js';
import { spendNameList } from '../editors.js';

const MAX_DIGITS = 9;

function warnNegative(accountId) {
  const s = store.getState();
  const acc = store.getAccount(accountId);
  if (!acc || acc.balance >= 0 || accountId !== s.settings.defaultAccountId) return;
  const today = todayISO();
  const refill = suggestRefill(s, today, computeDailyBudget(s, today));
  const reserve = store.getAccount(refill.fromAccountId);
  setTimeout(() => sheet(`${acc.name} ficou negativa`, (close) => [
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Saldo agora'), h('span', { class: 'stat-value neg', 'data-fit': true }, formatBRL(acc.balance))),
      refill.amount > 0 && h('div', { class: 'stat right' }, h('span', { class: 'stat-label' }, 'Resgate sugerido'), h('span', { class: 'stat-value' }, formatBRLShort(refill.amount)))),
    h('p', { class: 'sheet-lead' }, refill.amount > 0
      ? `Traga o valor de ${reserve?.name} para cobrir o saldo e os próximos dias.`
      : 'Não há saldo na reserva para resgatar.'),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn grow', onclick: close }, 'Agora não'),
      refill.amount > 0 && h('button', { class: 'btn warn grow', onclick: () => refillSheet({ refill }) }, 'Resgatar')),
  ]), 350);
}

export function renderSpend(ctx) {
  const state = ctx.state;
  let text = ''; // o que foi digitado, ex.: "12,5"
  let accountId = state.settings.defaultAccountId;

  const display = h('p', { class: 'amount-display', 'aria-live': 'polite', 'data-fit': true });
  const hint = h('p', { class: 'amount-hint' });
  const desc = h('input', {
    type: 'text', placeholder: 'Nome do gasto (opcional)', maxlength: store.NAME_MAX, autocomplete: 'off',
    autocapitalize: 'sentences', enterkeyhint: 'done', list: 'nomes-gastos', 'aria-label': 'Nome do gasto',
  });
  const confirmBtn = h('button', { class: 'btn primary xl block', disabled: true, onclick: save });

  const cents = () => {
    if (!text) return 0;
    const [int, dec = ''] = text.split(',');
    return Number(int || 0) * 100 + Number((dec + '00').slice(0, 2));
  };

  function update() {
    const v = cents();
    display.textContent = formatBRL(v);
    display.classList.toggle('empty', v === 0);
    confirmBtn.disabled = v <= 0;
    confirmBtn.textContent = v > 0 ? `Lançar ${formatBRL(v)}` : 'Digite o valor';
    const left = ctx.budget.remainingToday - v;
    hint.textContent = v === 0
      ? `Resta para hoje: ${formatBRL(ctx.budget.remainingToday)}`
      : left >= 0 ? `Sobram ${formatBRL(left)} hoje` : `Passa ${formatBRL(-left)} do limite de hoje`;
    hint.classList.toggle('neg', v > 0 && left < 0);
    if (display.isConnected) fitText(display.parentElement);
  }

  function press(key) {
    if (key === 'del') text = text.slice(0, -1);
    else if (key === ',') { if (!text.includes(',')) text = (text || '0') + ','; }
    else {
      const [int, dec] = text.split(',');
      if (dec != null && dec.length >= 2) return;
      if (dec == null && (int || '').replace(/^0+/, '').length >= MAX_DIGITS) return;
      text = text === '0' ? key : text + key;
    }
    if (navigator.vibrate) navigator.vibrate(8);
    update();
  }

  function save() {
    const v = cents();
    if (v <= 0) return;
    const t = store.addSpend(v, desc.value.trim(), accountId);
    ctx.navigate('#/hoje', { replace: true });
    toast(`Gasto de ${formatBRL(v)} lançado`, {
      label: 'Desfazer', run: () => { store.deleteTransaction(t.id); toast('Gasto desfeito'); },
    });
    warnNegative(accountId);
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'];
  const pad = h('div', { class: 'keypad' }, keys.map((k) => h('button', {
    class: `key ${k === 'del' || k === ',' ? 'key-fn' : ''}`,
    'aria-label': k === 'del' ? 'Apagar' : k === ',' ? 'Vírgula' : k,
    onclick: () => press(k),
  }, k === 'del' ? icon('backspace', { size: 26 }) : k)));

  const spending = state.accounts.filter((a) => a.kind === 'spending');
  const chips = spending.length > 1 && h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Sai de' },
    spending.map((a) => {
      const chip = h('button', {
        class: `chip ${a.id === accountId ? 'on' : ''}`, role: 'radio', 'aria-checked': String(a.id === accountId),
        onclick: () => {
          accountId = a.id;
          chips.querySelectorAll('.chip').forEach((c) => { c.classList.remove('on'); c.setAttribute('aria-checked', 'false'); });
          chip.classList.add('on'); chip.setAttribute('aria-checked', 'true');
        },
      }, a.name);
      return chip;
    }));

  const onKey = (e) => {
    if (!document.body.contains(pad)) return document.removeEventListener('keydown', onKey);
    if (e.target === desc) { if (e.key === 'Enter') save(); return; }
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === ',' || e.key === '.') press(',');
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') save();
  };
  document.addEventListener('keydown', onKey);

  update();
  return h('div', { class: 'screen spend' },
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Voltar', onclick: () => ctx.navigate('#/hoje', { replace: true }) }, icon('back', { size: 24 })),
      h('h1', {}, 'Novo gasto'), h('span')),
    h('div', { class: 'amount-area' }, display, hint),
    h('div', { class: 'spend-opts' },
      chips && h('div', { class: 'row gap' }, h('span', { class: 'chips-label' }, 'Sai de'), chips),
      desc,
      spendNameList('nomes-gastos')),
    pad,
    confirmBtn);
}
