// Contas: onde está o dinheiro (contas e seus papéis) e o que aconteceu (movimentações).

import { h, sheet, toast, amount } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import { formatBRL } from '../../core/money.js';
import { formatLong, addDays, TIME_ZONE } from '../../core/dates.js';
import { adjustSheet, transferSheet, addButton, editAccount, deleteAccount, listItem, transactionSheet, TX_LABEL } from '../editors.js';

const PAGE = 30;
let historyLimit = PAGE; // cresce com "Ver mais" e volta ao abrir a aba de novo

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
const accName = (id) => store.getAccount(id)?.name ?? 'conta excluída';

// ---------- movimentações ----------

/** Valor com o sinal padrão do app: gasto −, receita + verde, transferência neutra com ⇄. */
function txValue(t) {
  if (t.type === 'transfer' || t.type === 'contribution') {
    return h('span', { class: 'li-value tx-move' }, icon('transfer', { size: 15 }), formatBRL(t.amount));
  }
  if (t.type === 'income') return h('span', { class: 'li-value pos' }, `+${formatBRL(t.amount)}`);
  if (t.type === 'adjust') return h('span', { class: 'li-value' }, `${t.amount >= 0 ? '+' : '−'}${formatBRL(Math.abs(t.amount))}`);
  return h('span', { class: 'li-value' }, `−${formatBRL(t.amount)}`);
}

/** Uma linha de detalhe: hora (se houver), e a conta só quando não é a dos gastos do dia. */
function txSub(t, def) {
  if (t.type === 'transfer' || t.type === 'contribution') return `${accName(t.from)} → ${accName(t.to)}`;
  const time = t.createdAt && (t.type === 'spend' || t.type === 'income') ? timeFmt.format(new Date(t.createdAt)) : null;
  const acc = t.from || t.to;
  const parts = [time, acc !== def ? accName(acc) : null];
  return parts.filter(Boolean).join(', ') || null;
}

function txRow(t, def) {
  return h('li', {}, h('button', { class: 'list-item', onclick: () => transactionSheet(t) },
    h('span', { class: 'li-main' },
      h('span', { class: `li-title ${t.desc ? '' : 'muted'}` }, t.desc || TX_LABEL[t.type]),
      txSub(t, def) && h('span', { class: 'li-sub' }, txSub(t, def))),
    txValue(t)));
}

function dayLabel(today, date) {
  if (date === today) return 'Hoje';
  if (date === addDays(today, -1)) return 'Ontem';
  return formatLong(date);
}

/** Lista agrupada por dia, do mais recente para o mais antigo. */
function groupedByDay(ctx, txs) {
  const def = ctx.state.settings.defaultAccountId;
  const days = new Map();
  for (const t of txs) {
    if (!days.has(t.date)) days.set(t.date, []);
    days.get(t.date).push(t);
  }
  return [...days].map(([date, list]) => h('div', { class: 'day-group' },
    h('div', { class: 'day-head' }, h('strong', {}, dayLabel(ctx.today, date))),
    h('ul', { class: 'list' }, list.map((t) => txRow(t, def)))));
}

function recentFirst(txs) {
  // mais recentes primeiro: por data e, no mesmo dia, pela ordem de lançamento
  return txs.map((t, i) => [t, i]).sort((a, b) => (a[0].date === b[0].date ? b[1] - a[1] : a[0].date < b[0].date ? 1 : -1)).map(([t]) => t);
}

function history(ctx) {
  const all = recentFirst(ctx.state.transactions);
  if (!all.length) return null;
  const shown = all.slice(0, historyLimit);
  return [
    h('h2', { class: 'section-label' }, 'Movimentações'),
    h('section', { class: 'card flush' },
      groupedByDay(ctx, shown),
      all.length > shown.length && h('button', {
        class: 'btn quiet block', onclick: () => { historyLimit += PAGE; ctx.navigate('#/contas'); },
      }, 'Ver mais')),
  ];
}

// ---------- contas ----------

const ROLE_LABEL = { spend: 'Gastos do dia', reserve: 'Reserva' };

function roleOf(state, a) {
  if (a.id === state.settings.defaultAccountId) return 'spend';
  if (a.id === state.settings.reserveAccountId) return 'reserve';
  return 'none';
}

function goalsOf(state, a) {
  return state.goals.filter((g) => g.accountId === a.id).map((g) => g.name);
}

