// Lançar gasto ou receita: teclado numérico grande, só o valor (nome opcional).

import { h, toast, sheet, fitText, amountParts } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import { formatBRL, formatBRLShort } from '../../core/money.js';
import { computeDailyBudget, computeTomorrowBudget, withDelta } from '../../core/budget.js';
import { suggestRefill } from '../../core/refill.js';
import { todayISO, addDays, formatDayMonth } from '../../core/dates.js';
import { refillSheet } from './today.js';
import { nameList, editIncome } from '../editors.js';

const MAX_DIGITS = 9;
let cameFrom = '#/hoje'; // tela de onde o lançamento foi aberto; fechar volta para ela

const MODES = {
  spend: { label: 'Gasto', account: 'Sai de', placeholder: 'Nome do gasto (opcional)', list: 'nomes-gastos' },
  income: { label: 'Receita', account: 'Entra em', placeholder: 'Nome da receita (opcional)', list: 'nomes-receitas' },
};

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

/** Limite do dia se uma receita de `cents` entrasse agora na conta. */
function limitWithIncome(state, today, accountId, cents) {
  return computeDailyBudget(withDelta(state, accountId, cents), today).dailyBudget;
}

/** Limite de amanhã se um gasto de `cents` saísse agora da conta. */
function tomorrowAfterSpend(state, today, accountId, cents) {
  return computeTomorrowBudget(withDelta(state, accountId, -cents), today).dailyBudget;
}

