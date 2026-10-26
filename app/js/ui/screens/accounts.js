import { h, sheet } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import { formatBRL } from '../../core/money.js';
import { formatShort } from '../../core/dates.js';
import { adjustSheet, transferSheet, addButton, editAccount, listItem, transactionSheet, TX_LABEL } from '../editors.js';

const HISTORY_LIMIT = 40;

function accountSheet(ctx, a) {
  const s = ctx.state.settings;
  sheet(a.name, () => [
    h('div', { class: 'stat' },
      h('span', { class: 'stat-label' }, 'Saldo'),
      h('span', { class: `stat-value ${a.balance < 0 ? 'neg' : ''}`, style: 'font-size:2rem', 'data-fit': true }, formatBRL(a.balance))),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn grow', onclick: () => adjustSheet(a) }, icon('edit', { size: 18 }), 'Ajustar saldo'),
      h('button', {
        class: 'btn grow',
        onclick: () => transferSheet({ from: a.id, to: a.id === s.defaultAccountId ? s.reserveAccountId : s.defaultAccountId }),
      }, icon('transfer', { size: 18 }), 'Transferir')),
    h('button', { class: 'btn quiet block', onclick: () => editAccount(a) }, 'Editar nome e tipo'),
  ]);
}

function role(ctx, a) {
  const s = ctx.state.settings;
  if (a.id === s.defaultAccountId) return 'Padrão dos gastos';
  if (a.id === s.reserveAccountId) return 'Reserva';
  return null;
}

function accountList(ctx, accounts) {
  return h('section', { class: 'card flush' },
    h('ul', { class: 'list' }, accounts.map((a) => listItem(a.name, role(ctx, a),
      h('span', { class: a.balance < 0 ? 'neg' : '' }, formatBRL(a.balance)), () => accountSheet(ctx, a)))));
}

function history(ctx) {
  const txs = [...ctx.state.transactions].reverse().slice(0, HISTORY_LIMIT);
  if (!txs.length) return null;
  const name = (id) => store.getAccount(id)?.name ?? 'conta excluída';
  return [
    h('h2', { class: 'section-label' }, 'Movimentações'),
    h('section', { class: 'card flush' }, h('ul', { class: 'list' }, txs.map((t) => {
      const isMove = t.type === 'transfer' || t.type === 'contribution';
      const credit = t.type === 'adjust' ? t.amount > 0 : !!t.to && !t.from;
      const value = isMove ? formatBRL(t.amount) : `${credit ? '+' : '−'}${formatBRL(Math.abs(t.amount))}`;
      const title = t.desc || TX_LABEL[t.type];
      const sub = isMove ? `${formatShort(t.date)}, ${name(t.from)} → ${name(t.to)}` : formatShort(t.date);
      return h('li', {}, h('button', { class: 'list-item', onclick: () => transactionSheet(t) },
        h('span', { class: 'li-main' }, h('span', { class: 'li-title' }, title), h('span', { class: 'li-sub' }, sub)),
        h('span', { class: `li-value ${credit && !isMove ? 'pos' : ''}` }, value)));
    }))),
  ];
}

export function renderAccounts(ctx) {
  const spending = ctx.state.accounts.filter((a) => a.kind === 'spending');
  const goal = ctx.state.accounts.filter((a) => a.kind === 'goal');
  const total = spending.reduce((s, a) => s + a.balance, 0);
  return h('div', { class: 'screen accounts' },
    h('header', { class: 'screen-head' }, h('h1', {}, 'Contas')),
    h('section', { class: 'hero' },
      h('p', { class: 'hero-label' }, 'Total para gastar'),
      h('p', { class: `hero-value ${total < 0 ? 'neg' : ''}`, style: 'color:var(--text);font-size:2.5rem', 'data-fit': true }, formatBRL(total))),
    h('h2', { class: 'section-label' }, 'Contas de gasto'),
    accountList(ctx, spending),
    goal.length > 0 && h('h2', { class: 'section-label' }, 'Fora do orçamento'),
    goal.length > 0 && accountList(ctx, goal),
    h('section', { class: 'card flush' }, addButton('Nova conta', () => editAccount())),
    history(ctx));
}
