import { h, toast, confirmDialog } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import { formatBRL } from '../../core/money.js';
import { formatShort } from '../../core/dates.js';
import { adjustSheet, transferSheet, addButton, editAccount } from '../editors.js';

const TYPE_LABEL = {
  spend: 'Gasto', transfer: 'Transferência', adjust: 'Ajuste de saldo', income: 'Receita', expense: 'Despesa fixa', contribution: 'Aporte',
};

const HISTORY_LIMIT = 40;

function accountCard(ctx, a) {
  const s = ctx.state.settings;
  const badges = [
    a.id === s.defaultAccountId && h('span', { class: 'badge pos' }, 'Padrão dos gastos'),
    a.id === s.reserveAccountId && h('span', { class: 'badge' }, 'Reserva'),
  ].filter(Boolean);
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', { class: 'li-main' }, h('h3', { class: 'card-title' }, a.name), badges.length > 0 && h('div', { class: 'badges', style: 'margin-top:4px' }, badges)),
      h('span', { class: `stat-value ${a.balance < 0 ? 'neg' : ''}` }, formatBRL(a.balance))),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn small grow', onclick: () => adjustSheet(a) }, icon('edit', { size: 18 }), 'Ajustar'),
      h('button', {
        class: 'btn small grow',
        onclick: () => transferSheet({ from: a.id, to: a.id === s.defaultAccountId ? s.reserveAccountId : s.defaultAccountId }),
      }, icon('transfer', { size: 18 }), 'Transferir')));
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
      const route = isMove ? `${name(t.from)} → ${name(t.to)}` : name(t.from || t.to);
      return h('li', { class: 'row-item' },
        h('span', { class: 'li-main' },
          h('span', { class: 'li-title' }, t.desc || TYPE_LABEL[t.type]),
          h('span', { class: 'li-sub' }, `${formatShort(t.date)} · ${route}`)),
        h('span', { class: 'li-end' },
          h('span', { class: `li-value ${credit && !isMove ? 'pos' : ''}` }, value),
          h('button', {
            class: 'icon-btn', 'aria-label': 'Excluir movimentação',
            onclick: async () => {
              if (await confirmDialog('Excluir movimentação?', 'Os saldos voltam ao que eram antes dela.', 'Excluir', true)) {
                store.deleteTransaction(t.id);
                toast('Movimentação excluída');
              }
            },
          }, icon('trash', { size: 18 }))));
    }))),
  ];
}

export function renderAccounts(ctx) {
  const spending = ctx.state.accounts.filter((a) => a.kind === 'spending');
  const goal = ctx.state.accounts.filter((a) => a.kind === 'goal');
  const total = spending.reduce((s, a) => s + a.balance, 0);
  return h('div', { class: 'screen accounts' },
    h('header', { class: 'screen-head' },
      h('h1', {}, 'Contas'),
      h('p', { class: 'sub' }, 'Confira com o banco e ajuste quando precisar')),
    h('section', { class: 'card' },
      h('div', { class: 'stat' },
        h('span', { class: 'stat-label' }, 'Total para gastar'),
        h('span', { class: `stat-value ${total < 0 ? 'neg' : ''}`, style: 'font-size:1.75rem' }, formatBRL(total)))),
    h('h2', { class: 'section-label' }, 'Contas de gasto'),
    spending.map((a) => accountCard(ctx, a)),
    goal.length > 0 && h('h2', { class: 'section-label' }, 'Fora do orçamento'),
    goal.map((a) => accountCard(ctx, a)),
    h('section', { class: 'card flush' }, addButton('Nova conta', () => editAccount())),
    history(ctx));
}
