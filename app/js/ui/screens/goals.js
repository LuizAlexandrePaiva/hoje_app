// Metas: quanto já foi guardado, quanto falta e os aportes planejados.

import { h, amount } from '../dom.js';
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
  const pct = g.target > 0 ? Math.min(100, Math.max(0, (saved / g.target) * 100)) : 0;
  const days = diffDays(today, g.deadline);
  const contribs = state.contributions.filter((c) => c.goalId === g.id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const planned = contribs.filter((c) => !state.settled[`contribution:${c.id}`]).reduce((s, c) => s + c.amount, 0);
  const gapAfter = missing - planned;
  const shared = state.goals.filter((x) => x.accountId === g.accountId).length > 1;
  const pendingKeys = new Set(pendingConfirmations(state, today).map((e) => e.key));
  const reached = missing === 0;
  const late = !reached && days < 0;

  // estado em uma etiqueta: verde só quando atingida, vermelho só com prazo vencido
  const status = reached ? h('span', { class: 'badge pos' }, 'Atingida')
    : late ? h('span', { class: 'badge neg' }, 'Prazo vencido')
      : h('span', { class: 'badge' }, days === 0 ? 'Vence hoje' : days === 1 ? '1 dia restante' : `${days} dias restantes`);

  const plan = reached ? null
    : planned > 0
      ? (gapAfter > 0 ? `Com os aportes planejados, ainda faltam ${formatBRL(gapAfter)}.` : 'Os aportes planejados fecham a meta.')
      : days > 0 ? `Seriam ${formatBRL(Math.ceil(missing / Math.max(1, Math.ceil(days / 30))))} por mês até lá.` : null;

  return h('section', { class: 'card goal' },
    h('div', { class: 'card-head' },
      h('div', { class: 'li-main' },
        h('h2', { class: 'card-title' }, g.name),
        h('span', { class: 'li-sub' }, `Até ${formatDayMonth(g.deadline, year)}`)),
      h('button', { class: 'icon-btn', 'aria-label': `Editar meta ${g.name}`, onclick: () => editGoal(g) }, icon('edit', { size: 20 }))),
    h('div', { class: 'row between baseline gap' },
      amount(formatBRL(saved), `md ${reached ? 'pos' : ''}`, { 'data-fit': true }),
      h('span', { class: 'muted small', style: 'white-space:nowrap' }, `de ${formatBRLShort(g.target)}`)),
    h('div', { class: `meter ${reached ? '' : 'neutral'}`, role: 'progressbar', 'aria-label': 'Progresso da meta', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('span', { style: `width:${pct}%` })),
    h('div', { class: 'row between gap' },
      h('span', { class: 'small' }, reached ? 'Meta atingida' : `Faltam ${formatBRL(missing)}`),
      status),
    plan && h('p', { class: 'small muted' }, plan),
    shared && h('p', { class: 'caption' }, `${acc?.name} é usada por mais de uma meta. O progresso mostra o saldo total.`),
    h('div', { class: 'card inset' },
      contribs.length > 0 && h('ul', { class: 'list' }, contribs.map((c) => {
        const done = state.settled[`contribution:${c.id}`];
        const st = done ? h('span', { class: 'badge pos' }, 'Feito')
          : pendingKeys.has(`contribution:${c.id}`) ? h('span', { class: 'badge warn' }, 'Confirmar') : null;
        return h('li', {}, h('button', { class: 'list-item', onclick: () => editContribution(c) },
          h('span', { class: 'li-main' },
            h('span', { class: 'row gap-sm' }, h('span', { class: 'li-title' }, `Aporte em ${formatDayMonth(c.date, year)}`), st),
            h('span', { class: 'li-sub' }, done ? `Saiu de ${store.getAccount(c.fromAccountId)?.name ?? 'conta excluída'}` : relative(today, c.date))),
          h('span', { class: 'li-end' }, h('span', { class: 'li-value' }, formatBRLShort(c.amount)), icon('chevron', { size: 18, cls: 'chev' }))));
      })),
      addButton('Novo aporte', () => editContribution(null, g.id))));
}

export function renderGoals(ctx) {
  const goals = [...ctx.state.goals].sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
  return h('div', { class: 'screen goals' },
    h('header', { class: 'screen-head' }, h('div', { class: 'titles' }, h('h1', {}, 'Metas'))),
    goals.length
      ? goals.map((g) => goalCard(ctx, g))
      : h('section', { class: 'card' },
        h('p', { class: 'card-title' }, 'Nenhuma meta ainda'),
        h('p', { class: 'small muted' }, 'Uma meta acompanha o saldo de uma conta “de meta”. Os aportes saem de uma conta de gasto e já descontam do limite do dia.')),
    h('section', { class: 'card flush' }, addButton('Nova meta', () => editGoal())));
}
