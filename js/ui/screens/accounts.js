import { h, toast, confirmDialog } from '../dom.js';
import * as store from '../../data/store.js';
import { formatBRL } from '../../core/money.js';
import { formatShort } from '../../core/dates.js';
import { adjustSheet, transferSheet, editAccount } from '../editors.js';

const TYPE_LABEL = {
  spend: 'Gasto', transfer: 'Transferência', adjust: 'Ajuste', income: 'Receita', expense: 'Despesa fixa', contribution: 'Aporte',
};

const HISTORY_LIMIT = 40;

function accountCard(ctx, a) {
  const s = ctx.state.settings;
  const tags = [
    a.id === s.defaultAccountId && 'padrão dos gastos',
    a.id === s.reserveAccountId && 'reserva',
  ].filter(Boolean);
  return h('section', { class: 'card account' },
    h('div', { class: 'row between' },
      h('div', {},
        h('p', { class: 'li-title' }, a.name),
        h('p', { class: 'muted small' }, a.kind === 'goal' ? 'Meta / investimento — fora do orçamento' : 'Conta de gasto', tags.length ? ` · ${tags.join(' · ')}` : '')),
      h('p', { class: `big ${a.balance < 0 ? 'neg' : ''}` }, formatBRL(a.balance))),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn ghost grow', onclick: () => adjustSheet(a) }, 'Ajustar saldo'),
      h('button', { class: 'btn ghost grow', onclick: () => transferSheet({ from: a.id, to: a.id === s.defaultAccountId ? s.reserveAccountId : s.defaultAccountId }) }, 'Transferir')));
}

function history(ctx) {
  const txs = [...ctx.state.transactions].reverse().slice(0, HISTORY_LIMIT);
  if (!txs.length) return null;
  const name = (id) => store.getAccount(id)?.name ?? '(conta excluída)';
  return h('section', { class: 'card' },
    h('h3', {}, 'Movimentações recentes'),
    h('ul', { class: 'list' }, txs.map((t) => {
      const route = t.from && t.to ? `${name(t.from)} → ${name(t.to)}` : name(t.from || t.to);
      const sign = t.type === 'transfer' || t.type === 'contribution' ? '' : t.to ? '+' : '−';
      const value = t.type === 'adjust' ? `${t.amount > 0 ? '+' : '−'}${formatBRL(Math.abs(t.amount))}` : `${sign}${formatBRL(t.amount)}`;
      return h('li', { class: 'row between tx' },
        h('span', { class: 'li-main' },
          h('span', {}, t.desc || TYPE_LABEL[t.type]),
          h('span', { class: 'li-sub' }, `${formatShort(t.date)} · ${TYPE_LABEL[t.type]} · ${route}`)),
        h('span', { class: 'row gap-sm' },
          h('strong', { class: sign === '+' || (t.type === 'adjust' && t.amount > 0) ? 'pos' : '' }, value),
          h('button', {
            class: 'icon-btn', 'aria-label': 'Excluir movimentação',
            onclick: async () => {
              if (await confirmDialog('Excluir movimentação?', 'O saldo das contas volta ao que era antes dela.', 'Excluir', true)) {
                store.deleteTransaction(t.id);
                toast('Movimentação excluída');
              }
            },
          }, '✕')));
    })));
}

export function renderAccounts(ctx) {
  const spending = ctx.state.accounts.filter((a) => a.kind === 'spending');
  const goal = ctx.state.accounts.filter((a) => a.kind === 'goal');
  const total = spending.reduce((s, a) => s + a.balance, 0);
  return h('div', { class: 'screen accounts' },
    h('header', { class: 'screen-head' }, h('h1', {}, 'Contas')),
    h('section', { class: 'card summary' },
      h('p', { class: 'muted small' }, 'Dinheiro gastável (contas de gasto)'),
      h('p', { class: `big ${total < 0 ? 'neg' : ''}` }, formatBRL(total))),
    spending.map((a) => accountCard(ctx, a)),
    goal.length > 0 && h('h2', { class: 'section-title' }, 'Fora do orçamento'),
    goal.map((a) => accountCard(ctx, a)),
    h('button', { class: 'btn ghost block', onclick: () => editAccount() }, '+ Nova conta'),
    history(ctx));
}
