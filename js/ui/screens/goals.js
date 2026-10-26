import { h } from '../dom.js';
import * as store from '../../data/store.js';
import { formatBRL, formatBRLShort } from '../../core/money.js';
import { formatFull, formatShort, diffDays } from '../../core/dates.js';
import { editGoal, editContribution } from '../editors.js';
import { pendingConfirmations } from '../../core/schedule.js';

function goalCard(ctx, g) {
  const { state, today } = ctx;
  const acc = store.getAccount(g.accountId);
  const saved = acc?.balance ?? 0;
  const missing = Math.max(0, g.target - saved);
  const pct = g.target > 0 ? Math.min(100, (saved / g.target) * 100) : 0;
  const days = diffDays(today, g.deadline);
  const contribs = state.contributions.filter((c) => c.goalId === g.id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const planned = contribs.filter((c) => !state.settled[`contribution:${c.id}`]).reduce((s, c) => s + c.amount, 0);
  const gapAfter = missing - planned;
  const shared = state.goals.filter((x) => x.accountId === g.accountId).length > 1;
  const pendingKeys = new Set(pendingConfirmations(state, today).map((e) => e.key));

  return h('section', { class: 'card goal' },
    h('div', { class: 'row between' },
      h('h3', {}, g.name),
      h('button', { class: 'btn small ghost', onclick: () => editGoal(g) }, 'Editar')),
    h('div', { class: 'row between' },
      h('p', { class: 'big' }, formatBRL(saved)),
      h('p', { class: 'muted' }, `de ${formatBRLShort(g.target)}`)),
    h('div', { class: 'meter goal-meter', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('span', { style: `width:${pct}%` })),
    h('div', { class: 'row between small' },
      h('span', {}, missing > 0 ? `Faltam ${formatBRL(missing)}` : h('span', { class: 'pos' }, 'Meta atingida!')),
      h('span', { class: days < 0 ? 'neg' : 'muted' },
        days > 0 ? `${days} ${days === 1 ? 'dia' : 'dias'} · ${formatFull(g.deadline)}` : days === 0 ? 'É hoje!' : `prazo vencido (${formatFull(g.deadline)})`)),
    missing > 0 && h('p', { class: 'small muted' },
      planned > 0
        ? (gapAfter > 0 ? `Com os aportes planejados ainda faltarão ${formatBRL(gapAfter)}.` : 'Os aportes planejados completam a meta.')
        : days > 0 ? `Para chegar lá: ${formatBRL(Math.ceil(missing / Math.max(1, Math.ceil(days / 30))))} por mês.` : ''),
    shared && h('p', { class: 'small muted' }, `A conta ${acc?.name} é usada por mais de uma meta; o progresso mostra o saldo total dela.`),
    h('h4', {}, 'Aportes'),
    contribs.length
      ? h('ul', { class: 'list' }, contribs.map((c) => {
        const done = state.settled[`contribution:${c.id}`];
        const status = done ? 'feito' : pendingKeys.has(`contribution:${c.id}`) ? 'confirmar em Hoje' : `planejado · ${diffDays(today, c.date)} dias`;
        return h('li', {}, h('button', { class: 'list-item', onclick: () => editContribution(c) },
          h('span', { class: 'li-main' },
            h('span', { class: 'li-title' }, formatShort(c.date)),
            h('span', { class: 'li-sub' }, `${status} · de ${store.getAccount(c.fromAccountId)?.name ?? '—'}`)),
          h('span', { class: `li-value ${done ? 'pos' : ''}` }, formatBRLShort(c.amount)),
          h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
      }))
      : h('p', { class: 'muted small' }, 'Nenhum aporte planejado.'),
    h('button', { class: 'btn ghost block', onclick: () => editContribution(null, g.id) }, '+ Planejar aporte'));
}

export function renderGoals(ctx) {
  const goals = [...ctx.state.goals].sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
  return h('div', { class: 'screen goals' },
    h('header', { class: 'screen-head' }, h('h1', {}, 'Metas')),
    goals.length ? goals.map((g) => goalCard(ctx, g)) : h('p', { class: 'muted' },
      'Nenhuma meta ainda. Uma meta usa uma conta do tipo “meta / investimento”, que fica fora do orçamento. Aportes são transferências de uma conta de gasto para ela.'),
    h('button', { class: 'btn primary block', onclick: () => editGoal() }, '+ Nova meta'));
}
