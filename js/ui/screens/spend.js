// Lançar gasto: teclado numérico grande, só o valor (descrição opcional).

import { h, toast, sheet } from '../dom.js';
import * as store from '../../data/store.js';
import { formatBRL } from '../../core/money.js';
import { computeDailyBudget } from '../../core/budget.js';
import { suggestRefill } from '../../core/refill.js';
import { todayISO } from '../../core/dates.js';
import { refillSheet } from './today.js';

const MAX_DIGITS = 9;

export function renderSpend(ctx) {
  const state = ctx.state;
  let text = ''; // o que foi digitado, ex.: "12,5"
  let accountId = state.settings.defaultAccountId;

  const display = h('p', { class: 'amount-display', 'aria-live': 'polite' });
  const after = h('p', { class: 'muted small center' });
  const desc = h('input', { type: 'text', placeholder: 'Descrição (opcional)', class: 'desc-input', maxlength: 60, autocomplete: 'off' });
  const confirmBtn = h('button', { class: 'btn primary xl block', disabled: true, onclick: save }, 'Confirmar gasto');

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
    const remaining = ctx.budget.remainingToday - v;
    after.textContent = v > 0
      ? `Restante hoje após o gasto: ${formatBRL(remaining)}`
      : `Restante hoje: ${formatBRL(ctx.budget.remainingToday)}`;
    after.classList.toggle('neg', v > 0 && remaining < 0);
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
    const s = store.getState();
    const acc = store.getAccount(accountId);
    if (acc && acc.balance < 0 && accountId === s.settings.defaultAccountId) {
      const today = todayISO();
      const budget = computeDailyBudget(s, today);
      const refill = suggestRefill(s, today, budget);
      setTimeout(() => sheet(`${acc.name} ficou negativo`, (close) => [
        h('p', {}, `Saldo agora: `, h('strong', { class: 'neg' }, formatBRL(acc.balance)), '.'),
        refill.amount > 0
          ? h('p', { class: 'muted' }, `Sugestão: resgatar ${formatBRL(refill.amount)} de ${store.getAccount(refill.fromAccountId)?.name}.`)
          : h('p', { class: 'muted' }, 'Não há saldo na reserva para resgatar.'),
        h('div', { class: 'row gap' },
          h('button', { class: 'btn ghost grow', onclick: close }, 'Agora não'),
          refill.amount > 0 && h('button', { class: 'btn warn grow', onclick: () => refillSheet({ refill }) }, 'Registrar resgate')),
      ]), 350);
    }
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'];
  const pad = h('div', { class: 'keypad' }, keys.map((k) => h('button', {
    class: `key ${k === 'del' ? 'key-del' : ''}`,
    'aria-label': k === 'del' ? 'Apagar' : k,
    onclick: () => press(k),
  }, k === 'del' ? '⌫' : k)));

  const spending = state.accounts.filter((a) => a.kind === 'spending');
  const chips = spending.length > 1 && h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Conta' },
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
    h('header', { class: 'screen-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Voltar', onclick: () => ctx.navigate('#/hoje', { replace: true }) }, '←'),
      h('h1', {}, 'Lançar gasto'), h('span')),
    display,
    after,
    chips,
    desc,
    pad,
    confirmBtn);
}