/** Uso da conta: gastos do dia, reserva ou nenhum (só contas de gasto). */
function roleChooser(ctx, a) {
  const current = roleOf(ctx.state, a);
  const others = ctx.state.accounts.filter((x) => x.kind === 'spending' && x.id !== a.id);
  const options = [
    ['spend', 'Gastos do dia', 'De onde saem os gastos lançados', null],
    ['reserve', 'Reserva', 'De onde vêm os resgates',
      current === 'spend' && !others.length ? 'Cadastre outra conta de gasto antes' : null],
    ['none', 'Nenhum', 'Só guarda saldo',
      current === 'spend' ? 'Escolha outra conta para os gastos do dia antes' : null],
  ];
  return h('div', { class: 'field' },
    h('span', { class: 'field-label' }, 'Uso'),
    h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Uso da conta' }, options.map(([key, title, sub, blocked]) => h('button', {
      type: 'button', class: 'choice', role: 'radio', 'aria-checked': String(key === current), disabled: !!blocked,
      onclick: () => {
        if (key === current) return;
        const moved = store.setAccountRole(a.id, key);
        accountSheet(ctx, store.getAccount(a.id));
        toast(moved ? `${moved.name} passa a ser a conta dos gastos do dia` : key === 'none' ? `${a.name} sem uso definido` : `${a.name}: ${ROLE_LABEL[key].toLowerCase()}`);
      },
    },
    h('span', { class: 'li-main' }, h('span', { class: 'li-title' }, title), h('span', { class: 'li-sub' }, blocked || sub)),
    h('span', { class: 'radio', 'aria-hidden': 'true' })))));
}

function accountSheet(ctx, a) {
  if (!a) return;
  const s = ctx.state.settings;
  const recent = recentFirst(ctx.state.transactions.filter((t) => t.from === a.id || t.to === a.id)).slice(0, 5);
  const goals = goalsOf(ctx.state, a);
  sheet(a.name, () => [
    h('div', { class: 'stat' },
      h('span', { class: 'stat-label' }, 'Saldo'),
      amount(formatBRL(a.balance), `lg ${a.balance < 0 ? 'neg' : ''}`, { 'data-fit': true })),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn grow', onclick: () => adjustSheet(a) }, icon('edit', { size: 18 }), 'Ajustar saldo'),
      h('button', {
        class: 'btn grow',
        onclick: () => transferSheet({ from: a.id, to: a.id === s.defaultAccountId ? s.reserveAccountId : s.defaultAccountId }),
      }, icon('transfer', { size: 18 }), 'Transferir')),
    a.kind === 'spending'
      ? roleChooser(ctx, a)
      : h('p', { class: 'field-hint' }, goals.length ? `Fora do orçamento. Usada por: ${goals.join(', ')}.` : 'Fora do orçamento.'),
    h('div', { class: 'field' },
      h('span', { class: 'field-label' }, 'Últimas movimentações'),
      recent.length
        ? h('div', { class: 'card inset' }, h('ul', { class: 'list' }, recent.map((t) => txRow(t, a.id))))
        : h('p', { class: 'empty' }, 'Nenhuma movimentação ainda.')),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn quiet grow', onclick: () => editAccount(a) }, 'Editar nome'),
      h('button', { class: 'btn danger-text grow', onclick: () => deleteAccount(a) }, 'Excluir conta')),
  ]);
}

function accountRow(ctx, a) {
  const sub = a.kind === 'goal' ? goalsOf(ctx.state, a).join(', ') || null : ROLE_LABEL[roleOf(ctx.state, a)] || null;
  return listItem(a.name, sub, h('span', { class: a.balance < 0 ? 'neg' : '' }, formatBRL(a.balance)), () => accountSheet(ctx, a));
}

export function renderAccounts(ctx) {
  if (ctx.prevRoute !== '#/contas') historyLimit = PAGE;
  const spending = ctx.state.accounts.filter((a) => a.kind === 'spending');
  const goal = ctx.state.accounts.filter((a) => a.kind === 'goal');
  const total = spending.reduce((s, a) => s + a.balance, 0);
  const outside = goal.reduce((s, a) => s + a.balance, 0);
  return h('div', { class: 'screen accounts' },
    h('header', { class: 'screen-head' }, h('div', { class: 'titles' }, h('h1', {}, 'Contas'))),
    h('section', { class: 'hero' },
      h('p', { class: 'hero-label' }, 'Nas contas de gasto'),
      amount(formatBRL(total), `summary-value lg ${total < 0 ? 'neg' : ''}`, { 'data-fit': true }),
      goal.length > 0 && h('p', { class: 'hero-note' }, `Fora do orçamento: ${formatBRL(outside)}`)),
    h('h2', { class: 'section-label' }, 'Contas de gasto'),
    h('section', { class: 'card flush' }, h('ul', { class: 'list' }, spending.map((a) => accountRow(ctx, a)))),
    goal.length > 0 && h('h2', { class: 'section-label' }, 'Fora do orçamento'),
    goal.length > 0 && h('section', { class: 'card flush' }, h('ul', { class: 'list' }, goal.map((a) => accountRow(ctx, a)))),
    h('section', { class: 'card flush' }, addButton('Nova conta', () => editAccount())),
    history(ctx));
}