export function renderSpend(ctx) {
  const state = ctx.state;
  if (ctx.prevRoute && !['#/gasto', '#/receita', '#/setup'].includes(ctx.prevRoute)) cameFrom = ctx.prevRoute;
  let mode = ctx.mode === 'income' ? 'income' : 'spend';
  let text = ''; // o que foi digitado, ex.: "12,5"
  let accountId = state.settings.defaultAccountId;

  const display = h('p', { class: 'amount amount-display', 'aria-live': 'polite', 'data-fit': true });
  const hint = h('p', { class: 'amount-hint' });
  const desc = h('input', {
    type: 'text', maxlength: store.NAME_MAX, autocomplete: 'off',
    autocapitalize: 'sentences', enterkeyhint: 'done',
  });
  const scheduleBtn = h('button', {
    class: 'icon-btn schedule-btn', 'aria-label': 'Agendar para outro dia', title: 'Agendar para outro dia', onclick: schedule,
  }, icon('calendar', { size: 22 }));
  const accountLabel = h('span', { class: 'chips-label' });
  const confirmBtn = h('button', { class: 'btn primary xl block', disabled: true, onclick: save });

  const cents = () => {
    if (!text) return 0;
    const [int, dec = ''] = text.split(',');
    return Number(int || 0) * 100 + Number((dec + '00').slice(0, 2));
  };

  function update() {
    const v = cents();
    const m = MODES[mode];
    display.replaceChildren(...amountParts(formatBRL(v)));
    display.classList.toggle('empty', v === 0);
    display.classList.toggle('income', mode === 'income');
    confirmBtn.disabled = v <= 0;
    confirmBtn.textContent = v > 0 ? `Lançar ${formatBRL(v)}` : 'Digite o valor';
    desc.placeholder = m.placeholder;
    desc.setAttribute('aria-label', m.placeholder.replace(' (opcional)', ''));
    desc.setAttribute('list', m.list);
    accountLabel.textContent = m.account;
    scheduleBtn.hidden = mode !== 'income';
    if (mode === 'income') {
      hint.classList.remove('neg');
      hint.textContent = v === 0
        ? 'Entra no saldo agora e aumenta o limite do dia'
        : `Limite do dia passa para ${formatBRL(limitWithIncome(state, ctx.today, accountId, v))}`;
    } else {
      const b = ctx.budget;
      const left = b.remainingToday - v; // do que está liberado agora
      const full = b.dailyBudget - b.spentToday - v; // do limite, contando receitas a confirmar
      const w = b.waiting;
      hint.textContent = v === 0
        ? (b.remainingToday >= 0 ? `Resta para gastar hoje: ${formatBRL(b.remainingToday)}` : `Já passou ${formatBRL(-b.remainingToday)} do limite de hoje`)
        : left >= 0 ? `Sobram ${formatBRL(left)} hoje`
          : full >= 0 ? `Passa ${formatBRL(-left)} do liberado até confirmar ${w.length === 1 ? w[0].name : 'as receitas pendentes'}`
            : `Passa ${formatBRL(-full)} do limite. Amanhã cai para ${formatBRL(tomorrowAfterSpend(state, ctx.today, accountId, v))}`;
      hint.classList.toggle('neg', v > 0 && full < 0);
    }
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
    const name = desc.value.trim();
    if (mode === 'income') {
      const t = store.addIncome(v, name, accountId);
      ctx.navigate('#/hoje', { replace: true });
      toast(`Receita de ${formatBRL(v)} lançada`, {
        label: 'Desfazer', run: () => { store.deleteTransaction(t.id); toast('Receita desfeita'); },
      });
      return;
    }
    const t = store.addSpend(v, name, accountId);
    ctx.navigate('#/hoje', { replace: true });
    toast(`Gasto de ${formatBRL(v)} lançado`, {
      label: 'Desfazer', run: () => { store.deleteTransaction(t.id); toast('Gasto desfeito'); },
    });
    warnNegative(accountId);
  }

  /** Receita que vai cair em outro dia: agenda uma receita única, já preenchida. */
  function schedule() {
    editIncome(null, {
      draft: {
        name: desc.value.trim(), amount: cents() || null, accountId,
        rule: { type: 'once', date: addDays(ctx.today, 1) },
      },
      onSaved: (inc) => {
        ctx.navigate('#/hoje', { replace: true });
        toast(`${inc.name}: agendada para ${formatDayMonth(inc.rule.date)}`);
      },
    });
  }

  const modeButtons = Object.entries(MODES).map(([key, m]) => h('button', {
    type: 'button', 'aria-pressed': String(key === mode),
    onclick: () => {
      mode = key;
      modeButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(Object.keys(MODES)[i] === mode)));
      update();
    },
  }, m.label));

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'];
  const pad = h('div', { class: 'keypad' }, keys.map((k) => h('button', {
    class: `key ${k === 'del' || k === ',' ? 'key-fn' : ''}`,
    'aria-label': k === 'del' ? 'Apagar' : k === ',' ? 'Vírgula' : k,
    onclick: () => press(k),
  }, k === 'del' ? icon('backspace', { size: 26 }) : k)));

  const spending = state.accounts.filter((a) => a.kind === 'spending');
  const chips = spending.length > 1 && h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Conta' },
    spending.map((a) => {
      const chip = h('button', {
        class: `chip ${a.id === accountId ? 'on' : ''}`, role: 'radio', 'aria-checked': String(a.id === accountId),
        onclick: () => {
          accountId = a.id;
          chips.querySelectorAll('.chip').forEach((c) => { c.classList.remove('on'); c.setAttribute('aria-checked', 'false'); });
          chip.classList.add('on'); chip.setAttribute('aria-checked', 'true');
          update();
        },
      }, a.name);
      return chip;
    }));

  const onKey = (e) => {
    if (!document.body.contains(pad)) return document.removeEventListener('keydown', onKey);
    if (e.target === desc) { if (e.key === 'Enter') save(); return; }
    if (e.target.closest?.('.sheet')) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === ',' || e.key === '.') press(',');
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') save();
  };
  document.addEventListener('keydown', onKey);

  update();
  return h('div', { class: 'screen spend' },
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: () => ctx.navigate(cameFrom, { replace: true }) }, icon('close', { size: 24 })),
      h('div', { class: 'segmented mode-toggle', role: 'group', 'aria-label': 'Tipo de lançamento' }, modeButtons),
      h('span')),
    h('div', { class: 'amount-area' }, display, hint),
    h('div', { class: 'spend-opts' },
      chips && h('div', { class: 'row gap' }, accountLabel, chips),
      h('div', { class: 'row gap-sm' }, desc, scheduleBtn),
      nameList(MODES.spend.list, 'spend'),
      nameList(MODES.income.list, 'income')),
    pad,
    confirmBtn);
}
