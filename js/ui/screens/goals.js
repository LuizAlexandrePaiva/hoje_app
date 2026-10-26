import { h } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../../data/store.js';
import { formatBRL, formatBRLShort } from '../../core/money.js';
import { formatDayMonth, diffDays, relative } from '../../core/dates.js';
import { editGoal, editContribution, addButton } from '../editors.js';
import { pendingConfirmations } from '../../core/schedule.js';

function goalCard(ctx, g) {
  const { state, today } = ctx;
  const year = Number(today.slice(0, 4));
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

  const status = missing === 0 ? h('span', { class: 'badge pos' }, 'Atingida')
    : days < 0 ? h('span', { class: 'badge neg' }, 'Prazo vencido')
      : h('span', { class: 'badge' }, days === 0 ? 'Hoje' : `${days} ${days === 1 ? 'dia' : 'dias'}`);

  const plan = missing === 0 ? null
    : planned > 0
      ? (gapAfter > 0 ? `Com os aportes planejados, ainda faltam ${formatBRL(gapAfter)}.` : 'Os aportes planejados completam a meta.')
      : days > 0 ? `Sem aportes planejados. Seriam ${formatBRL(Math.ceil(missing / Math.max(1, Math.ceil(days / 30))))} por mês.` : null;

  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', { class: 'li-main' },
        h('h2', { class: 'card-title' }, g.name),
        h('span', { class: 'li-sub' }, `Até ${formatDayMonth(g.deadline, year)} · ${acc?.name ?? '—'}`)),
      h('button', { class: 'icon-btn', 'aria-label': `Editar meta ${g.name}`, onclick: () => editGoal(g) }, icon('edit', { size: 20 }))),
    h('div', { class: 'row between', style: 'align-items:baseline' },
      h('span', { class: 'stat-value' }, formatBRL(saved)),
      h('span', { class: 'muted small' }, `de ${formatBRLShort(g.target)}`)),
    h('div', { class: 'meter lg', role: 'progressbar', 'aria-label': 'Progresso da meta', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('span', { style: `width:${pct}%` })),
    h('div', { class: 'row between' },
      h('span', { class: 'small' }, missing > 0 ? `Faltam ${formatBRL(missing)}` : 'Meta atingida'),
      status),
    plan && h('p', { class: 'small muted' }, plan),
    shared && h('p', { class: 'caption' }, `${acc?.name} é usada por mais de uma meta; o progresso mostra o saldo total.`),
    h('div', { class: 'card flush', style: 'background:var(--surface-2);padding:0 14px' },
      contribs.length > 0 && h('ul', { class: 'list' }, contribs.map((c) => {
        const done = state.settled[`contribution:${c.id}`];
        const st = done ? h('span', { class: 'badge pos' }, 'Feito')
          : pendingKeys.has(`contribution:${c.id}`) ? h('span', { class: 'badge warn' }, 'Confirmar') : null;
        return h('li', {}, h('button', { class: 'list-item', onclick: () => editContribution(c) },
          h('span', { class: 'li-main' },
            h('span', { class: 'row gap-sm' }, h('span', { class: 'li-title' }, `Aporte · ${formatDayMonth(c.date, year)}`), st),
            h('span', { class: 'li-sub' }, done ? `Saiu de ${store.getAccount(c.fromAccountId)?.name ?? '—'}` : relative(today, c.date))),
          h('span', { class: 'li-end' }, h('span', { class: 'li-value' }, formatBRLShort(c.amount)), icon('chevron', { size: 18, cls: 'chev' }))));
      })),
      addButton('Planejar aporte', () => editContribution(null, g.id))));
}

export function renderGoals(ctx) {
  const goals = [...ctx.state.goals].sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
  return h('div', { class: 'screen goals' },
    h('header', { class: 'screen-head' },
      h('h1', {}, 'Metas'),
      h('p', { class: 'sub' }, 'Dinheiro guardado fora do orçamento')),
    goals.length
      ? goals.map((g) => goalCard(ctx, g))
      : h('section', { class: 'card' },
        h('p', { class: 'card-title' }, 'Nenhuma meta ainda'),
        h('p', { class: 'small muted' }, 'Uma meta usa uma conta “de meta”. Os aportes saem de uma conta de gasto e já descontam do orçamento.')),
    h('section', { class: 'card flush' }, addButton('Nova meta', () => editGoal())));
}
